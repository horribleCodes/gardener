import { afterAll, describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogBus } from "../../dev/tools/gui/server/log-bus.js";
import { McpSession } from "../../dev/tools/gui/server/mcp-session.js";

describe("McpSession stdio", () => {
  const sessions: McpSession[] = [];
  afterAll(async () => {
    await Promise.all(sessions.map((s) => s.stop()));
  });

  test("start fails with BUILD_REQUIRED when dist/server.js is missing", async () => {
    const log = new LogBus();
    const session = new McpSession(join(tmpdir(), "no-gardener-repo"), join(tmpdir(), "x.sqlite"), log);
    sessions.push(session);
    await expect(session.start()).rejects.toThrow("BUILD_REQUIRED");
  });

  test("spawns dist/server.js and lists quote_change", async () => {
    const repoRoot = process.cwd();
    const dbPath = join(mkdtempSync(join(tmpdir(), "gui-mcp-")), "campaign.sqlite");
    const log = new LogBus();
    const session = new McpSession(repoRoot, dbPath, log);
    sessions.push(session);
    const status = await session.start();
    expect(status.status).toBe("connected");
    if (status.status !== "connected") throw new Error("expected connected");
    expect(status.serverVersion.name).toBe("gardener");
    const listed = await session.withClient((client) => client.listTools());
    expect(listed.tools.map((t) => t.name)).toContain("quote_change");
    const result = await session.withClient((client) =>
      client.callTool({
        name: "quote_change",
        arguments: { scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [] },
      }),
    );
    const text = (result.content as { text: string }[])[0].text;
    expect(JSON.parse(text).data.total).toBe(12);
    await session.stop();
    expect(session.getStatus().status).toBe("stopped");
  });
});
