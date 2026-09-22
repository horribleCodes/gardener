import {
  MULTIPLIER, SCOPE_BY_POWER, SCOPE_COST,
  type Magnitude, type Power, type Scope,
} from "../domain/types.js";

export interface Quote {
  scopeCost: number;
  ward: number;
  opposition: number;
  base: number;
  multiplier: number;
  total: number;
  deedsRequired: number;
  challengesRequired: number;
}

export function quoteChange(input: {
  scope: Scope;
  magnitude: Magnitude;
  wardRatings: number[];
  resisterRatings: number[];
  kind?: "feature" | "fact" | "problem_mitigation" | "creature_population" | "champion" | "other";
  petty?: boolean;
  deedsRequired?: number;
  challengesRequired?: number;
}): Quote {
  const scopeCost = SCOPE_COST[input.scope];
  const ward = input.wardRatings.length ? Math.max(...input.wardRatings) : 0;
  const opposition = input.resisterRatings.length
    ? Math.max(...input.resisterRatings) + (input.resisterRatings.length - 1)
    : 0;
  const multiplier = MULTIPLIER[input.magnitude];
  const base = scopeCost + ward + opposition;
  const defaults = defaultObstacles(input.scope, input.magnitude, input.kind, input.petty ?? false);
  return {
    scopeCost, ward, opposition, base, multiplier, total: base * multiplier,
    deedsRequired: input.deedsRequired ?? defaults.deeds,
    challengesRequired: input.challengesRequired ?? defaults.challenges,
  };
}

function defaultObstacles(scope: Scope, magnitude: Magnitude, kind: string | undefined, petty: boolean): {
  deeds: number; challenges: number;
} {
  if (petty && magnitude === "impossible" && scope === "village") return { deeds: 0, challenges: 0 };
  if (kind === "creature_population" && (magnitude === "impossible" || magnitude === "vast")) {
    const deeds = SCOPE_COST[scope];
    return { deeds, challenges: deeds };
  }
  const large = scope === "region" || scope === "nation" || scope === "realm";
  if (magnitude === "plausible" || magnitude === "improbable") {
    return { deeds: 0, challenges: large ? 1 : 0 };
  }
  const challenges = scope === "realm" ? 6 : scope === "nation" ? 3 : scope === "region" ? 2 : 1;
  return {
    deeds: 1,
    challenges: magnitude === "vast" ? Math.max(2, challenges) : challenges,
  };
}

export function factionProjectCost(power: Power, magnitude: "plausible" | "improbable"): number {
  return SCOPE_COST[SCOPE_BY_POWER[power]] * MULTIPLIER[magnitude];
}

export function restoreCohesionCost(power: Power): number {
  return SCOPE_COST[SCOPE_BY_POWER[power]] * 2;
}

export function championStats(level: number, loyal: boolean): {
  effectiveLevel: number; hitDice: number; attacks: number; actions: number;
  damage: string; effort: number; lesserGifts: number; dominionCost: 8;
} {
  const effectiveLevel = loyal ? Math.ceil(level / 2) : level;
  return {
    effectiveLevel,
    hitDice: 5 + 2 * effectiveLevel,
    attacks: Math.ceil(effectiveLevel / 3),
    actions: Math.ceil(effectiveLevel / 5),
    damage: "1d8",
    effort: effectiveLevel,
    lesserGifts: Math.ceil(effectiveLevel / 3),
    dominionCost: 8,
  };
}
