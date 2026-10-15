import { expect, test } from "vitest";
import { attackProblemDamage, chooseDefense, interestCap, interestModifier, movedKeptFace } from "../../src/rules/actions.js";

test("a power-4 attacker inflicts 4 problem points on a power-1 defender", () => {
  expect(attackProblemDamage(4, 1)).toBe(4);
  expect(attackProblemDamage(1, 1)).toBe(1);
  expect(attackProblemDamage(1, 4)).toBe(1);
});

test("preserve_existence avoids collapse", () => {
  const choice = chooseDefense({
    policy: "preserve_existence",
    cohesion: 1,
    trouble: 4,
    dieMax: 6,
    problemDamage: 2,
    canSacrifice: true,
  });
  expect(choice).toBe("sacrifice");
  const wounded = chooseDefense({
    policy: "preserve_existence",
    cohesion: 2,
    trouble: 1,
    dieMax: 6,
    problemDamage: 1,
    canSacrifice: true,
  });
  expect(wounded).toBe("problem");
});

test("interest cap is twice the owner die and the modifier cannot exceed that die", () => {
  expect(interestCap(6)).toBe(12);
  expect(interestModifier(6, 6)).toBe(6);
  try {
    interestModifier(6, 7);
    throw new Error("should have thrown");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("MODIFIER_EXCEEDS_DIE");
  }
});

test("movedKeptFace clamps to 1 and the die maximum and reports points that moved", () => {
  expect(movedKeptFace({ kept: 3, dieMax: 6, direction: "raise", requested: 2 })).toEqual({
    kept: 5,
    spent: 2,
  });
  expect(movedKeptFace({ kept: 5, dieMax: 6, direction: "raise", requested: 4 })).toEqual({
    kept: 6,
    spent: 1,
  });
  expect(movedKeptFace({ kept: 2, dieMax: 6, direction: "lower", requested: 5 })).toEqual({
    kept: 1,
    spent: 1,
  });
  expect(movedKeptFace({ kept: 6, dieMax: 6, direction: "raise", requested: 1 }).spent).toBe(0);
});
