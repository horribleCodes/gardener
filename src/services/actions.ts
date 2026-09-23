import type Database from "better-sqlite3";
import { DIE_BY_POWER, RuleError, type FeatureTags, type Power } from "../domain/types.js";
import {
  attackProblemDamage,
  chooseDefense,
  interestCap,
  type DefenseChoice,
} from "../rules/actions.js";
import { factionProjectCost } from "../rules/cost.js";
import {
  defaultRelevance,
  unevenBonus,
  featureRoll,
  resolveContest,
} from "../rules/contest.js";
import { restoreCohesionCost } from "../rules/cost.js";
import { rollDie } from "../rules/dice.js";
import { applyCollapseIfNeeded } from "./collapse.js";
import { listUsableFeatures, resolveDefenderFeature, type FeatureRow } from "./features.js";
import type { StandingOrder } from "./unitPlan.js";
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
  nextProblemPosition,
  persistRoll,
  recordActionEvent,
  requireFaction,
  sumTrouble,
  troubleRollPayload,
  wrapRule,
  type ServiceResult,
} from "./util.js";

export type RunActionInput = {
  campaignId: string;
  factionId: string;
  forcedRoll?: number;
  standingOrders?: StandingOrder[];
} & (
  | { type: "build_strength" }
  | { type: "restore_cohesion" }
  | { type: "aid"; targetFactionId: string; amount?: number; changeId?: string }
  | {
      type: "remove_interest";
      targetFactionId: string;
      willing?: boolean;
      forcedRoll?: number;
    }
  | {
      type: "enact_change";
      magnitude?: "plausible" | "improbable";
      improbable?: boolean;
      featureText?: string;
      solveProblemId?: string;
      meansFeatureId?: string;
      problemId?: string;
      domain?: string;
      covert?: number;
      aimedAtFactionId?: string;
      addPartToFeatureId?: string;
    }
  | {
      type: "attack";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      defenderChoice?: DefenseChoice;
      problemId?: string;
      marginal?: boolean;
      forcedAttackerRoll?: number;
      forcedDefenderRoll?: number;
    }
  | {
      type: "extend_interest";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      willing?: boolean;
      marginal?: boolean;
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
      if (input.type === "extend_interest") {
        return runExtendInterest(db, faction, turnId, input);
      }
      if (input.type === "restore_cohesion") {
        return runRestoreCohesion(db, faction, turnId, input.forcedRoll);
      }
      if (input.type === "aid") {
        return runAid(db, faction, turnId, input);
      }
      if (input.type === "remove_interest") {
        return runRemoveInterest(db, faction, turnId, input);
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
  const rollId = persistRoll(
    db,
    faction.campaign_id,
    turnId,
    troubleRollPayload(check.roll, trouble, check.success, check.culpritId),
  );
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
  recordActionEvent(db, {
    campaignId: faction.campaign_id,
    turnId,
    type: "faction_action",
    payload: {
      actorId: faction.id,
      actionType: "build_strength",
      outcome: check.success ? "success" : "failure",
      rollId,
    },
  });
  applyCollapseIfNeeded(db, faction.id, turnId);
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
    if (namedProblem && namedProblem.intrinsic !== 0) {
      throw new RuleError("INTRINSIC_PROBLEM", "cannot reduce an intrinsic problem");
    }
    const hasNonIntrinsic = preflightProblems.some((p) => !p.intrinsic);
    if (!hasNonIntrinsic) {
      throw new RuleError("NOTHING_TO_SOLVE", "nothing to solve");
    }
    if (!namedProblem) {
      throw new RuleError("ENTITY_NOT_FOUND", "problem to solve not found");
    }
  }

  if (faction.dominion < cost) {
    throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion for enact change");
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
  const rollId = persistRoll(
    db,
    faction.campaign_id,
    turnId,
    troubleRollPayload(check.roll, trouble, check.success, check.culpritId),
  );
  const actionId = crypto.randomUUID();
  const enactFeatureIds = input.meansFeatureId
    ? JSON.stringify([input.meansFeatureId])
    : "[]";

  if (!check.success) {
    if (!inverted && check.culpritId) {
      const updated = db
        .prepare("UPDATE problems SET points = points + 1 WHERE id = ? AND faction_id = ?")
        .run(check.culpritId, faction.id);
      if (updated.changes === 0) {
        throw new RuleError("ENTITY_NOT_FOUND", "problem not found");
      }
      applyCollapseIfNeeded(db, faction.id, turnId);
    }
    db.prepare(
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta, feature_ids)
       VALUES (?, ?, 'enact_change', 'faction', ?, ?, 'failure', 0, ?)`,
    ).run(actionId, turnId, faction.id, rollId, enactFeatureIds);
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
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta, feature_ids)
       VALUES (?, ?, 'enact_change', 'faction', ?, ?, 'success', ?, ?)`,
    ).run(actionId, turnId, faction.id, rollId, -cost, enactFeatureIds);
    return { success: true, solvedProblemId: problem.id, roll: check.roll };
  }

  if (input.addPartToFeatureId) {
    const feature = db
      .prepare("SELECT id, faction_id FROM features WHERE id = ? AND faction_id = ?")
      .get(input.addPartToFeatureId, faction.id) as { id: string; faction_id: string } | undefined;
    if (!feature) throw new RuleError("ENTITY_NOT_FOUND", "feature to extend not found");
    const posRow = db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM feature_parts WHERE feature_id = ?")
      .get(input.addPartToFeatureId) as { p: number };
    const partText = input.featureText ?? "";
    db.prepare(
      "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
    ).run(crypto.randomUUID(), input.addPartToFeatureId, partText, posRow.p);
    if (input.aimedAtFactionId) {
      db.prepare("UPDATE features SET aimed_at_faction_id = ? WHERE id = ?").run(
        input.aimedAtFactionId,
        input.addPartToFeatureId,
      );
    }
  } else if (input.featureText) {
    insertFeatureFromText(db, faction.id, input.featureText, {
      domain: input.domain,
      covert: input.covert,
      aimedAtFactionId: input.aimedAtFactionId ?? null,
    });
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

function spendStandingOrdersOnContest(
  db: Database.Database,
  campaignId: string,
  turnId: string,
  spenderId: string,
  attackerId: string,
  defenderId: string,
  attackerTotal: number,
  defenderTotal: number,
  orders: StandingOrder[],
): { attackerTotal: number; defenderTotal: number } {
  let aTotal = attackerTotal;
  let dTotal = defenderTotal;
  const spender = requireFaction(db, spenderId);
  const dieMax = DIE_BY_POWER[spender.power];

  for (const order of orders) {
    const edge = db
      .prepare(
        "SELECT points FROM interests WHERE from_faction_id = ? AND to_faction_id = ?",
      )
      .get(spenderId, order.targetFactionId) as { points: number } | undefined;
    const cap = Math.min(order.maxSpend, dieMax, edge?.points ?? 0);
    if (cap <= 0) continue;

    const helpsAttacker = order.side === "help" && order.targetFactionId === attackerId;
    const helpsDefender = order.side === "help" && order.targetFactionId === defenderId;
    const harmsAttacker = order.side === "harm" && order.targetFactionId === attackerId;
    const harmsDefender = order.side === "harm" && order.targetFactionId === defenderId;

    let spent = 0;
    for (let m = 1; m <= cap; m++) {
      let na = aTotal;
      let nd = dTotal;
      if (helpsAttacker) na += m;
      if (helpsDefender) nd += m;
      if (harmsAttacker) na -= m;
      if (harmsDefender) nd -= m;
      const before = resolveContest({
        attackerTotal: aTotal,
        defenderTotal: dTotal,
        attackerPower: requireFaction(db, attackerId).power,
        defenderPower: requireFaction(db, defenderId).power,
      });
      const after = resolveContest({
        attackerTotal: na,
        defenderTotal: nd,
        attackerPower: requireFaction(db, attackerId).power,
        defenderPower: requireFaction(db, defenderId).power,
      });
      if (before !== after) {
        spent = m;
        aTotal = na;
        dTotal = nd;
        break;
      }
    }
    if (spent > 0 && edge) {
      db.prepare(
        "UPDATE interests SET points = points - ? WHERE from_faction_id = ? AND to_faction_id = ?",
      ).run(spent, spenderId, order.targetFactionId);
      db.prepare(
        `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome)
         VALUES (?, ?, 'spend_interest', 'faction', ?, 'faction', ?, 'success')`,
      ).run(crypto.randomUUID(), turnId, spenderId, order.targetFactionId);
    }
  }
  return { attackerTotal: aTotal, defenderTotal: dTotal };
}

export function applyAttackDefense(
  db: Database.Database,
  input: {
    campaignId: string;
    turnId: string;
    actionId: string;
    attackerId: string;
    defenderId: string;
    attackerFeatureId: string;
    defenderFeatureId: string | null;
    defenderChoice: DefenseChoice;
    problemId?: string;
  },
): void {
  const defender = requireFaction(db, input.defenderId);
  const attacker = requireFaction(db, input.attackerId);
  let defenderFeature: FeatureRow | undefined;
  if (input.defenderFeatureId) {
    defenderFeature = resolveDefenderFeature(db, defender.id, input.defenderFeatureId);
  }

  const problems = loadProblemsOrdered(db, defender.id);
  const trouble = sumTrouble(problems);
  const dieMax = facesForPower(defender.power);
  const damage = attackProblemDamage(attacker.power, defender.power);
  const canSacrifice = Boolean(defenderFeature);
  const choice = input.defenderChoice;
  if (choice === "sacrifice" && !canSacrifice) {
    throw new RuleError("NO_USABLE_FEATURE", "no feature to sacrifice");
  }

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
      ).run(problemId, defender.id, problemText, damage, nextProblemPosition(db, defender.id));
    }
  }

  db.prepare("UPDATE actions SET outcome = ? WHERE id = ?").run("attacker_win", input.actionId);
  applyCollapseIfNeeded(db, defender.id, input.turnId);
  recordActionEvent(db, {
    campaignId: input.campaignId,
    turnId: input.turnId,
    type: "faction_action",
    payload: {
      actorId: attacker.id,
      targetId: defender.id,
      actionType: "attack",
      outcome: "attacker_win",
      featureId: input.attackerFeatureId,
    },
  });
}

function runAttack(
  db: Database.Database,
  attacker: { id: string; campaign_id: string; power: Power; control: string },
  turnId: string,
  input: Extract<RunActionInput, { type: "attack" }>,
) {
  const defender = requireFaction(db, input.targetFactionId);
  if (defender.campaign_id !== attacker.campaign_id) {
    throw new RuleError("ENTITY_NOT_FOUND", "defender not in campaign");
  }
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
  const defenderFeature = resolveDefenderFeature(
    db,
    defender.id,
    input.defenderFeatureId,
  );
  let defenderTags: FeatureTags | null = null;
  let defenderTotal = 0;

  let attackerRoll;
  let winner: "attacker" | "defender";
  if (!defenderFeature) {
    attackerRoll = featureRoll({
      rng,
      faces: attackerFaces,
      marginal: input.marginal ?? false,
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
    const attackerMarginal =
      input.marginal ??
      defaultRelevance(attackerTags.domain, defenderTags.domain);
    const defenderMarginal =
      input.marginal ??
      defaultRelevance(defenderTags.domain, attackerTags.domain);
    attackerRoll = featureRoll({
      rng,
      faces: attackerFaces,
      marginal: attackerMarginal,
      bonus: attackerBonus,
      forced: input.forcedAttackerRoll,
    });
    const defenderRoll = featureRoll({
      rng,
      faces: defenderFaces,
      marginal: defenderMarginal,
      bonus: defenderBonus,
      forced: input.forcedDefenderRoll,
    });
    defenderTotal = defenderRoll.total;
    let aTotal = attackerRoll.total;
    let dTotal = defenderTotal;
    if (input.standingOrders?.length) {
      const adjusted = spendStandingOrdersOnContest(
        db,
        attacker.campaign_id,
        turnId,
        attacker.id,
        attacker.id,
        defender.id,
        aTotal,
        dTotal,
        input.standingOrders,
      );
      aTotal = adjusted.attackerTotal;
      dTotal = adjusted.defenderTotal;
    }
    winner = resolveContest({
      attackerTotal: aTotal,
      defenderTotal: dTotal,
      attackerPower: attacker.power,
      defenderPower: defender.power,
    });
    defenderTotal = dTotal;
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
      JSON.stringify([input.attackerFeatureId, defenderFeature?.id ?? null]),
      rollId,
    );
    recordActionEvent(db, {
      campaignId: attacker.campaign_id,
      turnId,
      type: "faction_action",
      payload: {
        actorId: attacker.id,
        targetId: defender.id,
        actionType: "attack",
        outcome: "defender_win",
        featureId: input.attackerFeatureId,
      },
    });
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
      JSON.stringify([input.attackerFeatureId, defenderFeature?.id ?? null]),
      rollId,
    );
    return { pending: true, code: "PENDING_DEFENDER_CHOICE", actionId };
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

  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
     VALUES (?, ?, 'attack', 'faction', ?, 'faction', ?, ?, ?, 'attacker_win')`,
  ).run(
    actionId,
    turnId,
    attacker.id,
    defender.id,
    JSON.stringify([input.attackerFeatureId, defenderFeature?.id ?? null]),
    rollId,
  );

  applyAttackDefense(db, {
    campaignId: attacker.campaign_id,
    turnId,
    actionId,
    attackerId: attacker.id,
    defenderId: defender.id,
    attackerFeatureId: input.attackerFeatureId,
    defenderFeatureId: defenderFeature?.id ?? null,
    defenderChoice: choice,
    problemId: input.problemId,
  });

  return { success: true, winner: "attacker", defense: choice, actionId };
}

function runExtendInterest(
  db: Database.Database,
  attacker: { id: string; campaign_id: string; power: Power },
  turnId: string,
  input: Extract<RunActionInput, { type: "extend_interest" }>,
) {
  const defender = requireFaction(db, input.targetFactionId);
  if (defender.campaign_id !== attacker.campaign_id) {
    throw new RuleError("ENTITY_NOT_FOUND", "defender not in campaign");
  }
  if (defender.id === attacker.id) {
    throw new RuleError("FILL_INCOMPLETE", "cannot extend interest to self");
  }

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
    throw new RuleError("NO_USABLE_FEATURE", "attacker has no usable feature");
  }

  const dieMax = DIE_BY_POWER[attacker.power];
  const cap = interestCap(dieMax);
  const existing = db
    .prepare(
      "SELECT points, nature FROM interests WHERE from_faction_id = ? AND to_faction_id = ?",
    )
    .get(attacker.id, defender.id) as { points: number; nature: string } | undefined;
  if (existing && existing.points >= cap) {
    throw new RuleError("INTEREST_CAP", "interest already at cap");
  }

  const attackerTags: FeatureTags = {
    domain: attackerFeature.domain as FeatureTags["domain"],
    size: attackerFeature.size as FeatureTags["size"],
    quality: attackerFeature.quality as FeatureTags["quality"],
    magical: attackerFeature.magical !== 0,
    origin: attackerFeature.origin as FeatureTags["origin"],
  };

  const attackerFaces = dieMax;
  let defenderFeature: typeof attackerFeature | undefined;
  let defenderTags: FeatureTags | null = null;
  let defenderTotal = 0;

  defenderFeature = resolveDefenderFeature(db, defender.id, input.defenderFeatureId);

  let attackerRoll;
  let winner: "attacker" | "defender";
  let rollId: string;
  if (input.willing) {
    winner = "attacker";
    rollId = persistRoll(db, attacker.campaign_id, turnId, { willing: true, winner: "attacker" });
  } else if (!defenderFeature) {
    const rng = nextRng(db, attacker.campaign_id);
    attackerRoll = featureRoll({
      rng,
      faces: attackerFaces,
      marginal: input.marginal ?? false,
      bonus: 0,
      forced: input.forcedAttackerRoll,
    });
    winner = "attacker";
    rollId = persistRoll(db, attacker.campaign_id, turnId, {
      attacker: attackerRoll,
      defenderTotal,
      winner,
    });
  } else {
    const rng = nextRng(db, attacker.campaign_id);
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
    const attackerMarginal =
      input.marginal ??
      defaultRelevance(attackerTags.domain, defenderTags.domain);
    const defenderMarginal =
      input.marginal ??
      defaultRelevance(defenderTags.domain, attackerTags.domain);
    attackerRoll = featureRoll({
      rng,
      faces: attackerFaces,
      marginal: attackerMarginal,
      bonus: attackerBonus,
      forced: input.forcedAttackerRoll,
    });
    const defenderRoll = featureRoll({
      rng,
      faces: defenderFaces,
      marginal: defenderMarginal,
      bonus: defenderBonus,
      forced: input.forcedDefenderRoll,
    });
    defenderTotal = defenderRoll.total;
    let aTotal = attackerRoll.total;
    let dTotal = defenderTotal;
    if (input.standingOrders?.length) {
      const adjusted = spendStandingOrdersOnContest(
        db,
        attacker.campaign_id,
        turnId,
        attacker.id,
        attacker.id,
        defender.id,
        aTotal,
        dTotal,
        input.standingOrders,
      );
      aTotal = adjusted.attackerTotal;
      dTotal = adjusted.defenderTotal;
    }
    winner = resolveContest({
      attackerTotal: aTotal,
      defenderTotal: dTotal,
      attackerPower: attacker.power,
      defenderPower: defender.power,
    });
    defenderTotal = dTotal;
    rollId = persistRoll(db, attacker.campaign_id, turnId, {
      attacker: attackerRoll,
      defenderTotal,
      winner,
    });
  }

  const actionId = crypto.randomUUID();

  if (winner === "defender") {
    db.prepare(
      `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
       VALUES (?, ?, 'extend_interest', 'faction', ?, 'faction', ?, ?, ?, 'defender_win')`,
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

  const catalog = loadCatalog();
  const natureKeys = catalog.interestNature.map((n) => n.id);
  const natureRng = nextRng(db, attacker.campaign_id);
  const natureIndex = Math.floor(natureRng.next() * natureKeys.length);
  const natureDefault = natureKeys[natureIndex];
  if (existing) {
    db.prepare(
      "UPDATE interests SET points = points + 1 WHERE from_faction_id = ? AND to_faction_id = ?",
    ).run(attacker.id, defender.id);
  } else {
    db.prepare(
      `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(crypto.randomUUID(), attacker.id, defender.id, natureDefault);
  }

  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
     VALUES (?, ?, 'extend_interest', 'faction', ?, 'faction', ?, ?, ?, 'attacker_win')`,
  ).run(
    actionId,
    turnId,
    attacker.id,
    defender.id,
    JSON.stringify([input.attackerFeatureId, input.defenderFeatureId ?? null]),
    rollId,
  );
  recordActionEvent(db, {
    campaignId: attacker.campaign_id,
    turnId,
    type: "faction_action",
    payload: {
      actorId: attacker.id,
      targetId: defender.id,
      actionType: "extend_interest",
      outcome: "attacker_win",
      featureId: input.attackerFeatureId,
    },
  });
  return { success: true, winner: "attacker" };
}

function runRestoreCohesion(
  db: Database.Database,
  faction: { id: string; campaign_id: string; power: Power; dominion: number; cohesion: number },
  turnId: string,
  forcedRoll?: number,
) {
  if (listUsableFeatures(db, faction.id).length === 0) {
    throw new RuleError("NO_USABLE_FEATURE", "no usable feature");
  }
  if (faction.cohesion >= faction.power) {
    throw new RuleError("COHESION_AT_CAP", "cohesion at cap");
  }
  const cost = restoreCohesionCost(faction.power);
  if (faction.dominion < cost) {
    throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion");
  }
  db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(cost, faction.id);
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
  const rollId = persistRoll(
    db,
    faction.campaign_id,
    turnId,
    troubleRollPayload(check.roll, trouble, check.success, check.culpritId),
  );
  const actionId = crypto.randomUUID();
  if (check.success) {
    db.prepare("UPDATE factions SET cohesion = cohesion + 1 WHERE id = ?").run(faction.id);
  }
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id, outcome, dominion_delta)
     VALUES (?, ?, 'restore_cohesion', 'faction', ?, ?, ?, ?)`,
  ).run(
    actionId,
    turnId,
    faction.id,
    rollId,
    check.success ? "success" : "failure",
    -cost,
  );
  applyCollapseIfNeeded(db, faction.id, turnId);
  return { success: check.success, roll: check.roll };
}

function runAid(
  db: Database.Database,
  faction: { id: string; campaign_id: string; power: Power; dominion: number },
  turnId: string,
  input: Extract<RunActionInput, { type: "aid" }>,
) {
  const amount = input.amount ?? 1;
  if (amount < 1) throw new RuleError("FILL_INCOMPLETE", "aid amount must be at least 1");
  if (faction.dominion < amount) {
    throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion to aid");
  }
  requireFaction(db, input.targetFactionId);
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
    forcedRoll: input.forcedRoll,
  });
  const rollId = persistRoll(
    db,
    faction.campaign_id,
    turnId,
    troubleRollPayload(check.roll, trouble, check.success, check.culpritId),
  );
  const actionId = crypto.randomUUID();
  if (check.success) {
    db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(amount, faction.id);
    db.prepare("UPDATE factions SET dominion = dominion + ? WHERE id = ?").run(
      amount,
      input.targetFactionId,
    );
  } else {
    db.prepare("UPDATE factions SET dominion = dominion - ? WHERE id = ?").run(amount, faction.id);
  }
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, roll_id, outcome, dominion_delta)
     VALUES (?, ?, 'aid', 'faction', ?, 'faction', ?, ?, ?, ?)`,
  ).run(
    actionId,
    turnId,
    faction.id,
    input.targetFactionId,
    rollId,
    check.success ? "success" : "failure",
    -amount,
  );
  recordActionEvent(db, {
    campaignId: faction.campaign_id,
    turnId,
    type: "faction_action",
    payload: {
      actorId: faction.id,
      targetId: input.targetFactionId,
      actionType: "aid",
      outcome: check.success ? "success" : "failure",
      rollId,
    },
  });
  applyCollapseIfNeeded(db, faction.id, turnId);
  return { success: check.success };
}

function runRemoveInterest(
  db: Database.Database,
  faction: { id: string; campaign_id: string; power: Power },
  turnId: string,
  input: Extract<RunActionInput, { type: "remove_interest" }>,
) {
  if (faction.id === input.targetFactionId) {
    throw new RuleError("FILL_INCOMPLETE", "cannot remove interest to self");
  }
  const edge = db
    .prepare(
      "SELECT points FROM interests WHERE from_faction_id = ? AND to_faction_id = ?",
    )
    .get(faction.id, input.targetFactionId) as { points: number } | undefined;
  if (!edge || edge.points <= 0) {
    throw new RuleError("ENTITY_NOT_FOUND", "no interest to remove");
  }

  const actionId = crypto.randomUUID();
  let rollId: string | null = null;
  let outcome: string;

  if (input.willing) {
    outcome = "attacker_win";
    rollId = persistRoll(db, faction.campaign_id, turnId, { willing: true, winner: "attacker" });
  } else {
    const rng = nextRng(db, faction.campaign_id);
    const faces = DIE_BY_POWER[faction.power];
    const attackerRoll = rollDie(rng, faces, input.forcedRoll);
    const defender = requireFaction(db, input.targetFactionId);
    const defenderRoll = rollDie(rng, DIE_BY_POWER[defender.power]);
    const winner = resolveContest({
      attackerTotal: attackerRoll.total,
      defenderTotal: defenderRoll.total,
      attackerPower: faction.power,
      defenderPower: defender.power,
    });
    rollId = persistRoll(db, faction.campaign_id, turnId, {
      attacker: attackerRoll,
      defenderTotal: defenderRoll.total,
      winner,
    });
    outcome = winner === "attacker" ? "attacker_win" : "defender_win";
  }

  if (outcome === "attacker_win") {
    const newPoints = Math.max(0, edge.points - 1);
    if (newPoints === 0) {
      db.prepare(
        "DELETE FROM interests WHERE from_faction_id = ? AND to_faction_id = ?",
      ).run(faction.id, input.targetFactionId);
    } else {
      db.prepare(
        "UPDATE interests SET points = ? WHERE from_faction_id = ? AND to_faction_id = ?",
      ).run(newPoints, faction.id, input.targetFactionId);
    }
  }

  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, roll_id, outcome)
     VALUES (?, ?, 'remove_interest', 'faction', ?, 'faction', ?, ?, ?)`,
  ).run(actionId, turnId, faction.id, input.targetFactionId, rollId, outcome);

  return { success: outcome === "attacker_win" };
}
