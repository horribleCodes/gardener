import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { beginChange } from "../../src/services/change.js";

function dbWithCampaign() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Test', 1, 1, 0)",
  ).run();
  return db;
}

test("beginChange stores 0 deed and challenge quotas when omitted", () => {
  const db = dbWithCampaign();
  const result = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "realm",
    magnitude: "impossible",
    kind: "feature",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.quote.deedsRequired).toBe(0);
  expect(result.data.quote.challengesRequired).toBe(0);
  const row = db.prepare("SELECT deeds_required, challenges_required FROM changes WHERE id = ?").get(
    result.data.changeId,
  ) as { deeds_required: number; challenges_required: number };
  expect(row).toEqual({ deeds_required: 0, challenges_required: 0 });
});

test("beginChange stores a caller-set deed quota", () => {
  const db = dbWithCampaign();
  const result = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude: "impossible",
    kind: "feature",
    deedsRequired: 1,
    challengesRequired: 0,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const row = db.prepare("SELECT deeds_required, challenges_required FROM changes WHERE id = ?").get(
    result.data.changeId,
  ) as { deeds_required: number; challenges_required: number };
  expect(row).toEqual({ deeds_required: 1, challenges_required: 0 });
});

test("beginChange rejects a negative deed quota", () => {
  const db = dbWithCampaign();
  const result = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    deedsRequired: -1,
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
});
