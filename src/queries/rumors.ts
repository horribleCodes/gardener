import type Database from "better-sqlite3";
import { DIE_BY_POWER, type Power } from "../domain/types.js";
import { sumTrouble, loadProblemsOrdered } from "../services/util.js";

export function worldBrief(db: Database.Database, campaignId: string) {
  const campaign = db
    .prepare("SELECT month FROM campaigns WHERE id = ?")
    .get(campaignId) as { month: number } | undefined;
  if (!campaign) return null;

  const factions = db
    .prepare(
      `SELECT id, name, power, cohesion, status FROM factions WHERE campaign_id = ?`,
    )
    .all(campaignId) as {
    id: string;
    name: string;
    power: Power;
    cohesion: number;
    status: string;
  }[];

  const factionBriefs = factions.map((f) => {
    const problems = loadProblemsOrdered(db, f.id);
    const trouble = sumTrouble(problems);
    const dieMax = DIE_BY_POWER[f.power];
    return {
      id: f.id,
      name: f.name,
      power: f.power,
      trouble,
      cohesion: f.cohesion,
      status: f.status,
      collapseMargin: dieMax - trouble,
    };
  });

  const courts = db
    .prepare(
      `SELECT id, type, place_id FROM courts WHERE campaign_id = ?`,
    )
    .all(campaignId) as { id: string; type: string; place_id: string | null }[];

  const openChanges = db
    .prepare(
      `SELECT id, faction_id, status FROM changes
       WHERE campaign_id = ? AND status NOT IN ('resolved', 'failed')`,
    )
    .all(campaignId) as { id: string; faction_id: string | null; status: string }[];

  return {
    month: campaign.month,
    factions: factionBriefs,
    courts: courts.map((c) => ({
      id: c.id,
      type: c.type,
      placeId: c.place_id,
    })),
    openChanges: openChanges.map((ch) => ({
      id: ch.id,
      factionId: ch.faction_id,
      state: ch.status,
    })),
  };
}

export function rumorLines(db: Database.Database, campaignId: string): string[] {
  const turn = db
    .prepare(
      `SELECT id FROM turns WHERE campaign_id = ? AND open = 0 ORDER BY sequence DESC LIMIT 1`,
    )
    .get(campaignId) as { id: string } | undefined;
  if (!turn) return [];

  const actions = db
    .prepare(
      `SELECT a.type, a.actor_id, a.target_id, a.feature_ids, a.outcome, a.roll_id,
              fa.name AS actor_name, ft.name AS target_name
       FROM actions a
       JOIN factions fa ON fa.id = a.actor_id
       LEFT JOIN factions ft ON ft.id = a.target_id
       WHERE a.turn_id = ? AND a.actor_type = 'faction'`,
    )
    .all(turn.id) as {
    type: string;
    actor_id: string;
    target_id: string | null;
    feature_ids: string;
    outcome: string | null;
    roll_id: string | null;
    actor_name: string;
    target_name: string | null;
  }[];

  const lines: string[] = [];
  for (const action of actions) {
    const featureIds = JSON.parse(action.feature_ids) as (string | null)[];
    const featureId = featureIds.find((id) => id != null);
    let featureLabel = "no asset";
    if (featureId) {
      const feature = db
        .prepare("SELECT text FROM features WHERE id = ?")
        .get(featureId) as { text: string } | undefined;
      featureLabel = feature?.text ?? "an undisclosed asset";
    }

    const target = action.target_name ?? "themselves";
    const outcome = action.outcome ?? "unknown";

    let reason = "unknown";
    if (action.roll_id) {
      const roll = db
        .prepare("SELECT payload FROM rolls WHERE id = ?")
        .get(action.roll_id) as { payload: string } | undefined;
      if (roll) {
        const payload = JSON.parse(roll.payload) as Record<string, unknown>;
        if (payload.culpritId && typeof payload.culpritId === "string") {
          const problem = db
            .prepare("SELECT text FROM problems WHERE id = ?")
            .get(payload.culpritId) as { text: string } | undefined;
          reason = problem?.text ?? payload.culpritId;
        } else if (payload.winner === "attacker") {
          reason = "won the contest";
        } else if (payload.winner === "defender") {
          reason = "lost the contest";
        } else if (payload.success === false && payload.culpritId) {
          const culpritId = payload.culpritId as string;
          const problem = db
            .prepare("SELECT text FROM problems WHERE id = ?")
            .get(culpritId) as { text: string } | undefined;
          reason = problem?.text ?? culpritId;
        }
      }
    }
    if (action.outcome === "attacker_win") reason = "won the contest";
    if (action.outcome === "defender_win") reason = "lost the contest";

    lines.push(
      `${action.actor_name} attempted ${action.type} against ${target} with ${featureLabel} and ${outcome} because ${reason}.`,
    );
  }
  return lines;
}
