export type Scope = "village" | "city" | "region" | "nation" | "realm";
export type Magnitude = "plausible" | "improbable" | "impossible" | "vast";
export type Power = 1 | 2 | 3 | 4 | 5;
export type Die = 6 | 8 | 10 | 12 | 20;
export type FillMode = "require" | "missing" | "blank";
export type Domain = "cultural" | "military" | "economic" | "other";
export type FeatureOrigin = "native" | "improbable" | "impossible";
export type InterestNature =
  | "alliance" | "rivalry" | "trade" | "marriage" | "spies" | "aid" | "tribute";
export type Behavior =
  | "despotic_tyrant" | "self_absorbed_survivor"
  | "scheming_manipulator" | "martial_conqueror" | "directed";
export type Harshness = "nominal" | "sharp" | "grueling" | "overwhelming";

export const DIE_BY_POWER: Record<Power, Die> = { 1: 6, 2: 8, 3: 10, 4: 12, 5: 20 };
export const SCOPE_BY_POWER: Record<Power, Scope> = {
  1: "village", 2: "city", 3: "region", 4: "nation", 5: "realm",
};
export const SCOPE_COST: Record<Scope, number> = {
  village: 1, city: 2, region: 4, nation: 8, realm: 16,
};
export const MULTIPLIER: Record<Magnitude, number> = {
  plausible: 1, improbable: 2, impossible: 4, vast: 8,
};

export interface ProblemRef { id: string; points: number; intrinsic?: boolean }

export interface FeatureTags {
  size: "normal" | "vast";
  quality: "normal" | "superior";
  magical: boolean;
  origin: FeatureOrigin;
  domain: Domain;
}

export interface RollRecord {
  faces: number;
  natural: number;
  kept: number;
  bonus: number;
  total: number;
  forced: boolean;
}

export class RuleError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
