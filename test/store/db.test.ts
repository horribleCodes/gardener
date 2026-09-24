import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";

test("migrate creates campaigns and rolls back a failed transaction", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)").run("c1", "Test");
  expect(() => {
    db.transaction(() => {
      db.prepare("UPDATE campaigns SET month = 2 WHERE id = ?").run("c1");
      throw new Error("nope");
    })();
  }).toThrow(/nope/);
  const row = db.prepare("SELECT month FROM campaigns WHERE id = ?").get("c1") as { month: number };
  expect(row.month).toBe(1);
});

test("openDb reopens an existing file database in WAL mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "gardener-db-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const db1 = openDb(path);
    expect(db1.pragma("journal_mode", { simple: true })).toBe("wal");
    db1.close();

    const db2 = openDb(path);
    expect(db2.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db2.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'").get()).toBeTruthy();
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openDb migrates legacy PC tables and columns to heroes", () => {
  const dir = mkdtempSync(join(tmpdir(), "gardener-legacy-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE factions (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        name TEXT,
        power INTEGER,
        cohesion INTEGER,
        dominion INTEGER,
        origin TEXT,
        behavior TEXT,
        control TEXT,
        auto_intervene INTEGER,
        status TEXT,
        patron_hero_id TEXT,
        contested_control INTEGER DEFAULT 0,
        home_place_id TEXT,
        harshness TEXT,
        cult INTEGER DEFAULT 0
      );
      CREATE TABLE heroes (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        name TEXT,
        level INTEGER,
        words TEXT DEFAULT '[]',
        influence INTEGER,
        dominion INTEGER,
        wealth INTEGER,
        divinity TEXT,
        cult_faction_id TEXT,
        acts_on_own INTEGER DEFAULT 0
      );
      CREATE TABLE change_commitments (
        change_id TEXT,
        hero_id TEXT,
        influence INTEGER,
        wealth_spent INTEGER,
        PRIMARY KEY (change_id, hero_id)
      );
      CREATE TABLE court_dispositions (
        court_id TEXT,
        target_type TEXT,
        target_id TEXT,
        disposition TEXT,
        PRIMARY KEY (court_id, target_type, target_id)
      );
      INSERT INTO heroes (id, campaign_id, name, level, influence, dominion, wealth, divinity)
      VALUES ('gb1', 'c1', 'Saint', 3, 4, 1, 0, 'none');
      INSERT INTO court_dispositions (court_id, target_type, target_id, disposition)
      VALUES ('court1', 'hero', 'gb1', 'favor');
    `);
    raw.close();

    const db = openDb(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('hero', 'heroes')")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(["heroes"]);
    const hero = db.prepare("SELECT name FROM heroes WHERE id = ?").get("gb1") as { name: string };
    expect(hero.name).toBe("Saint");
    const factionCols = db.prepare("PRAGMA table_info(factions)").all() as { name: string }[];
    expect(factionCols.some((c) => c.name === "patron_hero_id")).toBe(true);
    expect(factionCols.some((c) => c.name === "patron_hero_id")).toBe(false);
    const commitCols = db.prepare("PRAGMA table_info(change_commitments)").all() as { name: string }[];
    expect(commitCols.some((c) => c.name === "hero_id")).toBe(true);
    expect(commitCols.some((c) => c.name === "hero_id")).toBe(false);
    const disp = db
      .prepare("SELECT target_type FROM court_dispositions WHERE target_id = 'gb1'")
      .get() as { target_type: string };
    expect(disp.target_type).toBe("hero");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
