import type { Power, RollRecord } from "../domain/types.js";
import { RuleError } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export function readMarginal(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw !== "boolean") {
    throw new RuleError("FILL_INCOMPLETE", "marginal must be a boolean");
  }
  return raw;
}

export function readGmBonus(raw: unknown, label: string): number {
  if (raw == null) return 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 3) {
    throw new RuleError("FILL_INCOMPLETE", `${label} must be an integer from 0 to 3`);
  }
  return raw;
}

export function unevenBonus(input: {
  origin: string;
  gmBonus: number;
  hasOpponent: boolean;
}): number {
  if (!input.hasOpponent) return 0;
  let bonus = input.gmBonus;
  if (input.origin === "improbable") bonus += 1;
  if (input.origin === "impossible") bonus += 2;
  return bonus;
}

export function featureRoll(input: {
  rng: Rng; faces: number; marginal: boolean; bonus: number;
  forced?: number; forcedPair?: [number, number];
}): RollRecord {
  const first = rollDie(input.rng, input.faces, input.forcedPair?.[0] ?? input.forced);
  const second = input.marginal
    ? rollDie(input.rng, input.faces, input.forcedPair?.[1])
    : first;
  const kept = input.marginal ? Math.min(first.natural, second.natural) : first.natural;
  const bonus = kept === 1 ? 0 : input.bonus;
  return {
    faces: input.faces, natural: kept, kept, bonus, total: kept + bonus,
    forced: input.forced != null || input.forcedPair != null,
  };
}

export function resolveContest(input: {
  attackerTotal: number; defenderTotal: number; attackerPower: Power; defenderPower: Power;
}): "attacker" | "defender" {
  if (input.attackerTotal > input.defenderTotal) return "attacker";
  if (input.defenderTotal > input.attackerTotal) return "defender";
  if (input.attackerPower > input.defenderPower) return "attacker";
  return "defender";
}
