import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SCHEMA_VERSION, openDb } from "../../src/store/db.js";

test("a v2 campaign file gains godbound flag columns without changing month", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-flags-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const v2 = new Database(path);
    v2.exec(`
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        month INTEGER NOT NULL,
        rng_seed INTEGER NOT NULL,
        roll_counter INTEGER NOT NULL,
        name_lists TEXT NOT NULL DEFAULT '{}'
      );
    `);
    v2.prepare(
      "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Old', 7, 1, 0)",
    ).run();
    v2.pragma("user_version = 2");
    v2.close();

    const db = openDb(path);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    const row = db.prepare(
      "SELECT month, preset, profile, project_base, opposition, wards, held_changes, capability_gate, reach_unit FROM campaigns WHERE id = 'c1'",
    ).get() as Record<string, unknown>;
    expect(row).toMatchObject({
      month: 7,
      preset: "godbound",
      profile: "strain",
      project_base: "scope",
      opposition: "stack",
      wards: 1,
      held_changes: 1,
      capability_gate: 0,
      reach_unit: "place",
    });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
