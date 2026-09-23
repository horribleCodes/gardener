import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWriteLock } from "../../src/store/lock.js";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn, submitUnitPlan, applyWriteQueue } from "../../src/services/queue.js";

test("a dead stale lock is reclaimed", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-"));
  const dbPath = join(dir, "campaign.sqlite");
  openDb(dbPath);
  const stalePid = 2 ** 22;
  const staleTs = Date.now() - 60_000;
  writeFileSync(`${dbPath}.lock`, `${stalePid} ${staleTs}\n`);
  const result = withWriteLock(dbPath, () => "entered");
  expect(result).toBe("entered");
});

test("two plans both persist and apply in shuffle order", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "Test");

  for (const [id, name] of [["a", "A"], ["b", "B"]] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, ?, ?, 1, 1, 5, 'existing', 'directed', 'npc', 0, 'active')`,
    ).run(id, campaignId, name);
  }
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'a', 'b', 1, 'trade'), ('i2', 'b', 'a', 1, 'trade')`,
  ).run();

  const opened = openParallelTurn(db, dbPath, {
    campaignId,
    unitIds: ["b", "a"],
  });
  expect(opened.ok).toBe(true);

  expect(
    submitUnitPlan(db, dbPath, {
      campaignId,
      unitType: "faction",
      unitId: "a",
      plan: { type: "idle" },
    }).ok,
  ).toBe(true);
  expect(
    submitUnitPlan(db, dbPath, {
      campaignId,
      unitType: "faction",
      unitId: "b",
      plan: { type: "idle" },
    }).ok,
  ).toBe(true);

  const applied = applyWriteQueue(db, dbPath, { campaignId });
  expect(applied.ok).toBe(true);

  const turn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? ORDER BY sequence DESC LIMIT 1")
    .get(campaignId) as { id: string };
  const actions = db
    .prepare(
      `SELECT actor_id FROM actions WHERE turn_id = ? AND type = 'idle' ORDER BY rowid ASC`,
    )
    .all(turn.id) as { actor_id: string }[];
  expect(actions.map((a) => a.actor_id)).toEqual(["b", "a"]);
});
