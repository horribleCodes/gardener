import type Database from "better-sqlite3";
import { DIE_BY_POWER, RuleError, type FeatureTags, type Power } from "../domain/types.js";
import {
  attackProblemDamage,
  chooseDefense,
  type DefenseChoice,
} from "../rules/actions.js";
import { factionProjectCost } from "../rules/cost.js";
import { unevenBonus, featureRoll, resolveContest } from "../rules/contest.js";
import { troubleCheck } from "../rules/trouble.js";
import { loadCatalog } from "../tables/catalog.js";
import { withTransaction } from "../store/db.js";
import {
  ensureOpenTurn,
  facesForPower,
  insertBacklashProblem,
  insertFeatureFromText,
  loadProblemsOrdered,
  nextRng,
  persistRoll,
  requireFaction,
  sumTrouble,
  wrapRule,
  type ServiceResult,
} from "./util.js";

type RunActionInput = {
  campaignId: string;
  factionId: string;
  forcedRoll?: number;
} & (
  | { type: "build_strength" }
  | {
      type: "enact_change";
      magnitude?: "plausible" | "improbable";
      improbable?: boolean;
      featureText?: string;
      solveProblemId?: string;
      problemId?: string;
    }
  | {
      type: "attack";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      defenderChoice?: DefenseChoice;
      problemId?: string;
      forcedAttackerRoll?: number;
      forcedDefenderRoll?: number;
    }
);

export function runAction(db: Database.Database, input: RunActionInput): ServiceResult<unknown> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const faction = requireFaction(db, input.factionId);
      if (faction.campaign_id !== input.campaignId) {
        throw new RuleError("ENTITY_NOT_FOUND", "faction not in campaign");
      }
      const turnId = ensureOpenTurn(db, input.campaignId);

      if (input.type === "build_strength") {
        return runBuildStrength(db, faction, turnId, input.forcedRoll);
      }
      if (input.type === "enact_change") {
        return runEnactChange(db, faction, turnId, input);
      }
      if (input.type === "attack") {
        return runAttack(db, faction, turnId, input);
      }
      throw new RuleError("FILL_INCOMPLETE", `unknown action type`);
    }),
  );
}

function runBuildStrength(
  db: Database.Database,
  faction: { id: string; campaign_id: string; power: Power; dominion: number },
  turnId: string,
  forcedRoll?: number,
) {
  const problems = loadProblemsOrdered(db, faction.id);
  const trouble = sumTrouble(problems);
  const faces = facesForPower(faction.power);
  const rng = nextRng(db, faction.campaign_id);
  const check = troubleCheck({
    rng,
    faces,
    trouble,
    problems,
    inverted: false,
    forcedRoll,
  });
  const rollId = persistRoll(db, faction.campaign_id, turnId, check.roll);
  const actionId = crypto.randomUUID();
  let dominionDelta = 0;
  if (check.success) {
    dominionDelta = Math.ceil(faction.power / 2);
    db.prepare("UPDATE factions SET dominion = dominion + ? WHERE id = ?").run(
      dominionDelta,
      faction.id,
    );
  }
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta)
     VALUES (?, ?, 'build_strength', 'faction', ?, ?, ?, ?)`,
  ).run(
    actionId,
    turnId,
    faction.id,
    rollId,
    check.success ? "success" : "failure",
    dominionDelta,
  );
  return {
    success: check.success,
    culpritId: check.culpritId,
    roll: check.roll,
  };
}

function runEnactChange(
  db: Database.Database,
  faction: { id: string; campaign_id: string; power: Power; dominion: number },
  turnId: string,
  input: Extract<RunActionInput, { type: "enact_change" }>,
) {
  const magnitude =
    input.improbable || input.magnitude === "improbable" ? "improbable" : "plausible";
  const cost = factionProjectCost(faction.power, magnitude);
  if (faction.dominion < cost) {
    throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion for enact change");
  }

  if (input.solveProblemId) {
    const preflightProblems = loadProblemsOrdered(db, faction.id);
    const preflightTrouble = sumTrouble(preflightProblems);
    if (preflightTrouble === 0) {
      throw new RuleError("NOTHING_TO_SOLVE", "nothing to solve");
    }
    const namedProblem = db
      .prepare("SELECT id, points, intrinsic FROM problems WHERE id = ? AND faction_id = ?")
      .get(input.solveProblemId, faction.id) as
      | { id: string; points: number; intrinsic: number }
      | undefined;
    if (!namedProblem) {
      throw new RuleError("ENTITY_NOT_FOUND", "problem to solve not found");
    }
    if (namedProblem.intrinsic !== 0) {
      throw new RuleError("INTRINSIC_PROBLEM", "cannot reduce an intrinsic problem");
    }
  }

  db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(cost, faction.id);

  const problems = loadProblemsOrdered(db, faction.id);
  const trouble = sumTrouble(problems);
  const faces = facesForPower(faction.power);
  const inverted = Boolean(input.solveProblemId);
  const rng = nextRng(db, faction.campaign_id);
  const check = troubleCheck({
    rng,
    faces,
    trouble,
    problems,
    inverted,
    forcedRoll: input.forcedRoll,
  });
  const rollId = persistRoll(db, faction.campaign_id, turnId, check.roll);
  const actionId = crypto.randomUUID();

  if (!check.success) {
    if (!inverted && check.culpritId) {
      const updated = db
        .prepare("UPDATE problems SET points = points + 1 WHERE id = ? AND faction_id = ?")
        .run(check.culpritId, faction.id);
      if (updated.changes === 0) {
        throw new RuleError("ENTITY_NOT_FOUND", "problem not found");
      }
    }
    db.prepare(
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta)
       VALUES (?, ?, 'enact_change', 'faction', ?, ?, 'failure', 0)`,
    ).run(actionId, turnId, faction.id, rollId);
    return { success: false, culpritId: check.culpritId, roll: check.roll };
  }

  if (input.solveProblemId) {
    const problem = db
      .prepare("SELECT id, points, intrinsic FROM problems WHERE id = ? AND faction_id = ?")
      .get(input.solveProblemId, faction.id) as
      | { id: string; points: number; intrinsic: number }
      | undefined;
    if (!problem) throw new RuleError("ENTITY_NOT_FOUND", "problem to solve not found");
    if (problem.intrinsic !== 0) {
      throw new RuleError("INTRINSIC_PROBLEM", "cannot reduce an intrinsic problem");
    }
    if (problem.points <= 1) {
      db.prepare("DELETE FROM problems WHERE id = ?").run(problem.id);
    } else {
      db.prepare("UPDATE problems SET points = points - 1 WHERE id = ?").run(problem.id);
    }
    db.prepare(
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta)
       VALUES (?, ?, 'enact_change', 'faction', ?, ?, 'success', ?)`,
    ).run(actionId, turnId, faction.id, rollId, -cost);
    return { success: true, solvedProblemId: problem.id, roll: check.roll };
  }

  if (input.featureText) {
    insertFeatureFromText(db, faction.id, input.featureText);
  }
  if (input.problemId) {
    const updated = db
      .prepare("UPDATE problems SET points = points + 1 WHERE id = ? AND faction_id = ?")
      .run(input.problemId, faction.id);
    if (updated.changes === 0) {
      throw new RuleError("ENTITY_NOT_FOUND", "problem not found");
    }
  } else {
    insertBacklashProblem(db, faction.id);
  }
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta)
     VALUES (?, ?, 'enact_change', 'faction', ?, ?, 'success', ?)`,
  ).run(actionId, turnId, faction.id, rollId, -cost);
  return { success: true, roll: check.roll };
}

function runAttack(
  db: Database.Database,
  attacker: { id: string; campaign_id: string; power: Power },
  turnId: string,
  input: Extract<RunActionInput, { type: "attack" }>,
) {
  const defender = requireFaction(db, input.targetFactionId);
  const attackerFeature = db
    .prepare(
      `SELECT id, faction_id, domain, size, quality, magical, origin FROM features WHERE id = ?`,
    )
    .get(input.attackerFeatureId) as
    | {
        id: string;
        faction_id: string;
        domain: string;
        size: string;
        quality: string;
        magical: number;
        origin: string;
      }
    | undefined;
  if (!attackerFeature || attackerFeature.faction_id !== attacker.id) {
    throw new RuleError("ENTITY_NOT_FOUND", "attacker feature not found");
  }

  const attackerTags: FeatureTags = {
    domain: attackerFeature.domain as FeatureTags["domain"],
    size: attackerFeature.size as FeatureTags["size"],
    quality: attackerFeature.quality as FeatureTags["quality"],
    magical: attackerFeature.magical !== 0,
    origin: attackerFeature.origin as FeatureTags["origin"],
  };

  const rng = nextRng(db, attacker.campaign_id);
  const attackerFaces = DIE_BY_POWER[attacker.power];
  let defenderFeature: typeof attackerFeature | undefined;
  let defenderTags: FeatureTags | null = null;
  let defenderTotal = 0;

  if (input.defenderFeatureId) {
    defenderFeature = db
      .prepare(
        `SELECT id, faction_id, domain, size, quality, magical, origin FROM features WHERE id = ?`,
      )
      .get(input.defenderFeatureId) as typeof attackerFeature | undefined;
  }

  let attackerRoll;
  let winner: "attacker" | "defender";
  if (!defenderFeature || defenderFeature.faction_id !== defender.id) {
    attackerRoll = featureRoll({
      rng,
      faces: attackerFaces,
      marginal: false,
      bonus: 0,
      forced: input.forcedAttackerRoll,
    });
    winner = "attacker";
  } else {
    defenderTags = {
      domain: defenderFeature.domain as FeatureTags["domain"],
      size: defenderFeature.size as FeatureTags["size"],
      quality: defenderFeature.quality as FeatureTags["quality"],
      magical: defenderFeature.magical !== 0,
      origin: defenderFeature.origin as FeatureTags["origin"],
    };
    const defenderFaces = DIE_BY_POWER[defender.power];
    const attackerBonus = unevenBonus(attackerTags, defenderTags);
    const defenderBonus = unevenBonus(defenderTags, attackerTags);
    attackerRoll = featureRoll({
      rng,
      faces: attackerFaces,
      marginal: false,
      bonus: attackerBonus,
      forced: input.forcedAttackerRoll,
    });
    const defenderRoll = featureRoll({
      rng,
      faces: defenderFaces,
      marginal: defender.power < attacker.power,
      bonus: defenderBonus,
      forced: input.forcedDefenderRoll,
    });
    defenderTotal = defenderRoll.total;
    winner = resolveContest({
      attackerTotal: attackerRoll.total,
      defenderTotal: defenderRoll.total,
      attackerPower: attacker.power,
      defenderPower: defender.power,
    });
  }

  const rollId = persistRoll(db, attacker.campaign_id, turnId, {
    attacker: attackerRoll,
    defenderTotal,
    winner,
  });
  const actionId = crypto.randomUUID();

  if (winner === "defender") {
    db.prepare(
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
       VALUES (?, ?, 'attack', 'faction', ?, 'faction', ?, ?, ?, 'defender_win')`,
    ).run(
      actionId,
      turnId,
      attacker.id,
      defender.id,
      JSON.stringify([input.attackerFeatureId, input.defenderFeatureId ?? null]),
      rollId,
    );
    return { success: false, winner: "defender" };
  }

  if (defender.control === "player" && !input.defenderChoice) {
    db.prepare(
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
       VALUES (?, ?, 'attack', 'faction', ?, 'faction', ?, ?, ?, 'PENDING_DEFENDER_CHOICE')`,
    ).run(
      actionId,
      turnId,
      attacker.id,
      defender.id,
      JSON.stringify([input.attackerFeatureId, input.defenderFeatureId ?? null]),
      rollId,
    );
    return { pending: true, code: "PENDING_DEFENDER_CHOICE" };
  }

  const problems = loadProblemsOrdered(db, defender.id);
  const trouble = sumTrouble(problems);
  const dieMax = facesForPower(defender.power);
  const damage = attackProblemDamage(attacker.power, defender.power);
  const canSacrifice = Boolean(defenderFeature);
  const choice =
    input.defenderChoice ??
    chooseDefense({
      policy: "preserve_existence",
      cohesion: defender.cohesion,
      trouble,
      dieMax,
      problemDamage: damage,
      canSacrifice,
    });

  if (choice === "cohesion") {
    db.prepare("UPDATE factions SET cohesion = cohesion - 1 WHERE id = ?").run(defender.id);
  } else if (choice === "sacrifice" && defenderFeature) {
    db.prepare("DELETE FROM feature_parts WHERE feature_id = ?").run(defenderFeature.id);
    db.prepare("DELETE FROM features WHERE id = ?").run(defenderFeature.id);
  } else {
    if (input.problemId) {
      const updated = db
        .prepare("UPDATE problems SET points = points + ? WHERE id = ? AND faction_id = ?")
        .run(damage, input.problemId, defender.id);
      if (updated.changes === 0) {
        throw new RuleError("ENTITY_NOT_FOUND", "problem not found");
      }
    } else {
      const problemId = crypto.randomUUID();
      const problemText = loadCatalog().problems.military[0];
      db.prepare(
        `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
         VALUES (?, ?, ?, ?, 'military', 0, 0, 0, ?)`,
      ).run(problemId, defender.id, problemText, damage, problems.length);
    }
  }

  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
     VALUES (?, ?, 'attack', 'faction', ?, 'faction', ?, ?, ?, 'attacker_win')`,
  ).run(
    actionId,
    turnId,
    attacker.id,
    defender.id,
    JSON.stringify([input.attackerFeatureId, input.defenderFeatureId ?? null]),
    rollId,
  );
  return { success: true, winner: "attacker", defense: choice };
}
