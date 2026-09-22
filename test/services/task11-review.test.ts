import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { swayCourt } from "../../src/services/populate.js";
import { listHooks } from "../../src/services/turn.js";
import { resolveWithdrawal } from "../../src/services/change.js";
import { toEnvelope } from "../../src/mcp/envelope.js";
import { loadCatalog } from "../../src/tables/catalog.js";

function courtDb(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Test");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status, contested_control)
     VALUES ('f1', 'c1', 'Rulers', 2, 2, 0, 'native', 'directed', 'npc', 0, 'active', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, rules_faction_id, blank, acts_on_own)
     VALUES ('court1', 'c1', 'royal', 'autocratic', 'grim', 'f1', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO court_consequences (id, court_id, text) VALUES ('cc1', 'court1', 'The throne room burns.')`,
  ).run();
  return db;
}

test("swayCourt favor upserts disposition and writes a fact", () => {
  const db = courtDb();
  const result = swayCourt(db, {
    campaignId: "c1",
    courtId: "court1",
    targetType: "godbound",
    targetId: "gb1",
    mode: "favor",
  });
  expect(result.ok).toBe(true);
  const disposition = db
    .prepare(
      "SELECT disposition FROM court_dispositions WHERE court_id = ? AND target_type = ? AND target_id = ?",
    )
    .get("court1", "godbound", "gb1") as { disposition: string };
  expect(disposition.disposition).toBe("favor");
  const facts = db
    .prepare("SELECT statement FROM facts WHERE subject = 'court' AND subject_id = 'court1'")
    .all() as { statement: string }[];
  expect(facts).toHaveLength(1);
  expect(facts[0].statement).toBe(loadCatalog().minorRelationship[0].text);
});

test("swayCourt control on ruling court sets contested_control and disposition", () => {
  const db = courtDb();
  const result = swayCourt(db, {
    campaignId: "c1",
    courtId: "court1",
    targetType: "faction",
    targetId: "f1",
    mode: "control",
  });
  expect(result.ok).toBe(true);
  const faction = db.prepare("SELECT contested_control FROM factions WHERE id = 'f1'").get() as {
    contested_control: number;
  };
  expect(faction.contested_control).toBe(1);
  const disposition = db
    .prepare("SELECT disposition FROM court_dispositions WHERE court_id = 'court1'")
    .get() as { disposition: string };
  expect(disposition.disposition).toBe("control");
});

test("listHooks includes court consequences only with favor or control disposition", () => {
  const db = courtDb();
  const without = listHooks(db, "c1");
  expect(without.ok).toBe(true);
  if (without.ok) expect(without.data.courtConsequences).toHaveLength(0);

  db.prepare(
    `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility)
     VALUES ('fact1', 'c1', 'court', 'court1', 'noise', 'explicit', 'public')`,
  ).run();
  const stillWithout = listHooks(db, "c1");
  if (stillWithout.ok) expect(stillWithout.data.courtConsequences).toHaveLength(0);

  swayCourt(db, {
    campaignId: "c1",
    courtId: "court1",
    targetType: "godbound",
    targetId: "gb1",
    mode: "favor",
  });
  const withDisposition = listHooks(db, "c1");
  if (withDisposition.ok) expect(withDisposition.data.courtConsequences).toHaveLength(1);
});

test("toEnvelope lifts advisories from data without mutating service payload", () => {
  const serviceData = { factionId: "f1", advisories: ["warn"] };
  const envelope = toEnvelope({ ok: true, data: serviceData });
  expect(envelope.ok).toBe(true);
  if (envelope.ok) {
    expect(envelope.advisories).toEqual(["warn"]);
    expect(envelope.data).toEqual({ factionId: "f1" });
    expect(serviceData.advisories).toEqual(["warn"]);
  }
});

test("leave_fragile without faction returns ENTITY_NOT_FOUND and leaves status decaying", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Test");
  db.prepare(
    `INSERT INTO changes (id, campaign_id, scope, magnitude, kind, owner, status, faction_id)
     VALUES ('ch1', 'c1', 'city', 'plausible', 'feature', 'faction', 'decaying', NULL)`,
  ).run();
  const result = resolveWithdrawal(db, { changeId: "ch1", choice: "leave_fragile" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("ENTITY_NOT_FOUND");
    expect(result.error.message).toBe("change has no faction");
  }
  const status = db.prepare("SELECT status FROM changes WHERE id = 'ch1'").get() as { status: string };
  expect(status.status).toBe("decaying");
});
