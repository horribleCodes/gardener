import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { relevantFeatures } from "../../src/queries/detail.js";

test("relevant_features reports origin bonus only", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'T', 1, 1, 0)",
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', 'c1', 'F', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active'),
            ('f2', 'c1', 'G', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin)
     VALUES ('wide', 'f1', 'Wide', 'military', 'impossible'),
            ('econ', 'f1', 'Market', 'economic', 'improbable'),
            ('foe', 'f2', 'Foe', 'military', 'native')`,
  ).run();

  const alone = relevantFeatures(db, { factionId: "f1", domain: "military" });
  expect(alone.map((f) => [f.id, f.unevenBonus])).toEqual([["wide", 0]]);

  const against = relevantFeatures(db, {
    factionId: "f1",
    domain: "military",
    opposingFeatureId: "foe",
  });
  expect(against.map((f) => [f.id, f.unevenBonus])).toEqual([["wide", 2]]);

  const missing = relevantFeatures(db, {
    factionId: "f1",
    domain: "economic",
    opposingFeatureId: "missing",
  });
  expect(missing.map((f) => [f.id, f.unevenBonus])).toEqual([["econ", 0]]);
});
