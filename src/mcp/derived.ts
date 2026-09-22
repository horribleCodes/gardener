import type Database from "better-sqlite3";
import { DIE_BY_POWER, type Power } from "../domain/types.js";
import { loadProblemsOrdered, sumTrouble } from "../services/util.js";

export function computeDerived(
  db: Database.Database,
  args: Record<string, unknown>,
  data: unknown,
): Record<string, unknown> {
  const dataRecord =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  const factionId =
    (typeof args.factionId === "string" ? args.factionId : undefined) ??
    (typeof args.faction_id === "string" ? args.faction_id : undefined) ??
    (dataRecord && typeof dataRecord.factionId === "string" ? dataRecord.factionId : undefined) ??
    (dataRecord && typeof dataRecord.faction_id === "string" ? dataRecord.faction_id : undefined);

  if (factionId) {
    const row = db
      .prepare("SELECT id, power, status FROM factions WHERE id = ?")
      .get(factionId) as { id: string; power: Power; status: string } | undefined;
    if (!row) return {};
    const trouble = sumTrouble(loadProblemsOrdered(db, factionId));
    const dieMax = DIE_BY_POWER[row.power];
    return {
      factionId: row.id,
      trouble,
      collapseMargin: dieMax - trouble,
      status: row.status,
    };
  }

  const changeId =
    dataRecord && typeof dataRecord.changeId === "string" ? dataRecord.changeId : undefined;
  if (changeId) {
    const row = db
      .prepare("SELECT id, status, magnitude, scope FROM changes WHERE id = ?")
      .get(changeId) as
      | { id: string; status: string; magnitude: string; scope: string }
      | undefined;
    if (!row) return {};
    return { id: row.id, status: row.status, magnitude: row.magnitude, scope: row.scope };
  }

  return {};
}
