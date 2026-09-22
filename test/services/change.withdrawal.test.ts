import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { assessWithdrawal } from "../../src/services/change.js";

function withdrawalDb(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Test");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('owner', 'c1', 'Owner', 2, 2, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('rival', 'c1', 'Rival', 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('other', 'c1', 'Other', 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  return db;
}

function insertChange(
  db: Database.Database,
  opts: { id: string; factionId: string | null; magnitude: string; featureId?: string },
) {
  db.prepare(
    `INSERT INTO changes (id, campaign_id, scope, magnitude, kind, owner, status, faction_id, feature_id)
     VALUES (?, 'c1', 'city', ?, 'feature', 'faction', 'active', ?, ?)`,
  ).run(opts.id, opts.magnitude, opts.factionId, opts.featureId ?? null);
}

test("assessWithdrawal beyond_local_maintenance when plausible change links improbable feature", () => {
  const db = withdrawalDb();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('feat', 'owner', 'Wonder', 'cultural', 'normal', 'normal', 0, 'improbable')`,
  ).run();
  insertChange(db, { id: "ch1", factionId: "owner", magnitude: "plausible", featureId: "feat" });

  const result = assessWithdrawal(db, { changeId: "ch1" });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.beyond_local_maintenance).toBe(true);
});

test("assessWithdrawal opposed when rivalry targets the change faction", () => {
  const db = withdrawalDb();
  insertChange(db, { id: "ch1", factionId: "owner", magnitude: "plausible" });
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('in', 'rival', 'owner', 2, 'rivalry')`,
  ).run();

  const result = assessWithdrawal(db, { changeId: "ch1" });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.opposed).toBe(true);
});

test("assessWithdrawal not opposed when owner holds outgoing rivalry elsewhere", () => {
  const db = withdrawalDb();
  insertChange(db, { id: "ch1", factionId: "owner", magnitude: "plausible" });
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('out', 'owner', 'other', 3, 'rivalry')`,
  ).run();

  const result = assessWithdrawal(db, { changeId: "ch1" });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.opposed).toBe(false);
});
