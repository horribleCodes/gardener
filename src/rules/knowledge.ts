import { DIE_BY_POWER, type Behavior, type InterestNature, type Power } from "../domain/types.js";

export type UnitRef = { type: "faction" | "court" | "character" | "godbound"; id: string };

export type WorldFaction = {
  id: string;
  name: string;
  power: Power;
  cohesion: number;
  dominion: number;
  homePlaceId: string | null;
  behavior: Behavior | string;
  status: string;
  control?: string;
};

export type WorldPlace = {
  id: string;
  name: string;
  scope: string;
  parentPlaceId: string | null;
};

export type WorldFeature = {
  id: string;
  factionId: string;
  text: string;
  domain: string;
  covert: boolean | number;
};

export type WorldProblem = {
  id: string;
  factionId: string;
  text: string;
  domain: string;
  points: number;
  intrinsic: boolean | number;
};

export type WorldInterest = {
  fromFactionId: string;
  toFactionId: string;
  points: number;
  nature: InterestNature | string;
};

export type WorldCharacter = {
  id: string;
  name: string | null;
  statNote?: string | null;
  courtId: string | null;
  isHiddenController?: boolean;
  factionId?: string | null;
  actsOnOwn?: boolean | number;
};

export type WorldCourt = {
  id: string;
  type: string;
  powerStructure: string;
  atmosphere: string;
  placeId: string | null;
  rulesFactionId: string | null;
  actsOnOwn?: boolean | number;
  members?: WorldCharacter[];
  conflict?: { text: string } | null;
  defenses?: { text: string }[];
  consequences?: { text: string }[];
};

export type WorldFact = {
  id: string;
  subject: string;
  subjectId: string;
  statement: string;
  visibility: string;
  placeId?: string | null;
};

export type WorldEvent = {
  id: string;
  type: string;
  payload: unknown;
  visibility?: string;
  placeId?: string | null;
};

export type CampaignWorld = {
  factions: WorldFaction[];
  places: WorldPlace[];
  features: WorldFeature[];
  problems: WorldProblem[];
  interests: WorldInterest[];
  courts: WorldCourt[];
  characters: WorldCharacter[];
  facts: WorldFact[];
  events: WorldEvent[];
  godbound?: WorldGodbound[];
};

export type WorldGodbound = {
  id: string;
  name: string;
  level: number;
  divinity: string;
  cultFactionId: string | null;
  dominion: number;
  influence: number;
  actsOnOwn?: boolean | number;
};

function isCovert(f: WorldFeature): boolean {
  return f.covert === true || f.covert === 1;
}

function isIntrinsic(p: WorldProblem): boolean {
  return p.intrinsic === true || p.intrinsic === 1;
}

function stripStatNote<T extends Record<string, unknown>>(obj: T): T {
  const { statNote: _s, ...rest } = obj as T & { statNote?: unknown };
  return rest as T;
}

function placeAncestors(world: CampaignWorld, placeId: string | null): Set<string> {
  const out = new Set<string>();
  let cur = placeId;
  while (cur) {
    out.add(cur);
    const place = world.places.find((p) => p.id === cur);
    cur = place?.parentPlaceId ?? null;
  }
  return out;
}

function placesTouch(world: CampaignWorld, a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const setA = placeAncestors(world, a);
  for (const id of placeAncestors(world, b)) {
    if (setA.has(id)) return true;
  }
  return false;
}

function viewerFactionId(unit: UnitRef, world: CampaignWorld): string | undefined {
  if (unit.type === "faction") return unit.id;
  if (unit.type === "godbound") {
    const gb = world.godbound?.find((g) => g.id === unit.id);
    return gb?.cultFactionId ?? undefined;
  }
  if (unit.type === "character") {
    const ch = world.characters.find((c) => c.id === unit.id);
    if (ch?.factionId) return ch.factionId;
  }
  if (unit.type === "court") {
    const court = world.courts.find((c) => c.id === unit.id);
    return court?.rulesFactionId ?? undefined;
  }
  return undefined;
}

function publicFactNamesFaction(world: CampaignWorld, factionId: string): boolean {
  return world.facts.some(
    (f) => f.subject === "faction" && f.subjectId === factionId && f.visibility === "public",
  );
}

function interestFrom(
  world: CampaignWorld,
  fromId: string,
  toId: string,
): WorldInterest | undefined {
  return world.interests.find((i) => i.fromFactionId === fromId && i.toFactionId === toId);
}

function factNamesFaction(
  world: CampaignWorld,
  viewerUnit: UnitRef,
  factionId: string,
  viewerPlaces: Set<string>,
  viewerFaction: string | undefined,
): boolean {
  for (const fact of world.facts) {
    if (fact.subject !== "faction" || fact.subjectId !== factionId) continue;
    if (factVisibleToUnit(world, viewerUnit, fact, viewerPlaces, viewerFaction)) return true;
  }
  return false;
}

function factVisibleToUnit(
  world: CampaignWorld,
  unit: UnitRef,
  fact: WorldFact,
  viewerPlaces: Set<string>,
  viewerFactionId: string | undefined,
): boolean {
  const vis = fact.visibility;
  if (vis === "public") return true;
  if (vis === "local") {
    const pid = fact.placeId;
    return pid != null && viewerPlaces.has(pid);
  }
  if (vis === "privileged") {
    if (fact.subject === "faction" && fact.subjectId === viewerFactionId) return true;
    if (!viewerFactionId) return false;
    const edges = world.interests.filter((i) => i.fromFactionId === viewerFactionId);
    return edges.some(
      (e) =>
        e.toFactionId === fact.subjectId &&
        (e.nature === "alliance" || e.nature === "aid" || e.nature === "spies"),
    );
  }
  if (vis === "hidden") {
    if (fact.subject === "faction" && fact.subjectId === viewerFactionId) return true;
    if (!viewerFactionId) return false;
    const spy = interestFrom(world, viewerFactionId, fact.subjectId);
    if (!spy || spy.nature !== "spies") return false;
    const viewer = world.factions.find((f) => f.id === viewerFactionId);
    if (!viewer) return false;
    return spy.points >= DIE_BY_POWER[viewer.power];
  }
  return false;
}

function factionIncluded(
  world: CampaignWorld,
  viewerFaction: string,
  targetId: string,
  viewerPlaces: Set<string>,
): boolean {
  if (viewerFaction === targetId) return true;
  const viewer = world.factions.find((f) => f.id === viewerFaction);
  const target = world.factions.find((f) => f.id === targetId);
  if (!viewer || !target) return false;
  if (placesTouch(world, viewer.homePlaceId, target.homePlaceId)) return true;
  if (interestFrom(world, viewerFaction, targetId)) return true;
  const inbound = interestFrom(world, targetId, viewerFaction);
  if (inbound && inbound.nature !== "spies") return true;
  if (factNamesFaction(world, { type: "faction", id: viewerFaction }, targetId, viewerPlaces, viewerFaction)) {
    return true;
  }
  return false;
}

type ProjectedFeature = { id: string; text: string; domain: string; covert?: boolean };
type ProjectedProblem = { id: string; text: string; domain: string; points: number };

function projectOtherFaction(
  world: CampaignWorld,
  viewerFactionId: string,
  target: WorldFaction,
  options?: { publicFactOnly?: boolean },
): Record<string, unknown> | null {
  if (options?.publicFactOnly) {
    const allFeatures = world.features.filter((fe) => fe.factionId === target.id);
    const features = allFeatures
      .filter((fe) => !isCovert(fe))
      .map((fe) => ({ id: fe.id, text: fe.text, domain: fe.domain }));
    return {
      id: target.id,
      name: target.name,
      power: target.power,
      homePlaceId: target.homePlaceId,
      features,
      problems: [],
    };
  }

  const viewerUnit: UnitRef = { type: "faction", id: viewerFactionId };
  const viewerPlaces = viewerKnownPlaces(world, viewerUnit);
  if (!factionIncluded(world, viewerFactionId, target.id, viewerPlaces)) return null;

  const edge = interestFrom(world, viewerFactionId, target.id);
  const spyEdge = edge?.nature === "spies" ? edge : undefined;
  const viewer = world.factions.find((f) => f.id === viewerFactionId)!;
  const dieMax = DIE_BY_POWER[viewer.power];
  const spyMax = spyEdge && spyEdge.points >= dieMax;

  const allFeatures = world.features.filter((f) => f.factionId === target.id);
  const allProblems = world.problems.filter((p) => p.factionId === target.id);

  let features: ProjectedFeature[] = allFeatures
    .filter((f) => !isCovert(f))
    .map((f) => ({ id: f.id, text: f.text, domain: f.domain }));

  let problems: ProjectedProblem[] = [];

  const nature = edge?.nature;
  if (nature === "alliance" || nature === "aid") {
    features = allFeatures.map((f) => ({
      id: f.id,
      text: f.text,
      domain: f.domain,
      covert: isCovert(f),
    }));
    problems = allProblems.filter((p) => !isIntrinsic(p)).map((p) => ({
      id: p.id,
      text: p.text,
      domain: p.domain,
      points: p.points,
    }));
    return {
      id: target.id,
      name: target.name,
      power: target.power,
      cohesion: target.cohesion,
      dominion: target.dominion,
      homePlaceId: target.homePlaceId,
      features,
      problems,
    };
  }

  if (nature === "marriage" || nature === "trade" || nature === "tribute") {
    problems = allProblems
      .filter((p) => !isIntrinsic(p) && (p.domain === "cultural" || p.domain === "economic"))
      .map((p) => ({ id: p.id, text: p.text, domain: p.domain, points: p.points }));
    return {
      id: target.id,
      name: target.name,
      power: target.power,
      homePlaceId: target.homePlaceId,
      features,
      problems,
    };
  }

  if (nature === "rivalry") {
    const militaryCovert = allFeatures
      .filter((f) => isCovert(f) && f.domain === "military")
      .map((f) => ({ id: f.id, text: f.text, domain: f.domain, covert: true }));
    features = [...features, ...militaryCovert];
    problems = allProblems
      .filter((p) => !isIntrinsic(p) && p.domain === "military")
      .map((p) => ({ id: p.id, text: p.text, domain: p.domain, points: p.points }));
    return {
      id: target.id,
      name: target.name,
      power: target.power,
      homePlaceId: target.homePlaceId,
      features,
      problems,
    };
  }

  if (spyEdge && spyEdge.points >= 1) {
    features = allFeatures.map((f) => ({
      id: f.id,
      text: f.text,
      domain: f.domain,
      covert: isCovert(f),
    }));
    problems = allProblems.filter((p) => !isIntrinsic(p)).map((p) => ({
      id: p.id,
      text: p.text,
      domain: p.domain,
      points: p.points,
    }));
    const base: Record<string, unknown> = {
      id: target.id,
      name: target.name,
      power: target.power,
      cohesion: target.cohesion,
      dominion: target.dominion,
      homePlaceId: target.homePlaceId,
      features,
      problems,
    };
    return base;
  }

  return {
    id: target.id,
    name: target.name,
    power: target.power,
    homePlaceId: target.homePlaceId,
    features,
    problems,
  };
}

function projectOwnFaction(world: CampaignWorld, faction: WorldFaction): Record<string, unknown> {
  const trouble = world.problems
    .filter((p) => p.factionId === faction.id)
    .reduce((s, p) => s + p.points, 0);
  const features = world.features
    .filter((f) => f.factionId === faction.id)
    .map((f) => ({
      id: f.id,
      text: f.text,
      domain: f.domain,
      covert: isCovert(f),
    }));
  const problems = world.problems
    .filter((p) => p.factionId === faction.id)
    .map((p) => ({
      id: p.id,
      text: p.text,
      domain: p.domain,
      points: p.points,
      intrinsic: isIntrinsic(p),
    }));
  const interestsOut = world.interests
    .filter((i) => i.fromFactionId === faction.id)
    .map((i) => ({
      toFactionId: i.toFactionId,
      points: i.points,
      nature: i.nature,
    }));
  const interestsIn = world.interests
    .filter((i) => i.toFactionId === faction.id && i.nature !== "spies")
    .map((i) => ({
      fromFactionId: i.fromFactionId,
      points: i.points,
      nature: i.nature,
    }));

  return {
    id: faction.id,
    name: faction.name,
    power: faction.power,
    cohesion: faction.cohesion,
    dominion: faction.dominion,
    trouble,
    behavior: faction.behavior,
    homePlaceId: faction.homePlaceId,
    status: faction.status,
    features,
    problems,
    interestsOut,
    interestsIn,
  };
}

function viewerKnownPlaces(world: CampaignWorld, unit: UnitRef): Set<string> {
  const places = new Set<string>();
  const fid = viewerFactionId(unit, world);
  if (fid) {
    const f = world.factions.find((x) => x.id === fid);
    for (const id of placeAncestors(world, f?.homePlaceId ?? null)) places.add(id);
  }
  if (unit.type === "court") {
    const court = world.courts.find((c) => c.id === unit.id);
    for (const id of placeAncestors(world, court?.placeId ?? null)) places.add(id);
  }
  if (unit.type === "character") {
    const ch = world.characters.find((c) => c.id === unit.id);
    if (ch?.courtId) {
      const court = world.courts.find((c) => c.id === ch.courtId);
      for (const id of placeAncestors(world, court?.placeId ?? null)) places.add(id);
    }
  }

  const viewerFaction = fid;
  if (!viewerFaction) return places;

  let changed = true;
  while (changed) {
    changed = false;
    for (const f of world.factions) {
      if (!factionIncluded(world, viewerFaction, f.id, places)) continue;
      for (const id of placeAncestors(world, f.homePlaceId)) {
        if (!places.has(id)) {
          places.add(id);
          changed = true;
        }
      }
    }
    for (const fact of world.facts) {
      if (!factVisibleToUnit(world, unit, fact, places, viewerFaction)) continue;
      const pid = fact.placeId;
      if (pid) {
        for (const id of placeAncestors(world, pid)) {
          if (!places.has(id)) {
            places.add(id);
            changed = true;
          }
        }
      }
    }
  }
  return places;
}

function courtVisibleToUnit(
  world: CampaignWorld,
  unit: UnitRef,
  court: WorldCourt,
  viewerPlaces: Set<string>,
  viewerFaction: string | undefined,
): boolean {
  if (court.placeId && viewerPlaces.has(court.placeId)) return true;
  if (court.rulesFactionId && viewerFaction) {
    if (court.rulesFactionId === viewerFaction) return true;
    if (factionIncluded(world, viewerFaction, court.rulesFactionId, viewerPlaces)) return true;
  }
  return false;
}

function projectCourt(
  world: CampaignWorld,
  unit: UnitRef,
  court: WorldCourt,
  viewerPlaces: Set<string>,
): Record<string, unknown> | null {
  const viewerFaction = viewerFactionId(unit, world);
  const viewerChar = unit.type === "character" ? unit.id : undefined;
  const members = court.members ?? world.characters.filter((c) => c.courtId === court.id);

  if (!courtVisibleToUnit(world, unit, court, viewerPlaces, viewerFaction)) {
    const isMember = members.some((m) => m.id === viewerChar);
    if (!isMember) return null;
  }

  const isMember = members.some((m) => m.id === viewerChar);
  const isHiddenController = members.some(
    (m) =>
      m.id === viewerChar &&
      (m.isHiddenController === true || Number(m.isHiddenController) === 1),
  );

  let spyMax = false;
  if (viewerFaction && court.rulesFactionId) {
    const spy = interestFrom(world, viewerFaction, court.rulesFactionId);
    const viewer = world.factions.find((f) => f.id === viewerFaction);
    if (spy?.nature === "spies" && viewer && spy.points >= DIE_BY_POWER[viewer.power]) {
      spyMax = true;
    }
  }

  if (isHiddenController || spyMax) {
    return {
      id: court.id,
      type: court.type,
      powerStructure: court.powerStructure,
      atmosphere: court.atmosphere,
      placeId: court.placeId,
      agreement: court.powerStructure === "figurehead" ? "controllers" : court.powerStructure,
      actors: members.map((m) =>
        stripStatNote({
          id: m.id,
          name: m.name,
          isLeader: false,
          isHiddenController: m.isHiddenController ?? false,
          powerSource: (m as { powerSource?: string }).powerSource,
        }),
      ),
      conflict: court.conflict,
      defenses: court.defenses,
      consequences: court.consequences,
    };
  }

  if (isMember) {
    const leader = members.find((m) => (m as { isLeader?: boolean }).isLeader);
    return {
      id: court.id,
      type: court.type,
      placeId: court.placeId,
      atmosphere: court.atmosphere,
      agreement:
        court.powerStructure === "figurehead" ? "leader" : court.powerStructure,
      actors: members
        .filter((m) => !m.isHiddenController)
        .map((m) => stripStatNote({ id: m.id, name: m.name })),
      conflict: court.conflict?.text ? { text: court.conflict.text } : court.conflict,
      defenses: court.defenses,
      consequences: court.consequences,
    };
  }

  const leader = members.find((m) => (m as { isLeader?: boolean }).isLeader) ?? members[0];
  const agreement =
    court.powerStructure === "figurehead" && !spyMax && !isHiddenController
      ? "leader"
      : court.powerStructure;
  return {
    id: court.id,
    type: court.type,
    placeId: court.placeId,
    atmosphere: court.atmosphere,
    agreement,
    leaderName: leader?.name ?? null,
  };
}

export function projectUnitView(world: CampaignWorld, unit: UnitRef): { unit: UnitRef; known: Record<string, unknown> } {
  const viewerPlaces = viewerKnownPlaces(world, unit);
  const viewerFaction = viewerFactionId(unit, world);

  const factions: Record<string, unknown>[] = [];
  for (const f of world.factions) {
    if (viewerFaction === f.id) {
      factions.push(projectOwnFaction(world, f));
    } else if (viewerFaction) {
      const projected = projectOtherFaction(world, viewerFaction, f);
      if (projected) factions.push(projected);
    } else if (unit.type === "godbound" && publicFactNamesFaction(world, f.id)) {
      const projected = projectOtherFaction(world, f.id, f, { publicFactOnly: true });
      if (projected) factions.push(projected);
    }
  }

  const godbound: Record<string, unknown>[] = [];
  if (unit.type === "godbound") {
    const gb = world.godbound?.find((g) => g.id === unit.id);
    if (gb) {
      godbound.push({
        id: gb.id,
        name: gb.name,
        level: gb.level,
        divinity: gb.divinity,
        cultFactionId: gb.cultFactionId,
        dominion: gb.dominion,
        influence: gb.influence,
      });
    }
  }

  const courts: Record<string, unknown>[] = [];
  for (const c of world.courts) {
    const projected = projectCourt(world, unit, c, viewerPlaces);
    if (projected) courts.push(projected);
  }

  const characters: Record<string, unknown>[] = [];
  for (const ch of world.characters) {
    if (ch.courtId) {
      const courtProj = courts.find((c) => c.id === ch.courtId);
      if (!courtProj) continue;
      const actors = courtProj.actors as { id: string }[] | undefined;
      if (actors?.some((a) => a.id === ch.id)) {
        const actor = actors.find((a) => a.id === ch.id);
        if (actor) characters.push(stripStatNote(actor as Record<string, unknown>));
      }
    } else if (ch.factionId === viewerFaction || ch.id === unit.id) {
      characters.push(stripStatNote({ id: ch.id, name: ch.name }));
    }
  }

  const facts: Record<string, unknown>[] = [];
  for (const fact of world.facts) {
    if (factVisibleToUnit(world, unit, fact, viewerPlaces, viewerFaction)) {
      facts.push({ id: fact.id, statement: fact.statement, subject: fact.subject, subjectId: fact.subjectId });
    }
  }

  const places = world.places
    .filter((p) => viewerPlaces.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, scope: p.scope, parentPlaceId: p.parentPlaceId }));

  const rumors = projectRumors(world, unit, factions, viewerPlaces, viewerFaction);

  return {
    unit,
    known: {
      factions,
      places,
      courts,
      characters,
      facts,
      rumors,
      ...(godbound.length > 0 ? { godbound } : {}),
    },
  };
}

function featureInView(factionViews: Record<string, unknown>[], featureId: string): boolean {
  for (const f of factionViews) {
    const features = f.features as { id: string }[] | undefined;
    if (features?.some((x) => x.id === featureId)) return true;
  }
  return false;
}

function projectRumors(
  world: CampaignWorld,
  unit: UnitRef,
  factionViews: Record<string, unknown>[],
  viewerPlaces: Set<string>,
  viewerFaction: string | undefined,
): unknown[] {
  const lines: unknown[] = [];
  for (const ev of world.events) {
    const payload = ev.payload as Record<string, unknown>;
    const actorId = payload.actorId as string | undefined;
    const targetId = payload.targetId as string | undefined;
    const unitMatches =
      (unit.type === "faction" && (actorId === unit.id || targetId === unit.id)) ||
      (unit.type === "character" && (actorId === unit.id || targetId === unit.id)) ||
      (unit.type === "godbound" && (actorId === unit.id || targetId === unit.id));
    const isPublic =
      ev.visibility === "public" || (ev.placeId != null && viewerPlaces.has(ev.placeId));
    if (!unitMatches && !isPublic) continue;
    const copy = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    if (typeof copy.featureId === "string" && !featureInView(factionViews, copy.featureId)) {
      copy.featureName = "an undisclosed asset";
      delete copy.featureId;
    }
    lines.push({ id: ev.id, type: ev.type, ...copy });
  }
  return lines;
}

const ID_FIELDS = [
  "targetFactionId",
  "solveProblemId",
  "meansFeatureId",
  "attackerFeatureId",
  "defenderFeatureId",
  "problemId",
  "aimedAtFactionId",
  "addPartToFeatureId",
  "factionId",
  "courtId",
  "characterId",
  "placeId",
];

export function collectSnapshotIds(snapshot: ReturnType<typeof projectUnitView>): Set<string> {
  const ids = new Set<string>();
  ids.add(snapshot.unit.id);
  const known = snapshot.known as Record<string, unknown>;
  const addFromList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (item && typeof item === "object" && typeof (item as { id?: string }).id === "string") {
        ids.add((item as { id: string }).id);
      }
    }
  };
  addFromList(known.factions);
  addFromList(known.places);
  addFromList(known.courts);
  addFromList(known.characters);
  addFromList(known.facts);
  addFromList(known.godbound);
  for (const f of (known.factions as { features?: { id: string }[] }[]) ?? []) {
    for (const feat of f.features ?? []) ids.add(feat.id);
    for (const prob of (f as { problems?: { id: string }[] }).problems ?? []) ids.add(prob.id);
  }
  return ids;
}

export function planReferencesUnknown(
  snapshot: ReturnType<typeof projectUnitView>,
  plan: Record<string, unknown>,
): string | undefined {
  const allowed = collectSnapshotIds(snapshot);
  const check = (val: unknown): string | undefined => {
    if (val == null) return undefined;
    if (typeof val === "object" && !Array.isArray(val)) {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (ID_FIELDS.includes(k) && typeof v === "string" && !allowed.has(v)) return v;
        const nested = check(v);
        if (nested) return nested;
      }
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        const nested = check(item);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  return check(plan);
}
