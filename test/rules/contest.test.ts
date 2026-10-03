import { expect, test } from "vitest";
import { featureRoll, readGmBonus, resolveContest, unevenBonus } from "../../src/rules/contest.js";
import { cultBudget, monthlyDominion } from "../../src/rules/cults.js";
import { mulberry32 } from "../../src/rules/dice.js";
import { RuleError } from "../../src/domain/types.js";

test("origin is the only automatic bonus", () => {
  expect(unevenBonus({ origin: "impossible", gmBonus: 0, hasOpponent: true })).toBe(2);
  expect(unevenBonus({ origin: "improbable", gmBonus: 0, hasOpponent: true })).toBe(1);
  expect(unevenBonus({ origin: "native", gmBonus: 0, hasOpponent: true })).toBe(0);
  expect(unevenBonus({ origin: "other", gmBonus: 0, hasOpponent: true })).toBe(0);
  expect(unevenBonus({ origin: "impossible", gmBonus: 3, hasOpponent: false })).toBe(0);
});

test("a GM bonus from 0 to 3 stacks with origin when both sides have a feature", () => {
  expect(unevenBonus({ origin: "impossible", gmBonus: 3, hasOpponent: true })).toBe(5);
  expect(unevenBonus({ origin: "native", gmBonus: 2, hasOpponent: true })).toBe(2);
  expect(unevenBonus({ origin: "native", gmBonus: 0, hasOpponent: true })).toBe(0);
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

test("a GM bonus outside 0 to 3 is FILL_INCOMPLETE", () => {
  expect(readGmBonus(undefined, "attackerBonus")).toBe(0);
  expect(readGmBonus(null, "attackerBonus")).toBe(0);
  expect(readGmBonus(0, "attackerBonus")).toBe(0);
  expect(readGmBonus(3, "attackerBonus")).toBe(3);
  expect(() => readGmBonus(4, "attackerBonus")).toThrow(RuleError);
  try {
    readGmBonus({ vast: true }, "attackerBonus");
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe("FILL_INCOMPLETE");
  }
  expect(() => readGmBonus(1.5, "defenderBonus")).toThrow(RuleError);
  expect(() => readGmBonus(-1, "defenderBonus")).toThrow(RuleError);
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
