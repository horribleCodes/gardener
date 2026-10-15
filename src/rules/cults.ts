import { RuleError, type Harshness } from "../domain/types.js";

export function parseHarshness(value: string): Harshness {
  if (
    value === "nominal" ||
    value === "sharp" ||
    value === "grueling" ||
    value === "overwhelming"
  ) {
    return value;
  }
  throw new RuleError("PICK_UNKNOWN", "unknown harshness");
}

export function cultBudget(harshness: Harshness, dieMax: number): number {
  const key = parseHarshness(harshness);
  if (key === "nominal") return 0;
  if (key === "sharp") return Math.ceil(dieMax / 4);
  if (key === "grueling") return dieMax / 2;
  return Math.ceil((dieMax * 3) / 4);
}

export function monthlyDominion(input: {
  kind: "cult" | "free" | "none"; power: number; harshness: Harshness; level: number;
}): number {
  if (input.kind === "none") return 0;
  if (input.kind === "free") return 1 + Math.floor(input.level / 3);
  const key = parseHarshness(input.harshness);
  const extra = key === "sharp" ? 1 : key === "grueling" ? 2 : key === "overwhelming" ? 3 : 0;
  return input.power + extra;
}
