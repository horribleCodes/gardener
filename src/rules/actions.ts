import { RuleError, type Power } from "../domain/types.js";

export function attackProblemDamage(attacker: Power, defender: Power): number {
  return 1 + Math.max(0, attacker - defender);
}

export type DefenseChoice = "cohesion" | "sacrifice" | "problem";

export function chooseDefense(input: {
  policy: "preserve_existence";
  cohesion: number;
  trouble: number;
  dieMax: number;
  problemDamage: number;
  canSacrifice: boolean;
}): DefenseChoice {
  const options: DefenseChoice[] = ["problem", "cohesion"];
  if (input.canSacrifice) options.push("sacrifice");
  const collapses = (choice: DefenseChoice) => {
    if (choice === "sacrifice") return false;
    if (choice === "cohesion") return input.cohesion - 1 <= 0;
    return input.trouble + input.problemDamage >= input.dieMax;
  };
  const safe = options.find((choice) => !collapses(choice));
  if (safe) return safe;
  if (input.canSacrifice) return "sacrifice";
  return "problem";
}

export function interestCap(dieMax: number): number {
  return dieMax * 2;
}

export function interestModifier(dieMax: number, spend: number): number {
  if (spend > dieMax) {
    throw new RuleError("MODIFIER_EXCEEDS_DIE", `cannot modify by ${spend} with a d${dieMax}`);
  }
  if (spend < 1) throw new RuleError("MODIFIER_EXCEEDS_DIE", "modifier must be at least 1");
  return spend;
}

export function movedKeptFace(input: {
  kept: number;
  dieMax: number;
  direction: "raise" | "lower";
  requested: number;
}): { kept: number; spent: number } {
  if (!Number.isInteger(input.requested) || input.requested < 1) {
    throw new RuleError("MODIFIER_EXCEEDS_DIE", "modifier must be at least 1");
  }
  const raw = input.direction === "raise" ? input.kept + input.requested : input.kept - input.requested;
  const kept = Math.min(input.dieMax, Math.max(1, raw));
  return { kept, spent: Math.abs(kept - input.kept) };
}
