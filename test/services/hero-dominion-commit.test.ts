import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { beginChange, commitResources, withdrawInfluence } from "../../src/services/change.js";

function world(
  heroes: { id: string; influence: number; wealth: number; dominion?: number }[],
): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("village", "c1", "Village", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");
  for (const hero of heroes) {
    db.prepare(
      `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hero.id,
      "c1",
      hero.id,
      1,
      "[]",
      hero.influence,
      hero.dominion ?? 0,
      hero.wealth,
      "none",
    );
  }
  return db;
}

function beginFact(
  db: Database.Database,
  magnitude: "plausible" | "impossible" = "plausible",
): string {
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude,
    kind: "fact",
  });
  if (!begun.ok) throw new Error(begun.error.message);
  return begun.data.changeId;
}

function heroRow(db: Database.Database, id: string) {
  return db.prepare("SELECT influence, wealth, dominion FROM heroes WHERE id = ?").get(id) as {
    influence: number;
    wealth: number;
    dominion: number;
  };
}

function commitment(db: Database.Database, changeId: string, heroId: string) {
  return db
    .prepare(
      "SELECT influence, wealth_spent FROM change_commitments WHERE change_id = ? AND hero_id = ?",
    )
    .get(changeId, heroId) as { influence: number; wealth_spent: number } | undefined;
}

function changeRow(db: Database.Database, changeId: string) {
  return db.prepare("SELECT status, dominion_spent FROM changes WHERE id = ?").get(changeId) as {
    status: string;
    dominion_spent: number;
  };
}

test("hero Dominion can fully fund an eligible change", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 4,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(4);
  expect(committed.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(changeRow(db, changeId)).toEqual({ status: "active", dominion_spent: 4 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 0, wealth_spent: 0 });
});

test("hero Dominion can partially cover a change", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(2);
  expect(committed.data.status).toBe("pending");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 6 });
  expect(changeRow(db, changeId)).toEqual({ status: "pending", dominion_spent: 2 });
});

test("mixed Influence and Dominion cover the quote", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 2,
    dominionSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(4);
  expect(committed.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 1, wealth: 0, dominion: 6 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 2, wealth_spent: 0 });
  expect(changeRow(db, changeId)).toEqual({ status: "active", dominion_spent: 2 });
});

test("withdrawing mixed Influence leaves Dominion spent and decays the change", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 2,
    dominionSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;

  const withdrawn = withdrawInfluence(db, { changeId, heroId: "sword" });
  expect(withdrawn.ok).toBe(true);
  if (!withdrawn.ok) return;
  expect(withdrawn.data.covered).toBe(2);
  expect(withdrawn.data.status).toBe("decaying");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 6 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 0, wealth_spent: 0 });
  expect(changeRow(db, changeId)).toEqual({ status: "decaying", dominion_spent: 2 });

  const restored = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 2,
  });
  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(restored.data.covered).toBe(4);
  expect(restored.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(changeRow(db, changeId)).toEqual({ status: "active", dominion_spent: 4 });
});

test("unpaid Dominion offers write nothing", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 4 }]);

  const negativeId = beginFact(db, "impossible");
  const negative = commitResources(db, {
    changeId: negativeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: -1,
  });
  expect(negative.ok).toBe(false);
  if (negative.ok) return;
  expect(negative.error.code).toBe("INSUFFICIENT_DOMINION");
  expect(negative.error.message).toBe("cannot commit negative dominion");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(commitment(db, negativeId, "sword")).toBeUndefined();
  expect(changeRow(db, negativeId)).toEqual({ status: "pending", dominion_spent: 0 });

  const orderId = beginFact(db, "impossible");
  const order = commitResources(db, {
    changeId: orderId,
    heroId: "sword",
    influence: -1,
    dominionSpent: 5,
  });
  expect(order.ok).toBe(false);
  if (order.ok) return;
  expect(order.error.code).toBe("INSUFFICIENT_INFLUENCE");
  expect(order.error.message).toBe("cannot commit negative influence");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(commitment(db, orderId, "sword")).toBeUndefined();

  const shortId = beginFact(db, "impossible");
  const short = commitResources(db, {
    changeId: shortId,
    heroId: "sword",
    influence: 1,
    dominionSpent: 5,
  });
  expect(short.ok).toBe(false);
  if (short.ok) return;
  expect(short.error.code).toBe("INSUFFICIENT_DOMINION");
  expect(short.error.message).toBe("not enough dominion to commit");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(commitment(db, shortId, "sword")).toBeUndefined();
  expect(changeRow(db, shortId)).toEqual({ status: "pending", dominion_spent: 0 });
});

test("omitted dominionSpent and explicit zero leave Dominion unchanged", () => {
  const db = world([
    { id: "omit", influence: 2, wealth: 6, dominion: 8 },
    { id: "zero", influence: 4, wealth: 6, dominion: 8 },
  ]);
  const omittedId = beginFact(db);
  const omitted = commitResources(db, { changeId: omittedId, heroId: "omit", influence: 1 });
  expect(omitted.ok).toBe(true);
  if (!omitted.ok) return;
  expect(omitted.data.covered).toBe(1);
  expect(heroRow(db, "omit")).toEqual({ influence: 1, wealth: 6, dominion: 8 });

  const zeroId = beginFact(db);
  const zero = commitResources(db, {
    changeId: zeroId,
    heroId: "zero",
    influence: 1,
    wealthSpent: 2,
    dominionSpent: 0,
  });
  expect(zero.ok).toBe(true);
  if (!zero.ok) return;
  expect(zero.data.covered).toBe(2);
  expect(zero.data.status).toBe("active");
  expect(heroRow(db, "zero")).toEqual({ influence: 3, wealth: 4, dominion: 8 });
  expect(commitment(db, zeroId, "zero")).toEqual({ influence: 2, wealth_spent: 2 });
  expect(changeRow(db, zeroId)).toEqual({ status: "active", dominion_spent: 0 });
});

test("Dominion-only coverage lands a feature change and one backlash", () => {
  const db = world([{ id: "sword", influence: 0, wealth: 0, dominion: 2 }]);
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: "The village has a band of trained warriors.",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) throw new Error("begin");
  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 1,
    backlash: "The warriors demand pay.",
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.status).toBe("active");
  expect(committed.data.covered).toBe(1);
  expect(heroRow(db, "sword")).toEqual({ influence: 0, wealth: 0, dominion: 1 });
  const features = db
    .prepare("SELECT COUNT(*) AS c FROM features WHERE faction_id = ?")
    .get("village") as { c: number };
  const problems = db
    .prepare("SELECT text FROM problems WHERE faction_id = ?")
    .all("village") as { text: string }[];
  expect(features.c).toBe(1);
  expect(problems.map((p) => p.text)).toEqual(["The warriors demand pay."]);
});
