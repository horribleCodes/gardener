import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { listCampaigns } from "../../dev/tools/gui/server/campaigns.js";
import { createGuiHandler } from "../../dev/tools/gui/server/http.js";
import { LogBus } from "../../dev/tools/gui/server/log-bus.js";
import { McpSession } from "../../dev/tools/gui/server/mcp-session.js";

describe("listCampaigns", () => {
  test("returns an empty list when the file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "gui-camp-"));
    expect(listCampaigns(dir, join(dir, "missing.sqlite"))).toEqual([]);
  });

  test("returns an empty list when the campaigns table is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "gui-camp-"));
    const dbPath = join(dir, "campaign.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE notes (id TEXT)");
    db.close();
    expect(listCampaigns(dir, dbPath)).toEqual([]);
  });

  test("orders by name case-insensitively, then id", () => {
    const dir = mkdtempSync(join(tmpdir(), "gui-camp-"));
    const dbPath = join(dir, "campaign.sqlite");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE campaigns (id TEXT, name TEXT)");
    const insert = db.prepare("INSERT INTO campaigns (id, name) VALUES (?, ?)");
    insert.run("b", "beta");
    insert.run("a2", "Alpha");
    insert.run("a1", "alpha");
    db.close();
    expect(listCampaigns(dir, dbPath)).toEqual([
      { id: "a1", name: "alpha" },
      { id: "a2", name: "Alpha" },
      { id: "b", name: "beta" },
    ]);
  });
});

describe("GET /api/campaigns", () => {
  let server: Server;
  let base: string;
  const repoRoot = process.cwd();
  const dbPath = join(mkdtempSync(join(tmpdir(), "gui-camp-api-")), "campaign.sqlite");

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

  test("returns an empty list while MCP is stopped and the file is missing", async () => {
    const res = await fetch(`${base}/api/campaigns`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaigns: [] });
  });

  test("returns rows while MCP is stopped", async () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE campaigns (id TEXT, name TEXT)");
    db.prepare("INSERT INTO campaigns (id, name) VALUES (?, ?)").run("c1", "Kistelek");
    db.close();
    const res = await fetch(`${base}/api/campaigns`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ campaigns: [{ id: "c1", name: "Kistelek" }] });
  });
});
