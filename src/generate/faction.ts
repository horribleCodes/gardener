import type { Catalog } from "../tables/catalog.js";
import { pickOrRoll } from "../tables/catalog.js";
import type { Rng } from "../rules/dice.js";

export function problemBudget(
  dieMax: number,
  pressure: "prosperous" | "strained" | "crisis",
  crisisBand: "half" | "three-quarter",
): number {
  if (pressure === "prosperous") return Math.round(dieMax / 4);
  if (pressure === "strained") return Math.round(dieMax / 3);
  if (crisisBand === "three-quarter") return Math.ceil((dieMax * 3) / 4);
  return dieMax / 2;
}

export function splitProblemPoints(budget: number, rng: Rng): number[] {
  const chunks: number[] = [];
  let remaining = budget;
  while (remaining > 0) {
    if (remaining >= 2 && rng.next() < 0.5) {
      chunks.push(2);
      remaining -= 2;
    } else {
      chunks.push(1);
      remaining -= 1;
    }
  }
  return chunks;
}

const PROBLEM_DOMAINS = ["cultural", "military", "economic"] as const;

export function generateProblems(
  budget: number,
  rng: Rng,
  catalog: Catalog,
): { text: string; domain: string; points: number }[] {
  const chunks = splitProblemPoints(budget, rng);
  return chunks.map((points, index) => {
    const domain = PROBLEM_DOMAINS[index % PROBLEM_DOMAINS.length];
    const picked = pickOrRoll(catalog, `problems.${domain}`, rng);
    return { text: picked.text, domain, points };
  });
}
