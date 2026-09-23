import type Database from "better-sqlite3";
import type { Power } from "../domain/types.js";
import { collapseState } from "../rules/collapse.js";
import { loadProblemsOrdered, sumTrouble } from "./util.js";

export function applyCollapseIfNeeded(
  db: Database.Database,
  factionId: string,
  turnId?: string | null,
): boolean {
  const row = db
    .prepare("SELECT id, campaign_id, power, cohesion, status FROM factions WHERE id = ?")
    .get(factionId) as
    | { id: string; campaign_id: string; power: Power; cohesion: number; status: string }
    | undefined;
  if (!row || row.status === "collapsed") return false;

  let cohesion = row.cohesion;
  if (cohesion < 0) {
    db.prepare("UPDATE factions SET cohesion = 0 WHERE id = ?").run(factionId);
    cohesion = 0;
  }

  const trouble = sumTrouble(loadProblemsOrdered(db, factionId));
  const { collapsed } = collapseState({ power: row.power, trouble, cohesion });
  if (!collapsed) return false;

  db.prepare("UPDATE factions SET status = 'collapsed', cohesion = 0 WHERE id = ?").run(factionId);
  db.prepare(
    `INSERT INTO events (id, campaign_id, turn_id, type, payload, created_at)
     VALUES (?, ?, ?, 'faction_collapsed', ?, ?)`,
  ).run(
    crypto.randomUUID(),
    row.campaign_id,
    turnId ?? null,
    JSON.stringify({ factionId, trouble, cohesion }),
    Date.now(),
  );
  return true;
}
