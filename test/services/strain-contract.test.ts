import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RuleError } from "../../src/domain/types.js";
import { runAction } from "../../src/services/actions.js";
import { ensureSetpiece, recordChallengeOutcome } from "../../src/services/populate.js";
import { factionActionFromUnitPlan, parseUnitPlan } from "../../src/services/unitPlan.js";
import { listHooks } from "../../src/services/turn.js";
import { openDb } from "../../src/store/db.js";
import { loadCatalog } from "../../src/tables/catalog.js";

function campaignDb() {
  const dir = mkdtempSync(join(tmpdir(), "gb-strain-"));
  const db = openDb(join(dir, "c.sqlite"));
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Strain', 1, 1, 0)",
  ).run();
  return { dir, db };
}

test("ensure_setpiece rolls a challenge and points at it, including a free-floating card", () => {
  const { dir, db } = campaignDb();
  try {
    const texts = new Set<string>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const created = ensureSetpiece(db, {
        campaignId: "c1",
        key: `hook-${seed}`,
        need: "challenge",
        seed,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const row = db
        .prepare(
          `SELECT s.challenge_id, c.kind, c.text, c.change_id, c.campaign_id
           FROM setpieces s JOIN challenges c ON c.id = s.challenge_id
           WHERE s.id = ?`,
        )
        .get(created.data.setpieceId) as {
        challenge_id: string;
        kind: string;
        text: string;
        change_id: string | null;
        campaign_id: string;
      };
      expect(row.change_id).toBeNull();
      expect(row.campaign_id).toBe("c1");
      texts.add(row.text);
      kinds.add(row.kind);
      const again = ensureSetpiece(db, {
        campaignId: "c1",
        key: `hook-${seed}`,
        need: "challenge",
        seed: seed + 100,
      });
      expect(again.ok && again.data.created).toBe(false);
    }
    expect(texts.size).toBeGreaterThan(1);
    expect(kinds.size).toBeGreaterThan(1);
    const firstKind = Object.keys(loadCatalog().challenges)[0];
    const firstText = loadCatalog().challenges[firstKind][0];
    expect([...texts].every((text) => text === firstText)).toBe(false);

    const hooks = listHooks(db, "c1");
    expect(hooks.ok).toBe(true);
    if (!hooks.ok) return;
    const listed = (hooks.data as { challenges: { change_id: string | null }[] }).challenges;
    expect(listed.length).toBe(12);
    expect(listed.every((card) => card.change_id === null)).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a challenge attached to a change still points both ways, and a free card can be overcome alone", () => {
  const { dir, db } = campaignDb();
  try {
    db.prepare(
      `INSERT INTO changes (id, campaign_id, scope, magnitude, kind, owner, status, challenges_required)
       VALUES ('chg', 'c1', 'village', 'plausible', 'other', 'pc', 'active', 1)`,
    ).run();
    const attached = ensureSetpiece(db, {
      campaignId: "c1",
      key: "on-change",
      need: "challenge",
      changeId: "chg",
      seed: 2,
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    const linked = db
      .prepare(
        `SELECT c.change_id FROM setpieces s JOIN challenges c ON c.id = s.challenge_id WHERE s.id = ?`,
      )
      .get(attached.data.setpieceId) as { change_id: string };
    expect(linked.change_id).toBe("chg");

    const floating = ensureSetpiece(db, {
      campaignId: "c1",
      key: "loose",
      need: "challenge",
      seed: 3,
    });
    expect(floating.ok).toBe(true);
    if (!floating.ok) return;
    const card = db
      .prepare("SELECT challenge_id FROM setpieces WHERE id = ?")
      .get(floating.data.setpieceId) as { challenge_id: string };
    const outcome = recordChallengeOutcome(db, { challengeId: card.challenge_id, overcome: true });
    expect(outcome.ok).toBe(true);
    const status = db.prepare("SELECT status FROM challenges WHERE id = ?").get(card.challenge_id) as {
      status: string;
    };
    expect(status.status).toBe("overcome");
    const change = db.prepare("SELECT challenges_done FROM changes WHERE id = 'chg'").get() as {
      challenges_done: number;
    };
    expect(change.challenges_done).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a court setpiece stores the court it created", () => {
  const { dir, db } = campaignDb();
  try {
    const created = ensureSetpiece(db, {
      campaignId: "c1",
      key: "gate-court",
      need: "court",
      seed: 4,
      fill: "blank",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = db
      .prepare("SELECT court_id FROM setpieces WHERE id = ?")
      .get(created.data.setpieceId) as { court_id: string | null };
    expect(row.court_id).toBeTruthy();
    const court = db.prepare("SELECT id FROM courts WHERE id = ?").get(row.court_id);
    expect(court).toBeTruthy();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a willing remove-interest plan skips the roll and drops a point", () => {
  const { dir, db } = campaignDb();
  try {
    expect(() =>
      parseUnitPlan({ type: "attack", targetFactionId: "def", attackerFeatureId: "f", willing: true }),
    ).toThrow(RuleError);
    const plan = parseUnitPlan({
      type: "remove_interest",
      targetFactionId: "def",
      willing: true,
    });
    expect(plan).toMatchObject({ type: "remove_interest", willing: true });

    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES ('atk', 'c1', 'Atk', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active'),
              ('def', 'c1', 'Def', 5, 5, 0, 'existing', 'directed', 'npc', 0, 'active')`,
    ).run();
    db.prepare(
      "INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature) VALUES ('i1', 'atk', 'def', 2, 'rivalry')",
    ).run();
    const action = factionActionFromUnitPlan(plan);
    const result = runAction(db, { campaignId: "c1", factionId: "atk", ...action });
    expect(result.ok).toBe(true);
    const edge = db
      .prepare("SELECT points FROM interests WHERE from_faction_id = 'atk' AND to_faction_id = 'def'")
      .get() as { points: number };
    expect(edge.points).toBe(1);
    const roll = db.prepare("SELECT payload FROM rolls").get() as { payload: string };
    expect(JSON.parse(roll.payload).willing).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
