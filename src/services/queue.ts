import type Database from "better-sqlite3";
import { RuleError } from "../domain/types.js";
import {
  collectSnapshotIds,
  planReferencesUnknown,
  projectUnitView,
  type CampaignWorld,
  type UnitRef,
} from "../rules/knowledge.js";
import { withWriteLock } from "../store/lock.js";
import { withTransaction } from "../store/db.js";
import type { FactionAction } from "./turn.js";
import {
  planFactionAction,
  loadFactionRow,
  advanceMonth,
  resolveAttack,
} from "./turn.js";
import { runAction } from "./actions.js";
import { requireCampaign, wrapRule, type ServiceResult } from "./util.js";
import { mulberry32 } from "../rules/dice.js";

export function loadCampaignWorld(db: Database.Database, campaignId: string): CampaignWorld {
  const factions = (
    db
      .prepare(
        `SELECT id, name, power, cohesion, dominion, home_place_id AS homePlaceId, behavior, status, control
         FROM factions WHERE campaign_id = ?`,
      )
      .all(campaignId) as WorldFactionRow[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    power: r.power,
    cohesion: r.cohesion,
    dominion: r.dominion,
    homePlaceId: r.homePlaceId,
    behavior: r.behavior,
    status: r.status,
    control: r.control,
  }));

  const factionIds = new Set(factions.map((f) => f.id));

  const places = (
    db
      .prepare(
        `SELECT id, name, scope, parent_place_id AS parentPlaceId FROM places WHERE campaign_id = ?`,
      )
      .all(campaignId) as { id: string; name: string; scope: string; parentPlaceId: string | null }[]
  );

  const features = (
    db
      .prepare(
        `SELECT f.id, f.faction_id AS factionId, f.text, f.domain, f.covert
         FROM features f
         JOIN factions fa ON fa.id = f.faction_id
         WHERE fa.campaign_id = ?`,
      )
      .all(campaignId) as {
      id: string;
      factionId: string;
      text: string;
      domain: string;
      covert: number;
    }[]
  ).map((f) => ({ ...f, covert: f.covert !== 0 }));

  const problems = (
    db
      .prepare(
        `SELECT p.id, p.faction_id AS factionId, p.text, p.domain, p.points, p.intrinsic
         FROM problems p
         JOIN factions fa ON fa.id = p.faction_id
         WHERE fa.campaign_id = ?`,
      )
      .all(campaignId) as {
      id: string;
      factionId: string;
      text: string;
      domain: string;
      points: number;
      intrinsic: number;
    }[]
  ).map((p) => ({ ...p, intrinsic: p.intrinsic !== 0 }));

  const interests = db
    .prepare(
      `SELECT from_faction_id AS fromFactionId, to_faction_id AS toFactionId, points, nature
       FROM interests WHERE from_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    )
    .all(campaignId) as CampaignWorld["interests"];

  const courts = (
    db
      .prepare(
        `SELECT id, type, power_structure AS powerStructure, atmosphere, place_id AS placeId,
                rules_faction_id AS rulesFactionId, acts_on_own AS actsOnOwn
         FROM courts WHERE campaign_id = ?`,
      )
      .all(campaignId) as {
      id: string;
      type: string;
      powerStructure: string;
      atmosphere: string;
      placeId: string | null;
      rulesFactionId: string | null;
      actsOnOwn: number;
    }[]
  ).map((c) => ({ ...c, members: [] }));

  const characters = (
    db
      .prepare(
        `SELECT id, name, stat_note AS statNote, court_id AS courtId, faction_id AS factionId,
                is_hidden_controller AS isHiddenController, acts_on_own AS actsOnOwn
         FROM characters WHERE campaign_id = ?`,
      )
      .all(campaignId) as WorldCharacterRow[]
  ).map((c) => ({
    id: c.id,
    name: c.name,
    statNote: c.statNote,
    courtId: c.courtId,
    factionId: c.factionId,
    isHiddenController: c.isHiddenController !== 0,
    actsOnOwn: c.actsOnOwn,
  }));

  const facts = (
    db
      .prepare(
        `SELECT id, subject, subject_id AS subjectId, statement, visibility
         FROM facts WHERE campaign_id = ?`,
      )
      .all(campaignId) as CampaignWorld["facts"]
  );

  const events = (
    db
      .prepare(`SELECT id, type, payload FROM events WHERE campaign_id = ?`)
      .all(campaignId) as { id: string; type: string; payload: string }[]
  ).map((e) => ({
    id: e.id,
    type: e.type,
    payload: JSON.parse(e.payload) as unknown,
  }));

  return {
    factions,
    places,
    features,
    problems,
    interests,
    courts,
    characters,
    facts,
    events,
  };
}

type WorldFactionRow = {
  id: string;
  name: string;
  power: 1 | 2 | 3 | 4 | 5;
  cohesion: number;
  dominion: number;
  homePlaceId: string | null;
  behavior: string;
  status: string;
  control: string;
};

type WorldCharacterRow = {
  id: string;
  name: string | null;
  statNote: string | null;
  courtId: string | null;
  factionId: string | null;
  isHiddenController: number;
  actsOnOwn: number;
};

function shuffleUnitIds(ids: string[], rng: { next(): number }): string[] {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function defaultActingFactionIds(db: Database.Database, campaignId: string): string[] {
  return (
    db
      .prepare(
        `SELECT id FROM factions
         WHERE campaign_id = ? AND status = 'active' AND control = 'npc'`,
      )
      .all(campaignId) as { id: string }[]
  ).map((r) => r.id);
}

function freezeView(
  db: Database.Database,
  turnId: string,
  unit: UnitRef,
  world: CampaignWorld,
): void {
  const snapshot = projectUnitView(world, unit);
  db.prepare(
    `INSERT INTO unit_views (id, turn_id, unit_type, unit_id, snapshot)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), turnId, unit.type, unit.id, JSON.stringify(snapshot));
}

export function openParallelTurn(
  db: Database.Database,
  dbPath: string,
  input: {
    campaignId: string;
    unitIds?: string[];
    missing?: "idle" | "mechanical";
    advanceMonth?: boolean;
  },
): ServiceResult<{ turnId: string; unitIds: string[]; missing: "idle" | "mechanical"; advanceMonth: boolean }> {
  return wrapRule(() =>
    withWriteLock(dbPath, () =>
      withTransaction(db, () => {
        const existing = db
          .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
          .get(input.campaignId) as { id: string } | undefined;
        if (existing) {
          throw new RuleError("TURN_ALREADY_OPEN", "a turn is already open");
        }

        const missing = input.missing ?? "idle";
        const advanceMonthFlag = input.advanceMonth ?? false;
        let order: string[];
        if (input.unitIds && input.unitIds.length > 0) {
          order = [...input.unitIds];
        } else {
          const acting = defaultActingFactionIds(db, input.campaignId);
          const campaign = requireCampaign(db, input.campaignId);
          const rng = mulberry32(campaign.rng_seed + campaign.roll_counter);
          order = shuffleUnitIds(acting, rng);
        }

        const campaign = requireCampaign(db, input.campaignId);
        const turnId = crypto.randomUUID();
        const seqRow = db
          .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM turns WHERE campaign_id = ?")
          .get(input.campaignId) as { seq: number };

        db.prepare(
          `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
           VALUES (?, ?, ?, ?, 1, ?)`,
        ).run(turnId, input.campaignId, campaign.month, seqRow.seq, JSON.stringify(order));

        const world = loadCampaignWorld(db, input.campaignId);
        for (const factionId of order) {
          freezeView(db, turnId, { type: "faction", id: factionId }, world);
        }

        return { turnId, unitIds: order, missing, advanceMonth: advanceMonthFlag };
      }),
    ),
  );
}

export function getUnitView(
  db: Database.Database,
  input: { campaignId: string; unitType: string; unitId: string },
): ServiceResult<unknown> {
  return wrapRule(() => {
    const turn = db
      .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
      .get(input.campaignId) as { id: string } | undefined;
    if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");
    const row = db
      .prepare(
        `SELECT snapshot FROM unit_views WHERE turn_id = ? AND unit_type = ? AND unit_id = ?`,
      )
      .get(turn.id, input.unitType, input.unitId) as { snapshot: string } | undefined;
    if (!row) throw new RuleError("ENTITY_NOT_FOUND", "unit view not found");
    return JSON.parse(row.snapshot) as unknown;
  });
}

function queueRowForUnit(
  db: Database.Database,
  turnId: string,
  unitType: string,
  unitId: string,
): { id: string; status: string; payload: string } | undefined {
  return db
    .prepare(
      `SELECT id, status, payload FROM write_queue
       WHERE turn_id = ? AND unit_type = ? AND unit_id = ? AND kind = 'plan'
       ORDER BY enqueued_at DESC LIMIT 1`,
    )
    .get(turnId, unitType, unitId) as { id: string; status: string; payload: string } | undefined;
}

export function submitUnitPlan(
  db: Database.Database,
  dbPath: string,
  input: {
    campaignId: string;
    unitType: string;
    unitId: string;
    plan: FactionAction | Record<string, unknown>;
  },
): ServiceResult<{ status: string; errorCode?: string }> {
  return wrapRule(() =>
    withWriteLock(dbPath, () =>
      withTransaction(db, () => {
        const turn = db
          .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
          .get(input.campaignId) as { id: string } | undefined;
        if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");

        const existing = queueRowForUnit(db, turn.id, input.unitType, input.unitId);
        if (existing && (existing.status === "applying" || existing.status === "done")) {
          throw new RuleError("QUEUE_CLOSED", "plan queue closed for unit");
        }

        const viewRow = db
          .prepare(
            `SELECT snapshot FROM unit_views WHERE turn_id = ? AND unit_type = ? AND unit_id = ?`,
          )
          .get(turn.id, input.unitType, input.unitId) as { snapshot: string } | undefined;
        if (!viewRow) throw new RuleError("ENTITY_NOT_FOUND", "unit view not found");
        const snapshot = JSON.parse(viewRow.snapshot) as ReturnType<typeof projectUnitView>;

        const planObj = input.plan as FactionAction & Record<string, unknown>;

        const unknownId = planReferencesUnknown(snapshot, planObj);
        const now = Date.now();
        const payload = JSON.stringify(planObj);

        if (existing && existing.status === "queued") {
          if (unknownId) {
            db.prepare(
              `UPDATE write_queue SET payload = ?, status = 'rejected', error_code = 'UNKNOWN_TO_UNIT', enqueued_at = ?
               WHERE id = ?`,
            ).run(payload, now, existing.id);
            return { status: "rejected", errorCode: "UNKNOWN_TO_UNIT" };
          }
          db.prepare(
            `UPDATE write_queue SET payload = ?, status = 'queued', error_code = NULL, enqueued_at = ? WHERE id = ?`,
          ).run(payload, now, existing.id);
          return { status: "queued" };
        }

        const id = crypto.randomUUID();
        if (unknownId) {
          db.prepare(
            `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
             VALUES (?, ?, ?, ?, ?, 'plan', ?, 'rejected', 'UNKNOWN_TO_UNIT', ?)`,
          ).run(id, input.campaignId, turn.id, input.unitType, input.unitId, payload, now);
          return { status: "rejected", errorCode: "UNKNOWN_TO_UNIT" };
        }

        db.prepare(
          `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
           VALUES (?, ?, ?, ?, ?, 'plan', ?, 'queued', NULL, ?)`,
        ).run(id, input.campaignId, turn.id, input.unitType, input.unitId, payload, now);
        return { status: "queued" };
      }),
    ),
  );
}

function recordIdleAction(db: Database.Database, turnId: string, factionId: string): void {
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, feature_ids, outcome)
     VALUES (?, ?, 'idle', 'faction', ?, '[]', 'idle')`,
  ).run(crypto.randomUUID(), turnId, factionId);
}

function sanitizeActionForSnapshot(
  action: FactionAction,
  allowed: Set<string>,
): FactionAction {
  const check = (id: string | undefined): boolean => !id || allowed.has(id);
  if (action.type === "aid" && !check(action.targetFactionId)) return { type: "idle" };
  if (action.type === "attack") {
    if (!check(action.targetFactionId) || !check(action.attackerFeatureId)) return { type: "idle" };
    if (action.defenderFeatureId && !check(action.defenderFeatureId)) return { type: "idle" };
  }
  if (action.type === "extend_interest") {
    if (!check(action.targetFactionId) || !check(action.attackerFeatureId)) return { type: "idle" };
  }
  if (action.type === "enact_change") {
    if (action.solveProblemId && !check(action.solveProblemId)) return { type: "idle" };
    if (action.meansFeatureId && !check(action.meansFeatureId)) return { type: "idle" };
    if (action.aimedAtFactionId && !check(action.aimedAtFactionId)) return { type: "idle" };
    if (action.addPartToFeatureId && !check(action.addPartToFeatureId)) return { type: "idle" };
  }
  return action;
}

function applyFactionPlan(
  db: Database.Database,
  campaignId: string,
  turnId: string,
  factionId: string,
  action: FactionAction,
): { pending?: boolean } {
  if (action.type === "idle") {
    recordIdleAction(db, turnId, factionId);
    return {};
  }
  const result = runAction(db, { campaignId, factionId, ...action });
  if (!result.ok) {
    throw new RuleError(result.error.code, result.error.message, result.error.details);
  }
  const data = result.data as { pending?: boolean; code?: string };
  if (data.pending && data.code === "PENDING_DEFENDER_CHOICE") {
    return { pending: true };
  }
  return {};
}

export function applyWriteQueue(
  db: Database.Database,
  dbPath: string,
  input: {
    campaignId: string;
    missing?: "idle" | "mechanical";
    advanceMonth?: boolean;
  },
): ServiceResult<{ paused?: boolean; defenderUnit?: UnitRef }> {
  return wrapRule(() =>
    withWriteLock(dbPath, () => {
      const turn = db
        .prepare("SELECT id, faction_order FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
        .get(input.campaignId) as { id: string; faction_order: string } | undefined;
      if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");

      const order = JSON.parse(turn.faction_order) as string[];
      const missing = input.missing ?? "idle";

      for (const factionId of order) {
        const row = queueRowForUnit(db, turn.id, "faction", factionId);
        if (row?.status === "rejected") {
          db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(row.id);
          continue;
        }

        let action: FactionAction;
        let queueId: string | undefined;

        if (row && row.status === "queued") {
          queueId = row.id;
          db.prepare(`UPDATE write_queue SET status = 'applying' WHERE id = ?`).run(row.id);
          action = JSON.parse(row.payload) as FactionAction;
        } else if (missing === "mechanical") {
          const viewRow = db
            .prepare(
              `SELECT snapshot FROM unit_views WHERE turn_id = ? AND unit_type = 'faction' AND unit_id = ?`,
            )
            .get(turn.id, factionId) as { snapshot: string };
          const snapshot = JSON.parse(viewRow.snapshot) as ReturnType<typeof projectUnitView>;
          const allowed = collectSnapshotIds(snapshot);
          const faction = loadFactionRow(db, factionId);
          const planned = planFactionAction(db, faction, undefined);
          action = sanitizeActionForSnapshot(planned.action, allowed);
        } else {
          action = { type: "idle" };
        }

        const pending = withTransaction(db, () =>
          applyFactionPlan(db, input.campaignId, turn.id, factionId, action),
        );

        if (queueId) {
          db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(queueId);
        }

        if (pending.pending) {
          return { paused: true, defenderUnit: { type: "faction", id: factionId } };
        }
      }

      withTransaction(db, () => {
        db.prepare("UPDATE turns SET open = 0 WHERE id = ?").run(turn.id);
        if (input.advanceMonth) {
          advanceMonth(db, input.campaignId);
        }
      });

      return {};
    }),
  );
}

export function submitReaction(
  db: Database.Database,
  dbPath: string,
  input: {
    campaignId: string;
    unitType: string;
    unitId: string;
    defenderChoice: "cohesion" | "sacrifice" | "problem";
    problemId?: string;
  },
): ServiceResult<unknown> {
  return wrapRule(() =>
    withWriteLock(dbPath, () => {
      const pending = db
        .prepare(
          `SELECT a.id FROM actions a
           JOIN turns t ON t.id = a.turn_id
           WHERE t.campaign_id = ? AND t.open = 1 AND a.outcome = 'PENDING_DEFENDER_CHOICE'
           AND a.target_type = 'faction' AND a.target_id = ? LIMIT 1`,
        )
        .get(input.campaignId, input.unitId) as { id: string } | undefined;
      if (!pending) throw new RuleError("NOT_PENDING", "no pending defender choice");
      const result = resolveAttack(db, {
        campaignId: input.campaignId,
        actionId: pending.id,
        defenderChoice: input.defenderChoice,
        problemId: input.problemId,
      });
      if (!result.ok) {
        throw new RuleError(result.error.code, result.error.message, result.error.details);
      }
      return result.data;
    }),
  );
}
