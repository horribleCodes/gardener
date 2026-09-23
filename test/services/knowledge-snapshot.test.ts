import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { getUnitView, openParallelTurn } from "../../src/services/queue.js";

test("frozen snapshot respects local fact place_id via loadCampaignWorld", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-local-fact-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "Local facts");
  db.prepare(
    `INSERT INTO places (id, campaign_id, name, scope, parent_place_id)
     VALUES ('p', ?, 'Home', 'village', NULL), ('far', ?, 'Far', 'city', NULL)`,
  ).run(campaignId, campaignId);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status, home_place_id)
     VALUES ('us', ?, 'Us', 1, 1, 0, 'existing', 'directed', 'player', 0, 'active', 'p'),
            ('them', ?, 'Them', 2, 2, 0, 'existing', 'martial_conqueror', 'npc', 0, 'active', 'far')`,
  ).run(campaignId, campaignId);
  db.prepare(
    `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility, place_id)
     VALUES ('lf-home', ?, 'place', 'p', 'Village gossip', 'explicit', 'local', 'p'),
            ('lf-far', ?, 'place', 'far', 'Distant secret', 'explicit', 'local', 'far')`,
  ).run(campaignId, campaignId);
  db.close();

  const open = openDb(dbPath);
  openParallelTurn(open, dbPath, { campaignId, unitIds: ["us"] });
  open.close();

  const read = openDb(dbPath);
  const view = getUnitView(read, { campaignId, unitType: "faction", unitId: "us" });
  read.close();
  expect(view.ok).toBe(true);
  if (!view.ok) return;
  const facts = view.data as { known: { facts: { id: string }[] } };
  const ids = facts.known.facts.map((f) => f.id);
  expect(ids).toContain("lf-home");
  expect(ids).not.toContain("lf-far");
});
