import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { getFaction } from "../../src/queries/detail.js";

test("getFaction interestRoom is cap minus max outgoing points on one edge", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Test");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', 'c1', 'F', 2, 2, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('t1', 'c1', 'T1', 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('t2', 'c1', 'T2', 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('e1', 'f1', 't1', 5, 'trade')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('e2', 'f1', 't2', 3, 'trade')`,
  ).run();

  const faction = getFaction(db, "f1");
  expect(faction).not.toBeNull();
  expect(faction!.interestCap).toBe(16);
  expect(faction!.interestRoom).toBe(11);
  const byTarget = new Map(faction!.interestsOut.map((e) => [e.targetId, e]));
  expect(byTarget.get("t1")!.room).toBe(11);
  expect(byTarget.get("t2")!.room).toBe(13);
});
