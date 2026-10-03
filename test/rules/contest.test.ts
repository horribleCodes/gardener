import { expect, test } from "vitest";
import { featureRoll, resolveContest, resolveContestEdge, unevenBonus } from "../../src/rules/contest.js";
import { cultBudget, monthlyDominion } from "../../src/rules/cults.js";
import { mulberry32 } from "../../src/rules/dice.js";
import { RuleError } from "../../src/domain/types.js";

const none = resolveContestEdge(undefined, "edge");
const every = resolveContestEdge(
  { vast: true, superior: true, edged: true },
  "edge",
);

test("origin is the only automatic bonus", () => {
  expect(unevenBonus({ origin: "impossible", edge: none, opposingEdge: none })).toBe(2);
  expect(unevenBonus({ origin: "improbable", edge: none, opposingEdge: none })).toBe(1);
  expect(unevenBonus({ origin: "native", edge: none, opposingEdge: none })).toBe(0);
  expect(unevenBonus({ origin: "other", edge: none, opposingEdge: none })).toBe(0);
  expect(unevenBonus({ origin: "impossible", edge: every, opposingEdge: null })).toBe(0);
});

test("caller edges add scale, quality, and supernatural bonuses", () => {
  expect(unevenBonus({ origin: "impossible", edge: every, opposingEdge: none })).toBe(5);
  expect(
    unevenBonus({
      origin: "native",
      edge: resolveContestEdge({ vast: true, superior: true }, "edge"),
      opposingEdge: resolveContestEdge({ vast: true }, "edge"),
    }),
  ).toBe(1);
  const bothEdged = resolveContestEdge({ edged: true }, "edge");
  expect(unevenBonus({ origin: "native", edge: bothEdged, opposingEdge: bothEdged })).toBe(1);
});

test("a natural 1 zeros the bonus and a marginal roll keeps the lower die", () => {
  const lucky = featureRoll({
    rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 1,
  });
  expect(lucky.bonus).toBe(0);
  expect(lucky.total).toBe(1);
  const strong = featureRoll({
    rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 7,
  });
  expect(strong.total).toBe(12);
  const roll = featureRoll({
    rng: mulberry32(1), faces: 8, marginal: true, bonus: 0, forcedPair: [2, 8],
  });
  expect(roll.kept).toBe(2);
});

test("a non-boolean edge field is FILL_INCOMPLETE", () => {
  expect(() => resolveContestEdge({ vast: "yes" }, "attackerEdge")).toThrow(RuleError);
  try {
    resolveContestEdge({ vast: "yes" }, "attackerEdge");
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe("FILL_INCOMPLETE");
  }
  expect(() => resolveContestEdge("vast", "attackerEdge")).toThrow(RuleError);
});

test("ties go to higher power, then to the defender", () => {
  expect(resolveContest({
    attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 1,
  })).toBe("attacker");
  expect(resolveContest({
    attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 2,
  })).toBe("defender");
});

test("cult budgets and incomes", () => {
  expect(cultBudget("sharp", 6)).toBe(2);
  expect(cultBudget("grueling", 6)).toBe(3);
  expect(cultBudget("overwhelming", 6)).toBe(5);
  expect(monthlyDominion({ kind: "cult", power: 1, harshness: "nominal", level: 2 })).toBe(1);
  expect(monthlyDominion({ kind: "cult", power: 1, harshness: "sharp", level: 2 })).toBe(2);
  expect(monthlyDominion({ kind: "free", power: 1, harshness: "nominal", level: 2 })).toBe(1);
  expect(monthlyDominion({ kind: "free", power: 1, harshness: "nominal", level: 6 })).toBe(3);
  expect(monthlyDominion({ kind: "none", power: 1, harshness: "nominal", level: 9 })).toBe(0);
});
