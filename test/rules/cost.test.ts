import { expect, test } from "vitest";
import { championStats, factionProjectCost, quoteChange, restoreCohesionCost } from "../../src/rules/cost.js";
import { influenceFromWealth } from "../../src/rules/wealth.js";

test("improbable city with ward 4 costs 12", () => {
  const quote = quoteChange({
    scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [],
  });
  expect(quote.base).toBe(6);
  expect(quote.total).toBe(12);
});

test("city ward 4 plus a rating-6 resister has base 12", () => {
  const quote = quoteChange({
    scope: "city", magnitude: "plausible", wardRatings: [4], resisterRatings: [6],
  });
  expect(quote.base).toBe(12);
  expect(quote.total).toBe(12);
  const hard = quoteChange({
    scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [6],
  });
  expect(hard.total).toBe(24);
});

test("only the highest ward applies, and extra resisters add 1", () => {
  const wards = quoteChange({
    scope: "village", magnitude: "plausible", wardRatings: [3, 10], resisterRatings: [],
  });
  expect(wards.ward).toBe(10);
  expect(wards.total).toBe(11);
  const resisted = quoteChange({
    scope: "village", magnitude: "plausible", wardRatings: [], resisterRatings: [8, 4],
  });
  expect(resisted.opposition).toBe(9);
  expect(resisted.total).toBe(10);
});

test("faction projects ignore wards; restore cohesion is scope times 2", () => {
  expect(factionProjectCost(1, "plausible")).toBe(1);
  expect(factionProjectCost(5, "improbable")).toBe(32);
  expect(restoreCohesionCost(1)).toBe(2);
  expect(restoreCohesionCost(5)).toBe(32);
});

test("wealth pools before it becomes influence", () => {
  expect(influenceFromWealth(6)).toEqual({ influence: 3, wealthUsed: 6 });
  expect(influenceFromWealth(3)).toEqual({ influence: 2, wealthUsed: 3 });
  expect(influenceFromWealth(3, 2)).toEqual({ influence: 2, wealthUsed: 3 });
});

test("a loyal champion uses half the creator level, rounded up, and always costs 8", () => {
  expect(championStats(5, false).hitDice).toBe(15);
  expect(championStats(5, true).effectiveLevel).toBe(3);
  expect(championStats(5, true).hitDice).toBe(11);
  expect(championStats(1, false).attacks).toBe(1);
});
