import type Database from "better-sqlite3";
import {
  DIE_BY_POWER,
  RuleError,
  SCOPE_BY_POWER,
  type FillMode,
  type Power,
  type Scope,
} from "../domain/types.js";
import { championStats } from "../rules/cost.js";
import { cultBudget } from "../rules/cults.js";
import { generateCourt, type CourtDraft } from "../generate/court.js";
import {
  generateProblems,
  problemBudget,
} from "../generate/faction.js";
import { defaultFill, displayName, quarrelSummary } from "../generate/fill.js";
import { loadCatalog, pickOrRoll } from "../tables/catalog.js";
import { mulberry32 } from "../rules/dice.js";
import { withTransaction } from "../store/db.js";
import {
  insertFeatureFromText,
  nextProblemPosition,
  requireCampaign,
  wrapRule,
  type ServiceResult,
} from "./util.js";

function persistCourt(
  db: Database.Database,
  campaignId: string,
  draft: CourtDraft,
  opts: { placeId?: string | null; rulesFactionId?: string | null },
): string {
  const courtId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, place_id, rules_faction_id, blank)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    courtId,
    campaignId,
    draft.type,
    draft.powerStructure,
    draft.atmosphere,
    opts.placeId ?? null,
    opts.rulesFactionId ?? null,
    draft.blank ? 1 : 0,
  );

  const conflictId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO conflicts (id, court_id, text, fitted_summary, protagonist_id, antagonist_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    conflictId,
    courtId,
    draft.conflict.text,
    draft.conflict.fittedSummary,
    draft.conflict.protagonistId,
    draft.conflict.antagonistId,
  );

  const consId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO court_consequences (id, court_id, text) VALUES (?, ?, ?)",
  ).run(consId, courtId, draft.destruction.text);
  const defId = crypto.randomUUID();
  db.prepare("INSERT INTO court_defenses (id, court_id, text) VALUES (?, ?, ?)").run(
    defId,
    courtId,
    draft.defense.text,
  );

  for (const actor of draft.actors) {
    const charId = actor.id;
    db.prepare(
      `INSERT INTO characters (
        id, campaign_id, name, role, court_id, faction_id, problem_id, power_source, side,
        is_leader, is_hidden_controller, shares_authority, minor_relationship
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      charId,
      campaignId,
      actor.name,
      actor.role,
      courtId,
      actor.powerSource,
      actor.side,
      actor.isLeader ? 1 : 0,
      actor.isHiddenController ? 1 : 0,
      actor.sharesAuthority ? 1 : 0,
      actor.minorRelationship,
    );
    db.prepare(
      `INSERT INTO court_memberships (court_id, character_id, rank, side, is_leader, is_hidden_controller, shares_authority, minor_relationship)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      courtId,
      charId,
      actor.rank,
      actor.side,
      actor.isLeader ? 1 : 0,
      actor.isHiddenController ? 1 : 0,
      actor.sharesAuthority ? 1 : 0,
      actor.minorRelationship,
    );
  }
  return courtId;
}

export function createCampaign(
  db: Database.Database,
  input: { name: string; rngSeed?: number; nameLists?: Record<string, string[]> },
): ServiceResult<{ campaignId: string; rngSeed: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const campaignId = crypto.randomUUID();
      const rngSeed = input.rngSeed ?? Math.floor(Math.random() * 0xffffffff);
      db.prepare(
        `INSERT INTO campaigns (id, name, month, rng_seed, roll_counter, name_lists)
         VALUES (?, ?, 1, ?, 0, ?)`,
      ).run(campaignId, input.name, rngSeed, JSON.stringify(input.nameLists ?? {}));
      return { campaignId, rngSeed };
    }),
  );
}

export function createPlace(
  db: Database.Database,
  input: {
    campaignId: string;
    name: string;
    scope: Scope;
    parentPlaceId?: string;
    cultureId?: string;
    wards?: { rating: number }[];
  },
): ServiceResult<{ placeId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const placeId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO places (id, campaign_id, name, scope, parent_place_id, culture_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        placeId,
        input.campaignId,
        input.name,
        input.scope,
        input.parentPlaceId ?? null,
        input.cultureId ?? null,
      );
      for (const ward of input.wards ?? []) {
        db.prepare(
          "INSERT INTO wards (id, place_id, rating) VALUES (?, ?, ?)",
        ).run(crypto.randomUUID(), placeId, ward.rating);
      }
      return { placeId };
    }),
  );
}

export function createGodbound(
  db: Database.Database,
  input: {
    campaignId: string;
    name: string;
    level: number;
    words?: string[];
    influence?: number;
    dominion?: number;
    wealth?: number;
    divinity?: "none" | "free" | "cult";
  },
): ServiceResult<{ godboundId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const godboundId = crypto.randomUUID();
      const influence = input.influence ?? 1 + input.level;
      db.prepare(
        `INSERT INTO godbound (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        godboundId,
        input.campaignId,
        input.name,
        input.level,
        JSON.stringify(input.words ?? []),
        influence,
        input.dominion ?? 0,
        input.wealth ?? 0,
        input.divinity ?? "none",
      );
      return { godboundId };
    }),
  );
}

export function createFaction(
  db: Database.Database,
  input: {
    campaignId: string;
    name: string;
    power: Power;
    cohesion?: number;
    dominion?: number;
    origin?: "existing" | "forged";
    behavior: string;
    control?: "npc" | "player";
    homePlaceId?: string;
    fill?: FillMode;
    seed?: number;
    pressure?: "prosperous" | "strained" | "crisis";
    crisisBand?: "half" | "three-quarter";
    featureCount?: number;
  },
): ServiceResult<{ factionId: string; advisories: string[] }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      if (input.cohesion != null && input.cohesion > input.power) {
        throw new RuleError("COHESION_ABOVE_POWER", "cohesion cannot exceed power");
      }
      const factionId = crypto.randomUUID();
      const origin = input.origin ?? "existing";
      const dominion =
        input.dominion ?? (origin === "existing" ? input.power : 0);
      const cohesion = input.cohesion ?? input.power;
      db.prepare(
        `INSERT INTO factions (
          id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
          auto_intervene, status, home_place_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)`,
      ).run(
        factionId,
        input.campaignId,
        input.name,
        input.power,
        cohesion,
        dominion,
        origin,
        input.behavior,
        input.control ?? "npc",
        input.homePlaceId ?? null,
      );

      const advisories: string[] = [];
      const fill = defaultFill(input.fill);
      const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff);
      const rng = mulberry32(seed);
      const dieMax = DIE_BY_POWER[input.power];
      const budget = problemBudget(
        dieMax,
        input.pressure ?? "prosperous",
        input.crisisBand ?? "half",
      );
      const catalog = loadCatalog();
      const problems = generateProblems(budget, rng, catalog);
      for (let i = 0; i < problems.length; i++) {
        const p = problems[i];
        db.prepare(
          `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
           VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`,
        ).run(crypto.randomUUID(), factionId, p.text, p.points, p.domain, i);
      }

      const featureTarget = input.featureCount ?? input.power;
      if (featureTarget === 0 || featureTarget > input.power + 2) {
        advisories.push(`feature count ${featureTarget} is outside the usual band for power ${input.power}`);
      }
      for (let i = 0; i < featureTarget; i++) {
        const domain = ["cultural", "military", "economic"][i % 3];
        const text = pickOrRoll(catalog, `features.${domain}`, rng).text;
        insertFeatureFromText(db, factionId, text, { domain });
      }

      return { factionId, advisories };
    }),
  );
}

export function createCourt(
  db: Database.Database,
  input: {
    campaignId: string;
    fill?: FillMode;
    seed?: number;
    placeId?: string;
    rulesFactionId?: string;
    type?: string;
    powerStructure?: string;
    conflict?: string;
    atmosphere?: string;
    majorCount?: number;
    minorCount?: number;
    names?: string[];
  },
): ServiceResult<{ courtId: string; advisories: string[] }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff);
      const draft = generateCourt({
        fill: defaultFill(input.fill),
        seed,
        type: input.type,
        powerStructure: input.powerStructure,
        conflict: input.conflict,
        atmosphere: input.atmosphere,
        majorCount: input.majorCount,
        minorCount: input.minorCount,
        names: input.names,
      });
      const courtId = persistCourt(db, input.campaignId, draft, {
        placeId: input.placeId,
        rulesFactionId: input.rulesFactionId,
      });
      return { courtId, advisories: draft.advisories };
    }),
  );
}

export function seedCampaign(
  db: Database.Database,
  input: {
    name: string;
    fill?: FillMode;
    seed?: number;
    linkInterests?: boolean;
    rulingCourts?: boolean;
    outline?: {
      places?: {
        key: string;
        name: string;
        scope?: Scope;
        parentKey?: string;
        cultureId?: string;
      }[];
      factions?: {
        key: string;
        name: string;
        homePlaceKey?: string;
        power?: Power;
        behavior?: string;
        courtType?: string;
        neighborKeys?: string[];
      }[];
    };
  },
): ServiceResult<{ campaignId: string; seed: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff);
      const created = createCampaign(db, { name: input.name, rngSeed: seed });
      if (!created.ok) throw new RuleError(created.error.code, created.error.message);
      const campaignId = created.data.campaignId;
      const fill = defaultFill(input.fill);
      const placeIds = new Map<string, string>();

      for (const place of input.outline?.places ?? []) {
        const scope = place.scope ?? (fill === "require" ? undefined : "village");
        if (!scope) throw new RuleError("FILL_INCOMPLETE", "place scope required");
        const parentPlaceId = place.parentKey ? placeIds.get(place.parentKey) : undefined;
        const res = createPlace(db, {
          campaignId,
          name: place.name,
          scope,
          parentPlaceId,
          cultureId: place.cultureId,
        });
        if (!res.ok) throw new RuleError(res.error.code, res.error.message);
        placeIds.set(place.key, res.data.placeId);
      }

      const factionIds = new Map<string, string>();
      for (const fac of input.outline?.factions ?? []) {
        let power = fac.power;
        if (!power && fac.homePlaceKey) {
          const place = input.outline?.places?.find((p) => p.key === fac.homePlaceKey);
          const scope = place?.scope ?? "village";
          const scopeToPower: Record<string, Power> = {
            village: 1,
            city: 2,
            region: 3,
            nation: 4,
            realm: 5,
          };
          power = scopeToPower[scope] ?? 1;
        }
        power = power ?? 1;
        const res = createFaction(db, {
          campaignId,
          name: fac.name,
          power,
          behavior: fac.behavior ?? "self_absorbed_survivor",
          homePlaceId: fac.homePlaceKey ? placeIds.get(fac.homePlaceKey) : undefined,
          fill,
          seed: seed + factionIds.size,
        });
        if (!res.ok) throw new RuleError(res.error.code, res.error.message);
        factionIds.set(fac.key, res.data.factionId);

        if (input.rulingCourts) {
          createCourt(db, {
            campaignId,
            fill,
            seed: seed + 100 + factionIds.size,
            placeId: fac.homePlaceKey ? placeIds.get(fac.homePlaceKey) : undefined,
            rulesFactionId: res.data.factionId,
            type: fac.courtType,
          });
        }
      }

      const link = input.linkInterests ?? (factionIds.size >= 2);
      if (link) {
        const catalog = loadCatalog();
        const rng = mulberry32(seed + 999);
        const keys = [...factionIds.keys()];
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            const aKey = keys[i];
            const bKey = keys[j];
            const aFac = input.outline?.factions?.find((f) => f.key === aKey);
            const bFac = input.outline?.factions?.find((f) => f.key === bKey);
            const neighbors =
              aFac?.neighborKeys?.includes(bKey) ||
              bFac?.neighborKeys?.includes(aKey) ||
              shareParentPlace(input.outline?.places ?? [], aFac?.homePlaceKey, bFac?.homePlaceKey);
            if (!neighbors && factionIds.size > 2) continue;
            const aId = factionIds.get(aKey)!;
            const bId = factionIds.get(bKey)!;
            const aPower = db.prepare("SELECT power FROM factions WHERE id = ?").get(aId) as {
              power: Power;
            };
            const bPower = db.prepare("SELECT power FROM factions WHERE id = ?").get(bId) as {
              power: Power;
            };
            const nature = pickOrRoll(catalog, "interestNature", rng).text;
            const natureRow = catalog.interestNature.find((n) => n.text === nature)?.id ?? "alliance";
            db.prepare(
              `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(crypto.randomUUID(), aId, bId, DIE_BY_POWER[aPower.power], natureRow);
            db.prepare(
              `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(crypto.randomUUID(), bId, aId, DIE_BY_POWER[bPower.power], natureRow);
          }
        }
      }

      return { campaignId, seed };
    }),
  );
}

function shareParentPlace(
  places: { key: string; parentKey?: string }[],
  a?: string,
  b?: string,
): boolean {
  if (!a || !b) return false;
  const pa = places.find((p) => p.key === a);
  const pb = places.find((p) => p.key === b);
  if (!pa || !pb) return false;
  return pa.parentKey === pb.parentKey || pa.key === pb.parentKey || pb.key === pa.parentKey;
}

export function fitBlank(
  db: Database.Database,
  input: { campaignId: string; courtId?: string; characterId?: string; fittedSummary?: string },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const lists = JSON.parse(
        (db.prepare("SELECT name_lists FROM campaigns WHERE id = ?").get(input.campaignId) as {
          name_lists: string;
        }).name_lists,
      ) as Record<string, string[]>;
      const used = new Set(
        (
          db
            .prepare("SELECT name FROM characters WHERE campaign_id = ? AND name IS NOT NULL")
            .all(input.campaignId) as { name: string }[]
        ).map((r) => r.name),
      );

      if (input.courtId) {
        const court = db
          .prepare("SELECT id, blank FROM courts WHERE id = ? AND campaign_id = ?")
          .get(input.courtId, input.campaignId) as { id: string; blank: number } | undefined;
        if (!court) throw new RuleError("ENTITY_NOT_FOUND", "court not found");
        const chars = db
          .prepare(
            `SELECT c.id, c.name, c.role FROM characters c
             JOIN court_memberships cm ON cm.character_id = c.id WHERE cm.court_id = ?`,
          )
          .all(input.courtId) as { id: string; name: string | null; role: string }[];
        let n = 1;
        for (const ch of chars) {
          if (ch.name == null) {
            const fromCulture = pickCultureName(lists, used);
            const name = fromCulture ?? `Unnamed ${ch.role} ${n++}`;
            if (used.has(name)) throw new RuleError("NAME_TAKEN", `name ${name} already used`);
            used.add(name);
            db.prepare("UPDATE characters SET name = ? WHERE id = ?").run(name, ch.id);
          }
        }
        const conflict = db
          .prepare("SELECT protagonist_id, antagonist_id, text FROM conflicts WHERE court_id = ?")
          .get(input.courtId) as {
          protagonist_id: string;
          antagonist_id: string;
          text: string;
        };
        const pro = db
          .prepare("SELECT name FROM characters WHERE id = ?")
          .get(conflict.protagonist_id) as { name: string };
        const ant = db
          .prepare("SELECT name FROM characters WHERE id = ?")
          .get(conflict.antagonist_id) as { name: string };
        const summary =
          input.fittedSummary ??
          quarrelSummary("missing", pro.name, conflict.text, ant.name);
        db.prepare("UPDATE conflicts SET fitted_summary = ? WHERE court_id = ?").run(
          summary,
          input.courtId,
        );
        db.prepare("UPDATE courts SET blank = 0 WHERE id = ?").run(input.courtId);
        return { courtId: input.courtId, fittedSummary: summary };
      }

      if (input.characterId) {
        const ch = db
          .prepare("SELECT id, name, role FROM characters WHERE id = ? AND campaign_id = ?")
          .get(input.characterId, input.campaignId) as
          | { id: string; name: string | null; role: string }
          | undefined;
        if (!ch) throw new RuleError("ENTITY_NOT_FOUND", "character not found");
        if (ch.name == null) {
          const fromCulture = pickCultureName(lists, used);
          const name = fromCulture ?? `Unnamed ${ch.role} 1`;
          if (used.has(name)) throw new RuleError("NAME_TAKEN", `name ${name} already used`);
          db.prepare("UPDATE characters SET name = ? WHERE id = ?").run(name, ch.id);
        }
        return { characterId: ch.id };
      }

      throw new RuleError("FILL_INCOMPLETE", "courtId or characterId required");
    }),
  );
}

function pickCultureName(lists: Record<string, string[]>, used: Set<string>): string | null {
  for (const names of Object.values(lists)) {
    for (const name of names) {
      if (!used.has(name)) return name;
    }
  }
  return null;
}

export function createCharacter(
  db: Database.Database,
  input: {
    campaignId: string;
    role: string;
    fill?: FillMode;
    name?: string;
    courtId?: string;
    factionId?: string;
    side?: string;
  },
): ServiceResult<{ characterId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const fill = defaultFill(input.fill);
      const name = displayName(fill, input.role, input.name);
      const characterId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO characters (
          id, campaign_id, name, role, court_id, faction_id, side, is_leader, is_hidden_controller, shares_authority
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
      ).run(
        characterId,
        input.campaignId,
        name,
        input.role,
        input.courtId ?? null,
        input.factionId ?? null,
        input.side ?? "unaffiliated",
      );
      return { characterId };
    }),
  );
}

export function createFact(
  db: Database.Database,
  input: {
    campaignId: string;
    subject: "place" | "faction" | "character" | "court";
    subjectId: string;
    fill?: FillMode;
    statement?: string;
    kind?: string;
    visibility?: string;
  },
): ServiceResult<{ factId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const fill = defaultFill(input.fill);
      if (fill === "missing" && !input.statement) {
        throw new RuleError("FILL_INCOMPLETE", "statement required in missing mode");
      }
      const statement = fill === "blank" ? null : (input.statement ?? null);
      if (statement === null && fill !== "blank") {
        throw new RuleError("FILL_INCOMPLETE", "statement required");
      }
      const factId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        factId,
        input.campaignId,
        input.subject,
        input.subjectId,
        statement,
        input.kind ?? "explicit",
        input.visibility ?? "public",
      );
      return { factId };
    }),
  );
}

export function ensureSetpiece(
  db: Database.Database,
  input: {
    campaignId: string;
    key: string;
    need: "court" | "challenge" | "character" | "fact" | "problem_face";
    placeId?: string;
    changeId?: string;
    problemId?: string;
    courtId?: string;
    fill?: FillMode;
    seed?: number;
  },
): ServiceResult<{ setpieceId: string; created: boolean }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const existing = db
        .prepare("SELECT id FROM setpieces WHERE campaign_id = ? AND key = ?")
        .get(input.campaignId, input.key) as { id: string } | undefined;
      if (existing) return { setpieceId: existing.id, created: false };

      const setpieceId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO setpieces (id, campaign_id, key, need, status) VALUES (?, ?, ?, ?, 'ready')",
      ).run(setpieceId, input.campaignId, input.key, input.need);

      const fill = defaultFill(input.fill);
      const seed = input.seed ?? Math.floor(Math.random() * 0xffffffff);

      if (input.need === "court") {
        createCourt(db, { campaignId: input.campaignId, fill, seed, placeId: input.placeId });
      } else if (input.need === "challenge") {
        if (!input.changeId) throw new RuleError("FILL_INCOMPLETE", "changeId required");
        const catalog = loadCatalog();
        const kinds = Object.keys(catalog.challenges);
        const kind = kinds[0];
        const text = catalog.challenges[kind][0];
        db.prepare(
          "INSERT INTO challenges (id, kind, text, change_id, status) VALUES (?, ?, ?, ?, 'open')",
        ).run(crypto.randomUUID(), kind, text, input.changeId);
      } else if (input.need === "character") {
        createCharacter(db, { campaignId: input.campaignId, role: "Local figure", fill });
      } else if (input.need === "fact") {
        if (fill === "missing" && !input.placeId) {
          throw new RuleError("FILL_INCOMPLETE", "statement or subject required for fact");
        }
        createFact(db, {
          campaignId: input.campaignId,
          subject: "place",
          subjectId: input.placeId ?? input.campaignId,
          fill,
        });
      } else if (input.need === "problem_face") {
        if (!input.problemId) throw new RuleError("FILL_INCOMPLETE", "problemId required");
        const roles = [
          "leader",
          "victim",
          "profiteer",
          "fanatic",
          "outsider",
          "reluctant enforcer",
        ];
        const rng = mulberry32(seed);
        const role = roles[Math.floor(rng.next() * roles.length)];
        const ch = createCharacter(db, {
          campaignId: input.campaignId,
          role,
          fill,
        });
        if (ch.ok) {
          db.prepare("UPDATE characters SET problem_id = ? WHERE id = ?").run(
            input.problemId,
            ch.data.characterId,
          );
        }
      }

      return { setpieceId, created: true };
    }),
  );
}

export function createChallenge(
  db: Database.Database,
  input: { changeId: string; kind: string; text?: string; fill?: FillMode; seed?: number },
): ServiceResult<{ challengeId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const change = db.prepare("SELECT id FROM changes WHERE id = ?").get(input.changeId);
      if (!change) throw new RuleError("ENTITY_NOT_FOUND", "change not found");
      const catalog = loadCatalog();
      const seed = input.seed ?? 1;
      const rng = mulberry32(seed);
      const text =
        input.text ?? pickOrRoll(catalog, `challenges.${input.kind}`, rng).text;
      const challengeId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO challenges (id, kind, text, change_id, status) VALUES (?, ?, ?, ?, 'open')",
      ).run(challengeId, input.kind, text, input.changeId);
      return { challengeId };
    }),
  );
}

export function recordDeed(
  db: Database.Database,
  input: { changeId: string },
): ServiceResult<{ deedsDone: number; deedsRequired: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const change = db
        .prepare("SELECT deeds_done, deeds_required FROM changes WHERE id = ?")
        .get(input.changeId) as { deeds_done: number; deeds_required: number } | undefined;
      if (!change) throw new RuleError("ENTITY_NOT_FOUND", "change not found");
      if (change.deeds_done >= change.deeds_required) {
        throw new RuleError("CHANGE_NOT_READY", "no deeds left to record");
      }
      const deedsDone = change.deeds_done + 1;
      db.prepare("UPDATE changes SET deeds_done = ? WHERE id = ?").run(deedsDone, input.changeId);
      return { deedsDone, deedsRequired: change.deeds_required };
    }),
  );
}

export function recordChallengeOutcome(
  db: Database.Database,
  input: { challengeId: string; overcome: boolean },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const ch = db
        .prepare("SELECT id, change_id, status FROM challenges WHERE id = ?")
        .get(input.challengeId) as { id: string; change_id: string; status: string } | undefined;
      if (!ch) throw new RuleError("ENTITY_NOT_FOUND", "challenge not found");
      if (!input.overcome) return { status: ch.status };
      db.prepare("UPDATE challenges SET status = 'overcome' WHERE id = ?").run(ch.id);
      const change = db
        .prepare("SELECT challenges_done, challenges_required FROM changes WHERE id = ?")
        .get(ch.change_id) as { challenges_done: number; challenges_required: number };
      const done = change.challenges_done + 1;
      db.prepare("UPDATE changes SET challenges_done = ? WHERE id = ?").run(done, ch.change_id);
      return { status: "overcome", challengesDone: done };
    }),
  );
}

export function createChampion(
  db: Database.Database,
  input: { campaignId: string; godboundId: string; level: number; loyal?: boolean },
): ServiceResult<{ stats: ReturnType<typeof championStats> }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const gb = db
        .prepare("SELECT dominion FROM godbound WHERE id = ? AND campaign_id = ?")
        .get(input.godboundId, input.campaignId) as { dominion: number } | undefined;
      if (!gb) throw new RuleError("ENTITY_NOT_FOUND", "godbound not found");
      if (gb.dominion < 8) throw new RuleError("INSUFFICIENT_DOMINION", "champion costs 8 dominion");
      db.prepare("UPDATE godbound SET dominion = dominion - 8 WHERE id = ?").run(input.godboundId);
      const stats = championStats(input.level, input.loyal ?? false);
      const changeId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO changes (id, campaign_id, scope, magnitude, kind, place_ids, owner, status, dominion_spent, deeds_required, deeds_done, challenges_required, challenges_done)
         VALUES (?, ?, 'village', 'plausible', 'champion', '[]', 'pc', 'active', 8, 0, 0, 0, 0)`,
      ).run(changeId, input.campaignId);
      return { stats, changeId };
    }),
  );
}

export function recordShatter(
  db: Database.Database,
  input: {
    campaignId: string;
    factionId: string;
    outcome: "splintered" | "conquered" | "abandoned" | "other";
    statement: string;
    successorFactionIds?: string[];
  },
): ServiceResult<{ factId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const factId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility)
         VALUES (?, ?, 'faction', ?, ?, 'explicit', 'public')`,
      ).run(factId, input.campaignId, input.factionId, input.statement);
      return { factId, outcome: input.outcome, successors: input.successorFactionIds ?? [] };
    }),
  );
}

const USURPER_TEXT =
  "Usurpers and restorationists are moving against the new hand on the court.";

export function swayCourt(
  db: Database.Database,
  input: {
    campaignId: string;
    courtId: string;
    targetType: "godbound" | "faction";
    targetId: string;
    mode: "favor" | "control";
    prepared?: boolean;
    statement?: string;
  },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const court = db
        .prepare("SELECT id, rules_faction_id FROM courts WHERE id = ? AND campaign_id = ?")
        .get(input.courtId, input.campaignId) as { id: string; rules_faction_id: string | null } | undefined;
      if (!court) throw new RuleError("ENTITY_NOT_FOUND", "court not found");

      const statement =
        input.statement ?? loadCatalog().minorRelationship[0].text;
      const factId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility)
         VALUES (?, ?, 'court', ?, ?, 'explicit', 'public')`,
      ).run(factId, input.campaignId, input.courtId, statement);

      db.prepare(
        `INSERT INTO court_dispositions (court_id, target_type, target_id, disposition)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(court_id, target_type, target_id) DO UPDATE SET disposition = excluded.disposition`,
      ).run(input.courtId, input.targetType, input.targetId, input.mode);

      if (input.mode === "control" && court.rules_faction_id && !input.prepared) {
        db.prepare("UPDATE factions SET contested_control = 1 WHERE id = ?").run(
          court.rules_faction_id,
        );
        db.prepare(
          `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
           VALUES (?, ?, ?, 2, 'cultural', 0, 0, 0, ?)`,
        ).run(
          crypto.randomUUID(),
          court.rules_faction_id,
          USURPER_TEXT,
          nextProblemPosition(db, court.rules_faction_id),
        );
      }
      return { factId, mode: input.mode };
    }),
  );
}

export function formCult(
  db: Database.Database,
  input: {
    campaignId: string;
    godboundId: string;
    featureText: string;
    harshness?: string;
    acknowledged?: boolean;
    adoptFactionId?: string;
    name?: string;
  },
): ServiceResult<{ factionId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      if (!input.acknowledged) {
        throw new RuleError("FILL_INCOMPLETE", "acknowledged worshippers required");
      }
      requireCampaign(db, input.campaignId);
      const gb = db
        .prepare("SELECT id, divinity FROM godbound WHERE id = ? AND campaign_id = ?")
        .get(input.godboundId, input.campaignId) as { id: string; divinity: string } | undefined;
      if (!gb) throw new RuleError("ENTITY_NOT_FOUND", "godbound not found");

      let factionId = input.adoptFactionId;
      if (!factionId) {
        const created = createFaction(db, {
          campaignId: input.campaignId,
          name: input.name ?? "Cult",
          power: 1,
          behavior: "directed",
          origin: "forged",
        });
        if (!created.ok) throw new RuleError(created.error.code, created.error.message);
        factionId = created.data.factionId;
        db.prepare("UPDATE factions SET cult = 1, patron_godbound_id = ?, harshness = ? WHERE id = ?").run(
          input.godboundId,
          input.harshness ?? "nominal",
          factionId,
        );
      } else {
        db.prepare(
          "UPDATE factions SET cult = 1, patron_godbound_id = ?, harshness = ? WHERE id = ?",
        ).run(input.godboundId, input.harshness ?? "nominal", factionId);
      }

      insertFeatureFromText(db, factionId, input.featureText);
      const power = 1 as Power;
      const budget = cultBudget((input.harshness ?? "nominal") as import("../domain/types.js").Harshness, DIE_BY_POWER[power]);
      if (budget > 0) {
        db.prepare(
          `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
           VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, 0)`,
        ).run(crypto.randomUUID(), factionId, input.featureText, budget);
      }

      db.prepare("UPDATE godbound SET divinity = 'cult', cult_faction_id = ? WHERE id = ?").run(
        factionId,
        input.godboundId,
      );
      return { factionId };
    }),
  );
}

export function setTheology(
  db: Database.Database,
  input: {
    campaignId: string;
    cultFactionId: string;
    harshness?: string;
    featureText?: string;
  },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const faction = db
        .prepare("SELECT id, power, cohesion, cult FROM factions WHERE id = ? AND campaign_id = ?")
        .get(input.cultFactionId, input.campaignId) as
        | { id: string; power: Power; cohesion: number; cult: number }
        | undefined;
      if (!faction || faction.cult === 0) {
        throw new RuleError("ENTITY_NOT_FOUND", "cult faction not found");
      }

      const turnId = ensureInternalTurnSlot(db, input.campaignId, faction.id);

      if (faction.power <= 1) {
        db.prepare("UPDATE factions SET status = 'collapsed', cohesion = 0 WHERE id = ?").run(
          faction.id,
        );
        db.prepare(
          `INSERT INTO events (id, campaign_id, turn_id, type, payload, created_at)
           VALUES (?, ?, ?, 'faction_collapsed', ?, ?)`,
        ).run(
          crypto.randomUUID(),
          input.campaignId,
          turnId,
          JSON.stringify({ reason: "theology", factionId: faction.id }),
          Date.now(),
        );
        return { collapsed: true };
      }

      const newPower = (faction.power - 1) as Power;
      const newCohesion = Math.min(faction.cohesion, newPower);
      db.prepare("UPDATE factions SET power = ?, cohesion = ?, harshness = ? WHERE id = ?").run(
        newPower,
        newCohesion,
        input.harshness ?? "nominal",
        faction.id,
      );
      rescaleIntrinsic(db, faction.id, newPower, input.harshness ?? "nominal");
      if (input.featureText) {
        const feat = db
          .prepare("SELECT id FROM features WHERE faction_id = ? LIMIT 1")
          .get(faction.id) as { id: string } | undefined;
        if (feat) {
          db.prepare("UPDATE features SET text = ? WHERE id = ?").run(input.featureText, feat.id);
        }
      }
      return { power: newPower, cohesion: newCohesion };
    }),
  );
}

function ensureInternalTurnSlot(db: Database.Database, campaignId: string, factionId: string): string | null {
  const turn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(campaignId) as { id: string } | undefined;
  let turnId = turn?.id;
  if (!turnId) {
    turnId = crypto.randomUUID();
    const campaign = requireCampaign(db, campaignId);
    db.prepare(
      `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order) VALUES (?, ?, ?, 1, 1, '[]')`,
    ).run(turnId, campaignId, campaign.month);
  }
  const internal = db
    .prepare(
      `SELECT id FROM actions WHERE turn_id = ? AND actor_id = ? AND type IN ('set_theology', 'build_strength', 'enact_change') LIMIT 1`,
    )
    .get(turnId, factionId);
  if (internal) throw new RuleError("INTERNAL_BUDGET", "internal action already taken");
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, outcome) VALUES (?, ?, 'set_theology', 'faction', ?, 'success')`,
  ).run(crypto.randomUUID(), turnId, factionId);
  return turnId;
}

function rescaleIntrinsic(db: Database.Database, factionId: string, power: Power, harshness: string) {
  const budget = cultBudget(harshness as import("../domain/types.js").Harshness, DIE_BY_POWER[power]);
  const rows = db
    .prepare("SELECT id, points FROM problems WHERE faction_id = ? AND intrinsic = 1 ORDER BY position ASC")
    .all(factionId) as { id: string; points: number }[];
  const total = rows.reduce((s, r) => s + r.points, 0);
  if (total === budget) return;
  if (rows.length === 0 && budget > 0) {
    const text = loadCatalog().problems.cultural[0];
    db.prepare(
      `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
       VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, 0)`,
    ).run(crypto.randomUUID(), factionId, text, budget);
    return;
  }
  if (budget > total && rows[0]) {
    db.prepare("UPDATE problems SET points = ? WHERE id = ?").run(total + (budget - total), rows[0].id);
  } else if (budget < total) {
    let remaining = total - budget;
    for (let i = rows.length - 1; i >= 0 && remaining > 0; i--) {
      const row = rows[i];
      const drop = Math.min(row.points, remaining);
      const next = row.points - drop;
      if (next <= 0) db.prepare("DELETE FROM problems WHERE id = ?").run(row.id);
      else db.prepare("UPDATE problems SET points = ? WHERE id = ?").run(next, row.id);
      remaining -= drop;
    }
  }
}

export function setDivinity(
  db: Database.Database,
  input: {
    campaignId: string;
    godboundId: string;
    divinity: "none" | "free" | "cult";
    gmOverride?: boolean;
  },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const gb = db
        .prepare("SELECT id, divinity, cult_faction_id FROM godbound WHERE id = ? AND campaign_id = ?")
        .get(input.godboundId, input.campaignId) as
        | { id: string; divinity: string; cult_faction_id: string | null }
        | undefined;
      if (!gb) throw new RuleError("ENTITY_NOT_FOUND", "godbound not found");
      if (input.divinity === "free" && gb.cult_faction_id && !input.gmOverride) {
        throw new RuleError("FILL_INCOMPLETE", "gmOverride required to clear cult");
      }
      const cultFactionId = input.divinity === "free" ? null : gb.cult_faction_id;
      db.prepare("UPDATE godbound SET divinity = ?, cult_faction_id = ? WHERE id = ?").run(
        input.divinity,
        cultFactionId,
        input.godboundId,
      );
      return { divinity: input.divinity };
    }),
  );
}

export function setPower(
  db: Database.Database,
  input: { campaignId: string; factionId: string; power: Power },
): ServiceResult<Record<string, unknown>> {
  return wrapRule(() =>
    withTransaction(db, () => {
      if (input.power < 1 || input.power > 5) {
        throw new RuleError("POWER_OUT_OF_RANGE", "power must be 1-5");
      }
      const faction = db
        .prepare("SELECT id, cohesion FROM factions WHERE id = ? AND campaign_id = ?")
        .get(input.factionId, input.campaignId) as { id: string; cohesion: number } | undefined;
      if (!faction) throw new RuleError("ENTITY_NOT_FOUND", "faction not found");
      const cohesion = Math.min(faction.cohesion, input.power);
      db.prepare("UPDATE factions SET power = ?, cohesion = ? WHERE id = ?").run(
        input.power,
        cohesion,
        input.factionId,
      );
      const cult = db
        .prepare("SELECT cult, harshness FROM factions WHERE id = ?")
        .get(input.factionId) as { cult: number; harshness: string | null };
      if (cult.cult) {
        rescaleIntrinsic(db, input.factionId, input.power, cult.harshness ?? "nominal");
      }
      return { power: input.power, cohesion };
    }),
  );
}
