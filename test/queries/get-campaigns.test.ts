import { expect, test } from "vitest";
import { getCampaigns } from "../../src/queries/campaigns.js";
import { openDb } from "../../src/store/db.js";

test("getCampaigns returns an empty list when the database has no campaigns", () => {
  const db = openDb(":memory:");
  expect(getCampaigns(db)).toEqual({ campaigns: [] });
});

test("getCampaigns orders by name case-insensitively, then id", () => {
  const db = openDb(":memory:");
  const insert = db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  );
  insert.run("b", "beta");
  insert.run("a2", "Alpha");
  insert.run("a1", "alpha");
  expect(getCampaigns(db)).toEqual({
    campaigns: [
      { id: "a1", name: "alpha" },
      { id: "a2", name: "Alpha" },
      { id: "b", name: "beta" },
    ],
  });
});
