import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function registeredToolNames(): string[] {
  const registerPath = join(process.cwd(), "src/mcp/register.ts");
  const source = readFileSync(registerPath, "utf8");
  const names: string[] = [];
  const re = /^\s+reg\(\s*\n\s+"([a-z_]+)",/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

function documentedToolNames(): string[] {
  const docPath = join(process.cwd(), "docs/agent/current-mcp-tools.md");
  const doc = readFileSync(docPath, "utf8");
  const block = doc.match(/<!-- tools:begin -->([\s\S]*?)<!-- tools:end -->/);
  if (!block) {
    throw new Error("docs/agent/current-mcp-tools.md missing tools:begin/tools:end block");
  }
  const names: string[] = [];
  const re = /`([a-z_]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block[1])) !== null) {
    names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

test("agent instruction file lists every registered MCP tool exactly once", () => {
  const registered = registeredToolNames();
  const documented = documentedToolNames();
  expect(documented).toEqual(registered);
  expect(documented.length).toBe(registered.length);
});
