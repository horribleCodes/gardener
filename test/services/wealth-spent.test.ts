import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { beginChange, commitResources } from "../../src/services/change.js";

function world(
  heroes: { id: string; influence: number; wealth: number; dominion?: number }[],
): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
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

function beginFact(db: Database.Database): string {
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude: "plausible",
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

function changeStatus(db: Database.Database, changeId: string) {
  return db.prepare("SELECT status FROM changes WHERE id = ?").get(changeId) as { status: string };
}

test("wealthSpent adds converted coverage and debits only the explicit influence", () => {
  const db = world([{ id: "sword", influence: 4, wealth: 6, dominion: 8 }]);
  const changeId = beginFact(db);
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 1,
    wealthSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(2);
  expect(committed.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 4, dominion: 8 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 2, wealth_spent: 2 });
});

test("three heroes pooling 1 wealth each buy 2 influence", () => {
  const db = world([
    { id: "a", influence: 0, wealth: 1 },
    { id: "b", influence: 0, wealth: 1 },
    { id: "c", influence: 0, wealth: 1 },
  ]);
  const changeId = beginFact(db);
  let covered = 0;
  for (const heroId of ["a", "b", "c"]) {
    const committed = commitResources(db, { changeId, heroId, influence: 0, wealthSpent: 1 });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    covered = committed.data.covered;
  }
  expect(covered).toBe(2);
  expect(heroRow(db, "a")).toEqual({ influence: 0, wealth: 0, dominion: 0 });
  expect(heroRow(db, "b")).toEqual({ influence: 0, wealth: 0, dominion: 0 });
  expect(heroRow(db, "c")).toEqual({ influence: 0, wealth: 0, dominion: 0 });
  expect(commitment(db, changeId, "a")).toEqual({ influence: 1, wealth_spent: 1 });
  expect(commitment(db, changeId, "b")).toEqual({ influence: 0, wealth_spent: 1 });
  expect(commitment(db, changeId, "c")).toEqual({ influence: 1, wealth_spent: 1 });
});

test("a later wealthSpent continues the same pool", () => {
  const db = world([{ id: "sword", influence: 5, wealth: 10, dominion: 2 }]);
  const changeId = beginFact(db);
  const first = commitResources(db, { changeId, heroId: "sword", influence: 0, wealthSpent: 4 });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.data.covered).toBe(2);
  expect(heroRow(db, "sword")).toEqual({ influence: 5, wealth: 6, dominion: 2 });

  const second = commitResources(db, { changeId, heroId: "sword", influence: 1, wealthSpent: 2 });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.data.covered).toBe(4);
  expect(heroRow(db, "sword")).toEqual({ influence: 4, wealth: 4, dominion: 2 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 4, wealth_spent: 6 });
});

test("omitted wealthSpent and explicit zero leave Wealth unchanged", () => {
  const db = world([
    { id: "omit", influence: 2, wealth: 6, dominion: 1 },
    { id: "zero", influence: 2, wealth: 6, dominion: 1 },
  ]);
  const omittedId = beginFact(db);
  const omitted = commitResources(db, { changeId: omittedId, heroId: "omit", influence: 1 });
  expect(omitted.ok).toBe(true);
  if (!omitted.ok) return;
  expect(omitted.data.covered).toBe(1);
  expect(heroRow(db, "omit")).toEqual({ influence: 1, wealth: 6, dominion: 1 });
  expect(commitment(db, omittedId, "omit")).toEqual({ influence: 1, wealth_spent: 0 });

  const zeroId = beginFact(db);
  const zero = commitResources(db, {
    changeId: zeroId,
    heroId: "zero",
    influence: 1,
    wealthSpent: 0,
  });
  expect(zero.ok).toBe(true);
  if (!zero.ok) return;
  expect(zero.data.covered).toBe(1);
  expect(heroRow(db, "zero")).toEqual({ influence: 1, wealth: 6, dominion: 1 });
  expect(commitment(db, zeroId, "zero")).toEqual({ influence: 1, wealth_spent: 0 });
});

test("unpaid wealth offers write nothing", () => {
  const db = world([{ id: "sword", influence: 2, wealth: 3, dominion: 8 }]);

  const shortId = beginFact(db);
  const short = commitResources(db, {
    changeId: shortId,
    heroId: "sword",
    influence: 1,
    wealthSpent: 4,
  });
  expect(short.ok).toBe(false);
  if (short.ok) return;
  expect(short.error.code).toBe("INSUFFICIENT_WEALTH");
  expect(short.error.message).toBe("not enough wealth to commit");
  expect(heroRow(db, "sword")).toEqual({ influence: 2, wealth: 3, dominion: 8 });
  expect(commitment(db, shortId, "sword")).toBeUndefined();
  expect(changeStatus(db, shortId).status).toBe("pending");

  const negativeId = beginFact(db);
  const negative = commitResources(db, {
    changeId: negativeId,
    heroId: "sword",
    influence: 1,
    wealthSpent: -1,
  });
  expect(negative.ok).toBe(false);
  if (negative.ok) return;
  expect(negative.error.code).toBe("INSUFFICIENT_WEALTH");
  expect(negative.error.message).toBe("cannot commit negative wealth");
  expect(heroRow(db, "sword")).toEqual({ influence: 2, wealth: 3, dominion: 8 });
  expect(commitment(db, negativeId, "sword")).toBeUndefined();

  const bothId = beginFact(db);
  const both = commitResources(db, {
    changeId: bothId,
    heroId: "sword",
    influence: -1,
    wealthSpent: 4,
  });
  expect(both.ok).toBe(false);
  if (both.ok) return;
  expect(both.error.code).toBe("INSUFFICIENT_INFLUENCE");
  expect(both.error.message).toBe("cannot commit negative influence");
  expect(heroRow(db, "sword")).toEqual({ influence: 2, wealth: 3, dominion: 8 });
  expect(commitment(db, bothId, "sword")).toBeUndefined();

  const broke = world([{ id: "pen", influence: 0, wealth: 6 }]);
  const brokeId = beginFact(broke);
  const brokeCommit = commitResources(broke, {
    changeId: brokeId,
    heroId: "pen",
    influence: 1,
    wealthSpent: 1,
  });
  expect(brokeCommit.ok).toBe(false);
  if (brokeCommit.ok) return;
  expect(brokeCommit.error.code).toBe("INSUFFICIENT_INFLUENCE");
  expect(brokeCommit.error.message).toBe("not enough influence to commit");
  expect(heroRow(broke, "pen")).toEqual({ influence: 0, wealth: 6, dominion: 0 });
  expect(commitment(broke, brokeId, "pen")).toBeUndefined();
});
