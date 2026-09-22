import type Database from "better-sqlite3";
import {
  DIE_BY_POWER,
  RuleError,
  type Behavior,
  type Power,
} from "../domain/types.js";
import { monthlyDominion } from "../rules/cults.js";
import type { Harshness } from "../domain/types.js";
import { rollDie } from "../rules/dice.js";
import { planGoal } from "../rules/goals.js";
import { factionProjectCost } from "../rules/cost.js";
import { loadCatalog } from "../tables/catalog.js";
import { withTransaction } from "../store/db.js";
import { runAction } from "./actions.js";
import {
  nextRng,
  requireCampaign,
  requireFaction,
  wrapRule,
  type ServiceResult,
} from "./util.js";

type FactionAction =
  | { type: "build_strength"; forcedRoll?: number }
  | { type: "aid"; targetFactionId: string }
  | {
      type: "enact_change";
      magnitude?: "plausible" | "improbable";
      improbable?: boolean;
      featureText?: string;
      solveProblemId?: string;
      forcedRoll?: number;
    }
  | {
      type: "attack";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      defenderChoice?: "cohesion" | "sacrifice" | "problem";
      forcedAttackerRoll?: number;
      forcedDefenderRoll?: number;
    };

export type RunFactionTurnInput = {
  campaignId: string;
  advanceMonth?: boolean;
  resume?: boolean;
  actions?: Record<string, FactionAction>;
};

type FactionPlanResult = {
  factionId: string;
  strategy?: string;
  substituted?: boolean;
  skipRunAction?: boolean;
  action: FactionAction;
};

const INTEREST_ONLY_STRATEGIES = new Set([
  "max_interest",
  "half_interest",
]);

function shuffleIds(ids: string[], rng: { next(): number }): string[] {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function loadFactionRow(
  db: Database.Database,
  factionId: string,
): {
  id: string;
  campaign_id: string;
  name: string;
  power: Power;
  cohesion: number;
  dominion: number;
  behavior: Behavior;
  control: string;
  status: string;
} {
  const row = db
    .prepare(
      `SELECT id, campaign_id, name, power, cohesion, dominion, behavior, control, status
       FROM factions WHERE id = ?`,
    )
    .get(factionId) as
    | {
        id: string;
        campaign_id: string;
        name: string;
        power: Power;
        cohesion: number;
        dominion: number;
        behavior: Behavior;
        control: string;
        status: string;
      }
    | undefined;
  if (!row) throw new RuleError("ENTITY_NOT_FOUND", `faction ${factionId} not found`);
  return row;
}

function neighborFactions(db: Database.Database, factionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT CASE WHEN from_faction_id = ? THEN to_faction_id ELSE from_faction_id END AS other
       FROM interests WHERE from_faction_id = ? OR to_faction_id = ?`,
    )
    .all(factionId, factionId, factionId) as { other: string }[];
  return rows.map((r) => r.other);
}

function interestTo(
  db: Database.Database,
  fromId: string,
  toId: string,
): { points: number; nature: string } | undefined {
  return db
    .prepare(
      "SELECT points, nature FROM interests WHERE from_faction_id = ? AND to_faction_id = ?",
    )
    .get(fromId, toId) as { points: number; nature: string } | undefined;
}

function listFeatures(
  db: Database.Database,
  factionId: string,
  domain?: string,
  militaryOnly?: boolean,
): { id: string; domain: string; text: string }[] {
  const rows = db
    .prepare("SELECT id, domain, text FROM features WHERE faction_id = ?")
    .all(factionId) as { id: string; domain: string; text: string }[];
  return rows.filter((f) => {
    if (domain && f.domain !== domain) return false;
    if (militaryOnly && f.domain !== "military") return false;
    return true;
  });
}

export function preferredInterestTarget(
  db: Database.Database,
  faction: { id: string; power: Power },
): string | undefined {
  const neighbors = neighborFactions(db, faction.id);
  const active = neighbors
    .map((id) => loadFactionRow(db, id))
    .filter((f) => f.status === "active")
    .sort((a, b) => a.id.localeCompare(b.id));
  const weaker = active.find((n) => n.power < faction.power);
  return weaker?.id ?? active[0]?.id;
}

export function halfInterestSatisfied(
  db: Database.Database,
  faction: { id: string; power: Power },
): boolean {
  const targetId = preferredInterestTarget(db, faction);
  if (!targetId) return false;
  const interest = interestTo(db, faction.id, targetId);
  const dieMax = DIE_BY_POWER[faction.power];
  return interest != null && interest.points >= dieMax;
}

function strategySatisfied(
  db: Database.Database,
  faction: { id: string; power: Power; dominion: number },
  strategy: string,
): boolean {
  if (strategy === "stockpile") {
    return faction.dominion >= 2 * faction.power;
  }
  if (strategy === "half_interest") {
    return halfInterestSatisfied(db, faction);
  }
  return false;
}

function priorAttackerWinAgainst(
  db: Database.Database,
  campaignId: string,
  factionId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT a.id FROM actions a
       INNER JOIN turns t ON a.turn_id = t.id
       WHERE t.campaign_id = ? AND t.open = 0
         AND a.type = 'attack' AND a.target_id = ? AND a.outcome = 'attacker_win'
       LIMIT 1`,
    )
    .get(campaignId, factionId) as { id: string } | undefined;
  return row != null;
}

function pickProxyRecipient(
  db: Database.Database,
  actorId: string,
  campaignId: string,
): string | undefined {
  const row = db
    .prepare(
      `SELECT f.id FROM factions f
       WHERE f.campaign_id = ? AND f.status = 'active' AND f.id != ?
         AND EXISTS (SELECT 1 FROM features WHERE faction_id = f.id AND domain = 'military')
       ORDER BY f.power DESC, f.id ASC
       LIMIT 1`,
    )
    .get(campaignId, actorId) as { id: string } | undefined;
  return row?.id;
}

function executeAid(
  db: Database.Database,
  turnId: string,
  actorId: string,
  targetId: string,
): void {
  db.prepare("UPDATE factions SET dominion = dominion - 1 WHERE id = ?").run(actorId);
  db.prepare("UPDATE factions SET dominion = dominion + 1 WHERE id = ?").run(targetId);
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, dominion_delta)
     VALUES (?, ?, 'aid', 'faction', ?, 'faction', ?, -1)`,
  ).run(crypto.randomUUID(), turnId, actorId, targetId);
}

function militaryDefeatTarget(
  db: Database.Database,
  factionId: string,
  neighborRows: ReturnType<typeof loadFactionRow>[],
  neighbors: string[],
): ReturnType<typeof loadFactionRow> | undefined {
  const scored = neighbors
    .map((nId) => ({
      id: nId,
      interest: interestTo(db, factionId, nId),
    }))
    .filter((x) => x.interest && (x.interest.nature === "rivalry" || x.interest.nature === "spies"))
    .sort((a, b) => (b.interest?.points ?? 0) - (a.interest?.points ?? 0));
  if (scored[0]) return loadFactionRow(db, scored[0].id);
  return neighborRows[0];
}

function pickGoalRoll(db: Database.Database, campaignId: string, forced?: number): number {
  if (forced != null) return forced;
  const rng = nextRng(db, campaignId);
  return rollDie(rng, 10).natural;
}

function resolveStrategy(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  strategy: string,
): FactionAction {
  if (INTEREST_ONLY_STRATEGIES.has(strategy)) {
    return { type: "build_strength" };
  }

  if (strategy === "stockpile") {
    return { type: "build_strength" };
  }

  if (strategy === "no_external_until_hit") {
    if (!priorAttackerWinAgainst(db, faction.campaign_id, faction.id)) {
      return { type: "build_strength" };
    }
    const neighbors = neighborFactions(db, faction.id);
    const neighborRows = neighbors
      .map((id) => loadFactionRow(db, id))
      .filter((f) => f.status === "active");
    const target = militaryDefeatTarget(db, faction.id, neighborRows, neighbors);
    if (!target) return { type: "build_strength" };
    const mil = listFeatures(db, faction.id, "military")[0];
    if (!mil) return { type: "build_strength" };
    return {
      type: "attack",
      targetFactionId: target.id,
      attackerFeatureId: mil.id,
    };
  }

  if (strategy === "proxy") {
    if (faction.dominion >= 1) {
      const recipient = pickProxyRecipient(db, faction.id, faction.campaign_id);
      if (recipient) {
        return { type: "aid", targetFactionId: recipient };
      }
    }
    return { type: "build_strength" };
  }

  if (strategy === "glorify") {
    return { type: "enact_change", magnitude: "plausible" };
  }

  const neighbors = neighborFactions(db, faction.id);
  const neighborRows = neighbors
    .map((id) => loadFactionRow(db, id))
    .filter((f) => f.status === "active");

  if (strategy === "expand_reach") {
    const weaker = neighborRows.find((n) => n.power < faction.power);
    if (weaker) {
      const mil = listFeatures(db, faction.id, "military")[0];
      if (mil) {
        return {
          type: "attack",
          targetFactionId: weaker.id,
          attackerFeatureId: mil.id,
        };
      }
    }
    return {
      type: "enact_change",
      improbable: true,
      featureText: "Their reach extends into land that had no faction.",
    };
  }

  if (
    strategy === "military_defeat" ||
    strategy === "beat_weaker" ||
    strategy === "bloodless_coerce" ||
    strategy === "covert_problem" ||
    strategy === "strip_military_feature"
  ) {
    let target = neighborRows[0];
    if (strategy === "military_defeat") {
      const scored = neighbors
        .map((nId) => ({
          id: nId,
          interest: interestTo(db, faction.id, nId),
        }))
        .filter((x) => x.interest && (x.interest.nature === "rivalry" || x.interest.nature === "spies"))
        .sort((a, b) => (b.interest?.points ?? 0) - (a.interest?.points ?? 0));
      if (scored[0]) target = loadFactionRow(db, scored[0].id);
    }
    if (strategy === "beat_weaker") {
      const weaker = neighborRows
        .filter((n) => n.power < faction.power)
        .sort((a, b) => a.power - b.power)[0];
      if (!weaker) return { type: "build_strength" };
      target = weaker;
    }
    if (!target) return { type: "build_strength" };
    const wantMilitary = strategy !== "bloodless_coerce" && strategy !== "strip_military_feature";
    const features = listFeatures(db, faction.id);
    const feature =
      features.find((f) => f.domain === (wantMilitary ? "military" : "cultural")) ??
      features.find((f) => f.domain !== "military") ??
      features[0];
    if (!feature) return { type: "build_strength" };
    if (strategy === "bloodless_coerce" && features.every((f) => f.domain === "military")) {
      return { type: "build_strength" };
    }
    return {
      type: "attack",
      targetFactionId: target.id,
      attackerFeatureId: feature.id,
    };
  }

  if (
    strategy === "eliminate_resistance_problem" ||
    strategy === "solve_external_problem" ||
    strategy === "cunning_solve" ||
    strategy === "solve_military"
  ) {
    const problems = db
      .prepare(
        `SELECT id, points, resistance, external, domain, intrinsic FROM problems
         WHERE faction_id = ? ORDER BY position ASC`,
      )
      .all(faction.id) as {
      id: string;
      points: number;
      resistance: number;
      external: number;
      domain: string;
      intrinsic: number;
    }[];
    let pick: (typeof problems)[0] | undefined;
    if (strategy === "eliminate_resistance_problem") {
      pick = problems
        .filter((p) => p.resistance !== 0)
        .sort((a, b) => b.points - a.points)[0];
    } else if (strategy === "solve_external_problem") {
      pick = problems
        .filter((p) => p.external !== 0)
        .sort((a, b) => b.points - a.points)[0];
    } else if (strategy === "solve_military") {
      pick = problems
        .filter((p) => p.domain === "military")
        .sort((a, b) => b.points - a.points)[0];
    }
    if (!pick) {
      pick = problems
        .filter((p) => p.intrinsic === 0)
        .sort((a, b) => b.points - a.points)[0];
    }
    if (!pick) return { type: "build_strength" };
    return { type: "enact_change", solveProblemId: pick.id };
  }

  if (
    strategy === "dissident_feature" ||
    strategy === "survival_feature" ||
    strategy === "harmless_feature" ||
    strategy === "military_feature_aimed"
  ) {
    const catalog = loadCatalog();
    const domain =
      strategy === "harmless_feature"
        ? "cultural"
        : strategy === "dissident_feature"
          ? "military"
          : "military";
    const pool = catalog.features[domain] ?? catalog.features.other;
    const text = pool[0] ?? catalog.features.other[0];
    return { type: "enact_change", featureText: text };
  }

  return { type: "build_strength" };
}

function planFactionAction(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  explicit?: FactionAction,
): FactionPlanResult {
  if (explicit) {
    return { factionId: faction.id, action: explicit };
  }
  if (faction.behavior === "directed") {
    throw new RuleError("MAGNITUDE_REJECTED", "directed factions need an explicit plan");
  }

  let roll = pickGoalRoll(db, faction.campaign_id);
  let { strategy } = planGoal(faction.behavior, roll);
  while (strategySatisfied(db, faction, strategy)) {
    roll = pickGoalRoll(db, faction.campaign_id);
    const next = planGoal(faction.behavior, roll);
    if (strategySatisfied(db, faction, next.strategy)) {
      return {
        factionId: faction.id,
        strategy: next.strategy,
        action: { type: "build_strength" },
        skipRunAction: true,
      };
    }
    strategy = next.strategy;
  }

  let substituted = false;
  if (INTEREST_ONLY_STRATEGIES.has(strategy)) {
    substituted = true;
    return { factionId: faction.id, strategy, substituted, action: { type: "build_strength" } };
  }
  let action = resolveStrategy(db, faction, strategy);

  if (action.type === "aid") {
    return { factionId: faction.id, strategy, action };
  }

  if (strategy === "proxy" && action.type === "build_strength") {
    return { factionId: faction.id, strategy, substituted: true, action };
  }

  if (action.type === "enact_change") {
    const magnitude =
      action.improbable || action.magnitude === "improbable" ? "improbable" : "plausible";
    const cost = factionProjectCost(faction.power, magnitude);
    if (faction.dominion < cost) {
      substituted = true;
      action = { type: "build_strength" };
    }
  }

  return { factionId: faction.id, strategy, substituted, action };
}

function runGlorifyIfNeeded(
  db: Database.Database,
  factionId: string,
  turnId: string,
  strategy: string | undefined,
  actionResult: { ok: boolean; data?: unknown },
) {
  if (strategy !== "glorify" || !actionResult.ok) return;
  const data = actionResult.data as { success?: boolean };
  if (!data.success) return;
  const statement = loadCatalog().minorRelationship[0]?.text ?? "A boastful proclamation";
  const factId = crypto.randomUUID();
  const faction = requireFaction(db, factionId);
  db.prepare(
    `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility)
     VALUES (?, ?, 'faction', ?, ?, 'vanity', 'public')`,
  ).run(factId, faction.campaign_id, factionId, statement);
}

export function advanceMonth(db: Database.Database, campaignId: string): void {
  const campaign = requireCampaign(db, campaignId);
  const openTurn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(campaignId);
  if (openTurn) {
    throw new RuleError("TURN_ALREADY_OPEN", "cannot advance month while a turn is open");
  }

  db.prepare("UPDATE campaigns SET month = month + 1 WHERE id = ?").run(campaignId);

  const godbound = db
    .prepare(
      `SELECT id, level, divinity, cult_faction_id, dominion FROM godbound WHERE campaign_id = ?`,
    )
    .all(campaignId) as {
    id: string;
    level: number;
    divinity: string;
    cult_faction_id: string | null;
    dominion: number;
  }[];

  for (const gb of godbound) {
    let grant = 0;
    let kind: "free" | "cult" | "none" = "none";
    if (gb.divinity === "free") {
      kind = "free";
      grant = monthlyDominion({ kind: "free", level: gb.level, power: 0, harshness: "nominal" });
    } else if (gb.divinity === "cult" && gb.cult_faction_id) {
      kind = "cult";
      const cult = db
        .prepare("SELECT power, harshness FROM factions WHERE id = ?")
        .get(gb.cult_faction_id) as { power: number; harshness: string | null } | undefined;
      if (cult) {
        grant = monthlyDominion({
          kind: "cult",
          power: cult.power,
          harshness: (cult.harshness ?? "nominal") as Harshness,
          level: gb.level,
        });
      }
    }
    if (grant > 0) {
      db.prepare("UPDATE godbound SET dominion = dominion + ? WHERE id = ?").run(grant, gb.id);
      db.prepare(
        `INSERT INTO events (id, campaign_id, type, payload, created_at)
         VALUES (?, ?, 'income', ?, ?)`,
      ).run(
        crypto.randomUUID(),
        campaignId,
        JSON.stringify({ godboundId: gb.id, kind, amount: grant, month: campaign.month + 1 }),
        Date.now(),
      );
    }
  }
}

export function runFactionTurn(
  db: Database.Database,
  input: RunFactionTurnInput,
): ServiceResult<{ order: string[]; results: FactionPlanResult[] }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const existing = db
        .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
        .get(input.campaignId) as { id: string } | undefined;
      if (existing && !input.resume) {
        throw new RuleError("TURN_ALREADY_OPEN", "a turn is already open");
      }

      const acting = db
        .prepare(
          `SELECT id FROM factions
           WHERE campaign_id = ? AND status = 'active' AND control = 'npc'`,
        )
        .all(input.campaignId) as { id: string }[];

      let order: string[];
      let turnId: string;
      if (existing) {
        turnId = existing.id;
        const turnRow = db
          .prepare("SELECT faction_order FROM turns WHERE id = ?")
          .get(turnId) as { faction_order: string };
        order = JSON.parse(turnRow.faction_order) as string[];
      } else {
        const shuffleRng = nextRng(db, input.campaignId);
        order = shuffleIds(acting.map((f) => f.id), shuffleRng);
        const campaign = requireCampaign(db, input.campaignId);
        turnId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
           VALUES (?, ?, ?, 1, 1, ?)`,
        ).run(turnId, input.campaignId, campaign.month, JSON.stringify(order));
      }

      const actedRows = db
        .prepare(
          `SELECT DISTINCT actor_id FROM actions WHERE turn_id = ? AND actor_type = 'faction'`,
        )
        .all(turnId) as { actor_id: string }[];
      const alreadyActed = new Set(actedRows.map((r) => r.actor_id));

      const results: FactionPlanResult[] = [];
      for (const factionId of order) {
        if (alreadyActed.has(factionId)) continue;
        const fresh = loadFactionRow(db, factionId);
        const plan = planFactionAction(db, fresh, input.actions?.[factionId]);
        if (plan.skipRunAction) {
          results.push(plan);
          continue;
        }
        if (plan.action.type === "aid") {
          executeAid(db, turnId, factionId, plan.action.targetFactionId);
          results.push(plan);
          continue;
        }
        const actionInput = { campaignId: input.campaignId, factionId, ...plan.action };
        const actionResult = runAction(db, actionInput);
        runGlorifyIfNeeded(db, factionId, turnId, plan.strategy, actionResult);
        results.push(plan);
      }

      db.prepare("UPDATE turns SET open = 0, faction_order = ? WHERE id = ?").run(
        JSON.stringify(order),
        turnId,
      );

      if (input.advanceMonth) {
        advanceMonth(db, input.campaignId);
      }

      return { order, results };
    }),
  );
}
