import type Database from "better-sqlite3";
import { RuleError } from "../domain/types.js";
import { requireFaction } from "./util.js";

const INTERNAL_ACTIONS = new Set([
  "build_strength",
  "enact_change",
  "restore_cohesion",
  "set_theology",
]);
const EXTERNAL_ACTIONS = new Set(["attack", "extend_interest", "aid", "remove_interest"]);

export function assertFactionBudget(
  db: Database.Database,
  turnId: string,
  factionId: string,
  actionType: string,
  targetFactionId?: string,
): void {
  const faction = requireFaction(db, factionId);
  const prior = db
    .prepare(
      `SELECT type, target_id FROM actions WHERE turn_id = ? AND actor_type = 'faction' AND actor_id = ?`,
    )
    .all(turnId, factionId) as { type: string; target_id: string | null }[];
  if (prior.some((row) => row.type === "skip")) {
    throw new RuleError("FACTION_SKIPPED", "faction skipped this month");
  }
  if (INTERNAL_ACTIONS.has(actionType)) {
    if (prior.some((row) => INTERNAL_ACTIONS.has(row.type))) {
      throw new RuleError("INTERNAL_BUDGET", "internal action already taken");
    }
  }
  if (EXTERNAL_ACTIONS.has(actionType)) {
    const externalCount = prior.filter((row) => EXTERNAL_ACTIONS.has(row.type)).length;
    if (externalCount >= faction.power) {
      throw new RuleError("EXTERNAL_BUDGET", "external action budget exhausted");
    }
    if (
      targetFactionId &&
      prior.some((row) => row.target_id === targetFactionId && EXTERNAL_ACTIONS.has(row.type))
    ) {
      throw new RuleError("DUPLICATE_EXTERNAL_TARGET", "already acted on target");
    }
  }
}
