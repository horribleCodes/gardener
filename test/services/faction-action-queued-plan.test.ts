import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn, submitUnitPlan } from "../../src/services/queue.js";
import { factionAction } from "../../src/services/turn.js";

function world(): { db: Database.Database; dbPath: string; campaignId: string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-queued-plan-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run(campaignId, "Queued");
  for (const [id, name] of [
    ["a", "A"],
    ["b", "B"],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, ?, ?, 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, campaignId, name);
  }
  return { db, dbPath, campaignId };
}

function queueIdlePlan(db: Database.Database, dbPath: string, campaignId: string, unitId: string) {
  const opened = openParallelTurn(db, dbPath, { campaignId, unitIds: ["a", "b"] });
  expect(opened.ok).toBe(true);
  const submitted = submitUnitPlan(db, dbPath, {
    campaignId,
    unitType: "faction",
    unitId,
    plan: { type: "idle" },
  });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) return;
  expect(submitted.data.status).toBe("queued");
}

function planRow(db: Database.Database, unitId: string) {
  return db
    .prepare(
      `SELECT status, payload FROM write_queue
       WHERE unit_id = ? AND kind = 'plan' AND unit_type = 'faction'
       ORDER BY enqueued_at DESC LIMIT 1`,
    )
    .get(unitId) as { status: string; payload: string };
}

test("faction_action errors when that faction has a queued plan", () => {
  const { db, dbPath, campaignId } = world();
  queueIdlePlan(db, dbPath, campaignId, "a");
  const before = planRow(db, "a");
  const sheet = db.prepare("SELECT cohesion, dominion FROM factions WHERE id = 'a'").get();

  const idle = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(idle.ok).toBe(false);
  if (idle.ok) return;
  expect(idle.error).toEqual({
    code: "PLAN_ALREADY_QUEUED",
    message: "plan already queued",
    details: {},
  });

  const strength = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "build_strength" },
  });
  expect(strength.ok).toBe(false);
  if (strength.ok) return;
  expect(strength.error.code).toBe("PLAN_ALREADY_QUEUED");

  expect(planRow(db, "a")).toEqual(before);
  const actions = db.prepare("SELECT COUNT(*) AS c FROM actions").get() as { c: number };
  expect(actions.c).toBe(0);
  expect(db.prepare("SELECT cohesion, dominion FROM factions WHERE id = 'a'").get()).toEqual(sheet);
});

test("another faction can still act while a plan is queued", () => {
  const { db, dbPath, campaignId } = world();
  queueIdlePlan(db, dbPath, campaignId, "a");
  const before = planRow(db, "a");

  const other = factionAction(db, {
    campaignId,
    factionId: "b",
    action: { type: "idle" },
  });
  expect(other).toEqual({ ok: true, data: { idle: true } });
  expect(planRow(db, "a")).toEqual(before);
});

test.each(["done", "rejected", "applying"] as const)(
  "faction_action runs when the latest plan status is %s",
  (status) => {
    const { db, dbPath, campaignId } = world();
    queueIdlePlan(db, dbPath, campaignId, "a");
    db.prepare(
      `UPDATE write_queue SET status = ? WHERE unit_id = 'a' AND kind = 'plan'`,
    ).run(status);

    const result = factionAction(db, {
      campaignId,
      factionId: "a",
      action: { type: "idle" },
    });
    expect(result).toEqual({ ok: true, data: { idle: true } });
  },
);

test("a queued reaction does not block faction_action", () => {
  const { db, dbPath, campaignId } = world();
  const opened = openParallelTurn(db, dbPath, { campaignId, unitIds: ["a"] });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES ('rx1', ?, ?, 'faction', 'a', 'reaction', '{}', 'queued', NULL, 1)`,
  ).run(campaignId, opened.data.turnId);

  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });
});

test("a queued plan for a non-faction unit does not block faction_action", () => {
  const { db, dbPath, campaignId } = world();
  const opened = openParallelTurn(db, dbPath, { campaignId, unitIds: ["a"] });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES ('court-plan', ?, ?, 'court', 'a', 'plan', '{"type":"idle"}', 'queued', NULL, 1)`,
  ).run(campaignId, opened.data.turnId);

  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });
});

test("a queued plan on a closed turn does not block faction_action", () => {
  const { db, dbPath, campaignId } = world();
  queueIdlePlan(db, dbPath, campaignId, "a");
  const closed = db.prepare("SELECT id FROM turns WHERE open = 1").get() as { id: string };
  db.prepare("UPDATE turns SET open = 0 WHERE id = ?").run(closed.id);

  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });

  const stillQueued = db
    .prepare("SELECT status FROM write_queue WHERE turn_id = ? AND unit_id = 'a' AND kind = 'plan'")
    .get(closed.id) as { status: string };
  expect(stillQueued.status).toBe("queued");
  const openCount = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE open = 1").get() as { c: number };
  expect(openCount.c).toBe(1);
});

test("faction_action with no open turn still idles", () => {
  const { db, campaignId } = world();
  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });
  const openCount = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE open = 1").get() as { c: number };
  expect(openCount.c).toBe(1);
});
