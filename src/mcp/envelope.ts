import { RuleError } from "../domain/types.js";
import type { ServiceResult } from "../services/util.js";

export type Envelope =
  | {
      ok: true;
      data: unknown;
      rolls: unknown[];
      advisories: unknown[];
      derived: Record<string, unknown>;
    }
  | {
      ok: false;
      error: { code: string; message: string; details: Record<string, unknown> };
    };

export function toEnvelope<T>(result: ServiceResult<T>, extras?: Partial<Envelope & { ok: true }>): Envelope {
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  let data: unknown = result.data;
  let advisories = extras?.advisories ?? [];
  if (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "advisories" in data &&
    Array.isArray((data as { advisories: unknown }).advisories)
  ) {
    const record = data as Record<string, unknown> & { advisories: unknown[] };
    advisories = record.advisories;
    const { advisories: _omit, ...rest } = record;
    data = rest;
  }
  return {
    ok: true,
    data,
    rolls: extras?.rolls ?? [],
    advisories,
    derived: extras?.derived ?? {},
  };
}

export function mcpToolResult(envelope: Envelope) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
}

export function unexpectedErrorEnvelope(error: unknown): Envelope {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message, details: { unexpected: true } },
  };
}

export function runTool<T>(fn: () => ServiceResult<T>): ReturnType<typeof mcpToolResult> {
  try {
    return mcpToolResult(toEnvelope(fn()));
  } catch (error) {
    if (error instanceof RuleError) {
      return mcpToolResult({
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    return mcpToolResult(unexpectedErrorEnvelope(error));
  }
}
