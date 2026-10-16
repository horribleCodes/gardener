import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { getFaction } from "../../src/queries/detail.js";
import { formCult } from "../../src/services/populate.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function hero(
  db: Database.Database,
  row: { id: string; level: number; divinity?: string },
): void {
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, 'c1', ?, ?, ?, 0, 0, 0, ?)`,
  ).run(row.id, row.id, row.level, JSON.stringify([]), row.divinity ?? "none");
}

function faction(
  db: Database.Database,
  row: { id: string; power: number; harshness?: string | null },
): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness
     ) VALUES (?, 'c1', ?, ?, ?, 0, 'existing', 'directed', 'npc', 0, 'active', 0, 0, ?)`,
  ).run(row.id, row.id, row.power, row.power, row.harshness ?? null);
}

function intrinsic(db: Database.Database, id: string, factionId: string, text: string, points: number): void {
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, 0)`,
  ).run(id, factionId, text, points);
}

test("level 1 cannot form a cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 1 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "The law", acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "LEVEL_TOO_LOW", message: "cult requires level 2", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("free divinity cannot form a cult without gmOverride", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, divinity: "free" });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Open worship", acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FREE_DIVINITY", message: "gmOverride required to leave free divinity", details: {} },
  });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "free",
    cult_faction_id: null,
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
});

test("gmOverride does not bypass level", () => {
  const db = world();
  hero(db, { id: "h1", level: 1, divinity: "free" });
  expect(formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Law", acknowledged: true, gmOverride: true,
  })).toEqual({
    ok: false,
    error: { code: "LEVEL_TOO_LOW", message: "cult requires level 2", details: {} },
  });
});

test("gmOverride lets free divinity found a grueling cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, divinity: "free" });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Winter must never return",
    lawText: "The frost is a sin",
    acknowledged: true,
    gmOverride: true,
    harshness: "grueling",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factionId = result.data.factionId;
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: factionId,
  });
  expect(db.prepare("SELECT harshness, power FROM factions WHERE id = ?").get(factionId)).toEqual({
    harshness: "grueling",
    power: 1,
  });
  expect(db.prepare("SELECT text FROM features WHERE faction_id = ?").all(factionId)).toEqual([
    { text: "Winter must never return" },
  ]);
  expect(db.prepare(
    "SELECT text, points, intrinsic FROM problems WHERE faction_id = ?",
  ).all(factionId)).toEqual([
    { text: "The frost is a sin", points: 3, intrinsic: 1 },
  ]);
});

test("omitted harshness stores nominal and no problems", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Quiet faith", acknowledged: true,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factionId = result.data.factionId;
  expect(db.prepare("SELECT harshness, power FROM factions WHERE id = ?").get(factionId)).toEqual({
    harshness: "nominal",
    power: 1,
  });
  expect(db.prepare("SELECT text FROM features WHERE faction_id = ?").all(factionId)).toEqual([
    { text: "Quiet faith" },
  ]);
  expect(db.prepare("SELECT COUNT(*) AS n FROM problems WHERE faction_id = ?").get(factionId)).toEqual({
    n: 0,
  });
});

test("an unrecognized harshness forms nothing", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Law", acknowledged: true, harshness: "cruel",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("an adopted Power 3 cult prices sharp laws from the d10", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  faction(db, { id: "f1", power: 3 });
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, aimed_at_faction_id)
     VALUES ('old-feat', 'f1', 'Old mill', 'economic', 'native', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('old', 'f1', 'Street debt', 2, 'economic', 0, 0, 0, 0)`,
  ).run();
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    lawText: "Pay the tithe in winter",
    acknowledged: true,
    adoptFactionId: "f1",
    harshness: "sharp",
  });
  expect(result).toEqual({ ok: true, data: { factionId: "f1" } });
  expect(db.prepare("SELECT text FROM features WHERE faction_id = 'f1' ORDER BY text").all()).toEqual([
    { text: "Old mill" },
    { text: "The tithe" },
  ]);
  expect(db.prepare(
    "SELECT text, points FROM problems WHERE faction_id = 'f1' AND intrinsic = 1",
  ).get()).toEqual({ text: "Pay the tithe in winter", points: 3 });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'old'").get()).toEqual({
    text: "Street debt",
    points: 2,
  });
});

test("adopting keeps an existing holy-law sentence and rescales its points", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  faction(db, { id: "f1", power: 3 });
  intrinsic(db, "law1", "f1", "Old law", 1);
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
    harshness: "sharp",
  });
  expect(result.ok).toBe(true);
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "Old law",
    points: 3,
  });
  expect(db.prepare(
    "SELECT COUNT(*) AS n FROM problems WHERE faction_id = 'f1' AND intrinsic = 1",
  ).get()).toEqual({ n: 1 });
});

test("a missing adopted faction is refused", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Law",
    acknowledged: true,
    adoptFactionId: "missing",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "faction not found", details: {} },
  });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "none",
    cult_faction_id: null,
  });
});

test("acknowledged is still required before the level gate", () => {
  const db = world();
  hero(db, { id: "h1", level: 1 });
  expect(formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Law",
  })).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "acknowledged worshippers required", details: {} },
  });
});

test("a new cult without a holy law is refused when harshness prices one", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Winter must never return",
    acknowledged: true,
    harshness: "grueling",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "holy law required", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("new cult composition matches each harshness budget", () => {
  const cases = [
    { harshness: "nominal" as const, points: 0 },
    { harshness: "sharp" as const, points: 2 },
    { harshness: "grueling" as const, points: 3 },
    { harshness: "overwhelming" as const, points: 5 },
  ];
  for (const row of cases) {
    const db = world();
    hero(db, { id: "h1", level: 2 });
    const result = formCult(db, {
      campaignId: "c1",
      heroId: "h1",
      featureText: "Chosen gift",
      lawText: "Keep the vigil",
      acknowledged: true,
      harshness: row.harshness,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const factionId = result.data.factionId;
    expect(db.prepare("SELECT power FROM factions WHERE id = ?").get(factionId)).toEqual({ power: 1 });
    expect(db.prepare("SELECT text FROM features WHERE faction_id = ?").all(factionId)).toEqual([
      { text: "Chosen gift" },
    ]);
    const problems = db
      .prepare("SELECT text, points, intrinsic FROM problems WHERE faction_id = ?")
      .all(factionId) as { text: string; points: number; intrinsic: number }[];
    if (row.points === 0) {
      expect(problems).toEqual([]);
    } else {
      expect(problems).toEqual([{ text: "Keep the vigil", points: row.points, intrinsic: 1 }]);
      expect(problems[0].text).not.toBe("Chosen gift");
    }
  }
});

function place(db: Database.Database, id: string, name: string): void {
  db.prepare(
    `INSERT INTO places (id, campaign_id, name, scope, parent_place_id) VALUES (?, 'c1', ?, 'village', NULL)`,
  ).run(id, name);
}

test("form_cult stores homePlaceId on a new cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  place(db, "vale", "Ash Vale");
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    homePlaceId: "vale",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(getFaction(db, result.data.factionId)?.home_place_id).toBe("vale");
});

test("an unknown homePlaceId forms nothing", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    homePlaceId: "missing",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "place not found", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("adopting keeps the stored home unless homePlaceId is passed", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  place(db, "old", "Old Home");
  place(db, "new", "New Home");
  faction(db, { id: "f1", power: 3 });
  db.prepare("UPDATE factions SET home_place_id = 'old' WHERE id = 'f1'").run();
  const kept = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
  });
  expect(kept.ok).toBe(true);
  expect(getFaction(db, "f1")?.home_place_id).toBe("old");

  const db2 = world();
  hero(db2, { id: "h1", level: 2 });
  place(db2, "old", "Old Home");
  place(db2, "new", "New Home");
  faction(db2, { id: "f1", power: 3 });
  db2.prepare("UPDATE factions SET home_place_id = 'old' WHERE id = 'f1'").run();
  const moved = formCult(db2, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
    homePlaceId: "new",
  });
  expect(moved.ok).toBe(true);
  expect(getFaction(db2, "f1")?.home_place_id).toBe("new");
});
