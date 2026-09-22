import type Database from "better-sqlite3";
import { DIE_BY_POWER, RuleError, type Power } from "../domain/types.js";
import { interestCap } from "../rules/actions.js";
import { monthlyDominion } from "../rules/cults.js";
import { unevenBonus } from "../rules/contest.js";
import type { Harshness } from "../domain/types.js";
import { decisionMakers, type PowerStructure } from "./brief.js";
import { loadProblemsOrdered, sumTrouble } from "../services/util.js";

export function getFaction(db: Database.Database, factionId: string) {
  const faction = db
    .prepare(
      `SELECT id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, status, home_place_id
       FROM factions WHERE id = ?`,
    )
    .get(factionId) as
    | {
        id: string;
        campaign_id: string;
        name: string;
        power: Power;
        cohesion: number;
        dominion: number;
        origin: string;
        behavior: string;
        control: string;
        status: string;
        home_place_id: string | null;
      }
    | undefined;
  if (!faction) return null;

  const problems = loadProblemsOrdered(db, faction.id);
  let bandStart = 1;
  const problemsWithBands = problems.map((p) => {
    const band = { from: bandStart, to: bandStart + p.points - 1 };
    bandStart += p.points;
    const row = db.prepare("SELECT text, domain, intrinsic, external, resistance FROM problems WHERE id = ?").get(p.id) as {
      text: string;
      domain: string;
      intrinsic: number;
      external: number;
      resistance: number;
    };
    return { id: p.id, ...row, points: p.points, intrinsic: p.intrinsic, band };
  });

  const features = db
    .prepare("SELECT id, text, domain, size, quality, magical, origin, covert FROM features WHERE faction_id = ?")
    .all(faction.id);

  const interestsOutRaw = db
    .prepare("SELECT id, to_faction_id AS targetId, points, nature FROM interests WHERE from_faction_id = ?")
    .all(faction.id) as { id: string; targetId: string; points: number; nature: string }[];
  const interestsIn = db
    .prepare("SELECT id, from_faction_id AS sourceId, points, nature FROM interests WHERE to_faction_id = ?")
    .all(faction.id);

  const dieMax = DIE_BY_POWER[faction.power];
  const cap = interestCap(dieMax);
  const interestsOut = interestsOutRaw.map((edge) => ({
    ...edge,
    room: Math.max(0, cap - edge.points),
  }));
  const maxOutgoingPoints =
    interestsOutRaw.length > 0 ? Math.max(...interestsOutRaw.map((e) => e.points)) : 0;
  const interestRoom = interestsOutRaw.length === 0 ? cap : cap - maxOutgoingPoints;
  const trouble = sumTrouble(problems);

  return {
    ...faction,
    trouble,
    dieMax,
    features,
    problems: problemsWithBands,
    interestsOut,
    interestsIn,
    interestCap: cap,
    interestRoom,
  };
}

export function getCourt(db: Database.Database, courtId: string) {
  const court = db
    .prepare(
      `SELECT id, campaign_id, type, power_structure, atmosphere, place_id, rules_faction_id, blank
       FROM courts WHERE id = ?`,
    )
    .get(courtId) as
    | {
        id: string;
        campaign_id: string;
        type: string;
        power_structure: string;
        atmosphere: string;
        place_id: string | null;
        rules_faction_id: string | null;
        blank: number;
      }
    | undefined;
  if (!court) return null;

  type ActorRow = {
    id: string;
    name: string | null;
    role: string;
    rank: string;
    side: string;
    is_leader: number;
    is_hidden_controller: number;
    shares_authority: number;
    power_source: string | null;
  };
  const actors = (
    db
      .prepare(
        `SELECT c.id, c.name, c.role, cm.rank, cm.side, cm.is_leader, cm.is_hidden_controller, cm.shares_authority, c.power_source
         FROM characters c
         JOIN court_memberships cm ON cm.character_id = c.id
         WHERE cm.court_id = ?`,
      )
      .all(courtId) as ActorRow[]
  ).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    rank: a.rank,
    side: a.side,
    isLeader: a.is_leader !== 0,
    isHiddenController: a.is_hidden_controller !== 0,
    sharesAuthority: a.shares_authority !== 0,
    powerSource: a.power_source,
  }));

  const conflict = db
    .prepare(
      "SELECT id, text, fitted_summary, protagonist_id, antagonist_id FROM conflicts WHERE court_id = ? LIMIT 1",
    )
    .get(courtId);

  const rule = decisionMakers({
    powerStructure: court.power_structure as PowerStructure,
    actors: actors.map((a) => ({
      id: a.id,
      rank: a.rank as "major" | "minor",
      isLeader: a.isLeader,
      isHiddenController: a.isHiddenController,
      sharesAuthority: a.sharesAuthority,
    })),
  });

  return { ...court, actors, conflict, decisionRule: rule };
}

export function explainRoll(db: Database.Database, rollId: string) {
  const row = db.prepare("SELECT payload FROM rolls WHERE id = ?").get(rollId) as
    | { payload: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.payload);
}

export function cultIncome(db: Database.Database, campaignId: string) {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.level, g.divinity, g.cult_faction_id, f.power, f.harshness
       FROM godbound g
       LEFT JOIN factions f ON f.id = g.cult_faction_id
       WHERE g.campaign_id = ?`,
    )
    .all(campaignId) as {
    id: string;
    name: string;
    level: number;
    divinity: string;
    cult_faction_id: string | null;
    power: number | null;
    harshness: string | null;
  }[];

  return rows
    .filter((g) => g.divinity === "free" || g.divinity === "cult")
    .map((g) => {
      let grant = 0;
      if (g.divinity === "free") {
        grant = monthlyDominion({ kind: "free", level: g.level, power: 0, harshness: "nominal" });
      } else if (g.cult_faction_id && g.power != null) {
        grant = monthlyDominion({
          kind: "cult",
          power: g.power,
          harshness: (g.harshness ?? "nominal") as Harshness,
          level: g.level,
        });
      }
      return { godboundId: g.id, name: g.name, divinity: g.divinity, grant };
    });
}

export function interestMap(db: Database.Database, campaignId: string) {
  const edges = db
    .prepare(
      `SELECT i.id, i.from_faction_id, i.to_faction_id, i.points, i.nature, f.power
       FROM interests i
       JOIN factions f ON f.id = i.from_faction_id
       WHERE f.campaign_id = ?`,
    )
    .all(campaignId) as {
    id: string;
    from_faction_id: string;
    to_faction_id: string;
    points: number;
    nature: string;
    power: Power;
  }[];
  return edges.map((e) => ({
    ...e,
    cap: interestCap(DIE_BY_POWER[e.power]),
    room: interestCap(DIE_BY_POWER[e.power]) - e.points,
  }));
}

export function relevantFeatures(
  db: Database.Database,
  input: { factionId: string; domain: string; opposingFeatureId?: string },
) {
  const faction = db.prepare("SELECT id FROM factions WHERE id = ?").get(input.factionId);
  if (!faction) throw new RuleError("ENTITY_NOT_FOUND", `faction ${input.factionId} not found`);

  const features = db
    .prepare("SELECT id, text, domain, size, quality, magical, origin FROM features WHERE faction_id = ?")
    .all(input.factionId) as {
    id: string;
    text: string;
    domain: string;
    size: string;
    quality: string;
    magical: number;
    origin: string;
  }[];

  type OppRow = {
    domain: string;
    size: string;
    quality: string;
    magical: number;
    origin: string;
  };
  let opposing: OppRow | null = null;
  if (input.opposingFeatureId) {
    opposing =
      (db
        .prepare("SELECT domain, size, quality, magical, origin FROM features WHERE id = ?")
        .get(input.opposingFeatureId) as OppRow | undefined) ?? null;
  }

  return features
    .filter((f) => f.domain === input.domain || input.domain === "any")
    .map((f) => {
      const tags = {
        domain: f.domain as "cultural" | "military" | "economic" | "other",
        size: f.size as "normal" | "vast",
        quality: f.quality as "normal" | "superior",
        magical: f.magical !== 0,
        origin: f.origin as "native" | "improbable" | "impossible",
      };
      const bonus = opposing
        ? unevenBonus(tags, {
            domain: opposing.domain as "cultural" | "military" | "economic" | "other",
            size: opposing.size as "normal" | "vast",
            quality: opposing.quality as "normal" | "superior",
            magical: opposing.magical !== 0,
            origin: opposing.origin as "native" | "improbable" | "impossible",
          })
        : 0;
      return { ...f, unevenBonus: bonus };
    });
}
