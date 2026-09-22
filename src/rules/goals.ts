import type { Behavior } from "../domain/types.js";
import { RuleError } from "../domain/types.js";
import { loadCatalog } from "../tables/catalog.js";

export function planGoal(behavior: Behavior, roll: number): { strategy: string } {
  if (behavior === "directed") {
    throw new RuleError("MAGNITUDE_REJECTED", "directed factions need an explicit plan");
  }
  const rows = loadCatalog().goals[behavior];
  if (!rows) {
    throw new RuleError("PICK_UNKNOWN", `no goals for behavior ${behavior}`);
  }
  const row = rows.find((r) => roll >= r.min && roll <= r.max);
  if (!row) {
    throw new RuleError("PICK_OUT_OF_RANGE", `roll ${roll} out of range for ${behavior}`);
  }
  return { strategy: row.strategy };
}
