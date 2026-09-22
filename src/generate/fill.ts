import { RuleError, type FillMode } from "../domain/types.js";

export function defaultFill(fill?: FillMode): FillMode {
  return fill ?? "missing";
}

export function assertRequired(fill: FillMode, fields: Record<string, unknown>): void {
  if (fill !== "require") return;
  const missing = Object.entries(fields)
    .filter(([, value]) => value == null || value === "")
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new RuleError("FILL_INCOMPLETE", `missing ${missing.join(", ")}`, { fields: missing });
  }
}

export function displayName(fill: FillMode, role: string, provided?: string | null): string | null {
  if (fill === "blank") return null;
  if (provided != null && provided !== "") return provided;
  return `Unnamed ${role}`;
}

export function quarrelSummary(
  fill: FillMode,
  protagonist: string | null,
  conflict: string,
  antagonist: string | null,
): string | null {
  if (fill === "blank") return null;
  return `${protagonist} presses the quarrel (${conflict}). ${antagonist} opposes.`;
}
