import { expect, test } from "vitest";
import { mulberry32, rollDie, sequenceRng } from "../../src/rules/dice.js";
import { blameProblem, troubleCheck } from "../../src/rules/trouble.js";
import { collapseState } from "../../src/rules/collapse.js";

test("rollDie stays inside the faces", () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 50; i++) {
    const face = rollDie(rng, 6).natural;
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(6);
  }
});

test("blame bands use stored order and point width", () => {
  const problems = [
    { id: "raid", points: 1 },
    { id: "tax", points: 1 },
    { id: "despair", points: 2 },
  ];
  expect(blameProblem(problems, 1).id).toBe("raid");
  expect(blameProblem(problems, 2).id).toBe("tax");
  expect(blameProblem(problems, 4).id).toBe("despair");
});

test("normal trouble check fails on equal, solve check succeeds on equal", () => {
  const rng = sequenceRng([4]);
  const problems = [
    { id: "raid", points: 1 },
    { id: "tax", points: 1 },
    { id: "despair", points: 2 },
  ];
  const failed = troubleCheck({ rng, faces: 6, trouble: 4, problems, inverted: false });
  expect(failed.success).toBe(false);
  expect(failed.culpritId).toBe("despair");
  const solved = troubleCheck({
    rng: sequenceRng([4]), faces: 6, trouble: 4, problems, inverted: true,
  });
  expect(solved.success).toBe(true);
  expect(solved.culpritId).toBeNull();
});

test("collapse when trouble reaches the die maximum or cohesion hits zero", () => {
  expect(collapseState({ power: 1, trouble: 6, cohesion: 1 }).collapsed).toBe(true);
  expect(collapseState({ power: 1, trouble: 5, cohesion: 1 }).collapsed).toBe(false);
  expect(collapseState({ power: 4, trouble: 3, cohesion: 0 }).collapsed).toBe(true);
});
