import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import {
  openParallelTurn,
  submitUnitPlan,
  applyWriteQueue,
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
