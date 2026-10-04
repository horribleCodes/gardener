import { expect, test } from "vitest";
import type { FillMode } from "../../src/domain/types.js";
import { seedCampaign } from "../../src/services/populate.js";
import { openDb } from "../../src/store/db.js";

function counts(db: ReturnType<typeof openDb>) {
  const campaigns = db.prepare("SELECT COUNT(*) AS c FROM campaigns").get() as { c: number };
  const places = db.prepare("SELECT COUNT(*) AS c FROM places").get() as { c: number };
  return { campaigns: campaigns.c, places: places.c };
}

test.each<{ fill?: FillMode }>([
  { fill: "require" },
  { fill: "missing" },
  { fill: "blank" },
  {},
])("omitted place scope fails and writes nothing (fill %j)", ({ fill }) => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    ...(fill ? { fill } : {}),
    outline: { places: [{ key: "home", name: "Home" }] },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
  expect(result.error.message).toBe("place scope required");
  expect(counts(db)).toEqual({ campaigns: 0, places: 0 });
  db.close();
});

test("a later place missing scope rolls back the earlier place", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    fill: "missing",
    outline: {
      places: [
        { key: "home", name: "Home", scope: "city" },
        { key: "far", name: "Far" },
      ],
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({
    code: "FILL_INCOMPLETE",
    message: "place scope required",
    details: {},
  });
  expect(counts(db)).toEqual({ campaigns: 0, places: 0 });
  db.close();
});

test("an explicit scope is stored as given", () => {
  const db = openDb(":memory:");
  const city = seedCampaign(db, {
    name: "City campaign",
    seed: 1,
    fill: "missing",
    outline: { places: [{ key: "home", name: "Home", scope: "city" }] },
  });
  expect(city.ok).toBe(true);
  if (!city.ok) return;
  const cityRow = db
    .prepare("SELECT name, scope FROM places WHERE campaign_id = ?")
    .get(city.data.campaignId) as { name: string; scope: string };
  expect(cityRow).toEqual({ name: "Home", scope: "city" });

  const village = seedCampaign(db, {
    name: "Village campaign",
    seed: 99,
    fill: "require",
    outline: { places: [{ key: "home", name: "Home", scope: "village" }] },
  });
  expect(village.ok).toBe(true);
  if (!village.ok) return;
  const villageRow = db
    .prepare("SELECT scope FROM places WHERE campaign_id = ?")
    .get(village.data.campaignId) as { scope: string };
  expect(villageRow.scope).toBe("village");

  const blank = seedCampaign(db, {
    name: "Blank campaign",
    seed: 2,
    fill: "blank",
    outline: { places: [{ key: "home", name: "Home", scope: "city" }] },
  });
  expect(blank.ok).toBe(true);
  if (!blank.ok) return;
  const blankRow = db
    .prepare("SELECT scope FROM places WHERE campaign_id = ?")
    .get(blank.data.campaignId) as { scope: string };
  expect(blankRow.scope).toBe("city");
  db.close();
});

test("omitted faction power and behavior stay on the home scope and the survivor default", () => {
  const db = openDb(":memory:");
  const seeded = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    fill: "missing",
    linkInterests: false,
    outline: {
      places: [{ key: "home", name: "Home", scope: "city" }],
      factions: [{ key: "a", name: "Guild", homePlaceKey: "home" }],
    },
  });
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) return;
  const faction = db
    .prepare("SELECT power, behavior FROM factions WHERE campaign_id = ?")
    .get(seeded.data.campaignId) as { power: number; behavior: string };
  expect(faction).toEqual({ power: 2, behavior: "self_absorbed_survivor" });
  db.close();
});

test("a home key that matches no place still seeds power 1", () => {
  const db = openDb(":memory:");
  const seeded = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    outline: {
      factions: [{ key: "a", name: "Guild", homePlaceKey: "missing" }],
    },
  });
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) return;
  const faction = db
    .prepare("SELECT power, behavior FROM factions WHERE campaign_id = ?")
    .get(seeded.data.campaignId) as { power: number; behavior: string };
  expect(faction).toEqual({ power: 1, behavior: "self_absorbed_survivor" });
  db.close();
});

test("an empty places array still creates a campaign", () => {
  const db = openDb(":memory:");
  const seeded = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    outline: { places: [] },
  });
  expect(seeded.ok).toBe(true);
  expect(counts(db)).toEqual({ campaigns: 1, places: 0 });
  db.close();
});
