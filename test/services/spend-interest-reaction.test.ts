import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { factionAction, passInterest, spendInterest } from "../../src/services/turn.js";

function reactionFixture(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'React', 1, 1, 0)",
  ).run();
  for (const [id, name] of [
    ["actor", "Actor"],
    ["watcher", "Watcher"],
    ["other", "Other"],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, 1, 1, 4, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, name);
  }
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('w-actor', 'watcher', 'actor', 3, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('o-actor', 'other', 'actor', 3, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES ('turn1', 'c1', 1, 1, 1, '[]')`,
  ).run();
  return db;
}

test("before and after with no window return NOT_PENDING", () => {
  const db = reactionFixture();
  for (const timing of ["before", "after"] as const) {
    const result = spendInterest(db, {
      campaignId: "c1",
      fromFactionId: "watcher",
      toFactionId: "actor",
      timing,
      direction: "raise",
      modifier: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "NOT_PENDING",
        message: "no interest window",
        details: {},
      });
    }
  }
});

test("a faction without interest, or one that already spent, is not offered", () => {
  const db = reactionFixture();
  db.prepare("DELETE FROM interests WHERE from_faction_id = 'other'").run();
  const pending = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "build_strength", forcedRoll: 1 },
  });
  expect(pending.ok).toBe(true);
  if (!pending.ok) return;
  const data = pending.data as {
    code: string;
    eligibleFactionIds: string[];
    phase: string;
    subjectFactionId: string;
  };
  expect(data.code).toBe("PENDING_INTEREST");
  expect(data.phase).toBe("before");
  expect(data.subjectFactionId).toBe("actor");
  expect(data.eligibleFactionIds).toEqual(["watcher"]);
});

test("a spend re-opens the offer for a faction that already passed", () => {
  const db = reactionFixture();
  const first = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "build_strength", forcedRoll: 1 },
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const passed = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "other",
    toFactionId: "actor",
  });
  expect(passed.ok).toBe(true);
  const spent = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "before",
    direction: "raise",
    modifier: 1,
  });
  expect(spent.ok).toBe(true);
  if (!spent.ok) return;
  const data = spent.data as { code: string; eligibleFactionIds: string[] };
  expect(data.code).toBe("PENDING_INTEREST");
  expect(data.eligibleFactionIds).toEqual(["other"]);
  expect(data.eligibleFactionIds).not.toContain("watcher");
});

test("steal from an empty stockpile yields no dominion and spends the interest", () => {
  const db = reactionFixture();
  db.prepare("UPDATE factions SET dominion = 0 WHERE id = 'actor'").run();
  db.prepare("UPDATE turns SET open = 1 WHERE id = 'turn1'").run();
  const result = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "steal",
    modifier: 2,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toMatchObject({ stolenDominion: 0, spent: 2, timing: "steal" });
  const watcher = db.prepare("SELECT dominion FROM factions WHERE id = 'watcher'").get() as {
    dominion: number;
  };
  const actor = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as {
    dominion: number;
  };
  expect(watcher.dominion).toBe(4);
  expect(actor.dominion).toBe(0);
  const points = db
    .prepare("SELECT points FROM interests WHERE from_faction_id = 'watcher'")
    .get() as { points: number };
  expect(points.points).toBe(1);
  const again = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "steal",
    modifier: 1,
  });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error.code).toBe("INTEREST_ALREADY_SPENT");
  const other = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "other",
    toFactionId: "actor",
    timing: "steal",
    modifier: 1,
  });
  expect(other.ok).toBe(true);
});

test("a steal that leaves the actor short fails the dominion action", () => {
  const db = reactionFixture();
  db.prepare("UPDATE factions SET dominion = 1 WHERE id = 'actor'").run();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "aid", targetFactionId: "watcher", amount: 1 },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.data).toMatchObject({ code: "PENDING_INTEREST", phase: "steal", subjectFactionId: "actor" });
  const stolen = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "steal",
    modifier: 1,
  });
  expect(stolen.ok).toBe(true);
  if (!stolen.ok) return;
  expect(stolen.data).toMatchObject({ stolenDominion: 1 });
  const passed = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "other",
    toFactionId: "actor",
  });
  expect(passed.ok).toBe(true);
  if (!passed.ok) return;
  expect(passed.data).toMatchObject({ failed: true, reason: "insufficient dominion" });
  const action = db.prepare("SELECT type, outcome, roll_id, dominion_delta FROM actions WHERE type = 'aid'").get() as {
    type: string;
    outcome: string;
    roll_id: string | null;
    dominion_delta: number;
  };
  expect(action).toEqual({ type: "aid", outcome: "failed", roll_id: null, dominion_delta: 0 });
  const actor = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as { dominion: number };
  expect(actor.dominion).toBe(0);
  const again = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "aid", targetFactionId: "other", amount: 1 },
  });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error.code).toBe("EXTERNAL_BUDGET");
});
