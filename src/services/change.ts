import type Database from "better-sqlite3";
import {
  RuleError,
  type Magnitude,
  type Scope,
} from "../domain/types.js";
import type { Quote } from "../rules/cost.js";
import { quoteChange } from "../rules/cost.js";
import { withTransaction } from "../store/db.js";
import { loadCatalog } from "../tables/catalog.js";
import { influenceFromWealth } from "../rules/wealth.js";
import {
  coveredOnChange,
  insertBacklashProblem,
  insertFeatureFromText,
  nextProblemPosition,
  quoteForChangeRow,
  requireCampaign,
  resisterRatingsForChange,
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
    heroId?: string;
    petty?: boolean;
    deedsRequired?: number;
    challengesRequired?: number;
    resisters?: { rating: number; label?: string }[];
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
        resisterRatings: input.resisters?.map((r) => r.rating) ?? [],
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
      if (input.resisters?.length) {
        for (const r of input.resisters) {
          db.prepare(
            `INSERT INTO resisters (id, change_id, rating, label) VALUES (?, ?, ?, ?)`,
          ).run(crypto.randomUUID(), changeId, r.rating, r.label ?? "");
        }
      }
      if (input.featureText) {
        const factId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id, visibility)
           VALUES (?, ?, 'change', ?, ?, 'feature_draft', ?, 'privileged')`,
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
    heroId: string;
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

      const hero = db
        .prepare("SELECT id, influence FROM heroes WHERE id = ?")
        .get(input.heroId) as { id: string; influence: number } | undefined;
      if (!hero) throw new RuleError("ENTITY_NOT_FOUND", `hero ${input.heroId} not found`);
      if (input.influence < 0) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "cannot commit negative influence");
      }
      const wealthSpent = input.wealthSpent ?? 0;
      let influenceDebit = input.influence;
      if (wealthSpent > 0) {
        const gbRow = db
          .prepare("SELECT wealth FROM heroes WHERE id = ?")
          .get(input.heroId) as { wealth: number };
        const converted = influenceFromWealth(gbRow.wealth, wealthSpent);
        influenceDebit += converted.influence;
        db.prepare("UPDATE heroes SET wealth = wealth - ? WHERE id = ?").run(
          converted.wealthUsed,
          input.heroId,
        );
      }
      if (hero.influence < influenceDebit) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough influence to commit");
      }
      const existing = db
        .prepare(
          "SELECT influence FROM change_commitments WHERE change_id = ? AND hero_id = ?",
        )
        .get(input.changeId, input.heroId) as { influence: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE change_commitments SET influence = influence + ?, wealth_spent = wealth_spent + ?
           WHERE change_id = ? AND hero_id = ?`,
        ).run(input.influence, wealthSpent, input.changeId, input.heroId);
      } else {
        db.prepare(
          `INSERT INTO change_commitments (change_id, hero_id, influence, wealth_spent)
           VALUES (?, ?, ?, ?)`,
        ).run(input.changeId, input.heroId, input.influence, wealthSpent);
      }
      db.prepare("UPDATE heroes SET influence = influence - ? WHERE id = ?").run(
        influenceDebit,
        input.heroId,
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
        const feature = db
          .prepare("SELECT id FROM features WHERE id = ? AND faction_id = ?")
          .get(input.removeFeatureId, input.factionId) as { id: string } | undefined;
        if (!feature) throw new RuleError("ENTITY_NOT_FOUND", "feature not found");
        db.prepare("DELETE FROM feature_parts WHERE feature_id = ?").run(input.removeFeatureId);
        db.prepare("DELETE FROM features WHERE id = ? AND faction_id = ?").run(
          input.removeFeatureId,
          input.factionId,
        );
        return { removedFeatureId: input.removeFeatureId };
      }

      if (input.removeFeaturePartId) {
        const part = db
          .prepare(
            `SELECT fp.feature_id FROM feature_parts fp
             INNER JOIN features f ON f.id = fp.feature_id
             WHERE fp.id = ? AND f.faction_id = ?`,
          )
          .get(input.removeFeaturePartId, input.factionId) as { feature_id: string } | undefined;
        if (!part) throw new RuleError("ENTITY_NOT_FOUND", "feature part not found");
        db.prepare("DELETE FROM feature_parts WHERE id = ?").run(input.removeFeaturePartId);
        const remaining = db
          .prepare("SELECT COUNT(*) AS c FROM feature_parts WHERE feature_id = ?")
          .get(part.feature_id) as { c: number };
        if (remaining.c === 0) {
          db.prepare("DELETE FROM features WHERE id = ? AND faction_id = ?").run(
            part.feature_id,
            input.factionId,
          );
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

export function withdrawInfluence(
  db: Database.Database,
  input: { changeId: string; heroId: string },
): ServiceResult<{ status: string; covered: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const change = db
        .prepare(
          `SELECT id, status, dominion_spent, deeds_required, deeds_done, challenges_required, challenges_done, feature_id
           FROM changes WHERE id = ?`,
        )
        .get(input.changeId) as
        | {
            id: string;
            status: string;
            dominion_spent: number;
            deeds_required: number;
            deeds_done: number;
            challenges_required: number;
            challenges_done: number;
            feature_id: string | null;
          }
        | undefined;
      if (!change) throw new RuleError("ENTITY_NOT_FOUND", "change not found");

      const prior = db
        .prepare(
          "SELECT influence FROM change_commitments WHERE change_id = ? AND hero_id = ?",
        )
        .get(input.changeId, input.heroId) as { influence: number } | undefined;
      const returned = prior?.influence ?? 0;
      db.prepare(
        "UPDATE change_commitments SET influence = 0 WHERE change_id = ? AND hero_id = ?",
      ).run(input.changeId, input.heroId);
      if (returned > 0) {
        db.prepare("UPDATE heroes SET influence = influence + ? WHERE id = ?").run(
          returned,
          input.heroId,
        );
      }

      const row = db
        .prepare("SELECT id, scope, magnitude, kind, place_ids FROM changes WHERE id = ?")
        .get(input.changeId) as {
        id: string;
        scope: Scope;
        magnitude: Magnitude;
        kind: string;
        place_ids: string;
      };
      const quote = quoteForChangeRow(db, row);
      const covered = coveredOnChange(db, change.id, change.dominion_spent);
      let status = change.status;
      if (covered < quote.total) {
        status = "decaying";
        db.prepare("UPDATE changes SET status = ? WHERE id = ?").run(status, change.id);
        if (change.feature_id) {
          db.prepare("UPDATE features SET maintained = 0 WHERE id = ?").run(change.feature_id);
        }
      }
      return { status, covered };
    }),
  );
}

export function assessWithdrawal(
  db: Database.Database,
  input: { changeId: string; event?: boolean },
): ServiceResult<{
  opposed: boolean;
  beyond_local_maintenance: boolean;
  persists_uncontrolled: boolean;
}> {
  return wrapRule(() => {
    const change = db
      .prepare(
        "SELECT id, campaign_id, magnitude, kind, faction_id, feature_id FROM changes WHERE id = ?",
      )
      .get(input.changeId) as
      | {
          id: string;
          campaign_id: string;
          magnitude: Magnitude;
          kind: string;
          faction_id: string | null;
          feature_id: string | null;
        }
      | undefined;
    if (!change) throw new RuleError("ENTITY_NOT_FOUND", "change not found");

    const resisters = db
      .prepare("SELECT id FROM resisters WHERE change_id = ?")
      .all(change.id) as { id: string }[];
    let opposed = resisters.length > 0;
    if (change.faction_id) {
      const incoming = db
        .prepare(
          `SELECT id FROM interests WHERE to_faction_id = ? AND nature IN ('rivalry', 'spies') LIMIT 1`,
        )
        .get(change.faction_id);
      if (incoming) opposed = true;
    }

    let beyond =
      change.magnitude === "improbable" ||
      change.magnitude === "impossible" ||
      change.magnitude === "vast";
    if (!beyond && change.feature_id) {
      const feature = db
        .prepare("SELECT origin FROM features WHERE id = ?")
        .get(change.feature_id) as { origin: string } | undefined;
      if (feature?.origin === "improbable" || feature?.origin === "impossible") {
        beyond = true;
      }
    }
    const persists =
      (change.kind === "fact" || change.kind === "other") && input.event === true;

    return {
      opposed,
      beyond_local_maintenance: beyond,
      persists_uncontrolled: persists,
    };
  });
}

export function resolveWithdrawal(
  db: Database.Database,
  input: { changeId: string; choice: "undo" | "leave_fragile" | "stable" },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const change = db
        .prepare("SELECT id, campaign_id, status, feature_id, faction_id FROM changes WHERE id = ?")
        .get(input.changeId) as
        | {
            id: string;
            campaign_id: string;
            status: string;
            feature_id: string | null;
            faction_id: string | null;
          }
        | undefined;
      if (!change) throw new RuleError("ENTITY_NOT_FOUND", "change not found");
      if (change.status !== "decaying") {
        throw new RuleError("CHANGE_NOT_READY", "change is not decaying");
      }

      if (input.choice === "undo") {
        const facts = db
          .prepare(
            "SELECT id FROM facts WHERE source_change_id = ? AND superseded_by IS NULL",
          )
          .all(change.id) as { id: string }[];
        for (const f of facts) {
          const old = db
            .prepare(
              "SELECT campaign_id, subject, subject_id, statement, kind, source_change_id, visibility, place_id FROM facts WHERE id = ?",
            )
            .get(f.id) as {
            campaign_id: string;
            subject: string;
            subject_id: string;
            statement: string;
            kind: string;
            source_change_id: string | null;
            visibility: string;
            place_id: string | null;
          };
          const newId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id, visibility, place_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            newId,
            old.campaign_id,
            old.subject,
            old.subject_id,
            `${old.statement} (undone)`,
            old.kind,
            old.source_change_id,
            old.visibility,
            old.place_id,
          );
          db.prepare("UPDATE facts SET superseded_by = ? WHERE id = ?").run(newId, f.id);
        }
        if (change.feature_id) {
          db.prepare("DELETE FROM feature_parts WHERE feature_id = ?").run(change.feature_id);
          db.prepare("DELETE FROM features WHERE id = ?").run(change.feature_id);
        }
        db.prepare("UPDATE changes SET status = 'failed' WHERE id = ?").run(change.id);
        return { choice: "undo" };
      }

      if (input.choice === "leave_fragile") {
        if (!change.faction_id) {
          throw new RuleError("ENTITY_NOT_FOUND", "change has no faction");
        }
        const catalog = loadCatalog();
        db.prepare(
          `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
           VALUES (?, ?, ?, 1, 'cultural', 0, 0, 0, ?)`,
        ).run(
          crypto.randomUUID(),
          change.faction_id,
          catalog.backlash[0],
          nextProblemPosition(db, change.faction_id),
        );
        db.prepare("UPDATE changes SET status = 'resolved' WHERE id = ?").run(change.id);
        return { choice: "leave_fragile" };
      }

      if (change.feature_id) {
        db.prepare("UPDATE features SET maintained = 1 WHERE id = ?").run(change.feature_id);
      }
      db.prepare("UPDATE changes SET status = 'resolved' WHERE id = ?").run(change.id);
      return { choice: "stable" };
    }),
  );
}

export function expandChange(
  db: Database.Database,
  input: {
    changeId: string;
    scope: Scope;
    magnitude: Magnitude;
    kind?: string;
    placeIds?: string[];
    influence?: number;
    dominion?: number;
    heroId?: string;
    childStatement: string;
  },
): ServiceResult<{ quote: Quote; deltaPaid: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const change = db
        .prepare(
          `SELECT id, campaign_id, scope, magnitude, kind, place_ids, faction_id, dominion_spent,
                  deeds_required, deeds_done, challenges_required, challenges_done, status
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
            dominion_spent: number;
            deeds_required: number;
            deeds_done: number;
            challenges_required: number;
            challenges_done: number;
            status: string;
          }
        | undefined;
      if (!change) throw new RuleError("ENTITY_NOT_FOUND", "change not found");

      const oldQuote = quoteForChangeRow(db, change);
      const placeIdsForQuote =
        input.placeIds ?? (JSON.parse(change.place_ids) as string[]);
      const newQuote = quoteChange({
        scope: input.scope,
        magnitude: input.magnitude,
        kind: (input.kind ?? change.kind) as "feature" | "fact" | "problem_mitigation" | "creature_population" | "champion" | "other",
        wardRatings: placeIdsForQuote.flatMap((placeId) => {
          const wards = db
            .prepare("SELECT rating FROM wards WHERE place_id = ?")
            .all(placeId) as { rating: number }[];
          return wards.map((w) => w.rating);
        }),
        resisterRatings: resisterRatingsForChange(db, change.id),
      });

      let deltaPaid = 0;
      if (input.scope === change.scope && input.magnitude === change.magnitude) {
        const factId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id)
           VALUES (?, ?, 'change', ?, ?, 'change', ?)`,
        ).run(factId, change.campaign_id, change.id, input.childStatement, change.id);
        return { quote: newQuote, deltaPaid: 0 };
      }

      deltaPaid = Math.max(0, newQuote.total - oldQuote.total);
      const influence = input.influence ?? 0;
      const dominion = input.dominion ?? 0;
      if (influence + dominion < deltaPaid) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough to expand change");
      }
      if (!input.heroId && influence > 0) {
        throw new RuleError("FILL_INCOMPLETE", "heroId required for influence payment");
      }
      if (input.heroId && influence > 0) {
        const gb = db
          .prepare("SELECT influence FROM heroes WHERE id = ?")
          .get(input.heroId) as { influence: number } | undefined;
        if (!gb || gb.influence < influence) {
          throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough influence");
        }
        db.prepare("UPDATE heroes SET influence = influence - ? WHERE id = ?").run(
          influence,
          input.heroId,
        );
        const existing = db
          .prepare(
            "SELECT influence FROM change_commitments WHERE change_id = ? AND hero_id = ?",
          )
          .get(change.id, input.heroId) as { influence: number } | undefined;
        if (existing) {
          db.prepare(
            "UPDATE change_commitments SET influence = influence + ? WHERE change_id = ? AND hero_id = ?",
          ).run(influence, change.id, input.heroId);
        } else {
          db.prepare(
            `INSERT INTO change_commitments (change_id, hero_id, influence, wealth_spent) VALUES (?, ?, ?, 0)`,
          ).run(change.id, input.heroId, influence);
        }
      }
      if (dominion > 0) {
        if (!change.faction_id) {
          throw new RuleError("FILL_INCOMPLETE", "dominion payment requires faction-owned change");
        }
        const faction = db
          .prepare("SELECT dominion FROM factions WHERE id = ?")
          .get(change.faction_id) as { dominion: number };
        if (!faction || faction.dominion < dominion) {
          throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion to expand");
        }
        db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(
          dominion,
          change.faction_id,
        );
        db.prepare("UPDATE changes SET dominion_spent = dominion_spent + ? WHERE id = ?").run(
          dominion,
          change.id,
        );
      }

      db.prepare(
        `UPDATE changes SET scope = ?, magnitude = ?, place_ids = ?, deeds_required = ?, challenges_required = ? WHERE id = ?`,
      ).run(
        input.scope,
        input.magnitude,
        JSON.stringify(input.placeIds ?? JSON.parse(change.place_ids)),
        Math.max(change.deeds_done, newQuote.deedsRequired),
        Math.max(change.challenges_done, newQuote.challengesRequired),
        change.id,
      );

      const factId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id)
         VALUES (?, ?, 'change', ?, ?, 'change', ?)`,
      ).run(factId, change.campaign_id, change.id, input.childStatement, change.id);

      return { quote: newQuote, deltaPaid };
    }),
  );
}
