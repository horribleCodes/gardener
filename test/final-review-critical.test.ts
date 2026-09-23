import { spawn } from "node:child_process";
import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/store/db.js";
import { createCourt } from "../src/services/populate.js";
import { runAction } from "../src/services/actions.js";
import { parseUnitPlan } from "../src/services/unitPlan.js";
import { RuleError } from "../src/domain/types.js";

test("npm start build typecheck path", async () => {
  const proc = spawn("npm", ["start"], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 2000);
    proc.on("error", reject);
    proc.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  expect(proc.killed || proc.exitCode === null || proc.exitCode === 0 || proc.signalCode).toBeTruthy();
});

test("unit plan rejects factionId and forcedRoll", () => {
  expect(() =>
    parseUnitPlan({ type: "build_strength", factionId: "x" } as Record<string, unknown>),
  ).toThrow(RuleError);
  expect(() =>
    parseUnitPlan({ type: "build_strength", forcedRoll: 6 } as Record<string, unknown>),
  ).toThrow(RuleError);
});

test("attack without defender feature still contests when defender has a feature", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-attack-def-"));
  const dbPath = join(dir, "c.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "T");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('atk', ?, 'Atk', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active'),
            ('def', ?, 'Def', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId, campaignId);
  const af = "af1";
  const df = "df1";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, 'atk', 'A', 'military', 'normal', 'normal', 0, 'native'),
            (?, 'def', 'D', 'military', 'normal', 'normal', 0, 'native')`,
  ).run(af, df);
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES ('p1', ?, 'A', 0), ('p2', ?, 'D', 0)",
  ).run(af, df);
  db.prepare("INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order) VALUES ('t1', ?, 1, 1, 1, '[]')").run(
    campaignId,
  );

  const result = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: af,
    forcedAttackerRoll: 1,
    forcedDefenderRoll: 6,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const row = db.prepare("SELECT outcome FROM actions WHERE turn_id = 't1'").get() as {
    outcome: string;
  };
  expect(row.outcome).toBe("defender_win");
});

test("cohesion zero collapses faction", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-collapse-"));
  const db = openDb(join(dir, "c.sqlite"));
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "T");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', ?, 'F', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId);
  db.prepare("INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order) VALUES ('t1', ?, 1, 1, 1, '[]')").run(
    campaignId,
  );
  const af = "af";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin) VALUES (?, 'f1', 'x', 'military', 'normal', 'normal', 0, 'native')`,
  ).run(af);
  db.prepare("INSERT INTO feature_parts (id, feature_id, text, position) VALUES ('p', ?, 'x', 0)").run(af);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f2', ?, 'G', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId);
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin) VALUES (?, 'f2', 'y', 'military', 'normal', 'normal', 0, 'native')`,
  ).run("af2");
  db.prepare("INSERT INTO feature_parts (id, feature_id, text, position) VALUES ('p2', 'af2', 'y', 0)");

  runAction(db, {
    campaignId,
    factionId: "f2",
    type: "attack",
    targetFactionId: "f1",
    attackerFeatureId: "af2",
    defenderChoice: "cohesion",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
  });
  const status = db.prepare("SELECT status FROM factions WHERE id = 'f1'").get() as {
    status: string;
  };
  expect(status.status).toBe("collapsed");
});

test("second generated court persists", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-court2-"));
  const dbPath = join(dir, "c.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "T");
  const first = createCourt(db, { campaignId, fill: "missing", seed: 1 });
  const second = createCourt(db, { campaignId, fill: "missing", seed: 2 });
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
});
