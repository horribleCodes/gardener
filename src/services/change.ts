import type Database from "better-sqlite3";
import {
  RuleError,
  type Magnitude,
  type Scope,
} from "../domain/types.js";
import type { Quote } from "../rules/cost.js";
import { quoteChange } from "../rules/cost.js";
import { withTransaction } from "../store/db.js";
import {
  coveredOnChange,
  insertBacklashProblem,
  insertFeatureFromText,
  quoteForChangeRow,
  requireCampaign,
  wrapRule,
  type ServiceResult,
} from "./util.js";

export function beginChange(
  db: Database.Database,
  input: {
    campaignId: string;
    owner: "pc" | "faction";
    scope: Scope;
    magnitude: Magnitude;
    kind: string;
    factionId?: string;
    placeIds?: string[];
    featureText?: string;
    godboundId?: string;
    petty?: boolean;
    deedsRequired?: number;
    challengesRequired?: number;
  },
): ServiceResult<{ changeId: string; quote: Quote }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      if (input.owner !== "pc") {
        throw new RuleError(
          "IMPOSSIBLE_FOR_FACTION",
          "faction-owned changes use enact_change via runAction",
        );
      }
      requireCampaign(db, input.campaignId);
      const wardRatings: number[] = [];
      if (input.placeIds?.length) {
        for (const placeId of input.placeIds) {
          const wards = db
            .prepare("SELECT rating FROM wards WHERE place_id = ?")
            .all(placeId) as { rating: number }[];
          for (const w of wards) wardRatings.push(w.rating);
        }
      }
      const quote = quoteChange({
        scope: input.scope,
        magnitude: input.magnitude,
        kind: input.kind as "feature" | "fact" | "problem_mitigation" | "creature_population" | "champion" | "other",
        wardRatings,
        resisterRatings: [],
        petty: input.petty,
        deedsRequired: input.deedsRequired,
        challengesRequired: input.challengesRequired,
      });
      const changeId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO changes (
          id, campaign_id, scope, magnitude, kind, place_ids, faction_id, owner, status,
          dominion_spent, deeds_required, deeds_done, challenges_required, challenges_done
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, 0, ?, 0)`,
      ).run(
        changeId,
        input.campaignId,
        input.scope,
        input.magnitude,
        input.kind,
        JSON.stringify(input.placeIds ?? []),
        input.factionId ?? null,
        input.owner,
        quote.deedsRequired,
        quote.challengesRequired,
      );
      if (input.featureText) {
        const factId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id)
           VALUES (?, ?, 'change', ?, ?, 'feature_draft', ?)`,
        ).run(factId, input.campaignId, changeId, input.featureText, changeId);
      }
      return { changeId, quote };
    }),
  );
}

export function commitResources(
  db: Database.Database,
  input: {
    changeId: string;
    godboundId: string;
    influence: number;
    wealthSpent?: number;
    backlash?: string;
    featureText?: string;
  },
): ServiceResult<{ status: string; covered: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const change = db
        .prepare(
          `SELECT id, campaign_id, scope, magnitude, kind, place_ids, faction_id, owner, status,
                  dominion_spent, deeds_required, deeds_done, challenges_required, challenges_done,
                  feature_id
           FROM changes WHERE id = ?`,
        )
        .get(input.changeId) as
        | {
            id: string;
            campaign_id: string;
            scope: Scope;
            magnitude: Magnitude;
            kind: string;
            place_ids: string;
            faction_id: string | null;
            owner: string;
            status: string;
            dominion_spent: number;
            deeds_required: number;
            deeds_done: number;
            challenges_required: number;
            challenges_done: number;
            feature_id: string | null;
          }
        | undefined;
      if (!change) throw new RuleError("ENTITY_NOT_FOUND", `change ${input.changeId} not found`);

      const godbound = db
        .prepare("SELECT id, influence FROM godbound WHERE id = ?")
        .get(input.godboundId) as { id: string; influence: number } | undefined;
      if (!godbound) throw new RuleError("ENTITY_NOT_FOUND", `godbound ${input.godboundId} not found`);
      if (godbound.influence < input.influence) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough influence to commit");
      }

      const wealthSpent = input.wealthSpent ?? 0;
      const existing = db
        .prepare(
          "SELECT influence FROM change_commitments WHERE change_id = ? AND godbound_id = ?",
        )
        .get(input.changeId, input.godboundId) as { influence: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE change_commitments SET influence = influence + ?, wealth_spent = wealth_spent + ?
           WHERE change_id = ? AND godbound_id = ?`,
        ).run(input.influence, wealthSpent, input.changeId, input.godboundId);
      } else {
        db.prepare(
          `INSERT INTO change_commitments (change_id, godbound_id, influence, wealth_spent)
           VALUES (?, ?, ?, ?)`,
        ).run(input.changeId, input.godboundId, input.influence, wealthSpent);
      }
      db.prepare("UPDATE godbound SET influence = influence - ? WHERE id = ?").run(
        input.influence,
        input.godboundId,
      );

      const quote = quoteForChangeRow(db, change);
      const covered = coveredOnChange(db, change.id, change.dominion_spent);
      let status = change.status;
      if (
        covered >= quote.total &&
        change.deeds_done >= change.deeds_required &&
        change.challenges_done >= change.challenges_required &&
        change.kind === "feature" &&
        change.faction_id &&
        !change.feature_id
      ) {
        const draft = db
          .prepare(
            "SELECT statement FROM facts WHERE source_change_id = ? AND kind = 'feature_draft' LIMIT 1",
          )
          .get(change.id) as { statement: string } | undefined;
        const featureText = input.featureText ?? draft?.statement;
        if (!featureText) {
          throw new RuleError("FILL_INCOMPLETE", "missing featureText");
        }
        const featureId = insertFeatureFromText(db, change.faction_id, featureText);
        const backlashId = insertBacklashProblem(db, change.faction_id, input.backlash);
        db.prepare(
          `UPDATE changes SET status = 'active', feature_id = ?, backlash_problem_id = ? WHERE id = ?`,
        ).run(featureId, backlashId, change.id);
        status = "active";
      } else if (covered >= quote.total) {
        status = change.deeds_done >= change.deeds_required &&
          change.challenges_done >= change.challenges_required
          ? "active"
          : change.status;
        if (status !== change.status) {
          db.prepare("UPDATE changes SET status = ? WHERE id = ?").run(status, change.id);
        }
      }

      return { status, covered };
    }),
  );
}

export function applyOutcome(
  db: Database.Database,
  input: {
    campaignId: string;
    factionId: string;
    removeFeatureId?: string;
    removeFeaturePartId?: string;
    reduceProblemId?: string;
    reduceBy?: number;
    addFeatureText?: string;
    backlash?: string;
  },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);

      if (input.removeFeatureId) {
        db.prepare("DELETE FROM feature_parts WHERE feature_id = ?").run(input.removeFeatureId);
        db.prepare("DELETE FROM features WHERE id = ? AND faction_id = ?").run(
          input.removeFeatureId,
          input.factionId,
        );
        return { removedFeatureId: input.removeFeatureId };
      }

      if (input.removeFeaturePartId) {
        const part = db
          .prepare("SELECT feature_id FROM feature_parts WHERE id = ?")
          .get(input.removeFeaturePartId) as { feature_id: string } | undefined;
        if (!part) throw new RuleError("ENTITY_NOT_FOUND", "feature part not found");
        db.prepare("DELETE FROM feature_parts WHERE id = ?").run(input.removeFeaturePartId);
        const remaining = db
          .prepare("SELECT COUNT(*) AS c FROM feature_parts WHERE feature_id = ?")
          .get(part.feature_id) as { c: number };
        if (remaining.c === 0) {
          db.prepare("DELETE FROM features WHERE id = ?").run(part.feature_id);
        }
        return { removedFeaturePartId: input.removeFeaturePartId };
      }

      if (input.reduceProblemId) {
        const problem = db
          .prepare(
            "SELECT id, points, intrinsic FROM problems WHERE id = ? AND faction_id = ?",
          )
          .get(input.reduceProblemId, input.factionId) as
          | { id: string; points: number; intrinsic: number }
          | undefined;
        if (!problem) throw new RuleError("ENTITY_NOT_FOUND", "problem not found");
        if (problem.intrinsic !== 0) {
          throw new RuleError("INTRINSIC_PROBLEM", "cannot reduce an intrinsic problem");
        }
        const reduceBy = input.reduceBy ?? problem.points;
        const newPoints = problem.points - reduceBy;
        if (newPoints <= 0) {
          db.prepare("DELETE FROM problems WHERE id = ?").run(problem.id);
        } else {
          db.prepare("UPDATE problems SET points = ? WHERE id = ?").run(newPoints, problem.id);
        }
        return { reducedProblemId: problem.id, pointsRemaining: Math.max(0, newPoints) };
      }

      if (input.addFeatureText) {
        const featureId = insertFeatureFromText(db, input.factionId, input.addFeatureText);
        const backlashId = insertBacklashProblem(db, input.factionId, input.backlash);
        return { featureId, backlashProblemId: backlashId };
      }

      throw new RuleError("FILL_INCOMPLETE", "applyOutcome requires an outcome target");
    }),
  );
}
