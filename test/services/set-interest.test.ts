import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { setInterest } from "../../src/services/populate.js";

function twoFactions() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Test', 1, 1, 0)",
  ).run();
  for (const id of ["a", "b"] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, id);
  }
  return db;
}

test("setInterest creates a spies edge at 1 point", () => {
  const db = twoFactions();
  const result = setInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    nature: "spies",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toMatchObject({ nature: "spies", points: 1, fromFactionId: "a", toFactionId: "b" });
  const row = db
    .prepare("SELECT points, nature FROM interests WHERE from_faction_id = 'a' AND to_faction_id = 'b'")
    .get() as { points: number; nature: string };
  expect(row).toEqual({ points: 1, nature: "spies" });
});

test("setInterest honors caller points within cap and rejects over cap", () => {
  const db = twoFactions();
  const ok = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "rivalry", points: 6,
  });
  expect(ok.ok).toBe(true);
  const over = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "trade", points: 13, replaceNature: true,
  });
  expect(over.ok).toBe(false);
  if (!over.ok) expect(over.error.code).toBe("INTEREST_CAP");
});

test("setInterest refuses self-edges and nature mismatch without replaceNature", () => {
  const db = twoFactions();
  const self = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "a", nature: "alliance",
  });
  expect(self.ok).toBe(false);
  if (!self.ok) expect(self.error.code).toBe("FILL_INCOMPLETE");

  setInterest(db, { campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "alliance" });
  const clash = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "spies",
  });
  expect(clash.ok).toBe(false);
  if (!clash.ok) expect(clash.error.code).toBe("INTEREST_NATURE_MISMATCH");
  const kept = db.prepare("SELECT nature FROM interests WHERE from_faction_id = 'a'").get() as { nature: string };
  expect(kept.nature).toBe("alliance");

  const replaced = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "spies", replaceNature: true,
  });
  expect(replaced.ok).toBe(true);
  const after = db.prepare("SELECT nature FROM interests WHERE from_faction_id = 'a'").get() as { nature: string };
  expect(after.nature).toBe("spies");
});

test("setInterest rejects unknown nature and updates points on the same nature", () => {
  const db = twoFactions();
  const bad = setInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    nature: "war" as "alliance",
  });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error.code).toBe("PICK_UNKNOWN");

  const first = setInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    nature: "trade",
  });
  expect(first.ok).toBe(true);
  const updated = setInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    nature: "trade",
    points: 4,
  });
  expect(updated.ok).toBe(true);
  if (!updated.ok) return;
  expect(updated.data.points).toBe(4);
  expect(updated.data.interestId).toBeTruthy();
});
