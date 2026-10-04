import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn, submitUnitPlan } from "../../src/services/queue.js";

const attackThem = {
  type: "attack" as const,
  targetFactionId: "them",
  attackerFeatureId: "army",
};

function seedWorld(
  db: Database.Database,
  input: {
    samePlace: boolean;
    usControl: "npc" | "player";
    themControl: "npc" | "player";
  },
): void {
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'View', 1, 1, 0)",
  ).run();
  db.prepare(
    `INSERT INTO places (id, campaign_id, name, scope, parent_place_id)
     VALUES ('home', 'c1', 'Home', 'village', NULL), ('far', 'c1', 'Far', 'city', NULL)`,
  ).run();
  const themPlace = input.samePlace ? "home" : "far";
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status, home_place_id
     ) VALUES
       ('us', 'c1', 'Us', 1, 1, 0, 'existing', 'directed', ?, 0, 'active', 'home'),
       ('them', 'c1', 'Them', 2, 2, 0, 'existing', 'martial_conqueror', ?, 0, 'active', ?)`,
  ).run(input.usControl, input.themControl, themPlace);
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin)
     VALUES ('army', 'us', 'Army', 'military', 'native')`,
  ).run();
}

function openTemp(): { db: Database.Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-unknown-plan-"));
  const dbPath = join(dir, "campaign.sqlite");
  return { db: openDb(dbPath), dbPath };
}

function queueRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT unit_id, status, error_code, payload FROM write_queue ORDER BY unit_id, enqueued_at`,
    )
    .all() as {
    unit_id: string;
    status: string;
    error_code: string | null;
    payload: string;
  }[];
}

test("submitUnitPlan rejects an attack outside the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: attackThem,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  expect(result.error.message).toBe("plan names an id outside the frozen view: them");
  expect(result.error.details).toEqual({ id: "them", unitType: "faction", unitId: "us" });
  expect(queueRows(db)).toEqual([]);
});

test("submitUnitPlan rejects a standing order outside the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: {
      type: "idle",
      standingOrders: [{ targetFactionId: "them", side: "harm", maxSpend: 1 }],
    },
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  expect(result.error.details).toEqual({ id: "them", unitType: "faction", unitId: "us" });
  expect(queueRows(db)).toEqual([]);
});

test("submitUnitPlan queues an attack whose ids are in the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: true, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: attackThem,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toEqual({ status: "queued" });
  const rows = queueRows(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("queued");
  expect(rows[0]?.error_code).toBeNull();
  expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject(attackThem);
});

test("a failed replacement leaves the previous queued plan in place", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const queued = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: { type: "idle" },
  });
  expect(queued.ok).toBe(true);

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: attackThem,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  const rows = queueRows(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("queued");
  expect(rows[0]?.error_code).toBeNull();
  expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ type: "idle" });
});
