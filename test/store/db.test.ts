import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrate, openDb } from "../../src/store/db.js";

test("migrate restores foreign_keys after it temporarily disables them", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  db.close();
});

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
  const dir = mkdtempSync(join(tmpdir(), "godbound-db-"));
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
