import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { setTheology } from "../../src/services/populate.js";
import { advanceMonth } from "../../src/services/turn.js";
import { cultIncome } from "../../src/queries/detail.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function hero(
  db: Database.Database,
  id: string,
  cultFactionId: string | null,
  dominion = 0,
): void {
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity, cult_faction_id)
     VALUES (?, 'c1', ?, 2, '[]', 0, ?, 0, 'cult', ?)`,
  ).run(id, id, dominion, cultFactionId);
}

function faction(
  db: Database.Database,
  row: {
    id: string;
    power: number;
    cohesion: number;
    cult?: number;
    harshness?: string | null;
    patron?: string | null;
    home?: string | null;
    dominion?: number;
  },
): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness, patron_hero_id, home_place_id
     ) VALUES (?, 'c1', ?, ?, ?, ?, 'forged', 'directed', 'npc', 0, 'active', 0, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.id,
    row.power,
    row.cohesion,
    row.dominion ?? 0,
    row.cult ?? 1,
    row.harshness ?? "nominal",
    row.patron ?? null,
    row.home ?? null,
  );
}

function feature(
  db: Database.Database,
  id: string,
  factionId: string,
  text: string,
  aimedAt: string | null = null,
): void {
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, aimed_at_faction_id)
     VALUES (?, ?, ?, 'other', 'native', ?)`,
  ).run(id, factionId, text, aimedAt);
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, 0)",
  ).run(`${id}-part`, id, text);
}

test("a Power 1 cult stops being a faction and keeps the gift and worshipers", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1", dominion: 4 });
  faction(db, { id: "f2", power: 2, cohesion: 2, cult: 0, harshness: null });
  feature(db, "feat1", "f1", "The healing gift");
  feature(db, "feat2", "f1", "The war gift");
  feature(db, "feat-other", "f2", "Spies", "f1");
  db.prepare(
    `INSERT INTO characters (
       id, campaign_id, name, role, faction_id, side, is_leader, is_hidden_controller, shares_authority
     ) VALUES ('ch1', 'c1', 'Acolyte', 'priest', 'f1', 'unaffiliated', 0, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, rules_faction_id, blank)
     VALUES ('court1', 'c1', 'temple', 'autocratic', 'tense', 'f1', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('prob1', 'f1', 'Holy law', 1, 'cultural', 1, 0, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO changes (
       id, campaign_id, scope, magnitude, kind, owner, status, faction_id, feature_id, backlash_problem_id
     ) VALUES ('chng1', 'c1', 'village', 'plausible', 'feature', 'pc', 'active', 'f1', 'feat1', 'prob1')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('int1', 'f2', 'f1', 1, 'alliance'), ('int2', 'f1', 'f2', 1, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
     VALUES ('t1', 'c1', 1, 1, 1, '[]', 'idle', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO write_queue (
       id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, enqueued_at
     ) VALUES ('q1', 'c1', 't1', 'faction', 'f1', 'plan', '{}', 'queued', 1)`,
  ).run();

  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1", harshness: "sharp", featureText: "ignored" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factIds = result.data.factIds as string[];
  expect(result.data).toEqual({
    ended: true,
    factionId: "f1",
    giftTexts: ["The healing gift", "The war gift"],
    factIds,
  });
  expect(factIds).toHaveLength(3);
  const facts = factIds.map((id) =>
    db.prepare(
      "SELECT subject, subject_id, statement, kind, visibility FROM facts WHERE id = ?",
    ).get(id),
  );
  expect(facts).toEqual([
    { subject: "hero", subject_id: "h1", statement: "The healing gift", kind: "explicit", visibility: "public" },
    { subject: "hero", subject_id: "h1", statement: "The war gift", kind: "explicit", visibility: "public" },
    {
      subject: "hero",
      subject_id: "h1",
      statement: "Worshipers remain, and they are not a faction.",
      kind: "explicit",
      visibility: "public",
    },
  ]);
  expect(db.prepare("SELECT id FROM factions WHERE id = 'f1'").get()).toBeUndefined();
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions WHERE status = 'collapsed' OR power = 0").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'faction_collapsed'").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT id FROM features WHERE faction_id = 'f1'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM feature_parts WHERE id = 'feat1-part'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM problems WHERE faction_id = 'f1'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM interests").get()).toBeUndefined();
  expect(db.prepare("SELECT divinity, cult_faction_id, dominion FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: null,
    dominion: 0,
  });
  expect(db.prepare("SELECT faction_id FROM characters WHERE id = 'ch1'").get()).toEqual({ faction_id: null });
  expect(db.prepare("SELECT rules_faction_id FROM courts WHERE id = 'court1'").get()).toEqual({ rules_faction_id: null });
  expect(
    db.prepare("SELECT faction_id, feature_id, backlash_problem_id FROM changes WHERE id = 'chng1'").get(),
  ).toEqual({ faction_id: null, feature_id: null, backlash_problem_id: null });
  expect(db.prepare("SELECT id, power FROM factions WHERE id = 'f2'").get()).toEqual({ id: "f2", power: 2 });
  expect(db.prepare("SELECT aimed_at_faction_id FROM features WHERE id = 'feat-other'").get()).toEqual({
    aimed_at_faction_id: null,
  });
  expect(db.prepare("SELECT status FROM write_queue WHERE id = 'q1'").get()).toEqual({ status: "queued" });
  expect(
    db.prepare("SELECT type, actor_id, outcome FROM actions WHERE turn_id = 't1' AND type = 'set_theology'").get(),
  ).toEqual({ type: "set_theology", actor_id: "f1", outcome: "success" });
});

test("facts land on the home place when the cult has no patron", () => {
  const db = world();
  db.prepare(
    "INSERT INTO places (id, campaign_id, name, scope) VALUES ('p1', 'c1', 'Village', 'village')",
  ).run();
  faction(db, { id: "f1", power: 1, cohesion: 1, home: "p1" });
  feature(db, "feat1", "f1", "Place gift");
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factIds = result.data.factIds as string[];
  expect(result.data.giftTexts).toEqual(["Place gift"]);
  expect(factIds).toHaveLength(2);
  expect(
    db.prepare("SELECT subject, subject_id, statement FROM facts WHERE id = ?").get(factIds[0]),
  ).toEqual({ subject: "place", subject_id: "p1", statement: "Place gift" });
  expect(
    db.prepare("SELECT subject, subject_id, statement FROM facts WHERE id = ?").get(factIds[1]),
  ).toEqual({
    subject: "place",
    subject_id: "p1",
    statement: "Worshipers remain, and they are not a faction.",
  });
});

test("a cult with no patron and no home place still ends, with no facts", () => {
  const db = world();
  faction(db, { id: "f1", power: 1, cohesion: 1 });
  feature(db, "feat1", "f1", "A gift");
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toEqual({ ended: true, factionId: "f1", giftTexts: ["A gift"], factIds: [] });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT id FROM factions WHERE id = 'f1'").get()).toBeUndefined();
});

test("a patron and no features still records that worshipers remain", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1" });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.giftTexts).toEqual([]);
  const factIds = result.data.factIds as string[];
  expect(factIds).toHaveLength(1);
  expect(db.prepare("SELECT statement FROM facts WHERE id = ?").get(factIds[0])).toEqual({
    statement: "Worshipers remain, and they are not a faction.",
  });
});

test("a spent internal action leaves the Power 1 cult in place", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1" });
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES ('t1', 'c1', 1, 1, 1, '[]')`,
  ).run();
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, outcome)
     VALUES ('a1', 't1', 'build_strength', 'faction', 'f1', 'success')`,
  ).run();
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({
    ok: false,
    error: { code: "INTERNAL_BUDGET", message: "internal action already taken", details: {} },
  });
  expect(db.prepare("SELECT id, status, power, cohesion FROM factions WHERE id = 'f1'").get()).toEqual({
    id: "f1",
    status: "active",
    power: 1,
    cohesion: 1,
  });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
});

test("a faction that is not a cult is left alone", () => {
  const db = world();
  faction(db, { id: "f1", power: 1, cohesion: 1, cult: 0 });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "cult faction not found", details: {} },
  });
  expect(db.prepare("SELECT status FROM factions WHERE id = 'f1'").get()).toEqual({ status: "active" });
});

test("a Power 2 cult loses 1 Power and stays a faction", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, cohesion: 2, patron: "h1", harshness: "nominal" });
  feature(db, "feat1", "f1", "Old gift");
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    harshness: "sharp",
    featureText: "New gift",
  });
  expect(result).toEqual({ ok: true, data: { power: 1, cohesion: 1 } });
  expect(db.prepare("SELECT power, cohesion, harshness, status FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 1,
    cohesion: 1,
    harshness: "sharp",
    status: "active",
  });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "New gift" });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'faction_collapsed'").get()).toEqual({ n: 0 });
});

test("ending the cult stops cult Dominion while a linked cult still pays", () => {
  const db = world();
  hero(db, "h1", "f1");
  hero(db, "h2", "f2");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1", harshness: "nominal" });
  faction(db, { id: "f2", power: 1, cohesion: 1, patron: "h2", harshness: "nominal" });
  const ended = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(ended.ok).toBe(true);
  advanceMonth(db, "c1");
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get()).toEqual({ dominion: 0 });
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h2'").get()).toEqual({ dominion: 1 });
  const income = cultIncome(db, "c1");
  expect(income.find((row) => row.heroId === "h1")).toMatchObject({ divinity: "cult", grant: 0 });
  expect(income.find((row) => row.heroId === "h2")).toMatchObject({ divinity: "cult", grant: 1 });
});
