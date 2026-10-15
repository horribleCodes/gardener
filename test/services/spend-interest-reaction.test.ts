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

function contestWorld(): Database.Database {
  const db = reactionFixture();
  db.prepare("DELETE FROM interests WHERE from_faction_id = 'other'").run();
  db.prepare("UPDATE interests SET points = 4 WHERE from_faction_id = 'watcher'").run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin) VALUES
     ('af', 'actor', 'Host', 'military', 'native'),
     ('df', 'watcher', 'Wall', 'military', 'native')`,
  ).run();
  db.prepare(
    `INSERT INTO feature_parts (id, feature_id, text, position) VALUES
     ('afp', 'af', 'Host', 0),
     ('dfp', 'df', 'Wall', 0)`,
  ).run();
  return db;
}

test("after-roll raise turns a lost attack into a victory", () => {
  const db = contestWorld();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: {
      type: "attack",
      targetFactionId: "watcher",
      attackerFeatureId: "af",
      defenderFeatureId: "df",
      forcedAttackerRoll: 2,
      forcedDefenderRoll: 4,
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.data).toMatchObject({ code: "PENDING_INTEREST", phase: "before" });
  const passedBefore = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
  });
  expect(passedBefore.ok).toBe(true);
  if (!passedBefore.ok) return;
  expect(passedBefore.data).toMatchObject({ code: "PENDING_INTEREST", phase: "after" });
  const raised = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "after",
    direction: "raise",
    modifier: 3,
  });
  expect(raised.ok).toBe(true);
  if (!raised.ok) return;
  const action = db.prepare("SELECT outcome FROM actions WHERE type = 'attack'").get() as {
    outcome: string;
  };
  expect(action.outcome).toBe("attacker_win");
  const problems = db.prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = 'watcher'").get() as {
    c: number;
  };
  expect(problems.c).toBe(1);
  const watcher = db
    .prepare("SELECT dominion FROM factions WHERE id = 'watcher'")
    .get() as { dominion: number };
  expect(watcher.dominion).toBe(1);
  const points = db
    .prepare("SELECT points FROM interests WHERE from_faction_id = 'watcher'")
    .get() as { points: number };
  expect(points.points).toBe(1);
});

test("after-roll lower hinders a winning attack", () => {
  const db = contestWorld();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: {
      type: "attack",
      targetFactionId: "watcher",
      attackerFeatureId: "af",
      defenderFeatureId: "df",
      forcedAttackerRoll: 5,
      forcedDefenderRoll: 3,
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const passedBefore = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
  });
  expect(passedBefore.ok).toBe(true);
  if (!passedBefore.ok) return;
  expect(passedBefore.data).toMatchObject({ code: "PENDING_INTEREST", phase: "after" });
  const problemsBefore = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = 'watcher'")
    .get() as { c: number };
  expect(problemsBefore.c).toBe(1);
  const lowered = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "after",
    direction: "lower",
    modifier: 3,
  });
  expect(lowered.ok).toBe(true);
  if (!lowered.ok) return;
  const action = db.prepare("SELECT outcome FROM actions WHERE type = 'attack'").get() as {
    outcome: string;
  };
  expect(action.outcome).toBe("defender_win");
  const problemsAfter = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = 'watcher'")
    .get() as { c: number };
  expect(problemsAfter.c).toBe(0);
  const watcher = db
    .prepare("SELECT dominion FROM factions WHERE id = 'watcher'")
    .get() as { dominion: number };
  expect(watcher.dominion).toBe(1);
});

test("after-roll raise changes a failed build_strength into success", () => {
  const db = reactionFixture();
  db.prepare("DELETE FROM interests WHERE from_faction_id = 'other'").run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('p1', 'actor', 'Drought', 2, 'economic', 0, 0, 0, 0)`,
  ).run();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "build_strength", forcedRoll: 2 },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const passedBefore = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
  });
  expect(passedBefore.ok).toBe(true);
  if (!passedBefore.ok) return;
  const actorBefore = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as {
    dominion: number;
  };
  const raised = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "after",
    direction: "raise",
    modifier: 1,
  });
  expect(raised.ok).toBe(true);
  if (!raised.ok) return;
  const action = db.prepare("SELECT outcome, dominion_delta FROM actions WHERE type = 'build_strength'").get() as {
    outcome: string;
    dominion_delta: number;
  };
  expect(action.outcome).toBe("success");
  expect(action.dominion_delta).toBe(1);
  const roll = db
    .prepare(
      `SELECT r.payload FROM rolls r JOIN actions a ON a.roll_id = r.id WHERE a.type = 'build_strength'`,
    )
    .get() as { payload: string };
  expect((JSON.parse(roll.payload) as { kept: number }).kept).toBe(3);
  const actor = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as { dominion: number };
  expect(actor.dominion).toBe(actorBefore.dominion + 1);
  const watcher = db.prepare("SELECT dominion FROM factions WHERE id = 'watcher'").get() as {
    dominion: number;
  };
  expect(watcher.dominion).toBe(3);
  const points = db
    .prepare("SELECT points FROM interests WHERE from_faction_id = 'watcher'")
    .get() as { points: number };
  expect(points.points).toBe(2);
});
