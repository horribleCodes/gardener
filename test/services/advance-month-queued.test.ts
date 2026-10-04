import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { advanceMonthForCampaign } from "../../src/services/turn.js";

function world(): { db: Database.Database; campaignId: string } {
  const db = openDb(":memory:");
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run(campaignId, "Month");
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES ('h1', ?, 'Hero', 6, '[]', 0, 0, 0, 'free')`,
  ).run(campaignId);
  return { db, campaignId };
}

function openTurn(db: Database.Database, campaignId: string): void {
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
     VALUES ('t1', ?, 1, 1, 1, '[]', 'idle', 0)`,
  ).run(campaignId);
}

function queue(
  db: Database.Database,
  campaignId: string,
  row: {
    id: string;
    unitType: string;
    unitId: string;
    kind: string;
    status: string;
    payload?: string;
  },
): void {
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES (?, ?, 't1', ?, ?, ?, ?, ?, NULL, 1)`,
  ).run(
    row.id,
    campaignId,
    row.unitType,
    row.unitId,
    row.kind,
    row.payload ?? '{"type":"idle"}',
    row.status,
  );
}

function calendar(db: Database.Database, campaignId: string): {
  month: number;
  dominion: number;
  open: number | null;
  income: number;
} {
  const campaign = db.prepare("SELECT month FROM campaigns WHERE id = ?").get(campaignId) as {
    month: number;
  };
  const hero = db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get() as {
    dominion: number;
  };
  const turn = db.prepare("SELECT open FROM turns WHERE id = 't1'").get() as
    | { open: number }
    | undefined;
  const income = db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE campaign_id = ? AND type = 'income'")
    .get(campaignId) as { n: number };
  return {
    month: campaign.month,
    dominion: hero.dominion,
    open: turn?.open ?? null,
    income: income.n,
  };
}

function statusOf(db: Database.Database, id: string): string {
  const row = db.prepare("SELECT status FROM write_queue WHERE id = ?").get(id) as {
    status: string;
  };
  return row.status;
}

function expectBlocked(db: Database.Database, campaignId: string): void {
  const result = advanceMonthForCampaign(db, campaignId);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({
    code: "QUEUE_NOT_EMPTY",
    message: "plan or reaction queued",
    details: {},
  });
  expect(calendar(db, campaignId)).toEqual({ month: 1, dominion: 0, open: 1, income: 0 });
}

function expectAdvanced(
  db: Database.Database,
  campaignId: string,
  open: number | null,
): void {
  const result = advanceMonthForCampaign(db, campaignId);
  expect(result).toEqual({ ok: true, data: { month: 2 } });
  expect(calendar(db, campaignId)).toEqual({ month: 2, dominion: 3, open, income: 1 });
}

test("advance_month errors when a faction plan is queued", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "queued",
  });

  expectBlocked(db, campaignId);

  const row = db.prepare("SELECT status, payload FROM write_queue WHERE id = 'q1'").get() as {
    status: string;
    payload: string;
  };
  expect(row).toEqual({ status: "queued", payload: '{"type":"idle"}' });
});

test("advance_month errors when a reaction is queued", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "rx1",
    unitType: "faction",
    unitId: "def",
    kind: "reaction",
    status: "queued",
    payload: "{}",
  });

  expectBlocked(db, campaignId);
  expect(statusOf(db, "rx1")).toBe("queued");
});

test("advance_month errors when a non-faction plan is queued", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "court1",
    unitType: "court",
    unitId: "court-a",
    kind: "plan",
    status: "queued",
  });

  expectBlocked(db, campaignId);
  expect(statusOf(db, "court1")).toBe("queued");
});

test("a paused apply with a queued reaction returns QUEUE_NOT_EMPTY", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "plan1",
    unitType: "faction",
    unitId: "att",
    kind: "plan",
    status: "applying",
  });
  queue(db, campaignId, {
    id: "rx1",
    unitType: "faction",
    unitId: "def",
    kind: "reaction",
    status: "queued",
    payload: "{}",
  });
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome)
     VALUES ('act1', 't1', 'attack', 'faction', 'att', 'faction', 'def', 'PENDING_DEFENDER_CHOICE')`,
  ).run();

  expectBlocked(db, campaignId);
  expect(statusOf(db, "plan1")).toBe("applying");
  expect(statusOf(db, "rx1")).toBe("queued");
});

test("a pending defender choice with no queue row stays TURN_ALREADY_OPEN", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome)
     VALUES ('act1', 't1', 'attack', 'faction', 'att', 'faction', 'def', 'PENDING_DEFENDER_CHOICE')`,
  ).run();

  const result = advanceMonthForCampaign(db, campaignId);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({
    code: "TURN_ALREADY_OPEN",
    message: "defender choice pending",
    details: {},
  });
  expect(calendar(db, campaignId)).toEqual({ month: 1, dominion: 0, open: 1, income: 0 });
});

test("a done plan does not block advance_month", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "done",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("done");
});

test("a rejected plan does not block advance_month", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "rejected",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("rejected");
});

test("an applying plan with no queued reaction does not block advance_month", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "applying",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("applying");
});

test("an open turn with an empty queue still advances", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);

  expectAdvanced(db, campaignId, 0);
});

test("advance_month with no open turn still advances", () => {
  const { db, campaignId } = world();

  expectAdvanced(db, campaignId, null);
});

test("a queued plan on a closed turn does not block advance_month", () => {
  const { db, campaignId } = world();
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
     VALUES ('t1', ?, 1, 1, 0, '[]', 'idle', 0)`,
  ).run(campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "queued",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("queued");
  const openCount = db
    .prepare("SELECT COUNT(*) AS n FROM turns WHERE campaign_id = ? AND open = 1")
    .get(campaignId) as { n: number };
  expect(openCount.n).toBe(0);
});
