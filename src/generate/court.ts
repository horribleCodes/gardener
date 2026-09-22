import { RuleError, type FillMode } from "../domain/types.js";
import { mulberry32 } from "../rules/dice.js";
import { loadCatalog, pickOrRoll } from "../tables/catalog.js";
import { assertRequired, displayName, quarrelSummary } from "./fill.js";

export interface CourtDraftInput {
  fill: FillMode;
  seed: number;
  type?: string;
  powerStructure?: string;
  conflict?: string;
  atmosphere?: string;
  majorCount?: number;
  minorCount?: number;
  names?: string[];
}

export interface CourtActorDraft {
  id: string;
  rank: "major" | "minor";
  role: string;
  name: string | null;
  powerSource: string | null;
  side: "protagonist" | "antagonist" | "neutral" | "unaffiliated";
  isLeader: boolean;
  isHiddenController: boolean;
  sharesAuthority: boolean;
  minorRelationship: string | null;
}

export interface CourtDraft {
  type: string;
  powerStructure: string;
  atmosphere: string;
  blank: boolean;
  advisories: string[];
  actors: CourtActorDraft[];
  conflict: {
    text: string;
    fittedSummary: string | null;
    protagonistId: string;
    antagonistId: string;
  };
  destruction: { text: string };
  defense: { text: string };
}

function resolvePowerStructure(
  catalog: ReturnType<typeof loadCatalog>,
  rng: ReturnType<typeof mulberry32>,
  provided?: string,
): { id: string; agreement: string } {
  const rolled = pickOrRoll(catalog, "powerStructure", rng, undefined, provided);
  const row =
    catalog.powerStructure.find((r) => r.text === rolled.text) ??
    catalog.powerStructure.find((r) => r.id === rolled.text) ??
    catalog.powerStructure.find((r) => provided != null && r.id === provided);
  if (!row) {
    throw new RuleError("PICK_UNKNOWN", `${rolled.text} is not in powerStructure`);
  }
  return { id: row.id, agreement: row.agreement };
}

function applyAgreementFlags(majors: CourtActorDraft[], agreement: string): void {
  if (agreement === "leader" && majors[0]) majors[0].isLeader = true;
  if (agreement === "hidden") {
    if (majors[0]) majors[0].isLeader = true;
    if (majors[1]) majors[1].isHiddenController = true;
  }
  if (agreement === "all-sharers") {
    if (majors[0]) majors[0].sharesAuthority = true;
    if (majors[1]) majors[1].sharesAuthority = true;
  }
  if (agreement === "majority" && majors[0]) majors[0].isLeader = true;
}

export function generateCourt(input: CourtDraftInput): CourtDraft {
  const fill = input.fill;
  const catalog = loadCatalog();
  const rng = mulberry32(input.seed);
  const advisories: string[] = [];

  assertRequired(fill, { type: input.type, powerStructure: input.powerStructure });

  const { id: powerStructureId, agreement } = resolvePowerStructure(catalog, rng, input.powerStructure);

  const courtTypeKeys = Object.keys(catalog.courts);
  let type = input.type;
  if (type == null || type === "") {
    const pick = 1 + Math.floor(rng.next() * courtTypeKeys.length);
    type = courtTypeKeys[pick - 1];
  }

  let majorCount = input.majorCount ?? 3;
  if (majorCount < 2 || majorCount > 5) {
    if (input.majorCount != null) {
      advisories.push(`majorCount ${input.majorCount} was clamped to the 2–5 range`);
    }
    majorCount = Math.min(5, Math.max(2, majorCount));
  }

  const minorCount = input.minorCount ?? 3;
  const names = input.names ?? [];
  let nameIndex = 0;

  const actors: CourtActorDraft[] = [];
  const majors: CourtActorDraft[] = [];

  for (let i = 0; i < majorCount; i++) {
    const role = pickOrRoll(catalog, `courts.${type}.majorActor`, rng).text;
    const powerSource = pickOrRoll(catalog, `courts.${type}.powerSource`, rng).text;
    let providedName: string | undefined;
    if (fill !== "blank" && nameIndex < names.length) {
      providedName = names[nameIndex++];
    }
    const actor: CourtActorDraft = {
      id: `major-${i}`,
      rank: "major",
      role,
      name: displayName(fill, role, providedName),
      powerSource,
      side: i === 0 ? "protagonist" : i === 1 ? "antagonist" : "neutral",
      isLeader: false,
      isHiddenController: false,
      sharesAuthority: false,
      minorRelationship: null,
    };
    if (i >= 2) {
      const sideRoll = Math.floor(rng.next() * 3);
      actor.side = sideRoll === 0 ? "protagonist" : sideRoll === 1 ? "antagonist" : "neutral";
    }
    majors.push(actor);
    actors.push(actor);
  }

  applyAgreementFlags(majors, agreement);

  const conflictText =
    input.conflict ?? pickOrRoll(catalog, `courts.${type}.conflict`, rng).text;

  const protagonistId = majors[0]?.id ?? "major-0";
  const antagonistId = majors[1]?.id ?? "major-1";
  const fittedSummary = quarrelSummary(
    fill,
    majors[0]?.name ?? null,
    conflictText,
    majors[1]?.name ?? null,
  );

  for (let i = 0; i < minorCount; i++) {
    const role = pickOrRoll(catalog, `courts.${type}.minorActor`, rng).text;
    const minorRelationship = pickOrRoll(catalog, "minorRelationship", rng).text;
    let providedName: string | undefined;
    if (fill !== "blank" && nameIndex < names.length) {
      providedName = names[nameIndex++];
    }
    actors.push({
      id: `minor-${i}`,
      rank: "minor",
      role,
      name: displayName(fill, role, providedName),
      powerSource: null,
      side: "unaffiliated",
      isLeader: false,
      isHiddenController: false,
      sharesAuthority: false,
      minorRelationship,
    });
  }

  const atmosphere =
    input.atmosphere ??
    pickOrRoll(catalog, `courts.${type}.atmosphere`, rng, undefined, input.atmosphere).text;

  return {
    type,
    powerStructure: powerStructureId,
    atmosphere,
    blank: fill === "blank",
    advisories,
    actors,
    conflict: {
      text: conflictText,
      fittedSummary,
      protagonistId,
      antagonistId,
    },
    destruction: { text: pickOrRoll(catalog, `courts.${type}.destruction`, rng).text },
    defense: { text: pickOrRoll(catalog, `courts.${type}.defense`, rng).text },
  };
}
