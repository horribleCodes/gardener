import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import {
  openParallelTurn,
  submitUnitPlan,
  applyWriteQueue,
  submitReaction,
} from "../../src/services/queue.js";

function pauseDb(dbPath: string) {
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run(campaignId, "Pause");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('village', ?, 'Village', 1, 1, 0, 'native', 'self_absorbed_survivor', 'player', 0, 'active')`,
  ).run(campaignId);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('neighbor', ?, 'Neighbor', 2, 2, 0, 'native', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId);
  const featureId = "mil-feature";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, 'neighbor', 'Army', 'military', 'normal', 'normal', 0, 'native')`,
  ).run(featureId);
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, 'Army', 0)",
  ).run("mil-part", featureId);
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'neighbor', 'village', 1, 'trade')`,
  ).run();
  db.close();
  return campaignId;
}

test("pause keeps attacker plan applying and second apply does not add idle", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-pause-"));
  const dbPath = join(dir, "campaign.sqlite");
  const campaignId = pauseDb(dbPath);
  const db = openDb(dbPath);

  openParallelTurn(db, dbPath, { campaignId, unitIds: ["neighbor", "village"] });
  submitUnitPlan(db, dbPath, {
    campaignId,
    unitType: "faction",
    unitId: "neighbor",
    plan: {
      type: "attack",
      targetFactionId: "village",
      attackerFeatureId: "mil-feature",
      forcedAttackerRoll: 8,
      forcedDefenderRoll: 1,
    },
  });

  const first = applyWriteQueue(db, dbPath, { campaignId });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.data.paused).toBe(true);
  expect(first.data.defenderUnit).toEqual({ type: "faction", id: "village" });

  const planStatus = db
    .prepare(
      `SELECT status FROM write_queue WHERE kind = 'plan' AND unit_id = 'neighbor' ORDER BY enqueued_at DESC LIMIT 1`,
    )
    .get() as { status: string };
  expect(planStatus.status).toBe("applying");

  const turn = db.prepare("SELECT id FROM turns WHERE open = 1").get() as { id: string };
  const idleCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM actions WHERE turn_id = ? AND type = 'idle' AND actor_id = 'neighbor'`,
    )
    .get(turn.id) as { c: number };
  expect(idleCount.c).toBe(0);

  const second = applyWriteQueue(db, dbPath, { campaignId });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.data.paused).toBe(true);

  const idleAfter = db
    .prepare(
      `SELECT COUNT(*) AS c FROM actions WHERE turn_id = ? AND type = 'idle' AND actor_id = 'neighbor'`,
    )
    .get(turn.id) as { c: number };
  expect(idleAfter.c).toBe(0);
});

test("advanceMonth on open applies when apply closes the turn", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-advance-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run(campaignId, "Advance");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', ?, 'Faction', 1, 1, 0, 'existing', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId);

  openParallelTurn(db, dbPath, { campaignId, unitIds: ["f1"], advanceMonth: true });
  applyWriteQueue(db, dbPath, { campaignId });

  const month = db.prepare("SELECT month FROM campaigns WHERE id = ?").get(campaignId) as {
    month: number;
  };
  expect(month.month).toBe(2);
  const turn = db.prepare("SELECT advance_month FROM turns WHERE campaign_id = ?").get(campaignId) as {
    advance_month: number;
  };
  expect(turn.advance_month).toBe(0);
});

test("advanceMonth after defender reaction closes via submitReaction only once", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-advance-pause-"));
  const dbPath = join(dir, "campaign.sqlite");
  const campaignId = pauseDb(dbPath);
  const db = openDb(dbPath);

  openParallelTurn(db, dbPath, {
    campaignId,
    unitIds: ["neighbor", "village"],
    advanceMonth: true,
    missing: "mechanical",
  });
  const stored = db.prepare("SELECT missing, advance_month FROM turns WHERE open = 1").get() as {
    missing: string;
    advance_month: number;
  };
  expect(stored.missing).toBe("mechanical");
  expect(stored.advance_month).toBe(1);

  submitUnitPlan(db, dbPath, {
    campaignId,
    unitType: "faction",
    unitId: "neighbor",
    plan: {
      type: "attack",
      targetFactionId: "village",
      attackerFeatureId: "mil-feature",
      forcedAttackerRoll: 8,
      forcedDefenderRoll: 1,
    },
  });
  applyWriteQueue(db, dbPath, { campaignId, missing: "idle", advanceMonth: false });

  const monthMid = db.prepare("SELECT month FROM campaigns WHERE id = ?").get(campaignId) as {
    month: number;
  };
  expect(monthMid.month).toBe(1);

  submitReaction(db, dbPath, {
    campaignId,
    unitType: "faction",
    unitId: "village",
    defenderChoice: "cohesion",
  });

  const monthAfter = db.prepare("SELECT month FROM campaigns WHERE id = ?").get(campaignId) as {
    month: number;
  };
  expect(monthAfter.month).toBe(2);
  const closed = db
    .prepare("SELECT open, advance_month FROM turns WHERE campaign_id = ?")
    .get(campaignId) as {
    open: number;
    advance_month: number;
  };
  expect(closed.open).toBe(0);
  expect(closed.advance_month).toBe(0);
});

test("persisted missing mechanical is not overridden by applyWriteQueue idle argument", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-missing-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 99, 0)",
  ).run(campaignId, "Missing");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', ?, 'NPC', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active')`,
  ).run(campaignId);

  openParallelTurn(db, dbPath, { campaignId, unitIds: ["f1"], missing: "mechanical" });
  const applied = applyWriteQueue(db, dbPath, { campaignId, missing: "idle" });
  expect(applied.ok).toBe(false);
  if (applied.ok) return;
  expect(applied.error.code).toBe("MAGNITUDE_REJECTED");
});

test("court in faction_order gets idle action when it submits nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-court-idle-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "Court idle");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', ?, 'Faction', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active')`,
  ).run(campaignId);
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, rules_faction_id, blank, acts_on_own)
     VALUES ('court1', ?, 'royal', 'autocratic', 'grim', 'f1', 0, 1)`,
  ).run(campaignId);

  openParallelTurn(db, dbPath, { campaignId });
  db.prepare(
    `UPDATE turns SET faction_order = ? WHERE campaign_id = ? AND open = 1`,
  ).run(
    JSON.stringify([{ type: "court", id: "court1" }, { type: "faction", id: "f1" }]),
    campaignId,
  );
  submitUnitPlan(db, dbPath, {
    campaignId,
    unitType: "faction",
    unitId: "f1",
    plan: { type: "idle" },
  });
  applyWriteQueue(db, dbPath, { campaignId });

  const turn = db.prepare("SELECT id FROM turns WHERE campaign_id = ?").get(campaignId) as { id: string };
  const courtAction = db
    .prepare(
      `SELECT type, actor_type FROM actions WHERE turn_id = ? AND actor_type = 'court' AND actor_id = 'court1'`,
    )
    .get(turn.id) as { type: string; actor_type: string };
  expect(courtAction).toEqual({ type: "idle", actor_type: "court" });
});

test("openParallelTurn default order includes court with acts_on_own", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-court-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "Court");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', ?, 'Faction', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active')`,
  ).run(campaignId);
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, rules_faction_id, blank, acts_on_own)
     VALUES ('court1', ?, 'royal', 'autocratic', 'grim', 'f1', 0, 1)`,
  ).run(campaignId);

  openParallelTurn(db, dbPath, { campaignId });
  const row = db
    .prepare("SELECT faction_order FROM turns WHERE campaign_id = ? AND open = 1")
    .get(campaignId) as { faction_order: string };
  const order = JSON.parse(row.faction_order) as { type: string; id: string }[];
  expect(order.some((u) => u.type === "court" && u.id === "court1")).toBe(true);
});
