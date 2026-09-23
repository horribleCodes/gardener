import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RuleError } from "../../src/domain/types.js";
import {
  MIN_SCHEMA_VERSION,
  SCHEMA_VERSION,
  checkSchemaVersion,
  openDb,
} from "../../src/store/db.js";

test("checkSchemaVersion refuses a file newer or older than this server can open", () => {
  expect(() => checkSchemaVersion(SCHEMA_VERSION + 1)).toThrow(RuleError);
  expect(() => checkSchemaVersion(SCHEMA_VERSION + 1)).toThrow(/compatib/i);
  expect(() => checkSchemaVersion(MIN_SCHEMA_VERSION - 1)).toThrow(/compatib/i);
  expect(() => checkSchemaVersion(SCHEMA_VERSION)).not.toThrow();
  expect(() => checkSchemaVersion(MIN_SCHEMA_VERSION)).not.toThrow();
});

test("a new database is stamped with this server's schema version", () => {
  const db = openDb(":memory:");
  expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  const challenges = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'challenges'")
    .get() as { sql: string };
  expect(challenges.sql.toLowerCase()).not.toContain("change_id text not null");
  db.close();
});

test("an unversioned v1 file is migrated and can store a free-floating challenge", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-schema-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        month INTEGER NOT NULL,
        rng_seed INTEGER NOT NULL,
        roll_counter INTEGER NOT NULL
      );
      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id)
      );
      CREATE TABLE challenges (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        change_id TEXT NOT NULL REFERENCES changes(id),
        status TEXT NOT NULL
      );
      CREATE TABLE setpieces (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        key TEXT NOT NULL,
        need TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(campaign_id, key)
      );
      INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Old', 3, 1, 0);
      INSERT INTO changes (id, campaign_id) VALUES ('ch1', 'c1');
      INSERT INTO challenges (id, kind, text, change_id, status)
        VALUES ('card1', 'convince', 'They dislike the petitioners', 'ch1', 'open');
    `);
    expect(legacy.pragma("user_version", { simple: true })).toBe(0);
    legacy.close();

    const db = openDb(path);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    const kept = db.prepare("SELECT change_id, campaign_id FROM challenges WHERE id = 'card1'").get() as {
      change_id: string;
      campaign_id: string;
    };
    expect(kept).toEqual({ change_id: "ch1", campaign_id: "c1" });
    db.prepare(
      "INSERT INTO challenges (id, campaign_id, kind, text, change_id, status) VALUES ('free', 'c1', 'find_thing', 'A decoy', NULL, 'open')",
    ).run();
    const columns = db.prepare("PRAGMA table_info(setpieces)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["court_id", "challenge_id", "character_id", "fact_id"]),
    );
    const month = db.prepare("SELECT month FROM campaigns WHERE id = 'c1'").get() as { month: number };
    expect(month.month).toBe(3);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factions'").get(),
    ).toEqual({ name: "factions" });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy migration refuses orphaned challenges that would be dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-schema-orphan-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const legacy = new Database(path);
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        month INTEGER NOT NULL,
        rng_seed INTEGER NOT NULL,
        roll_counter INTEGER NOT NULL
      );
      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id)
      );
      CREATE TABLE challenges (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        change_id TEXT NOT NULL REFERENCES changes(id),
        status TEXT NOT NULL
      );
      INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Old', 1, 1, 0);
      INSERT INTO challenges (id, kind, text, change_id, status)
        VALUES ('orphan', 'convince', 'No change row', 'missing', 'open');
    `);
    legacy.close();

    expect(() => openDb(path)).toThrow(RuleError);
    expect(() => openDb(path)).toThrow(/compatib/i);
    expect(() => openDb(path)).toThrow(/orphaned challenge.*would be dropped/i);

    const after = new Database(path);
    expect(after.pragma("user_version", { simple: true })).toBe(0);
    expect(after.prepare("SELECT id FROM challenges WHERE id = 'orphan'").get()).toEqual({ id: "orphan" });
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file newer than this server is refused before any write", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-schema-new-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const future = new Database(path);
    future.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY)");
    future.prepare("INSERT INTO marker (id) VALUES (1)").run();
    future.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    future.close();

    expect(() => openDb(path)).toThrow(RuleError);
    expect(() => openDb(path)).toThrow(/compatib/i);

    const after = new Database(path);
    expect(after.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION + 1);
    expect(after.prepare("SELECT id FROM marker").get()).toEqual({ id: 1 });
    expect(
      after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factions'").get(),
    ).toBeUndefined();
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
