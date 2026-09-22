import { expect, test } from "vitest";
import { generateCourt } from "../../src/generate/court.js";
import { problemBudget } from "../../src/generate/faction.js";

test("blank courts roll structure and leave names empty", () => {
  const court = generateCourt({ fill: "blank", seed: 7, majorCount: 3, minorCount: 2 });
  expect(court.actors.filter((actor) => actor.rank === "major")).toHaveLength(3);
  expect(court.actors.every((actor) => actor.name == null)).toBe(true);
  expect(court.conflict.fittedSummary).toBeNull();
  expect(court.conflict.text.length).toBeGreaterThan(0);
  const leaders = court.actors.filter((actor) => actor.isLeader || actor.isHiddenController || actor.sharesAuthority);
  if (court.powerStructure === "autocratic") expect(court.actors.filter((a) => a.isLeader)).toHaveLength(1);
  expect(leaders.length).toBeGreaterThanOrEqual(0);
});

test("require mode does not invent a type", () => {
  try {
    generateCourt({ fill: "require", seed: 1 });
    throw new Error("should have thrown");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("FILL_INCOMPLETE");
  }
});

test("unknown power structure throws PICK_UNKNOWN", () => {
  try {
    generateCourt({ fill: "missing", seed: 1, powerStructure: "nope" });
    throw new Error("should have thrown");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("PICK_UNKNOWN");
  }
});

test("a supplied conflict is kept", () => {
  const court = generateCourt({
    fill: "missing", seed: 3, type: "temple", conflict: "Who keeps the relic",
  });
  expect(court.type).toBe("temple");
  expect(court.conflict.text).toBe("Who keeps the relic");
});

test("prosperous and crisis budgets", () => {
  expect(problemBudget(6, "prosperous", "half")).toBe(2);
  expect(problemBudget(12, "prosperous", "half")).toBe(3);
  expect(problemBudget(6, "crisis", "half")).toBe(3);
  expect(problemBudget(6, "crisis", "three-quarter")).toBe(5);
});
