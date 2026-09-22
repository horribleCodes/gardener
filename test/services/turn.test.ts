import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { planGoal } from "../../src/rules/goals.js";
import { decisionMakers } from "../../src/queries/brief.js";
import { worldBrief, rumorLines } from "../../src/queries/rumors.js";
import {
  halfInterestSatisfied,
  preferredInterestTarget,
  runFactionTurn,
  spendInterest,
} from "../../src/services/turn.js";
import { createFact } from "../../src/services/populate.js";
import { runAction } from "../../src/services/actions.js";
import { mulberry32, rollDie } from "../../src/rules/dice.js";
import { DIE_BY_POWER } from "../../src/domain/types.js";

test("a despotic 1 or 2 is glorify", () => {
  expect(planGoal("despotic_tyrant", 1).strategy).toBe("glorify");
  expect(planGoal("despotic_tyrant", 9).strategy).toBe("expand_reach");
  expect(planGoal("martial_conqueror", 5).strategy).toBe("half_interest");
});

test("anarchic courts bind nobody", () => {
  const result = decisionMakers({
    powerStructure: "anarchic",
    actors: [
      {
        id: "a",
        rank: "major",
        isLeader: false,
        isHiddenController: false,
        sharesAuthority: false,
      },
    ],
  });
  expect(result.binds).toBe(false);
  expect(result.approaches).toEqual(["a"]);
});

test("democratic court lists every major and majority threshold", () => {
  const result = decisionMakers({
    powerStructure: "democratic",
    actors: [
      { id: "z-last", rank: "major", isLeader: false, isHiddenController: false, sharesAuthority: false },
      { id: "a-first", rank: "major", isLeader: false, isHiddenController: false, sharesAuthority: false },
      { id: "m-mid", rank: "major", isLeader: false, isHiddenController: false, sharesAuthority: false },
    ],
  });
  expect(result.approaches).toHaveLength(3);
  expect(result.approaches).toEqual(["z-last", "a-first", "m-mid"]);
  expect(result.majority).toBe(2);
  expect(result.binds).toBe(true);
});

function shuffleFactionIds(ids: string[], seed: number, rollCounter: number): string[] {
  const rng = mulberry32(seed + rollCounter);
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function createTurnDb(): Database.Database {
  const db = openDb(":memory:");
  const seed = 4242;
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);

  for (const [id, name, behavior] of [
    ["f1", "Alpha", "directed"],
    ["f2", "Beta", "directed"],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, ?, ?, 1, 1, 5, 'native', ?, 'npc', 0, 'active')`,
    ).run(id, "c1", name, behavior);
  }

  db.prepare(
    `INSERT INTO godbound (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, ?, ?, ?, '[]', 0, 0, 0, 'free')`,
  ).run("gb1", "c1", "Hero", 6);

  return db;
}

function goalRollAt(seed: number, counter: number): number {
  const rng = mulberry32(seed + counter);
  return rollDie(rng, 10).natural;
}

test("runFactionTurn advances month and grants free divinity income", () => {
  const db = createTurnDb();
  const expectedOrder = shuffleFactionIds(["f1", "f2"], 4242, 0);

  const result = runFactionTurn(db, {
    campaignId: "c1",
    advanceMonth: true,
    actions: {
      f1: { type: "build_strength" },
      f2: { type: "build_strength" },
    },
  });
  expect(result.ok).toBe(true);

  const gb = db.prepare("SELECT dominion FROM godbound WHERE id = ?").get("gb1") as {
    dominion: number;
  };
  expect(gb.dominion).toBe(3);

  const campaign = db.prepare("SELECT month FROM campaigns WHERE id = ?").get("c1") as {
    month: number;
  };
  expect(campaign.month).toBe(2);

  const turn = db
    .prepare("SELECT faction_order, open FROM turns WHERE campaign_id = ? ORDER BY sequence DESC LIMIT 1")
    .get("c1") as { faction_order: string; open: number };
  expect(turn.open).toBe(0);
  expect(JSON.parse(turn.faction_order)).toEqual(expectedOrder);
});

test("resume open turn skips factions that already acted", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 99);

  for (const [id, behavior] of [
    ["a", "directed"],
    ["b", "directed"],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, ?, ?, 1, 1, 5, 'native', ?, 'npc', 0, 'active')`,
    ).run(id, "c1", id, behavior);
  }

  const turnId = "turn-open";
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, ?, 1, 1, 1, ?)`,
  ).run(turnId, "c1", JSON.stringify(["b", "a"]));

  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, dominion_delta)
     VALUES (?, ?, 'build_strength', 'faction', ?, 0)`,
  ).run("act-b", turnId, "b");

  const before = db
    .prepare("SELECT COUNT(*) AS n FROM actions WHERE turn_id = ? AND actor_id = ?",)
    .get(turnId, "b") as { n: number };
  expect(before.n).toBe(1);

  const result = runFactionTurn(db, {
    campaignId: "c1",
    resume: true,
    actions: { a: { type: "build_strength" } },
  });
  expect(result.ok).toBe(true);

  const afterB = db
    .prepare("SELECT COUNT(*) AS n FROM actions WHERE turn_id = ? AND actor_id = ?",)
    .get(turnId, "b") as { n: number };
  expect(afterB.n).toBe(1);

  const afterA = db
    .prepare("SELECT COUNT(*) AS n FROM actions WHERE turn_id = ? AND actor_id = ?",)
    .get(turnId, "a") as { n: number };
  expect(afterA.n).toBe(1);
});

test("half_interest is satisfied only on the preferred weaker neighbor", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 1);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f', 'c1', 'Us', 2, 1, 1, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('strong', 'c1', 'Strong', 3, 1, 1, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('weak', 'c1', 'Weak', 1, 1, 1, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();

  const dieMax = DIE_BY_POWER[2];
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i-strong', 'f', 'strong', ?, 'rivalry')`,
  ).run(dieMax);
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i-weak', 'f', 'weak', 1, 'trade')`,
  ).run();

  expect(preferredInterestTarget(db, { id: "f", power: 2 })).toBe("weak");
  expect(halfInterestSatisfied(db, { id: "f", power: 2 })).toBe(false);
});

test("proxy transfers dominion to a military faction", () => {
  const seed = 777;
  let shuffleCounter = 0;
  while (goalRollAt(seed, shuffleCounter + 1) < 5 || goalRollAt(seed, shuffleCounter + 1) > 6) {
    shuffleCounter++;
  }

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 2, 'native', 'scheming_manipulator', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('ally', 'c1', 'Ally', 1, 1, 3, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('mil', 'ally', 'Army', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const actor = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as {
    dominion: number;
  };
  const ally = db.prepare("SELECT dominion FROM factions WHERE id = 'ally'").get() as {
    dominion: number;
  };
  expect(actor.dominion).toBe(1);
  expect(ally.dominion).toBe(4);

  const aid = db
    .prepare("SELECT type FROM actions WHERE actor_id = 'actor' ORDER BY id DESC LIMIT 1")
    .get() as { type: string };
  expect(aid.type).toBe("aid");
});

test("no_external_until_hit attacks after a prior attacker win", () => {
  const seed = 555;
  let shuffleCounter = 0;
  while (goalRollAt(seed, shuffleCounter + 1) < 1 || goalRollAt(seed, shuffleCounter + 1) > 2) {
    shuffleCounter++;
  }

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('victim', 'c1', 'Victim', 1, 1, 1, 'native', 'self_absorbed_survivor', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('neighbor', 'c1', 'Neighbor', 1, 1, 2, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('link', 'victim', 'neighbor', 2, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('vmil', 'victim', 'Militia', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("vmil-part", "vmil", "Militia", 0);

  const closedTurn = "t-closed";
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, 'c1', 1, 1, 0, '[]')`,
  ).run(closedTurn);
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome, dominion_delta)
     VALUES ('past-hit', ?, 'attack', 'faction', 'neighbor', 'faction', 'victim', 'attacker_win', 0)`,
  ).run(closedTurn);

  const priorHit = db
    .prepare(
      `SELECT a.id FROM actions a
       WHERE a.type = 'attack' AND a.target_id = 'victim' AND a.outcome = 'attacker_win'
         AND (
           a.turn_id IN (
             SELECT id FROM turns
             WHERE campaign_id = 'c1' AND open = 0
             ORDER BY month DESC, sequence DESC
             LIMIT 1
           )
           OR a.turn_id IN (
             SELECT id FROM turns WHERE campaign_id = 'c1' AND open = 1 LIMIT 1
           )
         )
       LIMIT 1`,
    )
    .get();
  expect(priorHit).toBeTruthy();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.results[0]?.strategy).toBe("no_external_until_hit");
    expect(result.data.results[0]?.action.type).toBe("attack");
  }

  const attack = db
    .prepare(
      `SELECT type FROM actions WHERE turn_id != ? AND actor_id = 'victim'`,
    )
    .get(closedTurn) as { type: string };
  expect(attack.type).toBe("attack");
});

test("no_external_until_hit ignores attacker wins on older closed turns", () => {
  const seed = 556;
  let shuffleCounter = 0;
  while (goalRollAt(seed, shuffleCounter + 1) < 1 || goalRollAt(seed, shuffleCounter + 1) > 2) {
    shuffleCounter++;
  }

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 2, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('victim', 'c1', 'Victim', 1, 1, 5, 'native', 'self_absorbed_survivor', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('neighbor', 'c1', 'Neighbor', 1, 1, 2, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('link', 'victim', 'neighbor', 2, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('vmil', 'victim', 'Militia', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("vmil-part", "vmil", "Militia", 0);

  const olderClosed = "t-old";
  const recentClosed = "t-recent";
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, 'c1', 1, 1, 0, '[]')`,
  ).run(olderClosed);
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, 'c1', 2, 1, 0, '[]')`,
  ).run(recentClosed);
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome, dominion_delta)
     VALUES ('old-hit', ?, 'attack', 'faction', 'neighbor', 'faction', 'victim', 'attacker_win', 0)`,
  ).run(olderClosed);

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.results[0]?.strategy).toBe("no_external_until_hit");
    expect(result.data.results[0]?.action.type).toBe("build_strength");
  }

  const victimActs = db
    .prepare("SELECT type FROM actions WHERE actor_id = 'victim' AND turn_id != ?",)
    .all(recentClosed) as { type: string }[];
  expect(victimActs).toHaveLength(1);
  expect(victimActs[0]?.type).toBe("build_strength");
});

function forceStrategyRoll(seed: number, min: number, max: number): number {
  let shuffleCounter = 0;
  while (true) {
    const roll = goalRollAt(seed, shuffleCounter + 1);
    if (roll >= min && roll <= max) return shuffleCounter;
    shuffleCounter++;
  }
}

test("solve_military idles when no non-intrinsic military problem exists", () => {
  const seed = 901;
  const shuffleCounter = forceStrategyRoll(seed, 7, 8);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('p-cult', 'actor', 'Unrest', 3, 'cultural', 0, 0, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('p-mil-in', 'actor', 'Core flaw', 2, 'military', 1, 0, 0, 1)`,
  ).run();

  const beforeDom = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as { dominion: number }
  ).dominion;

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.results[0]?.strategy).toBe("solve_military");
    expect(result.data.results[0]?.skipRunAction).toBe(true);
  }

  const acts = db.prepare("SELECT id FROM actions WHERE actor_id = 'actor'").all();
  expect(acts).toHaveLength(0);
  const afterDom = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as { dominion: number }
  ).dominion;
  expect(afterDom).toBe(beforeDom);
});

test("solve_military enacts against highest non-intrinsic military problem", () => {
  const seed = 902;
  const shuffleCounter = forceStrategyRoll(seed, 7, 8);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run();
  for (let i = 0; i < 6; i++) {
    db.prepare(
      `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
       VALUES (?, 'actor', ?, 1, ?, 0, 0, 0, ?)`,
    ).run(`p-${i}`, `Problem ${i}`, i === 0 ? "military" : "cultural", i);
  }

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const mil = db
    .prepare("SELECT points FROM problems WHERE id = 'p-0'")
    .get() as { points: number } | undefined;
  expect(mil).toBeUndefined();

  const enact = db
    .prepare("SELECT type FROM actions WHERE actor_id = 'actor' AND type = 'enact_change'")
    .get() as { type: string };
  expect(enact.type).toBe("enact_change");
});

test("cunning_solve records non-military means on enact_change", () => {
  const seed = 903;
  const shuffleCounter = forceStrategyRoll(seed, 9, 10);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'scheming_manipulator', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('z-means', 'actor', 'Spy ring', 'cultural', 'normal', 'normal', 0, 'native')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('a-means', 'actor', 'Guild ties', 'economic', 'normal', 'normal', 0, 'native')`,
  ).run();
  for (let i = 0; i < 6; i++) {
    db.prepare(
      `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
       VALUES (?, 'actor', ?, 1, 'cultural', 0, 0, 0, ?)`,
    ).run(`p-${i}`, `Problem ${i}`, i);
  }

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const row = db
    .prepare("SELECT feature_ids FROM actions WHERE actor_id = 'actor' AND type = 'enact_change'")
    .get() as { feature_ids: string };
  expect(JSON.parse(row.feature_ids)).toEqual(["a-means"]);
});

test("harmless_feature creates covert cultural feature when none exists", () => {
  const seed = 904;
  const shuffleCounter = forceStrategyRoll(seed, 7, 8);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'scheming_manipulator', 'npc', 0, 'active')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const feature = db
    .prepare("SELECT domain, covert, text FROM features WHERE faction_id = 'actor'")
    .get() as { domain: string; covert: number; text: string };
  expect(feature.domain).toBe("cultural");
  expect(feature.covert).toBe(1);
  expect(feature.text).toBeTruthy();
});

test("military_feature_aimed sets aimed_at on new military feature", () => {
  const seed = 905;
  const shuffleCounter = forceStrategyRoll(seed, 3, 4);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('low', 'c1', 'Low', 1, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('high', 'c1', 'High', 2, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'actor', 'low', 1, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i2', 'actor', 'high', 1, 'rivalry')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const features = db
    .prepare("SELECT aimed_at_faction_id, domain FROM features WHERE faction_id = 'actor'")
    .all() as { aimed_at_faction_id: string; domain: string }[];
  expect(features).toHaveLength(1);
  expect(features[0]?.domain).toBe("military");
  expect(features[0]?.aimed_at_faction_id).toBe("high");
});

test("half_interest extends against preferred neighbor", () => {
  const seed = 811;
  const shuffleCounter = forceStrategyRoll(seed, 5, 6);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 2, 1, 3, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('weak', 'c1', 'Weak', 1, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('strong', 'c1', 'Strong', 3, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'actor', 'weak', 1, 'trade'), ('i2', 'actor', 'strong', 1, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('z-feat', 'actor', 'Levy', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const points = (
    db.prepare("SELECT points FROM interests WHERE from_faction_id = 'actor' AND to_faction_id = 'weak'").get() as {
      points: number;
    }
  ).points;
  expect(points).toBe(2);

  const action = db
    .prepare("SELECT type, target_id FROM actions WHERE actor_id = 'actor'")
    .get() as { type: string; target_id: string };
  expect(action.type).toBe("extend_interest");
  expect(action.target_id).toBe("weak");
});

test("max_interest extends once per neighbor up to power", () => {
  const seed = 812;
  const shuffleCounter = forceStrategyRoll(seed, 1, 2);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 3, 1, 5, 'native', 'scheming_manipulator', 'npc', 0, 'active')`,
  ).run();
  for (const [id, pwr] of [
    ["n-a", 2],
    ["n-b", 1],
    ["n-c", 1],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, ?, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
    ).run(id, id, pwr);
    db.prepare(
      `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
       VALUES (?, 'actor', ?, 0, 'trade')`,
    ).run(`i-${id}`, id);
  }
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('a-feat', 'actor', 'Spies', 'cultural', 'normal', 'normal', 0, 'native')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);

  const extendActions = db
    .prepare("SELECT target_id FROM actions WHERE actor_id = 'actor' AND type = 'extend_interest'")
    .all() as { target_id: string }[];
  expect(extendActions).toHaveLength(3);
  const targets = extendActions.map((r) => r.target_id).sort();
  expect(new Set(targets).size).toBe(3);
});

test("beat_weaker idles with no strictly weaker neighbor", () => {
  const seed = 813;
  const shuffleCounter = forceStrategyRoll(seed, 1, 2);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 2, 1, 5, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('peer', 'c1', 'Peer', 2, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'actor', 'peer', 1, 'rivalry')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.results[0]?.strategy).toBe("beat_weaker");
    expect(result.data.results[0]?.skipRunAction).toBe(true);
  }
  const acts = db.prepare("SELECT id FROM actions WHERE actor_id = 'actor'").all();
  expect(acts).toHaveLength(0);
});

test("double-satisfied reroll runs build_strength", () => {
  const seed = 814;
  let shuffleCounter = 0;
  while (
    goalRollAt(seed, shuffleCounter + 2) < 7 ||
    goalRollAt(seed, shuffleCounter + 2) > 8 ||
    goalRollAt(seed, shuffleCounter + 3) < 7 ||
    goalRollAt(seed, shuffleCounter + 3) > 8
  ) {
    shuffleCounter++;
  }

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'self_absorbed_survivor', 'npc', 0, 'active')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.results[0]?.action.type).toBe("build_strength");
    expect(result.data.results[0]?.skipRunAction).toBeFalsy();
  }
  const act = db
    .prepare("SELECT type FROM actions WHERE actor_id = 'actor'")
    .get() as { type: string };
  expect(act.type).toBe("build_strength");
});

test("military_defeat with only non-military feature sets marginal on attack", () => {
  const seed = 815;
  const shuffleCounter = forceStrategyRoll(seed, 3, 4);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'despotic_tyrant', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('neighbor', 'c1', 'Neighbor', 1, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'actor', 'neighbor', 3, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('cult', 'actor', 'Court', 'cultural', 'normal', 'normal', 0, 'native')`,
  ).run();

  const result = runFactionTurn(db, { campaignId: "c1" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.results[0]?.strategy).toBe("military_defeat");
    expect(result.data.results[0]?.desiredOutcome).toBe("A military setback.");
    expect(result.data.results[0]?.action.type).toBe("attack");
    if (result.data.results[0]?.action.type === "attack") {
      expect(result.data.results[0].action.marginal).toBe(true);
    }
  }
});

test("worldBrief and rumorLines match the query contract", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 100);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('p1', 'actor', 'Unrest', 2, 'cultural', 0, 0, 0, 0)`,
  ).run();

  const brief = worldBrief(db, "c1");
  expect(brief?.month).toBe(1);
  expect(brief?.factions[0]).toMatchObject({
    power: 1,
    trouble: 2,
    cohesion: 1,
    status: "active",
    collapseMargin: 4,
  });

  const turnId = "t1";
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, 'c1', 1, 1, 0, '[]')`,
  ).run(turnId);
  const rollId = "r1";
  db.prepare("INSERT INTO rolls (id, campaign_id, turn_id, payload) VALUES (?, 'c1', ?, ?)").run(
    rollId,
    turnId,
    JSON.stringify({ winner: "attacker" }),
  );
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, feature_ids, roll_id, outcome)
     VALUES ('a1', ?, 'build_strength', 'faction', 'actor', NULL, NULL, '[]', ?, 'success')`,
  ).run(turnId, rollId);

  const lines = rumorLines(db, "c1");
  expect(lines[0]).toBe(
    "Actor attempted build_strength against themselves with no asset and success because won the contest.",
  );
});

test("extend_interest increments interest and records action", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 1);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('a', 'c1', 'A', 1, 1, 1, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('b', 'c1', 'B', 1, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('f1', 'a', 'Envoy', 'cultural', 'normal', 'normal', 0, 'native')`,
  ).run();

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "a",
    type: "extend_interest",
    targetFactionId: "b",
    attackerFeatureId: "f1",
  });
  expect(result.ok).toBe(true);

  const edge = db
    .prepare("SELECT points, nature FROM interests WHERE from_faction_id = 'a' AND to_faction_id = 'b'")
    .get() as { points: number; nature: string };
  expect(edge.points).toBe(1);
  expect(edge.nature).toBe("alliance");

  const act = db.prepare("SELECT type FROM actions WHERE actor_id = 'a'").get() as { type: string };
  expect(act.type).toBe("extend_interest");
});

function spendInterestFixture(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 1);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('spender', 'c1', 'Spender', 2, 2, 4, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('target', 'c1', 'Target', 1, 1, 6, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('edge', 'spender', 'target', 5, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES ('turn1', 'c1', 1, 1, 1, '[]')`,
  ).run();
  return db;
}

test("spendInterest before reduces interest without charging dominion", () => {
  const db = spendInterestFixture();
  const beforeDom = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'spender'").get() as { dominion: number }
  ).dominion;
  const result = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "spender",
    toFactionId: "target",
    timing: "before",
    modifier: 2,
  });
  expect(result.ok).toBe(true);
  const afterDom = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'spender'").get() as { dominion: number }
  ).dominion;
  expect(afterDom).toBe(beforeDom);
  const points = (
    db.prepare("SELECT points FROM interests WHERE from_faction_id = 'spender'").get() as {
      points: number;
    }
  ).points;
  expect(points).toBe(3);
});

test("spendInterest after with short dominion leaves interest unchanged", () => {
  const db = spendInterestFixture();
  db.prepare("UPDATE factions SET dominion = 1 WHERE id = 'spender'").run();
  const result = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "spender",
    toFactionId: "target",
    timing: "after",
    modifier: 2,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("INSUFFICIENT_DOMINION");
  const points = (
    db.prepare("SELECT points FROM interests WHERE from_faction_id = 'spender'").get() as {
      points: number;
    }
  ).points;
  expect(points).toBe(5);
});

test("spendInterest steal moves dominion without charging spender extra dominion", () => {
  const db = spendInterestFixture();
  const spenderBefore = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'spender'").get() as { dominion: number }
  ).dominion;
  const targetBefore = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'target'").get() as { dominion: number }
  ).dominion;
  const result = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "spender",
    toFactionId: "target",
    timing: "steal",
    modifier: 3,
  });
  expect(result.ok).toBe(true);
  const spenderAfter = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'spender'").get() as { dominion: number }
  ).dominion;
  const targetAfter = (
    db.prepare("SELECT dominion FROM factions WHERE id = 'target'").get() as { dominion: number }
  ).dominion;
  expect(spenderAfter).toBe(spenderBefore + 3);
  expect(targetAfter).toBe(targetBefore - 3);
});

test("worldBrief includes courts and openChanges", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 100);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', 'c1', 'F', 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO places (id, campaign_id, name, scope) VALUES ('p1', 'c1', 'City', 'city')`,
  ).run();
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, place_id, blank, acts_on_own)
     VALUES ('court1', 'c1', 'royal', 'autocratic', 'grim', 'p1', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO changes (id, campaign_id, scope, magnitude, kind, owner, status, faction_id)
     VALUES ('ch1', 'c1', 'city', 'plausible', 'feature', 'faction', 'active', 'f1')`,
  ).run();

  const brief = worldBrief(db, "c1");
  expect(brief?.courts).toEqual([{ id: "court1", type: "royal", placeId: "p1" }]);
  expect(brief?.openChanges).toEqual([{ id: "ch1", factionId: "f1", state: "active" }]);
});

test("createFact blank stores SQL NULL statement", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", 1);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', 'c1', 'F', 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  const result = createFact(db, {
    campaignId: "c1",
    subject: "faction",
    subjectId: "f1",
    fill: "blank",
  });
  expect(result.ok).toBe(true);
  const row = db.prepare("SELECT statement FROM facts").get() as { statement: string | null };
  expect(row.statement).toBeNull();
});
