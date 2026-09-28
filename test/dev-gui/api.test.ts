import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuiHandler } from "../../dev/tools/gui/server/http.js";
import { LogBus } from "../../dev/tools/gui/server/log-bus.js";
import { McpSession } from "../../dev/tools/gui/server/mcp-session.js";

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json();
  return { status: res.status, body };
}

describe("GUI HTTP API", () => {
  let server: Server;
  let base: string;
  const repoRoot = process.cwd();
  const dbPath = join(mkdtempSync(join(tmpdir(), "gui-api-")), "campaign.sqlite");

  beforeAll(async () => {
    const log = new LogBus();
    const session = new McpSession(repoRoot, dbPath, log);
    const handler = createGuiHandler({ repoRoot, log, session });
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  test("GET /api/health returns ok", async () => {
    const { status, body } = await json(`${base}/api/health`);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  test("GET /api/mcp/tools returns 409 when MCP is not running", async () => {
    const { status, body } = await json(`${base}/api/mcp/tools`);
    expect(status).toBe(409);
    expect(body).toEqual({ error: "MCP_NOT_RUNNING" });
  });

  test("PUT /api/config/db-path updates path while stopped", async () => {
    const next = join(tmpdir(), "other-campaign.sqlite");
    const { status, body } = await json(`${base}/api/config/db-path`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: next }),
    });
    expect(status).toBe(200);
    expect(body.dbPath).toBe(next);
  });
});
