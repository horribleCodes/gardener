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

function strategySatisfied(
  db: Database.Database,
  faction: { id: string; power: Power; dominion: number },
  strategy: string,
): boolean {
  if (strategy === "stockpile") {
    return faction.dominion >= 2 * faction.power;
  }
  if (strategy === "half_interest") {
    const dieMax = DIE_BY_POWER[faction.power];
    const neighbors = neighborFactions(db, faction.id);
    for (const nId of neighbors) {
      const interest = interestTo(db, faction.id, nId);
      if (interest && interest.points >= dieMax) return true;
    }
    return false;
  }
  return false;
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
  if (INTEREST_ONLY_STRATEGIES.has(strategy) || strategy === "proxy") {
    return { type: "build_strength" };
  }

  if (strategy === "stockpile" || strategy === "no_external_until_hit") {
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
      return { factionId: faction.id, strategy, action: { type: "build_strength" } };
    }
    strategy = next.strategy;
  }

  let substituted = false;
  if (INTEREST_ONLY_STRATEGIES.has(strategy)) {
    substituted = true;
    return { factionId: faction.id, strategy, substituted, action: { type: "build_strength" } };
  }
  if (strategy === "proxy") {
    substituted = true;
    return { factionId: faction.id, strategy, substituted, action: { type: "build_strength" } };
  }

  let action = resolveStrategy(db, faction, strategy);

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

      const shuffleRng = nextRng(db, input.campaignId);
      const order = shuffleIds(acting.map((f) => f.id), shuffleRng);

      let turnId: string;
      if (existing) {
        turnId = existing.id;
      } else {
        const campaign = requireCampaign(db, input.campaignId);
        turnId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
           VALUES (?, ?, ?, 1, 1, ?)`,
        ).run(turnId, input.campaignId, campaign.month, JSON.stringify(order));
      }

      const results: FactionPlanResult[] = [];
      for (const factionId of order) {
        const fresh = loadFactionRow(db, factionId);
        const plan = planFactionAction(db, fresh, input.actions?.[factionId]);
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
