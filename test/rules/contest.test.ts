import { expect, test } from "vitest";
import { featureRoll, resolveContest, unevenBonus } from "../../src/rules/contest.js";
import { cultBudget, monthlyDominion } from "../../src/rules/cults.js";
import { mulberry32 } from "../../src/rules/dice.js";
import type { FeatureTags } from "../../src/domain/types.js";

const rifle: FeatureTags = {
  size: "vast", quality: "superior", magical: true, origin: "impossible", domain: "military",
};
const militia: FeatureTags = {
  size: "normal", quality: "normal", magical: false, origin: "native", domain: "military",
};

test("enchanted flying riflemen are worth +5 and a natural 1 takes none of it", () => {
  expect(unevenBonus(rifle, militia)).toBe(5);
  const lucky = featureRoll({ rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 1 });
  expect(lucky.bonus).toBe(0);
  expect(lucky.total).toBe(1);
  const strong = featureRoll({ rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 7 });
  expect(strong.total).toBe(12);
});

test("marginal rolls keep the lower die", () => {
  const roll = featureRoll({
    rng: mulberry32(1), faces: 8, marginal: true, bonus: 0, forcedPair: [2, 8],
  });
  expect(roll.kept).toBe(2);
});

test("ties go to higher power, then to the defender", () => {
  expect(resolveContest({ attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 1 })).toBe("attacker");
  expect(resolveContest({ attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 2 })).toBe("defender");
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
