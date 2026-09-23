import type Database from "better-sqlite3";
import {
  DIE_BY_POWER,
  RuleError,
  type Magnitude,
  type Power,
  type ProblemRef,
  type Scope,
} from "../domain/types.js";
import { quoteChange } from "../rules/cost.js";
import { mulberry32 } from "../rules/dice.js";
import { loadCatalog } from "../tables/catalog.js";

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };

export function wrapRule<T>(fn: () => T): ServiceResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (error) {
    if (error instanceof RuleError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      };
    }
    throw error;
  }
}

export function requireCampaign(db: Database.Database, campaignId: string) {
  const row = db
    .prepare("SELECT id, month, rng_seed, roll_counter FROM campaigns WHERE id = ?")
    .get(campaignId) as
    | { id: string; month: number; rng_seed: number; roll_counter: number }
    | undefined;
  if (!row) throw new RuleError("CAMPAIGN_NOT_FOUND", `campaign ${campaignId} not found`);
  return row;
}

export function requireFaction(db: Database.Database, factionId: string) {
  const row = db
    .prepare(
      `SELECT id, campaign_id, power, cohesion, dominion, control, status
       FROM factions WHERE id = ?`,
    )
    .get(factionId) as
    | {
        id: string;
        campaign_id: string;
        power: Power;
        cohesion: number;
        dominion: number;
        control: string;
        status: string;
      }
    | undefined;
  if (!row) throw new RuleError("ENTITY_NOT_FOUND", `faction ${factionId} not found`);
  if (row.status === "collapsed") {
    throw new RuleError("COLLAPSED_FACTION", `faction ${factionId} has collapsed`);
  }
  return row;
}

export function loadProblemsOrdered(db: Database.Database, factionId: string): ProblemRef[] {
  const rows = db
    .prepare(
      `SELECT id, points, intrinsic FROM problems WHERE faction_id = ? ORDER BY position ASC`,
    )
    .all(factionId) as { id: string; points: number; intrinsic: number }[];
  return rows.map((r) => ({
    id: r.id,
    points: r.points,
    intrinsic: r.intrinsic !== 0,
  }));
}

export function sumTrouble(problems: ProblemRef[]): number {
  return problems.reduce((sum, p) => sum + p.points, 0);
}

export function ensureOpenTurn(db: Database.Database, campaignId: string): string {
  const existing = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(campaignId) as { id: string } | undefined;
  if (existing) return existing.id;
  const campaign = requireCampaign(db, campaignId);
  const turnId = crypto.randomUUID();
  const seqRow = db
    .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM turns WHERE campaign_id = ?")
    .get(campaignId) as { seq: number };
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, ?, ?, ?, 1, '[]')`,
  ).run(turnId, campaignId, campaign.month, seqRow.seq);
  return turnId;
}

export function troubleRollPayload(
  roll: { faces: number; natural: number; kept: number; bonus: number; total: number; forced?: boolean },
  trouble: number,
  success: boolean,
  culpritId: string | null,
): Record<string, unknown> {
  return { ...roll, trouble, success, culpritId };
}

export function recordActionEvent(
  db: Database.Database,
  input: {
    campaignId: string;
    turnId: string;
    type: string;
    payload: Record<string, unknown>;
    visibility?: "public" | "local" | "privileged" | "hidden";
    placeId?: string | null;
  },
): void {
  const body = {
    ...input.payload,
    visibility: input.visibility ?? "public",
    placeId: input.placeId ?? null,
  };
  db.prepare(
    `INSERT INTO events (id, campaign_id, turn_id, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.campaignId,
    input.turnId,
    input.type,
    JSON.stringify(body),
    Date.now(),
  );
}

export function nextRng(db: Database.Database, campaignId: string) {
  const campaign = requireCampaign(db, campaignId);
  const rng = mulberry32(campaign.rng_seed + campaign.roll_counter);
  db.prepare("UPDATE campaigns SET roll_counter = roll_counter + 1 WHERE id = ?").run(campaignId);
  return rng;
}

export function wardRatingsForChange(db: Database.Database, placeIdsJson: string): number[] {
  const placeIds = JSON.parse(placeIdsJson) as string[];
  if (!placeIds.length) return [];
  const ratings: number[] = [];
  for (const placeId of placeIds) {
    const wards = db
      .prepare("SELECT rating FROM wards WHERE place_id = ?")
      .all(placeId) as { rating: number }[];
    for (const w of wards) ratings.push(w.rating);
  }
  return ratings;
}

export function resisterRatingsForChange(db: Database.Database, changeId: string): number[] {
  const rows = db
    .prepare("SELECT rating FROM resisters WHERE change_id = ?")
    .all(changeId) as { rating: number }[];
  return rows.map((r) => r.rating);
}

export function quoteForChangeRow(
  db: Database.Database,
  change: {
    id: string;
    scope: Scope;
    magnitude: Magnitude;
    kind: string;
    place_ids: string;
  },
) {
  return quoteChange({
    scope: change.scope,
    magnitude: change.magnitude,
    kind: change.kind as "feature" | "fact" | "problem_mitigation" | "creature_population" | "champion" | "other",
    wardRatings: wardRatingsForChange(db, change.place_ids),
    resisterRatings: resisterRatingsForChange(db, change.id),
  });
}

export function coveredOnChange(
  db: Database.Database,
  changeId: string,
  dominionSpent: number,
): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(influence), 0) AS inf FROM change_commitments WHERE change_id = ?")
    .get(changeId) as { inf: number };
  return dominionSpent + row.inf;
}

export function nextProblemPosition(db: Database.Database, factionId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM problems WHERE faction_id = ?")
    .get(factionId) as { maxPos: number };
  return row.maxPos + 1;
}

export function insertBacklashProblem(
  db: Database.Database,
  factionId: string,
  text?: string,
): string {
  const problemId = crypto.randomUUID();
  const problemText = text ?? loadCatalog().backlash[0];
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, 1, 'cultural', 0, 0, 0, ?)`,
  ).run(problemId, factionId, problemText, nextProblemPosition(db, factionId));
  return problemId;
}

export function insertFeatureFromText(
  db: Database.Database,
  factionId: string,
  featureText: string,
  tags?: {
    domain?: string;
    size?: string;
    quality?: string;
    magical?: number;
    origin?: string;
    covert?: number;
    aimedAtFactionId?: string | null;
  },
): string {
  const featureId = crypto.randomUUID();
  const domain = tags?.domain ?? "other";
  const size = tags?.size ?? "normal";
  const quality = tags?.quality ?? "normal";
  const magical = tags?.magical ?? 0;
  const origin = tags?.origin ?? "native";
  const covert = tags?.covert ?? 0;
  const aimedAt = tags?.aimedAtFactionId ?? null;
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin, aimed_at_faction_id, covert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(featureId, factionId, featureText, domain, size, quality, magical, origin, aimedAt, covert);
  const partId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, 0)",
  ).run(partId, featureId, featureText);
  return featureId;
}

export function persistRoll(
  db: Database.Database,
  campaignId: string,
  turnId: string,
  payload: unknown,
): string {
  const rollId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO rolls (id, campaign_id, turn_id, payload) VALUES (?, ?, ?, ?)",
  ).run(rollId, campaignId, turnId, JSON.stringify(payload));
  return rollId;
}

export function facesForPower(power: Power): number {
  return DIE_BY_POWER[power];
}
