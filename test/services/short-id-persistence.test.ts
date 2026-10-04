import { expect, test } from "vitest";
import { createCampaign } from "../../src/services/populate.js";
import { requireCampaign } from "../../src/services/util.js";
import { openDb } from "../../src/store/db.js";

test("createCampaign stores an 8-character hex id", () => {
  const db = openDb(":memory:");
  const created = createCampaign(db, { name: "N" });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.data.campaignId).toMatch(/^[0-9a-f]{8}$/);
  const row = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(created.data.campaignId) as {
    id: string;
  };
  expect(row.id).toBe(created.data.campaignId);
});

test("requireCampaign still loads a stored UUID", () => {
  const db = openDb(":memory:");
  const legacyId = "11111111-2222-4333-8444-555555555555";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, 'Old', 1, 1, 0)",
  ).run(legacyId);
  expect(requireCampaign(db, legacyId).id).toBe(legacyId);
});
