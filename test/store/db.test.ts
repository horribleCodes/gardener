import { expect, test } from "vitest";
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
