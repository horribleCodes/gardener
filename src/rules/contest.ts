import type { Power, RollRecord } from "../domain/types.js";
import { RuleError } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export type ContestEdge = {
  vast?: boolean;
  superior?: boolean;
  edged?: boolean;
};

export type ResolvedEdge = {
  vast: boolean;
  superior: boolean;
  edged: boolean;
};

const EDGE_KEYS = ["vast", "superior", "edged"] as const;

export function readMarginal(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw !== "boolean") {
    throw new RuleError("FILL_INCOMPLETE", "marginal must be a boolean");
  }
  return raw;
}

export function resolveContestEdge(raw: unknown, label: string): ResolvedEdge {
  if (raw == null) return { vast: false, superior: false, edged: false };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new RuleError("FILL_INCOMPLETE", `${label} must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const resolved: ResolvedEdge = { vast: false, superior: false, edged: false };
  for (const key of EDGE_KEYS) {
    if (!(key in obj) || obj[key] === undefined) continue;
    if (typeof obj[key] !== "boolean") {
      throw new RuleError("FILL_INCOMPLETE", `${label}.${key} must be a boolean`);
    }
    resolved[key] = obj[key];
  }
  return resolved;
}

export function unevenBonus(input: {
  origin: string;
  edge: ResolvedEdge;
  opposingEdge: ResolvedEdge | null;
}): number {
  if (!input.opposingEdge) return 0;
  let bonus = 0;
  if (input.origin === "improbable") bonus += 1;
  if (input.origin === "impossible") bonus += 2;
  if (input.edge.vast && !input.opposingEdge.vast) bonus += 1;
  if (input.edge.superior && !input.opposingEdge.superior) bonus += 1;
  if (input.edge.edged) bonus += 1;
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
