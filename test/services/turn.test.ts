import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { planGoal } from "../../src/rules/goals.js";
import { decisionMakers } from "../../src/queries/brief.js";
import { runFactionTurn } from "../../src/services/turn.js";
import { mulberry32 } from "../../src/rules/dice.js";

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
