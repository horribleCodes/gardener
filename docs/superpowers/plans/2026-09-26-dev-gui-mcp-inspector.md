# Dev GUI MCP inspector implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a localhost dev browser under `dev/tools/gui` to start/stop the real Gardener MCP server, invoke tools/resources/prompts, run SQL on the campaign database, and view MCP traffic logs.

**Architecture:** Node HTTP API on `127.0.0.1:3847` spawns `node dist/server.js` via MCP SDK `StdioClientTransport`; Vite-built vanilla TS UI proxies `/api` in dev and is served as static files in `gui` mode. SQL uses a separate `better-sqlite3` connection to the same `GARDENER_WORLD_DB` path.

**Tech Stack:** Node 22+, TypeScript, Vite 6, `@modelcontextprotocol/sdk` 1.30.0 (repo root), `better-sqlite3` 11.10.0 (repo root), Vitest 5 for small unit tests.

## Global Constraints

- Design: `docs/superpowers/specs/2026-09-26-dev-gui-mcp-inspector-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/26
- Do **not** edit `docs/ROADMAP.md`.
- Do **not** change `src/mcp/register.ts`, tool behavior, or production `src/server.ts` except if a one-line export is strictly required (prefer zero production changes).
- MCP integration must use **stdio subprocess** to `dist/server.js`, not `InMemoryTransport`.
- Bind **127.0.0.1** only; no auth.
- DB path changes require MCP **stop** before apply.
- v1: SQL tab yes; database explorer no.

---

### Task 1: Scaffold `dev/tools/gui`

**Files:**
- Create: `dev/tools/gui/README.md`
- Create: `dev/tools/gui/package.json`
- Create: `dev/tools/gui/tsconfig.json`
- Modify: `package.json` (root scripts only)

**Interfaces:**
- Consumes: repo root `node_modules` for `gardener` dependencies.
- Produces: `npm run gui:dev` and `npm run gui` entrypoints from repo root.

- [ ] **Step 1: Create `dev/tools/gui/package.json`**

```json
{
  "name": "gardener-dev-gui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.json",
    "start": "node dist-server/index.js"
  },
  "devDependencies": {
    "tsx": "^4.19.3",
    "typescript": "5.8.2",
    "vite": "^6.2.0"
  }
}
```

Install from repo root (adds lockfile entries under `dev/tools/gui` or hoist via `npm install --prefix dev/tools/gui`).

- [ ] **Step 2: Create `dev/tools/gui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-server",
    "rootDir": "server",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["server/**/*.ts"]
}
```

- [ ] **Step 3: Create `dev/tools/gui/vite.config.ts`**

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3847" },
  },
  build: {
    outDir: "../dist-client",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Add root scripts in `/workspace/package.json`**

```json
"gui:dev": "npm run build && npm install --prefix dev/tools/gui && npm run dev:server --prefix dev/tools/gui & npm run dev:client --prefix dev/tools/gui",
"gui:build": "npm run build && npm install --prefix dev/tools/gui && npm run build:client --prefix dev/tools/gui && npm run build:server --prefix dev/tools/gui",
"gui": "npm run gui:build && npm run start --prefix dev/tools/gui"
```

(Implementer may replace `&` with `concurrently` if added as devDependency; document chosen approach in README.)

- [ ] **Step 5: README stub**

Document: prerequisites (`npm run build`), ports 3847/5173, start/stop MCP, DB path + restart, SQL tab limitations.

- [ ] **Step 6: Commit**

```bash
git add dev/tools/gui package.json
git commit -m "chore: scaffold dev GUI package for issue #26"
```

---

### Task 2: Log bus and HTTP skeleton

**Files:**
- Create: `dev/tools/gui/server/log-bus.ts`
- Create: `dev/tools/gui/server/index.ts`

**Interfaces:**
- Consumes: none.
- Produces: `LogBus` with `push(event)`, `subscribe(handler)`; HTTP server listening on `127.0.0.1:3847`.

- [ ] **Step 1: Implement `log-bus.ts`**

```typescript
export type LogEvent = {
  ts: string;
  level: "info" | "error";
  direction: "mcp" | "sql" | "system";
  summary: string;
  detail?: string;
};

const MAX = 500;

export class LogBus {
  private events: LogEvent[] = [];
  private subs = new Set<(e: LogEvent) => void>();

  push(event: LogEvent): void {
    this.events.push(event);
    if (this.events.length > MAX) this.events.shift();
    for (const sub of this.subs) sub(event);
  }

  snapshot(): LogEvent[] {
    return [...this.events];
  }

  subscribe(fn: (e: LogEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
```

- [ ] **Step 2: Implement minimal `index.ts`**

Use `node:http`. Routes: `GET /api/health`, `GET /api/logs` (SSE: `text/event-stream`, send `data: ${JSON.stringify(e)}\n\n` on each push + initial snapshot). Static file serving for `dist-client` when `NODE_ENV` or `--static` flag set (for `gui` script).

Resolve `repoRoot` as `path.resolve(fileURLToPath(import.meta.url), "../../../..")` (adjust depth after file placement).

- [ ] **Step 3: Manual smoke**

```bash
npm run build
cd dev/tools/gui && npx tsx server/index.ts
curl -s http://127.0.0.1:3847/api/health
```

Expected: `{"ok":true}`

- [ ] **Step 4: Commit**

```bash
git add dev/tools/gui/server
git commit -m "feat(gui): add localhost API skeleton and log SSE"
```

---

### Task 3: MCP session manager (stdio child)

**Files:**
- Create: `dev/tools/gui/server/mcp-session.ts`
- Modify: `dev/tools/gui/server/index.ts`

**Interfaces:**
- Consumes: `LogBus`, `repoRoot`, `dbPath: string`.
- Produces: `McpSession` with `start()`, `stop()`, `getStatus()`, `withClient<T>(fn: (client: Client) => Promise<T>)`.

- [ ] **Step 1: Implement `mcp-session.ts`**

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import path from "node:path";
import type { LogBus } from "./log-bus.js";

export type McpStatus =
  | { status: "stopped"; dbPath: string }
  | { status: "connected"; dbPath: string; serverVersion: { name: string; version: string } };

export class McpSession {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private child: ReturnType<typeof spawn> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repoRoot: string,
    private dbPath: string,
    private readonly log: LogBus,
  ) {}

  setDbPath(p: string): void {
    if (this.client) throw new Error("MCP_RUNNING");
    this.dbPath = p;
  }

  getStatus(): McpStatus {
    if (!this.client) return { status: "stopped", dbPath: this.dbPath };
    return {
      status: "connected",
      dbPath: this.dbPath,
      serverVersion: this.client.getServerVersion() ?? { name: "gardener", version: "?" },
    };
  }

  async start(): Promise<McpStatus> {
    if (this.client) return this.getStatus() as McpStatus;
    const script = path.join(this.repoRoot, "dist/server.js");
    const { access } = await import("node:fs/promises");
    try {
      await access(script);
    } catch {
      throw new Error("BUILD_REQUIRED");
    }
    const env = { ...process.env, GARDENER_WORLD_DB: this.dbPath };
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [script],
      cwd: this.repoRoot,
      env,
    });
    this.client = new Client({ name: "gardener-dev-gui", version: "0.1.0" });
    await this.client.connect(this.transport);
    this.log.push({
      ts: new Date().toISOString(),
      level: "info",
      direction: "system",
      summary: "MCP connected",
      detail: this.dbPath,
    });
    return this.getStatus() as McpStatus;
  }

  async stop(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
    this.log.push({
      ts: new Date().toISOString(),
      level: "info",
      direction: "system",
      summary: "MCP stopped",
    });
  }

  withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    if (!this.client) throw new Error("MCP_NOT_RUNNING");
    const run = () => fn(this.client!);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
}
```

(Adjust `StdioClientTransport` constructor fields to match SDK 1.30.0 typings if they differ—read `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` at implement time.)

- [ ] **Step 2: Wire routes in `index.ts`**

`GET /api/config`, `PUT /api/config/db-path`, `POST /api/mcp/start`, `POST /api/mcp/stop`, `GET /api/mcp/status`.

Resolve relative `dbPath` against `repoRoot`.

- [ ] **Step 3: Manual test**

```bash
npm run build
npx tsx dev/tools/gui/server/index.ts
curl -s -X POST http://127.0.0.1:3847/api/mcp/start
curl -s http://127.0.0.1:3847/api/mcp/status
```

Expected: `connected` and `gardener` version.

- [ ] **Step 4: Commit**

```bash
git add dev/tools/gui/server
git commit -m "feat(gui): spawn MCP server over stdio"
```

---

### Task 4: MCP proxy routes (tools, resources, prompts)

**Files:**
- Modify: `dev/tools/gui/server/index.ts`
- Create: `dev/tools/gui/server/uri-template.ts`

**Interfaces:**
- Consumes: `McpSession.withClient`.
- Produces: REST handlers logging MCP summaries to `LogBus`.

- [ ] **Step 1: `uri-template.ts`**

```typescript
export function fillResourceUri(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const v = params[key];
    if (v === undefined) throw new Error(`Missing param: ${key}`);
    return encodeURIComponent(v);
  });
}
```

- [ ] **Step 2: Add routes**

- `GET /api/mcp/tools` → `client.listTools()`
- `POST /api/mcp/tools/call` → parse body, `client.callTool({ name, arguments })`, try `JSON.parse` on first text content into `envelope` field in response
- `GET /api/mcp/resources` → combine `listResourceTemplates()` and `listResources()` if available
- `POST /api/mcp/resources/read` → `{ uri }` → `client.readResource({ uri })`
- `GET /api/mcp/prompts` → `client.listPrompts()`
- `POST /api/mcp/prompts/get` → `client.getPrompt({ name, arguments })`

Each success: `log.push({ direction: "mcp", summary: "tools/call quote_change", ... })`.

- [ ] **Step 3: Manual test**

With MCP running and empty DB, call:

```bash
curl -s -X POST http://127.0.0.1:3847/api/mcp/tools/call \
  -H 'content-type: application/json' \
  -d '{"name":"quote_change","arguments":{"scope":"city","magnitude":"improbable","wardRatings":[4]}}'
```

Expected: JSON with `ok: true` and `data.total` 12.

- [ ] **Step 4: Commit**

```bash
git add dev/tools/gui/server
git commit -m "feat(gui): proxy MCP tools resources prompts"
```

---

### Task 5: SQL runner

**Files:**
- Create: `dev/tools/gui/server/sql-runner.ts`
- Modify: `dev/tools/gui/server/index.ts`

**Interfaces:**
- Consumes: `dbPath` string (same as session config).
- Produces: `runSql(dbPath, sql): { columns: string[]; rows: unknown[][] } | { text: string }`.

- [ ] **Step 1: Implement `sql-runner.ts`**

```typescript
import Database from "better-sqlite3";
import path from "node:path";

export function runSql(repoRoot: string, dbPath: string, sql: string) {
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(repoRoot, dbPath);
  const db = new Database(resolved);
  try {
    const trimmed = sql.trim();
    if (/^select\b/i.test(trimmed) || /^pragma\b/i.test(trimmed) || /^with\b/i.test(trimmed)) {
      const stmt = db.prepare(trimmed);
      const rows = stmt.all() as Record<string, unknown>[];
      if (rows.length === 0) return { columns: [], rows: [] };
      const columns = Object.keys(rows[0]);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
    }
    const result = db.exec(trimmed);
    return { text: JSON.stringify(result) };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: `POST /api/sql`**

Body `{ sql: string }`; log direction `sql`; return 400 with SQLite message on failure.

- [ ] **Step 3: Manual test**

After seeding a campaign via MCP or inserting a row, `SELECT * FROM campaigns LIMIT 1`.

- [ ] **Step 4: Commit**

```bash
git add dev/tools/gui/server
git commit -m "feat(gui): ad hoc SQL against campaign database"
```

---

### Task 6: Browser shell (header, tabs, log drawer)

**Files:**
- Create: `dev/tools/gui/client/index.html`
- Create: `dev/tools/gui/client/main.ts`
- Create: `dev/tools/gui/client/styles.css`

**Interfaces:**
- Consumes: HTTP API above.
- Produces: Working SPA with tab navigation.

- [ ] **Step 1: `index.html`**

Shell: header (`#status`, `#db-path`, `#btn-start`, `#btn-stop`), tab buttons, `#panel`, `#log-drawer`, script `type=module` → `main.ts`.

- [ ] **Step 2: `main.ts` — bootstrap**

```typescript
const API = "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function refreshStatus() {
  const s = await api<{ status: string; serverVersion?: { name: string; version: string } }>(
    "/api/mcp/status",
  );
  document.getElementById("status")!.textContent =
    s.status === "connected"
      ? `Connected (${s.serverVersion?.name} ${s.serverVersion?.version})`
      : "Stopped";
}

document.getElementById("btn-start")!.addEventListener("click", async () => {
  await api("/api/mcp/start", { method: "POST" });
  await refreshStatus();
});
document.getElementById("btn-stop")!.addEventListener("click", async () => {
  await api("/api/mcp/stop", { method: "POST" });
  await refreshStatus();
});

const es = new EventSource("/api/logs");
es.onmessage = (ev) => {
  const line = document.createElement("div");
  line.textContent = ev.data;
  document.getElementById("log-lines")!.append(line);
};

refreshStatus();
```

Expand with tab loaders in Tasks 7–9.

- [ ] **Step 3: Styles** — flex column layout, monospace JSON panels, log drawer `max-height: 30vh`.

- [ ] **Step 4: Commit**

```bash
git add dev/tools/gui/client
git commit -m "feat(gui): browser shell with server controls and logs"
```

---

### Task 7: Tools tab UI

**Files:**
- Create: `dev/tools/gui/client/tabs/tools.ts`
- Modify: `dev/tools/gui/client/main.ts`

**Interfaces:**
- Consumes: `GET /api/mcp/tools`, `POST /api/mcp/tools/call`.
- Produces: `mountToolsTab(container: HTMLElement)`.

- [ ] **Step 1: List tools** — sort by name; show description on select.

- [ ] **Step 2: Args editor** — textarea prefilled `{}`; optional: if `inputSchema.properties` exists, render simple inputs for `string`/`number`/`boolean`/`enum`.

- [ ] **Step 3: Call + result** — pretty-print `envelope` or raw `content`; show `isError` in red.

- [ ] **Step 4: Manual browser test** — `npm run gui:dev`, call `quote_change`, verify envelope.

- [ ] **Step 5: Commit**

```bash
git add dev/tools/gui/client
git commit -m "feat(gui): tools tab with JSON call and envelope view"
```

---

### Task 8: Resources and prompts tabs

**Files:**
- Create: `dev/tools/gui/client/tabs/resources.ts`
- Create: `dev/tools/gui/client/tabs/prompts.ts`
- Modify: `dev/tools/gui/client/main.ts`

- [ ] **Step 1: Resources** — list templates; inputs per `{param}`; display read result JSON.

- [ ] **Step 2: Prompts** — list; `campaignId` field default empty; show `messages` array.

- [ ] **Step 3: Manual test** — read `world://campaigns/{id}/brief` after `seed_campaign` (or skip if no campaign; document in README).

- [ ] **Step 4: Commit**

```bash
git add dev/tools/gui/client
git commit -m "feat(gui): resources and prompts tabs"
```

---

### Task 9: SQL tab UI

**Files:**
- Create: `dev/tools/gui/client/tabs/sql.ts`
- Modify: `dev/tools/gui/client/main.ts`

- [ ] **Step 1: Textarea + Run button** — POST `/api/sql`.

- [ ] **Step 2: Table renderer** — `<table>` from `columns`/`rows`; toggle to raw JSON.

- [ ] **Step 3: Commit**

```bash
git add dev/tools/gui/client
git commit -m "feat(gui): SQL tab with table view"
```

---

### Task 10: Unit tests and README finish

**Files:**
- Create: `test/dev-gui/uri-template.test.ts`
- Modify: `dev/tools/gui/README.md`

- [ ] **Step 1: Write test**

```typescript
import { describe, expect, test } from "vitest";
import { fillResourceUri } from "../../dev/tools/gui/server/uri-template.js";

describe("fillResourceUri", () => {
  test("substitutes campaign id", () => {
    expect(
      fillResourceUri("world://campaigns/{campaignId}/brief", { campaignId: "c1" }),
    ).toBe("world://campaigns/c1/brief");
  });
});
```

Export `fillResourceUri` from compiled path or import `.ts` via vitest alias—match existing `test/` conventions.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: PASS (new test + existing suite).

- [ ] **Step 3: Complete README** — full walkthrough, rebuild note, issue link.

- [ ] **Step 4: Commit**

```bash
git add test/dev-gui dev/tools/gui/README.md
git commit -m "test(gui): uri template helper and document dev GUI"
```

---

### Task 11: Final integration

- [ ] **Step 1: `npm run gui:build` from repo root** — must complete without error.

- [ ] **Step 2: `npm run gui`** — open `http://127.0.0.1:3847`, start MCP, call one tool, run one SQL query.

- [ ] **Step 3: Confirm no edits** to `docs/ROADMAP.md` or `src/mcp/register.ts`.

- [ ] **Step 4: Open PR** referencing issue #26; remove `spec required` label only if project convention says implementer does that (spec PR may leave label for implementer).
