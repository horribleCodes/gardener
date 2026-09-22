import { RuleError, type ProblemRef } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export function blameProblem(problems: ProblemRef[], roll: number): ProblemRef {
  let cursor = 1;
  for (const problem of problems) {
    const end = cursor + problem.points - 1;
    if (roll >= cursor && roll <= end) return problem;
    cursor = end + 1;
  }
  throw new RuleError("NOTHING_TO_SOLVE", `roll ${roll} matched no problem band`);
}

export function troubleCheck(input: {
  rng: Rng;
  faces: number;
  trouble: number;
  problems: ProblemRef[];
  inverted: boolean;
  forcedRoll?: number;
}): { success: boolean; culpritId: string | null; roll: ReturnType<typeof rollDie> } {
  const roll = rollDie(input.rng, input.faces, input.forcedRoll);
  const success = input.inverted
    ? roll.natural <= input.trouble
    : roll.natural > input.trouble;
  const culpritId = !input.inverted && !success
    ? blameProblem(input.problems, roll.natural).id
    : null;
  return { success, culpritId, roll };
}
