import type { FeatureTags, Power, RollRecord } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export function unevenBonus(mine: FeatureTags, theirs: FeatureTags | null, magicRelevant = true): number {
  if (!theirs) return 0;
  let bonus = 0;
  if (mine.size === "vast" && theirs.size !== "vast") bonus += 1;
  if (mine.quality === "superior" && theirs.quality !== "superior") bonus += 1;
  if (mine.magical && magicRelevant) bonus += 1;
  if (mine.origin === "improbable") bonus += 1;
  if (mine.origin === "impossible") bonus += 2;
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

export function defaultRelevance(
  attackerDomain: string | undefined | null,
  defenderDomain: string | undefined | null,
): boolean {
  if (!attackerDomain || !defenderDomain) return false;
  if (attackerDomain === "other" || defenderDomain === "other") return false;
  return attackerDomain !== defenderDomain;
}

export function resolveContest(input: {
  attackerTotal: number; defenderTotal: number; attackerPower: Power; defenderPower: Power;
}): "attacker" | "defender" {
  if (input.attackerTotal > input.defenderTotal) return "attacker";
  if (input.defenderTotal > input.attackerTotal) return "defender";
  if (input.attackerPower > input.defenderPower) return "attacker";
  return "defender";
}
