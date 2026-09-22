import type { Harshness } from "../domain/types.js";

export function cultBudget(harshness: Harshness, dieMax: number): number {
  if (harshness === "nominal") return 0;
  if (harshness === "sharp") return Math.ceil(dieMax / 4);
  if (harshness === "grueling") return dieMax / 2;
  return Math.ceil((dieMax * 3) / 4);
}

export function monthlyDominion(input: {
  kind: "cult" | "free" | "none"; power: number; harshness: Harshness; level: number;
}): number {
  if (input.kind === "none") return 0;
  if (input.kind === "free") return 1 + Math.floor(input.level / 3);
  const extra = input.harshness === "sharp" ? 1
    : input.harshness === "grueling" ? 2
    : input.harshness === "overwhelming" ? 3 : 0;
  return input.power + extra;
}
