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
import { interestCap } from "../rules/actions.js";
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
  | { type: "idle" }
  | { type: "aid"; targetFactionId: string }
  | {
      type: "enact_change";
      magnitude?: "plausible" | "improbable";
      improbable?: boolean;
      featureText?: string;
      solveProblemId?: string;
      meansFeatureId?: string;
      domain?: string;
      covert?: number;
      aimedAtFactionId?: string;
      addPartToFeatureId?: string;
      forcedRoll?: number;
    }
  | {
      type: "attack";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      defenderChoice?: "cohesion" | "sacrifice" | "problem";
      marginal?: boolean;
      forcedAttackerRoll?: number;
      forcedDefenderRoll?: number;
    }
  | {
      type: "extend_interest";
      targetFactionId: string;
      attackerFeatureId: string;
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
  desiredOutcome?: string;
  runSteps?: FactionAction[];
  action: FactionAction;
};

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

function pickLowestFeatureId(
  db: Database.Database,
  factionId: string,
): string | undefined {
  const row = db
    .prepare("SELECT id FROM features WHERE faction_id = ? ORDER BY id ASC LIMIT 1")
    .get(factionId) as { id: string } | undefined;
  return row?.id;
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
       WHERE a.type = 'attack' AND a.target_id = ? AND a.outcome = 'attacker_win'
         AND (
           a.turn_id IN (
             SELECT id FROM turns
             WHERE campaign_id = ? AND open = 0
             ORDER BY month DESC, sequence DESC
             LIMIT 1
           )
           OR a.turn_id IN (
             SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1
           )
         )
       LIMIT 1`,
    )
    .get(factionId, campaignId, campaignId) as { id: string } | undefined;
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

function rankNeighborsBelowCap(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  neighborRows: ReturnType<typeof loadFactionRow>[],
): ReturnType<typeof loadFactionRow>[] {
  const cap = interestCap(DIE_BY_POWER[faction.power]);
  return [...neighborRows]
    .filter((n) => {
      const edge = interestTo(db, faction.id, n.id);
      const points = edge?.points ?? 0;
      return points < cap;
    })
    .sort((a, b) => {
      const gapA = cap - (interestTo(db, faction.id, a.id)?.points ?? 0);
      const gapB = cap - (interestTo(db, faction.id, b.id)?.points ?? 0);
      if (gapB !== gapA) return gapB - gapA;
      if (b.power !== a.power) return b.power - a.power;
      return a.id.localeCompare(b.id);
    });
}

function planExtendInterest(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  strategy: string,
  neighborRows: ReturnType<typeof loadFactionRow>[],
): FactionAction[] {
  const featureId = pickLowestFeatureId(db, faction.id);
  if (!featureId) return [];

  if (strategy === "half_interest") {
    const targetId = preferredInterestTarget(db, faction);
    if (!targetId) return [];
    const cap = interestCap(DIE_BY_POWER[faction.power]);
    const edge = interestTo(db, faction.id, targetId);
    if (edge && edge.points >= cap) return [];
    return [
      {
        type: "extend_interest",
        targetFactionId: targetId,
        attackerFeatureId: featureId,
      },
    ];
  }

  if (strategy === "max_interest") {
    const ranked = rankNeighborsBelowCap(db, faction, neighborRows);
    const picks = ranked.slice(0, faction.power);
    return picks.map((n) => ({
      type: "extend_interest",
      targetFactionId: n.id,
      attackerFeatureId: featureId,
    }));
  }

  if (strategy === "proxy") {
    const target = [...neighborRows].sort(
      (a, b) => b.power - a.power || a.id.localeCompare(b.id),
    )[0];
    if (!target) return [];
    const cap = interestCap(DIE_BY_POWER[faction.power]);
    const edge = interestTo(db, faction.id, target.id);
    if (edge && edge.points >= cap) return [];
    return [
      {
        type: "extend_interest",
        targetFactionId: target.id,
        attackerFeatureId: featureId,
      },
    ];
  }

  return [];
}

function resolveStrategy(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  strategy: string,
): FactionAction {
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
    const neighbors = neighborFactions(db, faction.id);
    const neighborRows = neighbors
      .map((id) => loadFactionRow(db, id))
      .filter((f) => f.status === "active");
    const extendSteps = planExtendInterest(db, faction, "proxy", neighborRows);
    if (extendSteps.length === 0) return { type: "idle" };
    return extendSteps[0];
  }

  if (strategy === "half_interest" || strategy === "max_interest") {
    const neighbors = neighborFactions(db, faction.id);
    const neighborRows = neighbors
      .map((id) => loadFactionRow(db, id))
      .filter((f) => f.status === "active");
    const extendSteps = planExtendInterest(db, faction, strategy, neighborRows);
    if (extendSteps.length === 0) return { type: "idle" };
    return extendSteps[0];
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
      if (!weaker) return { type: "idle" };
      target = weaker;
    }
    if (!target) return { type: "build_strength" };
    const features = listFeatures(db, faction.id);
    const featureRows = db
      .prepare("SELECT id, domain, covert FROM features WHERE faction_id = ?")
      .all(faction.id) as { id: string; domain: string; covert: number }[];

    let feature: { id: string; domain: string } | undefined;
    let marginal = false;

    if (strategy === "strip_military_feature" || strategy === "bloodless_coerce") {
      const nonMil = featureRows.filter((f) => f.domain !== "military").sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      feature = nonMil[0];
      if (strategy === "bloodless_coerce" && featureRows.every((f) => f.domain === "military")) {
        return { type: "build_strength" };
      }
      if (!feature) return { type: "build_strength" };
    } else if (strategy === "covert_problem") {
      const nonMil = featureRows.filter((f) => f.domain !== "military");
      const covert = nonMil.filter((f) => f.covert === 1).sort((a, b) => a.id.localeCompare(b.id));
      feature = covert[0] ?? nonMil.sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!feature) return { type: "build_strength" };
    } else if (strategy === "military_defeat") {
      feature =
        featureRows.find((f) => f.domain === "military") ??
        featureRows.find((f) => f.domain !== "military") ??
        featureRows[0];
      if (!feature) return { type: "build_strength" };
      if (feature.domain !== "military") marginal = true;
    } else {
      feature =
        features.find((f) => f.domain === "military") ??
        features.find((f) => f.domain !== "military") ??
        features[0];
      if (!feature) return { type: "build_strength" };
    }

    return {
      type: "attack",
      targetFactionId: target.id,
      attackerFeatureId: feature.id,
      ...(marginal ? { marginal: true } : {}),
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

    if (strategy === "cunning_solve") {
      const means = db
        .prepare(
          `SELECT id FROM features WHERE faction_id = ? AND domain != 'military' ORDER BY id ASC LIMIT 1`,
        )
        .get(faction.id) as { id: string } | undefined;
      if (!means) return { type: "idle" };
      const pick = problems
        .filter((p) => p.intrinsic === 0)
        .sort((a, b) => b.points - a.points)[0];
      if (!pick) return { type: "build_strength" };
      return {
        type: "enact_change",
        solveProblemId: pick.id,
        meansFeatureId: means.id,
      };
    }

    if (strategy === "solve_military") {
      const pick = problems
        .filter((p) => p.domain === "military" && p.intrinsic === 0)
        .sort((a, b) => b.points - a.points)[0];
      if (!pick) return { type: "idle" };
      return { type: "enact_change", solveProblemId: pick.id };
    }

    let pick: (typeof problems)[0] | undefined;
    if (strategy === "eliminate_resistance_problem") {
      pick = problems
        .filter((p) => p.resistance !== 0)
        .sort((a, b) => b.points - a.points)[0];
    } else if (strategy === "solve_external_problem") {
      pick = problems
        .filter((p) => p.external !== 0)
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
    if (strategy === "harmless_feature") {
      const hasCultural = listFeatures(db, faction.id, "cultural").length > 0;
      if (!hasCultural) {
        return {
          type: "enact_change",
          featureText: catalog.features.cultural[0],
          domain: "cultural",
          covert: 1,
        };
      }
      return {
        type: "enact_change",
        featureText: catalog.features.economic[0],
        domain: "economic",
        covert: 1,
      };
    }
    if (strategy === "military_feature_aimed") {
      const aimedAt = [...neighborRows].sort(
        (a, b) => b.power - a.power || a.id.localeCompare(b.id),
      )[0];
      if (!aimedAt) return { type: "idle" };
      const partText = catalog.features.military[0];
      const milFeatures = listFeatures(db, faction.id, "military").sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      if (milFeatures.length > 0) {
        return {
          type: "enact_change",
          featureText: partText,
          domain: "military",
          aimedAtFactionId: aimedAt.id,
          addPartToFeatureId: milFeatures[0].id,
        };
      }
      return {
        type: "enact_change",
        featureText: partText,
        domain: "military",
        aimedAtFactionId: aimedAt.id,
      };
    }
    const domain =
      strategy === "dissident_feature"
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
      };
    }
    strategy = next.strategy;
  }

  let substituted = false;
  let runSteps: FactionAction[] | undefined;
  let desiredOutcome: string | undefined;

  if (strategy === "max_interest" || strategy === "half_interest") {
    const neighbors = neighborFactions(db, faction.id);
    const neighborRows = neighbors
      .map((id) => loadFactionRow(db, id))
      .filter((f) => f.status === "active");
    const extendSteps = planExtendInterest(db, faction, strategy, neighborRows);
    if (extendSteps.length === 0) {
      return {
        factionId: faction.id,
        strategy,
        skipRunAction: true,
        action: { type: "idle" },
      };
    }
    runSteps = extendSteps;
  }

  let action = runSteps?.[0] ?? resolveStrategy(db, faction, strategy);

  if (action.type === "idle") {
    return {
      factionId: faction.id,
      strategy,
      skipRunAction: true,
      action: { type: "idle" },
    };
  }

  if (action.type === "aid") {
    return { factionId: faction.id, strategy, action };
  }

  if (strategy === "proxy" && action.type === "extend_interest") {
    return { factionId: faction.id, strategy, action };
  }

  if (strategy === "military_defeat") {
    desiredOutcome = "A military setback.";
  }
  if (strategy === "strip_military_feature") {
    desiredOutcome = "The target should lose a military feature.";
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

  return {
    factionId: faction.id,
    strategy,
    substituted,
    desiredOutcome,
    runSteps,
    action,
  };
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
        const steps =
          plan.runSteps ??
          (plan.action.type === "aid" ? [plan.action] : [plan.action]);
        for (const step of steps) {
          if (step.type === "aid") {
            executeAid(db, turnId, factionId, step.targetFactionId);
            continue;
          }
          if (step.type === "idle") continue;
          const actionInput = { campaignId: input.campaignId, factionId, ...step };
          const actionResult = runAction(db, actionInput);
          runGlorifyIfNeeded(db, factionId, turnId, plan.strategy, actionResult);
        }
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
