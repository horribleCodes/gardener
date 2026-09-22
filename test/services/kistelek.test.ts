import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { applyOutcome, beginChange, commitResources } from "../../src/services/change.js";
import { runAction } from "../../src/services/actions.js";
import { loadCatalog } from "../../src/tables/catalog.js";

function createKistelekDb(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("village", "c1", "Village", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");

  const problemRows = [
    { id: "raid", text: "Raiding bandits", points: 1, position: 0 },
    { id: "tax", text: "Crushing taxes", points: 1, position: 1 },
    { id: "despair", text: "Village despair", points: 2, position: 2 },
  ];
  for (const p of problemRows) {
    db.prepare(
      `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
       VALUES (?, ?, ?, ?, 'cultural', 0, 0, 0, ?)`,
    ).run(p.id, "village", p.text, p.points, p.position);
  }

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("neighbor", "c1", "Neighbor City", 2, 2, 0, "native", "martial_conqueror", "npc", 0, "active");

  const featureId = "mil-feature";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(featureId, "neighbor", "Standing army", "military", "normal", "normal", 0, "native");
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("mil-part", featureId, "Standing army", 0);

  db.prepare(
    `INSERT INTO godbound (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sword", "c1", "Sword", 3, "[]", 2, 0, 0, "free");

  return db;
}

test("a forced trouble roll of 4 blames despair and gains no dominion", () => {
  const db = createKistelekDb();
  const result = runAction(db, {
    campaignId: "c1",
    factionId: "village",
    type: "build_strength",
    forcedRoll: 4,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.success).toBe(false);
    expect(result.data.culpritId).toBe("despair");
  }
  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("village") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(0);
});

test("pc feature creation adds one backlash problem and not a trouble check", () => {
  const db = createKistelekDb();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: "The village has a band of trained warriors.",
    godboundId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;
  expect(begun.data.quote.total).toBe(1);

  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    godboundId: "sword",
    influence: 1,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.status).toBe("active");

  const trouble = db
    .prepare("SELECT COALESCE(SUM(points), 0) AS t FROM problems WHERE faction_id = ?")
    .get("village") as { t: number };
  expect(trouble.t).toBe(5);
  expect(loadCatalog().backlash[0]).toBeTruthy();
});

test("attack win without problemId adds catalog military problem text", () => {
  const db = createKistelekDb();
  const militaryText = loadCatalog().problems.military[0];
  const before = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get("village") as { c: number };

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "neighbor",
    type: "attack",
    targetFactionId: "village",
    attackerFeatureId: "mil-feature",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.success).toBe(true);

  const added = db
    .prepare(
      "SELECT text, domain FROM problems WHERE faction_id = ? ORDER BY position DESC LIMIT 1",
    )
    .get("village") as { text: string; domain: string };
  const after = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get("village") as { c: number };
  expect(after.c).toBe(before.c + 1);
  expect(added.text).toBe(militaryText);
  expect(added.domain).toBe("military");
});

test("commitResources rejects feature activation without featureText or draft", () => {
  const db = createKistelekDb();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    godboundId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    godboundId: "sword",
    influence: 1,
  });
  expect(committed.ok).toBe(false);
  if (committed.ok) return;
  expect(committed.error.code).toBe("FILL_INCOMPLETE");
});

test("enact_change failure increments only the acting faction culprit problem", () => {
  const db = createKistelekDb();
  db.prepare("UPDATE factions SET dominion = 1 WHERE id = ?").run("village");
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 0, 0, 0, ?)`,
  ).run("neighbor-problem", "neighbor", "Neighbor woes", 2, 0);
  const neighborBefore = db
    .prepare("SELECT points FROM problems WHERE id = ?")
    .get("neighbor-problem") as { points: number };

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "village",
    type: "enact_change",
    magnitude: "plausible",
    forcedRoll: 4,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.success).toBe(false);

  const despair = db.prepare("SELECT points FROM problems WHERE id = ?").get("despair") as {
    points: number;
  };
  expect(despair.points).toBe(3);
  const neighborAfter = db
    .prepare("SELECT points FROM problems WHERE id = ?")
    .get("neighbor-problem") as { points: number };
  expect(neighborAfter.points).toBe(neighborBefore.points);
});

test("applyOutcome rejects removing another faction's feature", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("village", "c1", "Village", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("neighbor", "c1", "Neighbor City", 2, 2, 0, "native", "martial_conqueror", "npc", 0, "active");
  const featureId = "mil-feature";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(featureId, "neighbor", "Standing army", "military", "normal", "normal", 0, "native");
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("mil-part", featureId, "Standing army", 0);

  const result = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    removeFeatureId: featureId,
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("ENTITY_NOT_FOUND");

  const feature = db.prepare("SELECT id FROM features WHERE id = ?").get(featureId);
  expect(feature).toBeTruthy();
  const part = db.prepare("SELECT id FROM feature_parts WHERE id = ?").get("mil-part");
  expect(part).toBeTruthy();
});

test("applyOutcome rejects reducing an intrinsic problem", () => {
  const db = createKistelekDb();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, ?)`,
  ).run("core-wound", "village", "Core wound", 1, 3);

  const result = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    reduceProblemId: "core-wound",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("INTRINSIC_PROBLEM");
});

test("applyOutcome addFeatureText inserts catalog backlash problem", () => {
  const db = createKistelekDb();
  const backlashText = loadCatalog().backlash[0];
  const before = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get("village") as { c: number };

  const result = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    addFeatureText: "A shrine to the sword.",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const backlashRows = db
    .prepare("SELECT text FROM problems WHERE faction_id = ? ORDER BY position DESC LIMIT 1")
    .all("village") as { text: string }[];
  const after = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get("village") as { c: number };
  expect(after.c).toBe(before.c + 1);
  expect(backlashRows).toHaveLength(1);
  expect(backlashRows[0].text).toBe(backlashText);
});

test("attack against player defender without choice stays pending and spares cohesion", () => {
  const db = createKistelekDb();
  db.prepare("UPDATE factions SET control = 'player' WHERE id = ?").run("village");
  const cohesionBefore = db
    .prepare("SELECT cohesion FROM factions WHERE id = ?")
    .get("village") as { cohesion: number };

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "neighbor",
    type: "attack",
    targetFactionId: "village",
    attackerFeatureId: "mil-feature",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.pending).toBe(true);
  expect(result.data.code).toBe("PENDING_DEFENDER_CHOICE");

  const cohesionAfter = db
    .prepare("SELECT cohesion FROM factions WHERE id = ?")
    .get("village") as { cohesion: number };
  expect(cohesionAfter.cohesion).toBe(cohesionBefore.cohesion);
});

test("contested attack win adds catalog military problem text", () => {
  const db = createKistelekDb();
  const militaryText = loadCatalog().problems.military[0];
  db.prepare("UPDATE problems SET points = 1 WHERE id = ?").run("despair");
  const defenderFeatureId = "village-mil";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(defenderFeatureId, "village", "Militia", "military", "normal", "normal", 0, "native");
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("village-mil-part", defenderFeatureId, "Militia", 0);

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "neighbor",
    type: "attack",
    targetFactionId: "village",
    attackerFeatureId: "mil-feature",
    defenderFeatureId,
    forcedAttackerRoll: 8,
    forcedDefenderRoll: 1,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.success).toBe(true);

  const added = db
    .prepare(
      "SELECT text FROM problems WHERE faction_id = ? ORDER BY position DESC LIMIT 1",
    )
    .get("village") as { text: string };
  expect(added.text).toBe(militaryText);
});

function createPower1FactionDb(dominion: number): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("f1", "c1", "Faction", 1, 1, dominion, "native", "self_absorbed_survivor", "npc", 0, "active");
  return db;
}

test("enact_change solveProblemId rejects intrinsic problem before spending dominion", () => {
  const db = createPower1FactionDb(2);
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, ?)`,
  ).run("holy-law", "f1", "Holy law", 1, 0);

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "f1",
    type: "enact_change",
    magnitude: "plausible",
    solveProblemId: "holy-law",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("INTRINSIC_PROBLEM");

  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("f1") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(2);
});

test("enact_change solveProblemId missing id when only intrinsic problems refuses NOTHING_TO_SOLVE", () => {
  const db = createPower1FactionDb(2);
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, ?)`,
  ).run("holy-law", "f1", "Holy law", 1, 0);

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "f1",
    type: "enact_change",
    magnitude: "plausible",
    solveProblemId: "missing",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("NOTHING_TO_SOLVE");

  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("f1") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(2);
});

test("enact_change solveProblemId with no problems refuses before spending dominion", () => {
  const db = createPower1FactionDb(2);

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "f1",
    type: "enact_change",
    magnitude: "plausible",
    solveProblemId: "missing",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("NOTHING_TO_SOLVE");

  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("f1") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(2);
});

test("enact_change solveProblemId with zero dominion still returns NOTHING_TO_SOLVE not insufficient dominion", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("f1", "c1", "Faction", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "f1",
    type: "enact_change",
    magnitude: "plausible",
    solveProblemId: "missing",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("NOTHING_TO_SOLVE");

  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("f1") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(0);
});

test("attack against a faction in another campaign is ENTITY_NOT_FOUND before any roll", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("cA", "Campaign A");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 99, 0)",
  ).run("cB", "Campaign B");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("attacker", "cA", "Attacker", 2, 2, 0, "native", "martial_conqueror", "npc", 0, "active");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("defender", "cB", "Defender", 1, 2, 0, "native", "self_absorbed_survivor", "npc", 0, "active");
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 0, 0, 0, ?)`,
  ).run("def-problem", "defender", "Woes", 1, 0);
  const attackerFeatureId = "atk-feature";
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(attackerFeatureId, "attacker", "Army", "military", "normal", "normal", 0, "native");
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, ?)",
  ).run("atk-part", attackerFeatureId, "Army", 0);

  const cohesionBefore = db
    .prepare("SELECT cohesion FROM factions WHERE id = ?")
    .get("defender") as { cohesion: number };
  const problemPointsBefore = db
    .prepare("SELECT points FROM problems WHERE id = ?")
    .get("def-problem") as { points: number };

  const result = runAction(db, {
    campaignId: "cA",
    factionId: "attacker",
    type: "attack",
    targetFactionId: "defender",
    attackerFeatureId,
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("ENTITY_NOT_FOUND");

  const cohesionAfter = db
    .prepare("SELECT cohesion FROM factions WHERE id = ?")
    .get("defender") as { cohesion: number };
  const problemPointsAfter = db
    .prepare("SELECT points FROM problems WHERE id = ?")
    .get("def-problem") as { points: number };
  expect(cohesionAfter.cohesion).toBe(cohesionBefore.cohesion);
  expect(problemPointsAfter.points).toBe(problemPointsBefore.points);
});

test("enact_change solveProblemId success reduces named non-intrinsic problem", () => {
  const db = createPower1FactionDb(2);
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 0, 0, 0, ?)`,
  ).run("woes", "f1", "Local woes", 2, 0);

  const result = runAction(db, {
    campaignId: "c1",
    factionId: "f1",
    type: "enact_change",
    magnitude: "plausible",
    solveProblemId: "woes",
    forcedRoll: 1,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.success).toBe(true);

  const problem = db.prepare("SELECT points FROM problems WHERE id = ?").get("woes") as {
    points: number;
  };
  expect(problem.points).toBe(1);
  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("f1") as {
    dominion: number;
  };
  expect(faction.dominion).toBe(1);
});
