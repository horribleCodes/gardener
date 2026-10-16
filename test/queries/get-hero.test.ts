import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { getHero } from "../../src/queries/detail.js";
import { worldBrief } from "../../src/queries/rumors.js";

function world() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Reads', 1, 42, 0)",
  ).run();
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES ('h1', 'c1', 'Lira', 2, ?, 0, 3, 0, 'free')`,
  ).run(JSON.stringify(["Sun"]));
  return db;
}

test("getHero returns the sheet with no open turn", () => {
  const db = world();
  expect(getHero(db, "h1")).toEqual({
    id: "h1",
    name: "Lira",
    level: 2,
    divinity: "free",
    dominion: 3,
    cult_faction_id: null,
    words: ["Sun"],
  });
  expect(getHero(db, "missing")).toBeNull();
});

test("worldBrief lists the campaign heroes", () => {
  const db = world();
  expect(worldBrief(db, "c1")?.heroes).toEqual([
    { id: "h1", name: "Lira", level: 2, divinity: "free", dominion: 3 },
  ]);
});
