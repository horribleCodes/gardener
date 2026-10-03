import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { beginChange, commitResources } from "../../src/services/change.js";
import {
  createCampaign,
  createHero,
  createPlace,
  ensureSetpiece,
  removeCampaign,
  seedCampaign,
} from "../../src/services/populate.js";
import { openParallelTurn } from "../../src/services/queue.js";
import { openDb } from "../../src/store/db.js";

function openTemp() {
  const dir = mkdtempSync(join(tmpdir(), "gdnr-rm-camp-"));
  const path = join(dir, "c.sqlite");
  const db = openDb(path);
  return { dir, path, db };
}

function countByCampaign(db: ReturnType<typeof openDb>, campaignId: string): number {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  let total = 0;
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "campaign_id") && name !== "campaigns") continue;
    const column = name === "campaigns" ? "id" : "campaign_id";
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${column} = ?`).get(campaignId) as {
      n: number;
    };
    total += row.n;
  }
  return total;
}

function leftoverChildren(db: ReturnType<typeof openDb>, campaignId: string): number {
  const one = (sql: string) => (db.prepare(sql).get(campaignId) as { n: number }).n;
  const two = (sql: string) => (db.prepare(sql).get(campaignId, campaignId) as { n: number }).n;
  return (
    one(
      `SELECT COUNT(*) AS n FROM feature_parts WHERE feature_id IN (
         SELECT f.id FROM features f JOIN factions fa ON fa.id = f.faction_id WHERE fa.campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM problems WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    ) +
    two(
      `SELECT COUNT(*) AS n FROM interests WHERE from_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)
         OR to_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM features WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM wards WHERE place_id IN (SELECT id FROM places WHERE campaign_id = ?)`,
    ) +
    two(
      `SELECT COUNT(*) AS n FROM court_memberships WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)
         OR character_id IN (SELECT id FROM characters WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM conflicts WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM court_consequences WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM court_dispositions WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM court_defenses WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM unit_views WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM actions WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
    ) +
    two(
      `SELECT COUNT(*) AS n FROM change_commitments WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)
         OR hero_id IN (SELECT id FROM heroes WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM resisters WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)`,
    )
  );
}

test("removeCampaign refuses an unknown campaign and writes nothing", () => {
  const { dir, db } = openTemp();
  try {
    const created = createCampaign(db, { name: "Keep" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number };
    const result = removeCampaign(db, { campaignId: "missing-id" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CAMPAIGN_NOT_FOUND");
    expect(result.error.message).toMatch(/missing-id/);
    const after = db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number };
    expect(after.n).toBe(before.n);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeCampaign deletes an empty campaign row", () => {
  const { dir, db } = openTemp();
  try {
    const created = createCampaign(db, { name: "Gone" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.campaignId;
    const result = removeCampaign(db, { campaignId: id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.campaignId).toBe(id);
    expect(countByCampaign(db, id)).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeCampaign deletes associated graph and leaves another campaign", () => {
  const { dir, path, db } = openTemp();
  try {
    const keep = createCampaign(db, { name: "Keep" });
    expect(keep.ok).toBe(true);
    if (!keep.ok) return;
    const keepId = keep.data.campaignId;
    const keepPlace = createPlace(db, {
      campaignId: keepId,
      name: "Keepville",
      scope: "village",
    });
    expect(keepPlace.ok).toBe(true);

    const seeded = seedCampaign(db, {
      name: "Drop",
      seed: 7,
      fill: "missing",
      linkInterests: true,
      rulingCourts: true,
      outline: {
        places: [
          { key: "p1", name: "Hill", scope: "village" },
          { key: "p2", name: "Ford", scope: "village" },
        ],
        factions: [
          { key: "a", name: "A", homePlaceKey: "p1", power: 1, neighborKeys: ["b"] },
          { key: "b", name: "B", homePlaceKey: "p2", power: 1, neighborKeys: ["a"] },
        ],
      },
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const dropId = seeded.data.campaignId;

    const place = db
      .prepare("SELECT id FROM places WHERE campaign_id = ? LIMIT 1")
      .get(dropId) as { id: string };
    db.prepare("INSERT INTO wards (id, place_id, rating) VALUES ('w1', ?, 4)").run(place.id);

    const hero = createHero(db, { campaignId: dropId, name: "Pat", level: 1 });
    expect(hero.ok).toBe(true);
    if (!hero.ok) return;

    const change = beginChange(db, {
      campaignId: dropId,
      owner: "pc",
      scope: "village",
      magnitude: "plausible",
      kind: "fact",
      placeIds: [place.id],
      resisters: [{ rating: 2, label: "priest" }],
    });
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const committed = commitResources(db, {
      changeId: change.data.changeId,
      heroId: hero.data.heroId,
      influence: 1,
    });
    expect(committed.ok).toBe(true);

    const setpiece = ensureSetpiece(db, {
      campaignId: dropId,
      key: "hook-1",
      need: "challenge",
      seed: 3,
    });
    expect(setpiece.ok).toBe(true);

    const faction = db
      .prepare("SELECT id FROM factions WHERE campaign_id = ? LIMIT 1")
      .get(dropId) as { id: string };
    const opened = openParallelTurn(db, path, { campaignId: dropId, unitIds: [faction.id] });
    expect(opened.ok).toBe(true);

    const keepBefore = countByCampaign(db, keepId);
    expect(countByCampaign(db, dropId)).toBeGreaterThan(1);

    const result = removeCampaign(db, { campaignId: dropId });
    expect(result.ok).toBe(true);
    expect(countByCampaign(db, dropId)).toBe(0);
    expect(leftoverChildren(db, dropId)).toBe(0);
    expect(countByCampaign(db, keepId)).toBe(keepBefore);
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    expect(fk).toEqual([]);

    const again = removeCampaign(db, { campaignId: dropId });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe("CAMPAIGN_NOT_FOUND");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
