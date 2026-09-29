import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { LogBus, LogEvent } from "./log-bus.js";
import type { McpSession } from "./mcp-session.js";
import { runSql } from "./sql-runner.js";

export type GuiDeps = {
  repoRoot: string;
  log: LogBus;
  session: McpSession;
  staticDir?: string;
};

const HOST_HINT = "127.0.0.1";

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const map: Record<string, number> = {
    MCP_NOT_RUNNING: 409,
    MCP_RUNNING: 409,
    BUILD_REQUIRED: 400,
    DB_NOT_FOUND: 400,
    INVALID_JSON: 400,
    BODY_TOO_LARGE: 400,
  };
  const status = map[message] ?? (message.startsWith("Missing param:") ? 400 : 500);
  json(res, status, { error: message });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) throw new Error("BODY_TOO_LARGE");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON");
  }
  return parsed as Record<string, unknown>;
}

function parseToolResult(result: unknown) {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  let envelope: unknown;
  const content = record.content;
  if (Array.isArray(content) && content[0] && typeof content[0] === "object") {
    const first = content[0] as { type?: string; text?: string };
    if (first.type === "text" && typeof first.text === "string") {
      try {
        envelope = JSON.parse(first.text);
      } catch {
        envelope = undefined;
      }
    }
  }
  return {
    content: record.content,
    structuredContent: record.structuredContent,
    isError: record.isError,
    envelope,
  };
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(staticDir: string, urlPath: string, res: ServerResponse): boolean {
  let rel = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(staticDir, rel));
  if (!file.startsWith(staticDir)) {
    json(res, 403, { error: "FORBIDDEN" });
    return true;
  }
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { "content-type": contentTypeFor(file) });
  createReadStream(file).pipe(res);
  return true;
}

export function createGuiHandler(deps: GuiDeps) {
  const { repoRoot, log, session } = deps;
  const defaultDbPath = path.join(repoRoot, "data/campaign.sqlite");
  const mcpScript = path.join(repoRoot, "dist/server.js");

  return (req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error) => {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? HOST_HINT;
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    const route = `${method} ${url.pathname}`;

    if (route === "GET /api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (route === "GET /api/config") {
      json(res, 200, {
        dbPath: session.getDbPath(),
        defaultDbPath,
        repoRoot,
        mcpScript,
      });
      return;
    }

    if (route === "PUT /api/config/db-path") {
      const body = await readJson(req);
      const next = body.path;
      if (typeof next !== "string" || !next.trim()) {
        json(res, 400, { error: "PATH_REQUIRED" });
        return;
      }
      session.setDbPath(next.trim());
      json(res, 200, { dbPath: session.getDbPath() });
      return;
    }

    if (route === "POST /api/mcp/start") {
      const status = await session.start();
      json(res, 200, status);
      return;
    }

    if (route === "POST /api/mcp/stop") {
      await session.stop();
      json(res, 200, session.getStatus());
      return;
    }

    if (route === "GET /api/mcp/status") {
      json(res, 200, session.getStatus());
      return;
    }

    if (route === "GET /api/mcp/tools") {
      const result = await session.withClient((client) => client.listTools());
      log.push({
        ts: new Date().toISOString(),
        level: "info",
        direction: "mcp",
        summary: "tools/list",
      });
      json(res, 200, result);
      return;
    }

    if (route === "POST /api/mcp/tools/call") {
      const body = await readJson(req);
      const name = body.name;
      if (typeof name !== "string") {
        json(res, 400, { error: "NAME_REQUIRED" });
        return;
      }
      const args = (body.arguments ?? {}) as Record<string, unknown>;
      const result = await session.withClient((client) =>
        client.callTool({ name, arguments: args }),
      );
      const parsed = parseToolResult(result);
      log.push({
        ts: new Date().toISOString(),
        level: parsed.isError ? "error" : "info",
        direction: "mcp",
        summary: `tools/call ${name}`,
        detail: JSON.stringify(parsed.envelope ?? parsed.content).slice(0, 2000),
      });
      json(res, 200, parsed);
      return;
    }

    if (route === "GET /api/mcp/resources") {
      const result = await session.withClient(async (client) => {
        const templates = await client.listResourceTemplates().catch(() => ({ resourceTemplates: [] }));
        const resources = await client.listResources().catch(() => ({ resources: [] }));
        return {
          resources: resources.resources ?? [],
          resourceTemplates: templates.resourceTemplates ?? [],
        };
      });
      log.push({
        ts: new Date().toISOString(),
        level: "info",
        direction: "mcp",
        summary: "resources/list",
      });
      json(res, 200, result);
      return;
    }

    if (route === "POST /api/mcp/resources/read") {
      const body = await readJson(req);
      const uri = body.uri;
      if (typeof uri !== "string") {
        json(res, 400, { error: "URI_REQUIRED" });
        return;
      }
      const result = await session.withClient((client) => client.readResource({ uri }));
      log.push({
        ts: new Date().toISOString(),
        level: "info",
        direction: "mcp",
        summary: `resources/read ${uri}`,
      });
      json(res, 200, result);
      return;
    }

    if (route === "GET /api/mcp/prompts") {
      const result = await session.withClient((client) => client.listPrompts());
      log.push({
        ts: new Date().toISOString(),
        level: "info",
        direction: "mcp",
        summary: "prompts/list",
      });
      json(res, 200, result);
      return;
    }

    if (route === "POST /api/mcp/prompts/get") {
      const body = await readJson(req);
      const name = body.name;
      if (typeof name !== "string") {
        json(res, 400, { error: "NAME_REQUIRED" });
        return;
      }
      const args = (body.arguments ?? {}) as Record<string, string>;
      const result = await session.withClient((client) => client.getPrompt({ name, arguments: args }));
      log.push({
        ts: new Date().toISOString(),
        level: "info",
        direction: "mcp",
        summary: `prompts/get ${name}`,
      });
      json(res, 200, result);
      return;
    }

    if (route === "POST /api/sql") {
      const body = await readJson(req);
      const sql = body.sql;
      if (typeof sql !== "string" || !sql.trim()) {
        json(res, 400, { error: "SQL_REQUIRED" });
        return;
      }
      try {
        const result = runSql(repoRoot, session.getDbPath(), sql);
        log.push({
          ts: new Date().toISOString(),
          level: "info",
          direction: "sql",
          summary: sql.trim().slice(0, 120),
        });
        json(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.push({
          ts: new Date().toISOString(),
          level: "error",
          direction: "sql",
          summary: "SQL error",
          detail: message,
        });
        json(res, 400, { error: message });
      }
      return;
    }

    if (route === "GET /api/logs") {
      writeSse(req, res, log);
      return;
    }

    if (deps.staticDir && method === "GET" && !url.pathname.startsWith("/api/")) {
      if (serveStatic(deps.staticDir, url.pathname, res)) return;
      if (serveStatic(deps.staticDir, "/index.html", res)) return;
    }

    json(res, 404, { error: "NOT_FOUND" });
  }
}

function writeSse(req: IncomingMessage, res: ServerResponse, log: LogBus): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (event: LogEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  for (const event of log.snapshot()) send(event);
  const unsub = log.subscribe(send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  ping.unref();
  req.on("close", () => {
    clearInterval(ping);
    unsub();
  });
}
