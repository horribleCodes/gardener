import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { RuleError } from "../../src/domain/types.js";
import { openDb } from "../../src/store/db.js";
import { setPower } from "../../src/services/populate.js";
import { advanceMonthForCampaign } from "../../src/services/turn.js";
import { cultIncome } from "../../src/queries/detail.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function linkedCult(db: Database.Database, harshness: string): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness, patron_hero_id
     ) VALUES ('f1', 'c1', 'f1', 1, 1, 0, 'forged', 'directed', 'npc', 0, 'active', 0, 1, ?, 'h1')`,
  ).run(harshness);
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity, cult_faction_id)
     VALUES ('h1', 'c1', 'h1', 2, '[]', 0, 0, 0, 'cult', 'f1')`,
  ).run();
}

test("grueling cult income is Power plus 2", () => {
  const db = world();
  linkedCult(db, "grueling");
  expect(cultIncome(db, "c1")).toEqual([
    { heroId: "h1", name: "h1", divinity: "cult", grant: 3 },
  ]);
  const advanced = advanceMonthForCampaign(db, "c1");
  expect(advanced).toEqual({ ok: true, data: { month: 2 } });
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get()).toEqual({ dominion: 3 });
});

test("a stored unrecognized harshness refuses income and the month", () => {
  const db = world();
  linkedCult(db, "cruel");
  expect(() => cultIncome(db, "c1")).toThrow(RuleError);
  try {
    cultIncome(db, "c1");
  } catch (error) {
    expect((error as RuleError).code).toBe("PICK_UNKNOWN");
    expect((error as RuleError).message).toBe("unknown harshness");
  }
  expect(advanceMonthForCampaign(db, "c1")).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT month FROM campaigns WHERE id = 'c1'").get()).toEqual({ month: 1 });
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get()).toEqual({ dominion: 0 });
});

test("set_power refuses a cult whose harshness is unrecognized", () => {
  const db = world();
  linkedCult(db, "cruel");
  expect(setPower(db, { campaignId: "c1", factionId: "f1", power: 2 })).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT power FROM factions WHERE id = 'f1'").get()).toEqual({ power: 1 });
});
