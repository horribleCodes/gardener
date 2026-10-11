import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn } from "../../src/services/queue.js";
import { advanceMonthForCampaign, factionAction, spendInterest } from "../../src/services/turn.js";

function world(): { db: Database.Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-budget-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Budget', 1, 1, 0)",
  ).run();
  for (const [id, name, power] of [
    ["a", "A", 1],
    ["b", "B", 1],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, ?, ?, 3, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, name, power, power);
  }
  return { db, dbPath };
}

function closeOpenTurn(db: Database.Database): void {
  db.prepare("UPDATE turns SET open = 0 WHERE campaign_id = 'c1' AND open = 1").run();
}

test("a second turn in the same month is the rejected crisis choice", () => {
  const { db, dbPath } = world();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "idle" },
  });
  expect(opened.ok).toBe(true);
  closeOpenTurn(db);

  const again = openParallelTurn(db, dbPath, { campaignId: "c1" });
  expect(again.ok).toBe(false);
  if (!again.ok) {
    expect(again.error).toEqual({
      code: "TURN_ALREADY_TAKEN",
      message: "turn already taken this month",
      details: {},
    });
  }
  const viaAction = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "idle" },
  });
  expect(viaAction.ok).toBe(false);
  if (!viaAction.ok) {
    expect(viaAction.error.code).toBe("TURN_ALREADY_TAKEN");
    expect(viaAction.error.message).toBe("turn already taken this month");
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE campaign_id = 'c1'").get() as {
    c: number;
  };
  expect(count.c).toBe(1);
});

test("advance_month allows a turn in the new month", () => {
  const { db, dbPath } = world();
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "idle" } }).ok,
  ).toBe(true);
  closeOpenTurn(db);
  const advanced = advanceMonthForCampaign(db, "c1");
  expect(advanced.ok).toBe(true);
  const next = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "idle" },
  });
  expect(next.ok).toBe(true);
  const months = db.prepare("SELECT month FROM turns WHERE campaign_id = 'c1' ORDER BY sequence").all() as {
    month: number;
  }[];
  expect(months.map((row) => row.month)).toEqual([1, 2]);
  expect(openParallelTurn(db, dbPath, { campaignId: "c1" }).ok).toBe(false);
});

test("skip with no open turn does not insert a turn", () => {
  const { db } = world();
  const result = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toEqual({
      code: "ENTITY_NOT_FOUND",
      message: "no open turn",
      details: {},
    });
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM turns").get() as { c: number };
  expect(count.c).toBe(0);
});

test("skip is recorded and a second skip fails", () => {
  const { db } = world();
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "idle" } }).ok,
  ).toBe(true);
  const skipped = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(skipped.ok).toBe(true);
  if (skipped.ok) expect(skipped.data).toEqual({ skipped: true });
  const row = db.prepare("SELECT type, outcome FROM actions WHERE actor_id = 'a'").get() as {
    type: string;
    outcome: string;
  };
  expect(row).toEqual({ type: "skip", outcome: "skipped" });
  const again = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error.code).toBe("FACTION_SKIPPED");
});

test("skip after a budgeted action returns ALREADY_ACTED", () => {
  const { db } = world();
  expect(
    factionAction(db, {
      campaignId: "c1",
      factionId: "a",
      action: { type: "build_strength", forcedRoll: 6 },
    }).ok,
  ).toBe(true);
  const skipped = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(skipped.ok).toBe(false);
  if (!skipped.ok) {
    expect(skipped.error).toEqual({
      code: "ALREADY_ACTED",
      message: "faction already acted",
      details: {},
    });
  }
});

test("one internal action and power external actions, one per target", () => {
  const { db } = world();
  db.prepare("UPDATE factions SET power = 2, cohesion = 2 WHERE id = 'a'").run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin) VALUES ('fa', 'a', 'Envoy', 'cultural', 'native')`,
  ).run();
  const first = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "build_strength", forcedRoll: 6 },
  });
  expect(first.ok).toBe(true);
  const secondInternal = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "restore_cohesion" },
  });
  expect(secondInternal.ok).toBe(false);
  if (!secondInternal.ok) {
    expect(secondInternal.error).toEqual({
      code: "INTERNAL_BUDGET",
      message: "internal action already taken",
      details: {},
    });
  }
  const external = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: {
      type: "extend_interest",
      targetFactionId: "b",
      attackerFeatureId: "fa",
      willing: true,
    },
  });
  expect(external.ok).toBe(true);
  const repeated = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: {
      type: "remove_interest",
      targetFactionId: "b",
      willing: true,
    },
  });
  expect(repeated.ok).toBe(false);
  if (!repeated.ok) {
    expect(repeated.error.code).toBe("DUPLICATE_EXTERNAL_TARGET");
    expect(repeated.error.message).toBe("already acted on target");
  }
});

test("a free steal does not consume the external budget", () => {
  const { db } = world();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('edge', 'a', 'b', 2, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin) VALUES ('fa', 'a', 'Envoy', 'cultural', 'native')`,
  ).run();
  expect(
    factionAction(db, {
      campaignId: "c1",
      factionId: "a",
      action: { type: "idle" },
    }).ok,
  ).toBe(true);
  expect(
    factionAction(db, {
      campaignId: "c1",
      factionId: "a",
      action: {
        type: "extend_interest",
        targetFactionId: "b",
        attackerFeatureId: "fa",
        willing: true,
      },
    }).ok,
  ).toBe(true);
  const stolen = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    timing: "steal",
    modifier: 1,
  });
  expect(stolen.ok).toBe(true);
  const exhausted = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "aid", targetFactionId: "b", amount: 1 },
  });
  expect(exhausted.ok).toBe(false);
  if (!exhausted.ok) expect(exhausted.error.code).toBe("EXTERNAL_BUDGET");
});

test("a budgeted action after skip returns FACTION_SKIPPED", () => {
  const { db } = world();
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "idle" } }).ok,
  ).toBe(true);
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "skip" } }).ok,
  ).toBe(true);
  const blocked = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "build_strength" },
  });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.error).toEqual({
      code: "FACTION_SKIPPED",
      message: "faction skipped this month",
      details: {},
    });
  }
});
