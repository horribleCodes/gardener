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
  return {
    ok: true,
    data: result.data,
    rolls: extras?.rolls ?? [],
    advisories: extras?.advisories ?? [],
    derived: extras?.derived ?? {},
  };
}

export function mcpToolResult(envelope: Envelope) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope,
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
    throw error;
  }
}
