import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { setTheology } from "../../src/services/populate.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function hero(db: Database.Database, id: string, cultFactionId: string): void {
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity, cult_faction_id)
     VALUES (?, 'c1', ?, 2, '[]', 0, 0, 0, 'cult', ?)`,
  ).run(id, id, cultFactionId);
}

function faction(
  db: Database.Database,
  row: { id: string; power: number; harshness?: string | null; cult?: number },
): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness, patron_hero_id
     ) VALUES (?, 'c1', ?, ?, ?, 0, 'forged', 'directed', 'npc', 0, 'active', 0, ?, ?, ?)`,
  ).run(row.id, row.id, row.power, row.power, row.cult ?? 1, row.harshness === undefined ? "nominal" : row.harshness, "h1");
}

function feature(db: Database.Database, id: string, factionId: string, text: string): void {
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, aimed_at_faction_id)
     VALUES (?, ?, ?, 'other', 'native', NULL)`,
  ).run(id, factionId, text);
}

function problem(
  db: Database.Database,
  row: { id: string; factionId: string; text: string; points: number; intrinsic: number; position: number },
): void {
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', ?, 0, 0, ?)`,
  ).run(row.id, row.factionId, row.text, row.points, row.intrinsic, row.position);
}

test("omitted harshness keeps grueling laws while Power drops", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "grueling" });
  feature(db, "feat1", "f1", "Gift");
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 5, intrinsic: 1, position: 0 });
  problem(db, { id: "street", factionId: "f1", text: "Street debt", points: 2, intrinsic: 0, position: 1 });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({ ok: true, data: { power: 2, cohesion: 2 } });
  expect(db.prepare("SELECT power, cohesion, harshness, status FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 2,
    cohesion: 2,
    harshness: "grueling",
    status: "active",
  });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "Law",
    points: 4,
  });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'street'").get()).toEqual({
    text: "Street debt",
    points: 2,
  });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "Gift" });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
});

test("an intrinsic text edit keeps harshness and the feature", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "grueling" });
  feature(db, "feat1", "f1", "Gift");
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 5, intrinsic: 1, position: 0 });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [{ problemId: "law1", text: "New law" }],
  });
  expect(result).toEqual({ ok: true, data: { power: 2, cohesion: 2 } });
  expect(db.prepare("SELECT harshness FROM factions WHERE id = 'f1'").get()).toEqual({ harshness: "grueling" });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "New law",
    points: 4,
  });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "Gift" });
});

test("feature text updates the lowest feature id only", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "nominal" });
  feature(db, "a-feat", "f1", "First");
  feature(db, "b-feat", "f1", "Second");
  const result = setTheology(db, {
    campaignId: "c1", cultFactionId: "f1", featureText: "Rewritten",
  });
  expect(result.ok).toBe(true);
  expect(db.prepare("SELECT text FROM features WHERE id = 'a-feat'").get()).toEqual({ text: "Rewritten" });
  expect(db.prepare("SELECT text FROM features WHERE id = 'b-feat'").get()).toEqual({ text: "Second" });
});

test("nominal harshness deletes holy laws and leaves other problems", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "grueling" });
  feature(db, "feat1", "f1", "Gift");
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 5, intrinsic: 1, position: 0 });
  problem(db, { id: "street", factionId: "f1", text: "Street debt", points: 2, intrinsic: 0, position: 1 });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1", harshness: "nominal" });
  expect(result.ok).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM problems WHERE id = 'law1'").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT text FROM problems WHERE id = 'street'").get()).toEqual({ text: "Street debt" });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "Gift" });
});

test("unrecognized harshness rolls back the theology edit", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1", harshness: "cruel" });
  expect(result).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT power, harshness FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 2,
    harshness: "sharp",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM actions WHERE type = 'set_theology'").get()).toEqual({ n: 0 });
});

test("a text edit must name an intrinsic problem of this cult", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  faction(db, { id: "f2", power: 2, harshness: "sharp" });
  problem(db, { id: "street", factionId: "f1", text: "Street debt", points: 2, intrinsic: 0, position: 0 });
  problem(db, { id: "other", factionId: "f2", text: "Other law", points: 2, intrinsic: 1, position: 0 });
  expect(setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [{ problemId: "street", text: "Nope" }],
  })).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "intrinsic problem not found", details: {} },
  });
  expect(setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [{ problemId: "other", text: "Nope" }],
  })).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "intrinsic problem not found", details: {} },
  });
  expect(db.prepare("SELECT power FROM factions WHERE id = 'f1'").get()).toEqual({ power: 2 });
});

test("a repeated intrinsic id is refused", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 2, intrinsic: 1, position: 0 });
  expect(setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [
      { problemId: "law1", text: "One" },
      { problemId: "law1", text: "Two" },
    ],
  })).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "duplicate intrinsic problem", details: {} },
  });
  expect(db.prepare("SELECT text FROM problems WHERE id = 'law1'").get()).toEqual({ text: "Law" });
  expect(db.prepare("SELECT power FROM factions WHERE id = 'f1'").get()).toEqual({ power: 2 });
});

test("a text edit that the new budget would delete changes nothing", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 2, intrinsic: 1, position: 0 });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    harshness: "nominal",
    intrinsicTexts: [{ problemId: "law1", text: "Gone" }],
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "intrinsic problem removed by the new budget", details: {} },
  });
  expect(db.prepare("SELECT power, harshness FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 2,
    harshness: "sharp",
  });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "Law",
    points: 2,
  });
});

test("a Power 1 cult still ends when harshness is unrecognized", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, harshness: "nominal" });
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 1, intrinsic: 1, position: 0 });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    harshness: "cruel",
    intrinsicTexts: [{ problemId: "law1", text: "Ignored" }],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.ended).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions WHERE id = 'f1'").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: null,
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'faction_collapsed'").get()).toEqual({ n: 0 });
});

test("a faction that is not a cult is left alone", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, cult: 0 });
  expect(setTheology(db, { campaignId: "c1", cultFactionId: "f1" })).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "cult faction not found", details: {} },
  });
});
