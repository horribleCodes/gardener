import type Database from "better-sqlite3";
import { RuleError } from "../domain/types.js";

export type FeatureRow = {
  id: string;
  faction_id: string;
  domain: string;
  size: string;
  quality: string;
  magical: number;
  origin: string;
};

const FEATURE_SELECT = `SELECT f.id, f.faction_id, f.domain, f.size, f.quality, f.magical, f.origin
  FROM features f
  WHERE f.faction_id = ?
    AND EXISTS (SELECT 1 FROM feature_parts fp WHERE fp.feature_id = f.id)
  ORDER BY f.id ASC`;

export function listUsableFeatures(db: Database.Database, factionId: string): FeatureRow[] {
  return db.prepare(FEATURE_SELECT).all(factionId) as FeatureRow[];
}

export function resolveDefenderFeature(
  db: Database.Database,
  defenderFactionId: string,
  defenderFeatureId?: string,
): FeatureRow | undefined {
  if (defenderFeatureId) {
    const row = db
      .prepare(
        `SELECT id, faction_id, domain, size, quality, magical, origin FROM features WHERE id = ?`,
      )
      .get(defenderFeatureId) as FeatureRow | undefined;
    if (!row || row.faction_id !== defenderFactionId) {
      throw new RuleError("ENTITY_NOT_FOUND", "defender feature not found");
    }
    const hasPart = db
      .prepare("SELECT 1 FROM feature_parts WHERE feature_id = ? LIMIT 1")
      .get(row.id);
    if (!hasPart) {
      throw new RuleError("ENTITY_NOT_FOUND", "defender feature not found");
    }
    return row;
  }
  const usable = listUsableFeatures(db, defenderFactionId);
  return usable[0];
}
