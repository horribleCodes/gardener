import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { beginChange, commitResources } from "../../src/services/change.js";
import { runAction } from "../../src/services/actions.js";
import { loadCatalog } from "../../src/tables/catalog.js";

function createKistelekDb(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("village", "c1", "Village", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");

  const problemRows = [
    { id: "raid", text: "Raiding bandits", points: 1, position: 0 },
    { id: "tax", text: "Crushing taxes", points: 1, position: 1 },
    { id: "despair", text: "Village despair", points: 2, position: 2 },
  ];
  for (const p of problemRows) {
    db.prepare(
      `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
       VALUES (?, ?, ?, ?, 'cultural', 0, 0, 0, ?)`,
    ).run(p.id, "village", p.text, p.points, p.position);
  }

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("neighbor", "c1", "Neighbor City", 2, 2, 0, "native", "martial_conqueror", "npc", 0, "active");

  const featureId = "mil-feature";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(featureId, "neighbor", "Standing army", "military", "normal", "normal", 0, "native");
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("mil-part", featureId, "Standing army", 0);

  db.prepare(
    `INSERT INTO godbound (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sword", "c1", "Sword", 3, "[]", 2, 0, 0, "free");

  return db;
}

test("a forced trouble roll of 4 blames despair and gains no dominion", () => {
  const db = createKistelekDb();
  const result = runAction(db, {
    campaignId: "c1",
    factionId: "village",
    type: "build_strength",
    forcedRoll: 4,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.success).toBe(false);
    expect(result.data.culpritId).toBe("despair");
  }
  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("village") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(0);
});

test("pc feature creation adds one backlash problem and not a trouble check", () => {
  const db = createKistelekDb();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: "The village has a band of trained warriors.",
    godboundId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;
  expect(begun.data.quote.total).toBe(1);

  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    godboundId: "sword",
    influence: 1,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.status).toBe("active");

  const trouble = db
    .prepare("SELECT COALESCE(SUM(points), 0) AS t FROM problems WHERE faction_id = ?")
    .get("village") as { t: number };
  expect(trouble.t).toBe(5);
  expect(loadCatalog().backlash[0]).toBeTruthy();
});

test("attack win without problemId adds catalog military problem text", () => {
  const db = createKistelekDb();
  const militaryText = loadCatalog().problems.military[0];
  const before = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get("village") as { c: number };

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "neighbor",
    type: "attack",
    targetFactionId: "village",
    attackerFeatureId: "mil-feature",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.success).toBe(true);

  const added = db
    .prepare(
      "SELECT text, domain FROM problems WHERE faction_id = ? ORDER BY position DESC LIMIT 1",
    )
    .get("village") as { text: string; domain: string };
  const after = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get("village") as { c: number };
  expect(after.c).toBe(before.c + 1);
  expect(added.text).toBe(militaryText);
  expect(added.domain).toBe("military");
});

test("commitResources rejects feature activation without featureText or draft", () => {
  const db = createKistelekDb();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    godboundId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    godboundId: "sword",
    influence: 1,
  });
  expect(committed.ok).toBe(false);
  if (committed.ok) return;
  expect(committed.error.code).toBe("FILL_INCOMPLETE");
});
