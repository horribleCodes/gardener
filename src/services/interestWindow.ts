import type Database from "better-sqlite3";
import { DIE_BY_POWER, RuleError, type Power } from "../domain/types.js";
import { movedKeptFace } from "../rules/actions.js";
import { factionProjectCost, restoreCohesionCost } from "../rules/cost.js";
import { resolveContest } from "../rules/contest.js";
import { runAction, followRolledAction, type RunActionInput } from "./actions.js";
import { assertFactionBudget } from "./factionBudget.js";
import { resolveDefenderFeature } from "./features.js";
import { newId } from "./ids.js";
import type { FactionAction } from "./turn.js";
import { requireFaction } from "./util.js";
import type { StandingOrder } from "./unitPlan.js";

export type InterestPhase = "steal" | "before" | "after";

export type PendingInterest = {
  pending: true;
  code: "PENDING_INTEREST";
  windowId: string;
  phase: InterestPhase;
  subjectFactionId: string;
  eligibleFactionIds: string[];
  actionId: string | null;
};

type PhaseStep =
  | { kind: "steal"; subjectFactionId: string }
  | { kind: "before"; subjectFactionId: string }
  | { kind: "roll" }
  | { kind: "after"; subjectFactionId: string }
  | { kind: "resolve" };

export type WindowPayload = {
  windowId: string;
  phase: InterestPhase;
  subjectFactionId: string;
  actionId: string | null;
  round: number;
  passedFactionIds: string[];
  queue: PhaseStep[];
  cursor: number;
  pendingAction: { campaignId: string; factionId: string; action: FactionAction };
  beforeDeltas: { subjectFactionId: string; delta: number }[];
  lastResult?: unknown;
  standingOrders?: StandingOrder[];
};

type InterestRow = { id: string; turn_id: string; payload: string; campaign_id: string };

export function eligibleSpenders(
  db: Database.Database,
  turnId: string,
  subjectFactionId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT i.from_faction_id AS id
       FROM interests i
       WHERE i.to_faction_id = ? AND i.points >= 1 AND i.from_faction_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM actions a
           WHERE a.turn_id = ? AND a.type = 'spend_interest'
             AND a.actor_id = i.from_faction_id AND a.target_id = ?
         )
       ORDER BY i.id ASC`,
    )
    .all(subjectFactionId, subjectFactionId, turnId, subjectFactionId) as { id: string }[];
  return rows.map((row) => row.id);
}

export function loadOpenInterestWindow(
  db: Database.Database,
  turnId: string,
): WindowPayload | undefined {
  const row = queuedInterestRow(db, turnId);
  if (!row) return undefined;
  return JSON.parse(row.payload) as WindowPayload;
}

export function queuedInterest(db: Database.Database, turnId: string): PendingInterest | undefined {
  const row = queuedInterestRow(db, turnId);
  if (!row) return undefined;
  const payload = JSON.parse(row.payload) as WindowPayload;
  const eligible = remainingEligible(db, turnId, payload);
  return pendingFrom(payload, eligible);
}

function queuedInterestRow(db: Database.Database, turnId: string): InterestRow | undefined {
  return db
    .prepare(
      `SELECT id, turn_id, payload, campaign_id FROM write_queue
       WHERE turn_id = ? AND kind = 'interest' AND status = 'queued' LIMIT 1`,
    )
    .get(turnId) as InterestRow | undefined;
}

function remainingEligible(db: Database.Database, turnId: string, payload: WindowPayload): string[] {
  const eligible = eligibleSpenders(db, turnId, payload.subjectFactionId);
  const passed = new Set(payload.passedFactionIds);
  return eligible.filter((id) => !passed.has(id));
}

function pendingFrom(payload: WindowPayload, eligibleFactionIds: string[]): PendingInterest {
  return {
    pending: true,
    code: "PENDING_INTEREST",
    windowId: payload.windowId,
    phase: payload.phase,
    subjectFactionId: payload.subjectFactionId,
    eligibleFactionIds,
    actionId: payload.actionId,
  };
}

function dominionCost(db: Database.Database, factionId: string, action: FactionAction): number {
  const faction = requireFaction(db, factionId);
  if (action.type === "aid") return action.amount ?? 1;
  if (action.type === "restore_cohesion") return restoreCohesionCost(faction.power);
  if (action.type === "enact_change") {
    const magnitude =
      action.improbable || action.magnitude === "improbable" ? "improbable" : "plausible";
    return factionProjectCost(faction.power, magnitude);
  }
  return 0;
}

function rollingSubjects(db: Database.Database, actorId: string, action: FactionAction): string[] {
  if (action.type === "idle" || action.type === "skip") return [];
  if (action.type === "remove_interest" && action.willing) return [];
  if (action.type === "extend_interest" && action.willing) return [];
  if (
    action.type === "build_strength" ||
    action.type === "enact_change" ||
    action.type === "restore_cohesion" ||
    action.type === "aid"
  ) {
    return [actorId];
  }
  if (action.type === "attack" || action.type === "extend_interest") {
    const subjects = [actorId];
    const feature = resolveDefenderFeature(db, action.targetFactionId, action.defenderFeatureId);
    if (feature) subjects.push(action.targetFactionId);
    return subjects;
  }
  if (action.type === "remove_interest") {
    return [actorId, action.targetFactionId];
  }
  return [];
}

function buildQueue(db: Database.Database, actorId: string, action: FactionAction): PhaseStep[] {
  const queue: PhaseStep[] = [];
  if (dominionCost(db, actorId, action) > 0) {
    queue.push({ kind: "steal", subjectFactionId: actorId });
  }
  const rolling = rollingSubjects(db, actorId, action);
  for (const subject of rolling) queue.push({ kind: "before", subjectFactionId: subject });
  queue.push({ kind: "roll" });
  for (const subject of rolling) queue.push({ kind: "after", subjectFactionId: subject });
  queue.push({ kind: "resolve" });
  return queue;
}

function savePayload(db: Database.Database, rowId: string, payload: WindowPayload): void {
  db.prepare("UPDATE write_queue SET payload = ?, unit_id = ? WHERE id = ?").run(
    JSON.stringify(payload),
    payload.subjectFactionId,
    rowId,
  );
}

function insertWindow(
  db: Database.Database,
  campaignId: string,
  turnId: string,
  payload: WindowPayload,
): string {
  const now = Date.now();
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES (?, ?, ?, 'faction', ?, 'interest', ?, 'queued', NULL, ?)`,
  ).run(
    payload.windowId,
    campaignId,
    turnId,
    payload.subjectFactionId,
    JSON.stringify(payload),
    now,
  );
  return payload.windowId;
}

function markDone(db: Database.Database, rowId: string | undefined): void {
  if (!rowId) return;
  db.prepare("UPDATE write_queue SET status = 'done' WHERE id = ?").run(rowId);
}

function summedDeltas(beforeDeltas: { subjectFactionId: string; delta: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of beforeDeltas) {
    out[entry.subjectFactionId] = (out[entry.subjectFactionId] ?? 0) + entry.delta;
  }
  return out;
}

function failUnpaid(
  db: Database.Database,
  turnId: string,
  action: FactionAction,
  actorId: string,
): { failed: true; reason: "insufficient dominion" } {
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome, dominion_delta)
     VALUES (?, ?, ?, 'faction', ?, ?, ?, 'failed', 0)`,
  ).run(
    newId(),
    turnId,
    action.type,
    actorId,
    "targetFactionId" in action ? "faction" : null,
    "targetFactionId" in action ? action.targetFactionId : null,
  );
  return { failed: true, reason: "insufficient dominion" };
}

function walkWindow(
  db: Database.Database,
  turnId: string,
  payload: WindowPayload,
  mode: "pause" | "pass",
  rowId?: string,
): PendingInterest | { pending: false; result: unknown } {
  const { campaignId, factionId, action } = payload.pendingAction;
  while (payload.cursor < payload.queue.length) {
    const step = payload.queue[payload.cursor];
    if (step.kind === "steal" || step.kind === "before" || step.kind === "after") {
      const cost = dominionCost(db, factionId, action);
      const actorNow = requireFaction(db, factionId);
      if (step.kind !== "steal" && cost > 0 && actorNow.dominion < cost) {
        const rollIndex = payload.queue.findIndex((entry) => entry.kind === "roll");
        payload.cursor = rollIndex >= 0 ? rollIndex : payload.cursor + 1;
        continue;
      }
      payload.phase = step.kind;
      payload.subjectFactionId = step.subjectFactionId;
      const remaining =
        mode === "pass" ? [] : remainingEligible(db, turnId, payload);
      if (remaining.length === 0) {
        payload.passedFactionIds = [];
        payload.cursor += 1;
        continue;
      }
      if (!rowId) {
        rowId = insertWindow(db, campaignId, turnId, payload);
      } else {
        savePayload(db, rowId, payload);
      }
      return pendingFrom(payload, remaining);
    }
    if (step.kind === "roll") {
      const cost = dominionCost(db, factionId, action);
      const actor = requireFaction(db, factionId);
      if (cost > 0 && actor.dominion < cost) {
        const result = failUnpaid(db, turnId, action, factionId);
        markDone(db, rowId);
        payload.lastResult = result;
        return { pending: false, result };
      }
      const interestDeltas = summedDeltas(payload.beforeDeltas);
      const ran = runAction(db, {
        campaignId,
        factionId,
        ...action,
        standingOrders: payload.standingOrders,
        interestDeltas,
      } as RunActionInput);
      if (!ran.ok) {
        throw new RuleError(ran.error.code, ran.error.message, ran.error.details);
      }
      const newest = db
        .prepare(
          `SELECT id FROM actions WHERE turn_id = ? AND actor_type = 'faction' AND actor_id = ?
           ORDER BY rowid DESC LIMIT 1`,
        )
        .get(turnId, factionId) as { id: string } | undefined;
      payload.actionId = newest?.id ?? null;
      payload.lastResult = ran.data;
      payload.cursor += 1;
      continue;
    }
    if (step.kind === "resolve") {
      markDone(db, rowId);
      const result = payload.lastResult;
      if (payload.actionId) {
        const row = db
          .prepare("SELECT outcome FROM actions WHERE id = ?")
          .get(payload.actionId) as { outcome: string } | undefined;
        if (row?.outcome === "PENDING_DEFENDER_CHOICE") {
          return {
            pending: false,
            result: { pending: true, code: "PENDING_DEFENDER_CHOICE", actionId: payload.actionId },
          };
        }
      }
      return { pending: false, result };
    }
  }
  markDone(db, rowId);
  return { pending: false, result: payload.lastResult };
}

export function beginInterestWindow(
  db: Database.Database,
  input: {
    campaignId: string;
    factionId: string;
    action: FactionAction;
    mode: "pause" | "pass";
    standingOrders?: StandingOrder[];
  },
): PendingInterest | { pending: false; result: unknown } {
  if (Object.prototype.hasOwnProperty.call(input.action, "interestDeltas")) {
    throw new RuleError("FILL_INCOMPLETE", "forbidden action field: interestDeltas");
  }
  const turn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(input.campaignId) as { id: string } | undefined;
  if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");
  const targetFactionId =
    "targetFactionId" in input.action ? input.action.targetFactionId : undefined;
  assertFactionBudget(db, turn.id, input.factionId, input.action.type, targetFactionId);

  if (input.action.type === "idle" || input.action.type === "skip") {
    return { pending: false, result: { idle: true } };
  }

  const payload: WindowPayload = {
    windowId: newId(),
    phase: "before",
    subjectFactionId: input.factionId,
    actionId: null,
    round: 1,
    passedFactionIds: [],
    queue: buildQueue(db, input.factionId, input.action),
    cursor: 0,
    pendingAction: {
      campaignId: input.campaignId,
      factionId: input.factionId,
      action: input.action,
    },
    beforeDeltas: [],
    standingOrders: input.standingOrders,
  };
  return walkWindow(db, turn.id, payload, input.mode);
}

export function continueInterest(
  db: Database.Database,
  turnId: string,
  mode: "pause" | "pass",
): PendingInterest | { pending: false; result: unknown } | undefined {
  const row = queuedInterestRow(db, turnId);
  if (!row) return undefined;
  const payload = JSON.parse(row.payload) as WindowPayload;
  return walkWindow(db, turnId, payload, mode, row.id);
}

export function passInterestInner(
  db: Database.Database,
  input: { campaignId: string; fromFactionId: string; toFactionId: string },
): PendingInterest | unknown {
  const turn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(input.campaignId) as { id: string } | undefined;
  if (!turn) throw new RuleError("NOT_PENDING", "no interest window");
  const row = queuedInterestRow(db, turn.id);
  if (!row) throw new RuleError("NOT_PENDING", "no interest window");
  const payload = JSON.parse(row.payload) as WindowPayload;
  if (payload.subjectFactionId !== input.toFactionId) {
    throw new RuleError("NOT_PENDING", "no interest window");
  }
  const eligible = eligibleSpenders(db, turn.id, payload.subjectFactionId);
  if (!eligible.includes(input.fromFactionId) || payload.passedFactionIds.includes(input.fromFactionId)) {
    throw new RuleError("NOT_PENDING", "no interest window");
  }
  payload.passedFactionIds = [...payload.passedFactionIds, input.fromFactionId];
  const remaining = remainingEligible(db, turn.id, payload);
  if (remaining.length > 0) {
    savePayload(db, row.id, payload);
    return pendingFrom(payload, remaining);
  }
  payload.passedFactionIds = [];
  payload.cursor += 1;
  const advanced = walkWindow(db, turn.id, payload, "pause", row.id);
  if ("code" in advanced && advanced.code === "PENDING_INTEREST") return advanced;
  return advanced.result;
}

function debitInterest(
  db: Database.Database,
  fromFactionId: string,
  toFactionId: string,
  amount: number,
): void {
  const edge = db
    .prepare("SELECT points FROM interests WHERE from_faction_id = ? AND to_faction_id = ?")
    .get(fromFactionId, toFactionId) as { points: number } | undefined;
  if (!edge || edge.points < amount) {
    throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough interest");
  }
  db.prepare(
    "UPDATE interests SET points = points - ? WHERE from_faction_id = ? AND to_faction_id = ?",
  ).run(amount, fromFactionId, toFactionId);
}

function insertSpend(
  db: Database.Database,
  turnId: string,
  fromFactionId: string,
  toFactionId: string,
): void {
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome)
     VALUES (?, ?, 'spend_interest', 'faction', ?, 'faction', ?, 'success')`,
  ).run(newId(), turnId, fromFactionId, toFactionId);
}

function reofferOrAdvance(
  db: Database.Database,
  turnId: string,
  payload: WindowPayload,
  rowId: string,
  report: Record<string, unknown>,
): Record<string, unknown> | PendingInterest {
  payload.passedFactionIds = [];
  payload.round += 1;
  const remaining = remainingEligible(db, turnId, payload);
  if (remaining.length > 0) {
    savePayload(db, rowId, payload);
    return { ...pendingFrom(payload, remaining), ...report };
  }
  payload.cursor += 1;
  const advanced = walkWindow(db, turnId, payload, "pause", rowId);
  if ("code" in advanced && advanced.code === "PENDING_INTEREST") return advanced;
  return { ...report, ...(typeof advanced.result === "object" && advanced.result ? (advanced.result as object) : { result: advanced.result }) };
}

function subjectDieMax(db: Database.Database, factionId: string): number {
  const faction = requireFaction(db, factionId) as { power: Power };
  return DIE_BY_POWER[faction.power];
}

function adjustStoredKept(
  db: Database.Database,
  actionId: string,
  subjectFactionId: string,
  direction: "raise" | "lower",
  requested: number,
): { spent: number; changed: boolean; previousOutcome: string } {
  const action = db
    .prepare("SELECT actor_id, target_id, roll_id, outcome FROM actions WHERE id = ?")
    .get(actionId) as
    | { actor_id: string; target_id: string | null; roll_id: string | null; outcome: string }
    | undefined;
  if (!action?.roll_id) {
    throw new RuleError("NOT_PENDING", "no interest window");
  }
  const rollRow = db.prepare("SELECT payload FROM rolls WHERE id = ?").get(action.roll_id) as
    | { payload: string }
    | undefined;
  if (!rollRow) throw new RuleError("NOT_PENDING", "no interest window");
  const payload = JSON.parse(rollRow.payload) as Record<string, unknown>;
  const dieMax = subjectDieMax(db, subjectFactionId);
  const isActor = action.actor_id === subjectFactionId;
  const rollObj = isActor
    ? ((payload.attacker as Record<string, unknown> | undefined) ?? payload)
    : ((payload.defender as Record<string, unknown> | undefined) ?? payload);
  if (typeof rollObj.kept !== "number") {
    throw new RuleError("MODIFIER_EXCEEDS_DIE", "roll cannot move past the die");
  }
  const moved = movedKeptFace({
    kept: rollObj.kept as number,
    dieMax,
    direction,
    requested,
  });
  if (moved.spent === 0) {
    throw new RuleError("MODIFIER_EXCEEDS_DIE", "roll cannot move past the die");
  }
  const previousBonus = typeof rollObj.bonus === "number" ? rollObj.bonus : 0;
  rollObj.kept = moved.kept;
  rollObj.bonus = moved.kept === 1 ? 0 : previousBonus;
  rollObj.total = moved.kept + (rollObj.bonus as number);
  if (!isActor) {
    payload.defenderTotal = rollObj.total;
  } else if (payload.attacker && typeof payload.attacker === "object") {
    payload.attacker = rollObj;
  }
  const previousOutcome = action.outcome;
  db.prepare("UPDATE rolls SET payload = ? WHERE id = ?").run(JSON.stringify(payload), action.roll_id);

  let changed = false;
  if (typeof payload.success === "boolean" || previousOutcome === "success" || previousOutcome === "failure") {
    const inverted = Boolean((payload.effect as { inverted?: boolean } | undefined)?.inverted);
    const trouble = typeof payload.trouble === "number" ? payload.trouble : 0;
    const success = inverted
      ? (rollObj.kept as number) <= trouble
      : (rollObj.kept as number) > trouble;
    payload.success = success;
    db.prepare("UPDATE rolls SET payload = ? WHERE id = ?").run(JSON.stringify(payload), action.roll_id);
    const newOutcome = success ? "success" : "failure";
    changed = newOutcome !== previousOutcome;
  } else if (payload.attacker && typeof payload.defenderTotal === "number") {
    const attacker = payload.attacker as { total?: number };
    const attackerPower = requireFaction(db, action.actor_id).power;
    const defenderPower = action.target_id ? requireFaction(db, action.target_id).power : attackerPower;
    const winner = resolveContest({
      attackerTotal: typeof attacker.total === "number" ? attacker.total : 0,
      defenderTotal: payload.defenderTotal as number,
      attackerPower,
      defenderPower,
    });
    const newOutcome = winner === "attacker" ? "attacker_win" : "defender_win";
    changed = newOutcome !== previousOutcome && previousOutcome !== "PENDING_DEFENDER_CHOICE"
      ? newOutcome !== previousOutcome
      : (previousOutcome === "PENDING_DEFENDER_CHOICE" ? winner !== "attacker" : newOutcome !== previousOutcome);
    if (previousOutcome === "PENDING_DEFENDER_CHOICE") {
      changed = winner !== "attacker";
    }
  }
  return { spent: moved.spent, changed, previousOutcome };
}

export function applyWindowSpend(
  db: Database.Database,
  input: {
    campaignId: string;
    fromFactionId: string;
    toFactionId: string;
    timing: InterestPhase;
    modifier: number;
    direction?: "raise" | "lower";
  },
): Record<string, unknown> | PendingInterest {
  const turn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(input.campaignId) as { id: string } | undefined;
  if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");
  const row = queuedInterestRow(db, turn.id);
  if (!row) throw new RuleError("NOT_PENDING", "no interest window");
  const payload = JSON.parse(row.payload) as WindowPayload;
  if (payload.phase !== input.timing || payload.subjectFactionId !== input.toFactionId) {
    throw new RuleError("NOT_PENDING", "no interest window");
  }
  const eligible = eligibleSpenders(db, turn.id, payload.subjectFactionId);
  if (!eligible.includes(input.fromFactionId)) {
    throw new RuleError("NOT_PENDING", "no interest window");
  }

  const already = db
    .prepare(
      `SELECT id FROM actions WHERE turn_id = ? AND actor_id = ? AND target_id = ? AND type = 'spend_interest'`,
    )
    .get(turn.id, input.fromFactionId, input.toFactionId);
  if (already) throw new RuleError("INTEREST_ALREADY_SPENT", "already spent on target");

  const report: Record<string, unknown> = { spent: input.modifier, timing: input.timing };

  if (input.timing === "before") {
    if (!input.direction) throw new RuleError("FILL_INCOMPLETE", "direction must be raise or lower");
    debitInterest(db, input.fromFactionId, input.toFactionId, input.modifier);
    insertSpend(db, turn.id, input.fromFactionId, input.toFactionId);
    const delta = input.direction === "raise" ? input.modifier : -input.modifier;
    payload.beforeDeltas.push({ subjectFactionId: payload.subjectFactionId, delta });
    return reofferOrAdvance(db, turn.id, payload, row.id, report);
  }

  if (input.timing === "steal") {
    const target = requireFaction(db, input.toFactionId);
    const steal = Math.min(input.modifier, target.dominion);
    db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(steal, input.toFactionId);
    db.prepare("UPDATE factions SET dominion = dominion + ? WHERE id = ?").run(steal, input.fromFactionId);
    debitInterest(db, input.fromFactionId, input.toFactionId, input.modifier);
    insertSpend(db, turn.id, input.fromFactionId, input.toFactionId);
    report.stolenDominion = steal;
    report.spent = input.modifier;
    return reofferOrAdvance(db, turn.id, payload, row.id, report);
  }

  if (!input.direction) throw new RuleError("FILL_INCOMPLETE", "direction must be raise or lower");
  if (!payload.actionId) throw new RuleError("NOT_PENDING", "no interest window");
  const adjusted = adjustStoredKept(
    db,
    payload.actionId,
    payload.subjectFactionId,
    input.direction,
    input.modifier,
  );
  const spender = requireFaction(db, input.fromFactionId);
  if (spender.dominion < adjusted.spent) {
    throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion for after-roll spend");
  }
  debitInterest(db, input.fromFactionId, input.toFactionId, adjusted.spent);
  db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(
    adjusted.spent,
    input.fromFactionId,
  );
  insertSpend(db, turn.id, input.fromFactionId, input.toFactionId);
  report.spent = adjusted.spent;
  if (adjusted.changed) {
    const follow = followRolledAction(db, payload.actionId);
    if (follow.featureNotRestored) report.featureNotRestored = true;
  }
  return reofferOrAdvance(db, turn.id, payload, row.id, report);
}
