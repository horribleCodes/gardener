import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { runAction } from "../../src/services/actions.js";
import { parseUnitPlan } from "../../src/services/unitPlan.js";
import type Database from "better-sqlite3";

function contestDb(): { db: Database.Database; campaignId: string } {
  const db = openDb(":memory:");
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "T");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('atk', ?, 'Atk', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active'),
            ('def', ?, 'Def', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId, campaignId);
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('af', 'atk', 'A', 'cultural', 'vast', 'superior', 1, 'impossible'),
            ('df', 'def', 'D', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES ('pa', 'af', 'A', 0), ('pd', 'df', 'D', 0)",
  ).run();
  db.prepare(
    "INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order) VALUES ('t1', ?, 1, 1, 1, '[]')",
  ).run(campaignId);
  return { db, campaignId };
}

function attackerRoll(db: Database.Database): { natural: number; kept: number; bonus: number; total: number } {
  const row = db.prepare("SELECT payload FROM rolls").get() as { payload: string };
  const payload = JSON.parse(row.payload) as {
    attacker: { natural: number; kept: number; bonus: number; total: number };
  };
  return payload.attacker;
}

test("domain mismatch keeps one die and ignores stored vast, superior, and magical marks", () => {
  const { db, campaignId } = contestDb();
  const result = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
    defenderChoice: "cohesion",
  });
  expect(result.ok).toBe(true);
  const roll = attackerRoll(db);
  expect(roll.natural).toBe(6);
  expect(roll.kept).toBe(6);
  expect(roll.bonus).toBe(2);
  expect(roll.total).toBe(8);
});

test("explicit edges add comparative scale and quality plus one-sided edged", () => {
  const { db, campaignId } = contestDb();
  runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
    defenderChoice: "cohesion",
    attackerEdge: { vast: true, superior: true, edged: true },
    defenderEdge: { vast: true },
  });
  expect(attackerRoll(db).bonus).toBe(4);
});

test("a natural 1 zeros origin and edges", () => {
  const { db, campaignId } = contestDb();
  runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 1,
    forcedDefenderRoll: 6,
    attackerEdge: { vast: true, superior: true, edged: true },
  });
  const roll = attackerRoll(db);
  expect(roll.bonus).toBe(0);
  expect(roll.total).toBe(1);
});

test("extend_interest uses the same origin bonus", () => {
  const { db, campaignId } = contestDb();
  const result = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "extend_interest",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
  });
  expect(result.ok).toBe(true);
  expect(attackerRoll(db).bonus).toBe(2);
});

test("a non-boolean edge or marginal returns FILL_INCOMPLETE", () => {
  const { db, campaignId } = contestDb();
  const badEdge = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    attackerEdge: { vast: "yes" },
  } as never);
  expect(badEdge.ok).toBe(false);
  if (!badEdge.ok) expect(badEdge.error.code).toBe("FILL_INCOMPLETE");

  const badMarginal = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "extend_interest",
    targetFactionId: "def",
    attackerFeatureId: "af",
    willing: true,
    marginal: "yes",
  } as never);
  expect(badMarginal.ok).toBe(false);
  if (!badMarginal.ok) expect(badMarginal.error.code).toBe("FILL_INCOMPLETE");
  const rolls = db.prepare("SELECT COUNT(*) AS n FROM rolls").get() as { n: number };
  expect(rolls.n).toBe(0);
});

test("a unit plan accepts contest edges and rejects a non-boolean vast", () => {
  const plan = parseUnitPlan({
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    attackerEdge: { edged: true },
    defenderEdge: { superior: true },
    marginal: true,
  });
  expect(plan).toMatchObject({
    marginal: true,
    attackerEdge: { edged: true },
    defenderEdge: { superior: true },
  });
  expect(() =>
    parseUnitPlan({
      type: "extend_interest",
      targetFactionId: "def",
      attackerFeatureId: "af",
      attackerEdge: { vast: "yes" },
    }),
  ).toThrow();
});
