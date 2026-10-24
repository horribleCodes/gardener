import { RuleError } from "../domain/types.js";

export function assertDirectedAllowed(
  behavior: string,
  control: "npc" | "player",
): void {
  if (behavior !== "directed") return;
  if (control === "npc") {
    throw new RuleError(
      "DIRECTED_NPC",
      "a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior",
    );
  }
}
