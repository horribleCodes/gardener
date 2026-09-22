import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { planGoal } from "../../src/rules/goals.js";
import { decisionMakers } from "../../src/queries/brief.js";
import { halfInterestSatisfied, preferredInterestTarget, runFactionTurn } from "../../src/services/turn.js";
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
       INNER JOIN turns t ON a.turn_id = t.id
       WHERE t.campaign_id = 'c1' AND t.open = 0
         AND a.type = 'attack' AND a.target_id = 'victim' AND a.outcome = 'attacker_win'
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
