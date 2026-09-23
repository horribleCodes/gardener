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
  resolvePendingAttack,
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

  const courtRows = db
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
  }[];

  type MemberRow = {
    courtId: string;
    id: string;
    name: string | null;
    isLeader: number;
    isHiddenController: number;
    powerSource: string | null;
  };
  const memberRows =
    courtRows.length === 0
      ? []
      : (db
          .prepare(
            `SELECT cm.court_id AS courtId, c.id, c.name, cm.is_leader AS isLeader,
                    cm.is_hidden_controller AS isHiddenController, c.power_source AS powerSource
             FROM court_memberships cm
             JOIN characters c ON c.id = cm.character_id
             WHERE cm.court_id IN (${courtRows.map(() => "?").join(",")})`,
          )
          .all(...courtRows.map((c) => c.id)) as MemberRow[]);

  const conflictRows = (
    courtRows.length === 0
      ? []
      : db
          .prepare(
            `SELECT court_id AS courtId, text FROM conflicts
             WHERE court_id IN (${courtRows.map(() => "?").join(",")})`,
          )
          .all(...courtRows.map((c) => c.id))
  ) as { courtId: string; text: string }[];

  const defenseRows = (
    courtRows.length === 0
      ? []
      : db
          .prepare(
            `SELECT court_id AS courtId, text FROM court_defenses
             WHERE court_id IN (${courtRows.map(() => "?").join(",")})`,
          )
          .all(...courtRows.map((c) => c.id))
  ) as { courtId: string; text: string }[];

  const consequenceRows = (
    courtRows.length === 0
      ? []
      : db
          .prepare(
            `SELECT court_id AS courtId, text FROM court_consequences
             WHERE court_id IN (${courtRows.map(() => "?").join(",")})`,
          )
          .all(...courtRows.map((c) => c.id))
  ) as { courtId: string; text: string }[];

  const courts = courtRows.map((c) => ({
    ...c,
    actsOnOwn: c.actsOnOwn !== 0,
    members: memberRows
      .filter((m) => m.courtId === c.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        courtId: c.id,
        isLeader: m.isLeader !== 0,
        isHiddenController: m.isHiddenController !== 0,
        powerSource: m.powerSource,
      })),
    conflict: (() => {
      const row = conflictRows.find((x) => x.courtId === c.id);
      return row ? { text: row.text } : null;
    })(),
    defenses: defenseRows.filter((d) => d.courtId === c.id).map((d) => ({ text: d.text })),
    consequences: consequenceRows
      .filter((d) => d.courtId === c.id)
      .map((d) => ({ text: d.text })),
  }));

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
        `SELECT id, subject, subject_id AS subjectId, statement, visibility, place_id AS placeId
         FROM facts WHERE campaign_id = ? AND superseded_by IS NULL`,
      )
      .all(campaignId) as CampaignWorld["facts"]
  );

  const godbound = (
    db
      .prepare(
        `SELECT id, name, acts_on_own AS actsOnOwn FROM godbound WHERE campaign_id = ?`,
      )
      .all(campaignId) as { id: string; name: string; actsOnOwn: number }[]
  ).map((g) => ({ ...g, actsOnOwn: g.actsOnOwn !== 0 }));

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
    godbound,
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

function shuffleUnits(units: UnitRef[], rng: { next(): number }): UnitRef[] {
  const order = [...units];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function parseTurnOrder(raw: string): UnitRef[] {
  const parsed = JSON.parse(raw) as (string | UnitRef)[];
  return parsed.map((entry) =>
    typeof entry === "string" ? { type: "faction", id: entry } : entry,
  );
}

function orderEntryIds(order: UnitRef[]): string[] {
  return order.map((u) => u.id);
}

function defaultActingUnits(db: Database.Database, campaignId: string): UnitRef[] {
  const units: UnitRef[] = (
    db
      .prepare(
        `SELECT id FROM factions
         WHERE campaign_id = ? AND status = 'active' AND control = 'npc'`,
      )
      .all(campaignId) as { id: string }[]
  ).map((r) => ({ type: "faction", id: r.id }));

  const courts = db
    .prepare(`SELECT id FROM courts WHERE campaign_id = ? AND acts_on_own = 1`)
    .all(campaignId) as { id: string }[];
  for (const c of courts) units.push({ type: "court", id: c.id });

  const characters = db
    .prepare(`SELECT id FROM characters WHERE campaign_id = ? AND acts_on_own = 1`)
    .all(campaignId) as { id: string }[];
  for (const c of characters) units.push({ type: "character", id: c.id });

  const godbound = db
    .prepare(`SELECT id FROM godbound WHERE campaign_id = ? AND acts_on_own = 1`)
    .all(campaignId) as { id: string }[];
  for (const g of godbound) units.push({ type: "godbound", id: g.id });

  return units;
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
        let orderStored: (string | UnitRef)[];
        let orderUnits: UnitRef[];
        if (input.unitIds && input.unitIds.length > 0) {
          orderStored = [...input.unitIds];
          orderUnits = orderStored.map((entry) =>
            typeof entry === "string" ? { type: "faction", id: entry } : entry,
          );
        } else {
          const acting = defaultActingUnits(db, input.campaignId);
          const campaign = requireCampaign(db, input.campaignId);
          const rng = mulberry32(campaign.rng_seed + campaign.roll_counter);
          orderUnits = shuffleUnits(acting, rng);
          orderStored = orderUnits;
        }

        const campaign = requireCampaign(db, input.campaignId);
        const turnId = crypto.randomUUID();
        const seqRow = db
          .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM turns WHERE campaign_id = ?")
          .get(input.campaignId) as { seq: number };

        db.prepare(
          `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        ).run(
          turnId,
          input.campaignId,
          campaign.month,
          seqRow.seq,
          JSON.stringify(orderStored),
          missing,
          advanceMonthFlag ? 1 : 0,
        );

        const world = loadCampaignWorld(db, input.campaignId);
        for (const unit of orderUnits) {
          freezeView(db, turnId, unit, world);
        }

        return {
          turnId,
          unitIds: orderEntryIds(orderUnits),
          missing,
          advanceMonth: advanceMonthFlag,
        };
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
  recordUnitAction(db, turnId, "faction", factionId, "idle");
}

function recordUnitAction(
  db: Database.Database,
  turnId: string,
  actorType: string,
  actorId: string,
  actionType: string,
): void {
  const outcome = actionType === "idle" ? "idle" : null;
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, feature_ids, outcome)
     VALUES (?, ?, ?, ?, ?, '[]', ?)`,
  ).run(crypto.randomUUID(), turnId, actionType, actorType, actorId, outcome);
}

type TurnRow = {
  id: string;
  faction_order: string;
  missing: "idle" | "mechanical";
  advance_month: number;
};

function loadOpenTurn(db: Database.Database, campaignId: string): TurnRow | undefined {
  return db
    .prepare(
      `SELECT id, faction_order, missing, advance_month FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1`,
    )
    .get(campaignId) as TurnRow | undefined;
}

function closeTurn(db: Database.Database, turnId: string, campaignId: string): void {
  const row = db
    .prepare("SELECT advance_month FROM turns WHERE id = ?")
    .get(turnId) as { advance_month: number };
  db.prepare("UPDATE turns SET open = 0, advance_month = 0 WHERE id = ?").run(turnId);
  if (row.advance_month === 1) {
    advanceMonth(db, campaignId);
  }
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

function featureKnownInSnapshot(
  snapshot: ReturnType<typeof projectUnitView>,
  featureId: string,
): boolean {
  return collectSnapshotIds(snapshot).has(featureId);
}

function sanitizeAttackForDefender(
  snapshot: ReturnType<typeof projectUnitView>,
  attack: FactionAction,
): Record<string, unknown> {
  if (attack.type !== "attack") return attack as Record<string, unknown>;
  const out: Record<string, unknown> = { type: "attack", targetFactionId: attack.targetFactionId };
  if (attack.attackerFeatureId) {
    if (featureKnownInSnapshot(snapshot, attack.attackerFeatureId)) {
      out.attackerFeatureId = attack.attackerFeatureId;
    } else {
      out.attackerFeatureName = "an undisclosed asset";
    }
  }
  if (attack.defenderFeatureId) {
    if (featureKnownInSnapshot(snapshot, attack.defenderFeatureId)) {
      out.defenderFeatureId = attack.defenderFeatureId;
    } else {
      out.defenderFeatureName = "an undisclosed asset";
    }
  }
  return out;
}

function pendingDefenderChoice(
  db: Database.Database,
  turnId: string,
): { actionId: string; defenderUnit: UnitRef } | undefined {
  const row = db
    .prepare(
      `SELECT id, target_id FROM actions
       WHERE turn_id = ? AND outcome = 'PENDING_DEFENDER_CHOICE' LIMIT 1`,
    )
    .get(turnId) as { id: string; target_id: string } | undefined;
  if (!row) return undefined;
  return {
    actionId: row.id,
    defenderUnit: { type: "faction", id: row.target_id },
  };
}

function queuedReactionDefender(
  db: Database.Database,
  turnId: string,
): UnitRef | undefined {
  const row = db
    .prepare(
      `SELECT unit_type, unit_id FROM write_queue
       WHERE turn_id = ? AND kind = 'reaction' AND status = 'queued' LIMIT 1`,
    )
    .get(turnId) as { unit_type: string; unit_id: string } | undefined;
  if (!row) return undefined;
  return { type: row.unit_type as UnitRef["type"], id: row.unit_id };
}

function enqueueDefenderReaction(
  db: Database.Database,
  campaignId: string,
  turnId: string,
  defender: UnitRef,
  actionId: string,
  attackPlan: FactionAction,
): void {
  const existing = db
    .prepare(
      `SELECT id FROM write_queue WHERE turn_id = ? AND kind = 'reaction' AND status = 'queued' LIMIT 1`,
    )
    .get(turnId);
  if (existing) return;

  const viewRow = db
    .prepare(
      `SELECT snapshot FROM unit_views WHERE turn_id = ? AND unit_type = ? AND unit_id = ?`,
    )
    .get(turnId, defender.type, defender.id) as { snapshot: string };
  const snapshot = JSON.parse(viewRow.snapshot) as ReturnType<typeof projectUnitView>;
  const payload = JSON.stringify({
    actionId,
    attack: sanitizeAttackForDefender(snapshot, attackPlan),
    view: snapshot,
  });
  const now = Date.now();
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES (?, ?, ?, ?, ?, 'reaction', ?, 'queued', NULL, ?)`,
  ).run(crypto.randomUUID(), campaignId, turnId, defender.type, defender.id, payload, now);
}

function applyFactionPlan(
  db: Database.Database,
  campaignId: string,
  turnId: string,
  factionId: string,
  action: FactionAction,
): { pending?: boolean; defenderUnit?: UnitRef; actionId?: string } {
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
    const pending = pendingDefenderChoice(db, turnId);
    return {
      pending: true,
      defenderUnit: pending?.defenderUnit ?? { type: "faction", id: factionId },
      actionId: pending?.actionId,
    };
  }
  return {};
}

function planRowDone(db: Database.Database, turnId: string, unit: UnitRef): void {
  const row = queueRowForUnit(db, turnId, unit.type, unit.id);
  if (row) {
    db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(row.id);
  }
}

type ApplyPause = { paused: true; defenderUnit: UnitRef };
type ApplyDone = { paused?: false };

function applyUnitsInOrder(
  db: Database.Database,
  input: {
    campaignId: string;
    turnId: string;
    order: UnitRef[];
    missing: "idle" | "mechanical";
    startIndex: number;
  },
): ApplyPause | ApplyDone {
  const { campaignId, turnId, order, missing, startIndex } = input;

  for (let i = startIndex; i < order.length; i++) {
    const unit = order[i];
    if (unit.type !== "faction") {
      const row = queueRowForUnit(db, turnId, unit.type, unit.id);
      if (row?.status === "done") {
        continue;
      }
      if (row?.status === "rejected") {
        db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(row.id);
        continue;
      }
      let actionType = "idle";
      if (row?.status === "queued") {
        const payload = JSON.parse(row.payload) as { type?: string };
        actionType = typeof payload.type === "string" ? payload.type : "idle";
        db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(row.id);
      }
      recordUnitAction(db, turnId, unit.type, unit.id, actionType);
      continue;
    }

    const factionId = unit.id;
    const row = queueRowForUnit(db, turnId, "faction", factionId);

    if (row?.status === "applying") {
      const pause = pendingDefenderChoice(db, turnId);
      if (pause) {
        return { paused: true, defenderUnit: pause.defenderUnit };
      }
      planRowDone(db, turnId, unit);
      continue;
    }

    if (row?.status === "done") continue;

    if (row?.status === "rejected") {
      db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(row.id);
      continue;
    }

    let action: FactionAction;
    let queueId: string | undefined;
    let attackPlan: FactionAction | undefined;

    if (row && row.status === "queued") {
      queueId = row.id;
      db.prepare(`UPDATE write_queue SET status = 'applying' WHERE id = ?`).run(row.id);
      action = JSON.parse(row.payload) as FactionAction;
      if (action.type === "attack") attackPlan = action;
    } else if (missing === "mechanical") {
      const viewRow = db
        .prepare(
          `SELECT snapshot FROM unit_views WHERE turn_id = ? AND unit_type = 'faction' AND unit_id = ?`,
        )
        .get(turnId, factionId) as { snapshot: string };
      const snapshot = JSON.parse(viewRow.snapshot) as ReturnType<typeof projectUnitView>;
      const allowed = collectSnapshotIds(snapshot);
      const faction = loadFactionRow(db, factionId);
      const planned = planFactionAction(db, faction, undefined);
      action = sanitizeActionForSnapshot(planned.action, allowed);
      if (action.type === "attack") attackPlan = action;
    } else {
      action = { type: "idle" };
    }

    const outcome = applyFactionPlan(db, campaignId, turnId, factionId, action);

    if (outcome.pending) {
      const defender = outcome.defenderUnit ?? { type: "faction", id: factionId };
      if (attackPlan && outcome.actionId) {
        enqueueDefenderReaction(db, campaignId, turnId, defender, outcome.actionId, attackPlan);
      }
      return { paused: true, defenderUnit: defender };
    }

    if (queueId) {
      db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(queueId);
    }
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
    withWriteLock(dbPath, () =>
      withTransaction(db, () => {
        const turn = loadOpenTurn(db, input.campaignId);
        if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");

        const reactionWait = queuedReactionDefender(db, turn.id);
        if (reactionWait) {
          return { paused: true, defenderUnit: reactionWait };
        }

        const order = parseTurnOrder(turn.faction_order);
        const missing = turn.missing ?? "idle";

        const result = applyUnitsInOrder(db, {
          campaignId: input.campaignId,
          turnId: turn.id,
          order,
          missing,
          startIndex: 0,
        });

        if (result.paused) {
          return result;
        }

        closeTurn(db, turn.id, input.campaignId);

        return {};
      }),
    ),
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
    withWriteLock(dbPath, () =>
      withTransaction(db, () => {
        const turn = loadOpenTurn(db, input.campaignId);
        if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");

        const pending = db
          .prepare(
            `SELECT a.id, a.actor_id FROM actions a
             WHERE a.turn_id = ? AND a.outcome = 'PENDING_DEFENDER_CHOICE'
             AND a.target_type = 'faction' AND a.target_id = ? LIMIT 1`,
          )
          .get(turn.id, input.unitId) as { id: string; actor_id: string } | undefined;
        if (!pending) throw new RuleError("NOT_PENDING", "no pending defender choice");

        const reactionRow = db
          .prepare(
            `SELECT id FROM write_queue
             WHERE turn_id = ? AND kind = 'reaction' AND unit_type = ? AND unit_id = ? AND status = 'queued'
             LIMIT 1`,
          )
          .get(turn.id, input.unitType, input.unitId) as { id: string } | undefined;
        if (!reactionRow) throw new RuleError("REACTION_CLOSED", "no open reaction");

        const data = resolvePendingAttack(db, {
          campaignId: input.campaignId,
          actionId: pending.id,
          defenderChoice: input.defenderChoice,
          problemId: input.problemId,
        });

        db.prepare(`UPDATE write_queue SET status = 'done' WHERE id = ?`).run(reactionRow.id);

        const attackerUnit: UnitRef = { type: "faction", id: pending.actor_id };
        planRowDone(db, turn.id, attackerUnit);

        const order = parseTurnOrder(turn.faction_order);
        const attackerIndex = order.findIndex(
          (u) => u.type === attackerUnit.type && u.id === attackerUnit.id,
        );
        const resumeFrom = attackerIndex >= 0 ? attackerIndex + 1 : order.length;

        const continueResult = applyUnitsInOrder(db, {
          campaignId: input.campaignId,
          turnId: turn.id,
          order,
          missing: turn.missing ?? "idle",
          startIndex: resumeFrom,
        });

        if (!continueResult.paused) {
          closeTurn(db, turn.id, input.campaignId);
        }

        return data;
      }),
    ),
  );
}
