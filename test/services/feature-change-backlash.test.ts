import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { applyOutcome, beginChange, commitResources } from "../../src/services/change.js";
import { loadCatalog } from "../../src/tables/catalog.js";

const FEATURE = "The village has a band of trained warriors.";
const BACKLASH = "The warriors demand pay.";

function world(): Database.Database {
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
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sword", "c1", "Sword", 3, "[]", 2, 0, 0, "free");
  return db;
}

function counts(db: Database.Database, factionId: string): { features: number; problems: number } {
  const features = db
    .prepare("SELECT COUNT(*) AS c FROM features WHERE faction_id = ?")
    .get(factionId) as { c: number };
  const problems = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get(factionId) as { c: number };
  return { features: features.c, problems: problems.c };
}

function landFeature(db: Database.Database): string {
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: FEATURE,
    heroId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) throw new Error("begin");
  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    heroId: "sword",
    influence: 1,
    backlash: BACKLASH,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) throw new Error("commit");
  expect(committed.data.status).toBe("active");
  return begun.data.changeId;
}

test("landed feature change keeps one backlash when apply_outcome names that change", () => {
  const db = world();
  const changeId = landFeature(db);
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
  const problem = db.prepare("SELECT text FROM problems WHERE faction_id = ?").get("village") as {
    text: string;
  };
  expect(problem.text).toBe(BACKLASH);

  const again = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
  });
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.data).toEqual({ status: "active", covered: 1 });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });

  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId,
    addFeatureText: FEATURE,
    backlash: "A second problem",
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  const row = db
    .prepare("SELECT feature_id, backlash_problem_id FROM changes WHERE id = ?")
    .get(changeId) as { feature_id: string; backlash_problem_id: string };
  expect(outcome.error).toEqual({
    code: "CHANGE_ALREADY_LANDED",
    message: "feature change already landed",
    details: { featureId: row.feature_id, backlashProblemId: row.backlash_problem_id },
  });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
  const texts = db.prepare("SELECT text FROM problems WHERE faction_id = ?").all("village") as {
    text: string;
  }[];
  expect(texts).toEqual([{ text: BACKLASH }]);
});

test("apply_outcome does not land a feature change whose deeds are still open", () => {
  const db = world();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: FEATURE,
    heroId: "sword",
    deedsRequired: 1,
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;
  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    heroId: "sword",
    influence: 1,
    backlash: BACKLASH,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data).toEqual({ status: "pending", covered: 1 });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });

  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId: begun.data.changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "CHANGE_NOT_READY",
    message: "feature change lands in commit_resources",
    details: { changeId: begun.data.changeId },
  });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });
});

test("apply_outcome does not add a feature for a change that is not a feature change", () => {
  const db = world();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "fact",
    heroId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId: begun.data.changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "CHANGE_NOT_READY",
    message: "change is not a feature change",
    details: { changeId: begun.data.changeId },
  });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });
});

test("apply_outcome changeId on another faction inserts nothing", () => {
  const db = world();
  const changeId = landFeature(db);
  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "neighbor",
    changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "ENTITY_NOT_FOUND",
    message: `change ${changeId} not found`,
    details: {},
  });
  expect(counts(db, "neighbor")).toEqual({ features: 0, problems: 0 });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
});

test("apply_outcome changeId from another campaign inserts nothing", () => {
  const db = world();
  const changeId = landFeature(db);
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 7, 0)",
  ).run("c2", "Other");
  const outcome = applyOutcome(db, {
    campaignId: "c2",
    factionId: "village",
    changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "ENTITY_NOT_FOUND",
    message: `change ${changeId} not found`,
    details: {},
  });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
});

test("apply_outcome unknown changeId inserts nothing", () => {
  const db = world();
  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId: "missing",
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "ENTITY_NOT_FOUND",
    message: "change missing not found",
    details: {},
  });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });
});

test("addFeatureText without changeId still inserts one backlash", () => {
  const db = world();
  const backlashText = loadCatalog().backlash[0];
  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    addFeatureText: "A shrine to the sword.",
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
  const problem = db.prepare("SELECT text FROM problems WHERE faction_id = ?").get("village") as {
    text: string;
  };
  expect(problem.text).toBe(backlashText);
});

test("removeFeatureId ignores changeId and does not insert addFeatureText", () => {
  const db = world();
  const changeId = landFeature(db);
  const shrine = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    addFeatureText: "A shrine to the sword.",
  });
  expect(shrine.ok).toBe(true);
  if (!shrine.ok) return;
  const shrineId = shrine.data.featureId as string;

  const removed = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    removeFeatureId: shrineId,
    changeId,
    addFeatureText: "This text must not become a feature.",
  });
  expect(removed.ok).toBe(true);
  if (!removed.ok) return;
  expect(removed.data).toEqual({ removedFeatureId: shrineId });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 2 });
  const feature = db.prepare("SELECT text FROM features WHERE faction_id = ?").get("village") as {
    text: string;
  };
  expect(feature.text).toBe(FEATURE);
});
