import { expect, test } from "vitest";
import { attackProblemDamage, chooseDefense, interestCap, interestModifier } from "../../src/rules/actions.js";

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
