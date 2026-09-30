import { RuleError } from "./types.js";

export type CampaignProfile = "strain" | "assets";
export type ProjectBase = "scope" | "scale";
export type OppositionMode = "stack" | "largest";
export type ReachUnit = "place" | "miles" | "hex";

export interface CampaignFlags {
  preset: "godbound";
  profile: CampaignProfile;
  projectBase: ProjectBase;
  opposition: OppositionMode;
  wards: boolean;
  heldChanges: boolean;
  capabilityGate: boolean;
  reachUnit: ReachUnit;
}

export const GODBOUND_PRESET: CampaignFlags = {
  preset: "godbound",
  profile: "strain",
  projectBase: "scope",
  opposition: "stack",
  wards: true,
  heldChanges: true,
  capabilityGate: false,
  reachUnit: "place",
};

const PROFILES = new Set<CampaignProfile>(["strain", "assets"]);
const PROJECT_BASES = new Set<ProjectBase>(["scope", "scale"]);
const OPPOSITIONS = new Set<OppositionMode>(["stack", "largest"]);
const REACH = new Set<ReachUnit>(["place", "miles", "hex"]);

export function resolveCampaignFlags(input: {
  preset?: string;
  flags?: Partial<Omit<CampaignFlags, "preset">>;
}): CampaignFlags {
  const presetName = input.preset ?? "godbound";
  if (presetName !== "godbound") {
    throw new RuleError("PICK_UNKNOWN", `unknown campaign preset: ${presetName}`);
  }
  const next: CampaignFlags = { ...GODBOUND_PRESET };
  const flags = input.flags ?? {};
  if (flags.profile != null) {
    if (!PROFILES.has(flags.profile)) throw new RuleError("PICK_UNKNOWN", "unknown profile");
    next.profile = flags.profile;
  }
  if (flags.projectBase != null) {
    if (!PROJECT_BASES.has(flags.projectBase)) throw new RuleError("PICK_UNKNOWN", "unknown projectBase");
    next.projectBase = flags.projectBase;
  }
  if (flags.opposition != null) {
    if (!OPPOSITIONS.has(flags.opposition)) throw new RuleError("PICK_UNKNOWN", "unknown opposition");
    next.opposition = flags.opposition;
  }
  if (flags.wards != null) next.wards = flags.wards;
  if (flags.heldChanges != null) next.heldChanges = flags.heldChanges;
  if (flags.capabilityGate != null) next.capabilityGate = flags.capabilityGate;
  if (flags.reachUnit != null) {
    if (!REACH.has(flags.reachUnit)) throw new RuleError("PICK_UNKNOWN", "unknown reachUnit");
    next.reachUnit = flags.reachUnit;
  }
  return next;
}
