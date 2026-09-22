import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RuleError } from "../domain/types.js";
import type { Rng } from "../rules/dice.js";

export interface Catalog {
  powerStructure: { id: string; text: string; agreement: string }[];
  minorRelationship: { id: string; text: string }[];
  interestNature: { id: string; text: string; autoIntervene: "help" | "harm" | "none" }[];
  courts: Record<string, Record<string, string[]>>;
  challenges: Record<string, string[]>;
  features: Record<string, string[]>;
  problems: Record<string, string[]>;
  backlash: string[];
  goals: Record<string, { min: number; max: number; strategy: string }[]>;
}

let cached: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const path = fileURLToPath(new URL("./catalog.json", import.meta.url));
  cached = JSON.parse(readFileSync(path, "utf8")) as Catalog;
  return cached;
}

export function catalogRowsAt(path: string): { id?: string; text: string }[] {
  const catalog = loadCatalog();
  return rowsAt(catalog, path);
}

function rowsAt(catalog: Catalog, path: string): { id?: string; text: string }[] {
  const parts = path.split(".");
  let cursor: unknown = catalog;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) {
      throw new RuleError("PICK_UNKNOWN", `unknown table ${path}`);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (!Array.isArray(cursor)) throw new RuleError("PICK_UNKNOWN", `unknown table ${path}`);
  return cursor.map((row: unknown, index: number) => {
    if (typeof row === "string") return { id: String(index + 1), text: row };
    const obj = row as { id?: string; text: string };
    return { id: obj.id, text: obj.text };
  });
}

export function pickOrRoll(
  catalog: Catalog,
  path: string,
  rng: Rng,
  pick?: number | string,
  provided?: string,
): { text: string; index: number; forced: boolean } {
  if (provided != null) return { text: provided, index: 0, forced: false };
  const rows = rowsAt(catalog, path);
  if (pick == null) {
    const index = 1 + Math.floor(rng.next() * rows.length);
    return { text: rows[index - 1].text, index, forced: false };
  }
  if (typeof pick === "number") {
    if (pick < 1 || pick > rows.length) throw new RuleError("PICK_OUT_OF_RANGE", `${path} has no row ${pick}`);
    return { text: rows[pick - 1].text, index: pick, forced: true };
  }
  const found = rows.findIndex((row) => row.id === pick || row.text.toLowerCase() === pick.toLowerCase());
  if (found < 0) throw new RuleError("PICK_UNKNOWN", `${pick} is not in ${path}`);
  return { text: rows[found].text, index: found + 1, forced: true };
}
