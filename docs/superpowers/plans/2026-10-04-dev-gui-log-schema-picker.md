# Dev GUI log, schema fill, and campaign picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Dev GUI traffic log without dropping the session, fill the tool JSON textarea from the input schema, and offer a background-loaded campaign id/name menu on every `campaignId` text input.

**Architecture:** Pure client modules own the skeleton, the drawer state, and the menu rows, and Vitest imports those modules directly. A new `GET /api/campaigns` reads `campaigns.id` and `campaigns.name` on a short-lived SQLite connection. The browser starts that fetch without awaiting it and attaches a listbox to existing `campaignId` inputs.

**Tech Stack:** Node >= 22, TypeScript, Vitest 5, `better-sqlite3` 13.0.3, existing Vite vanilla client under `dev/tools/gui`. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-dev-gui-log-schema-picker-design.md`. If this plan disagrees, fix the plan.
- Issue #78. Dev GUI only. Do not change `src/`, `user/`, `docs/design/`, MCP tools, campaign create/delete, or the 2026-09-26 inspector spec.
- Implement on this spec pull request’s branch. Do not open a second pull request and do not branch from `main`.
- Collapse keeps the same client events array, leaves `EventSource` open, and does not call the server. Default is expanded. Reload starts expanded.
- **Fill from schema** replaces `#tool-json` only. Selecting a tool still sets that textarea to `{}`. Do not change `collectArgs`.
- `GET /api/campaigns` returns `{ campaigns: { id: string, name: string }[] }` with MCP stopped or started. Missing file and missing `campaigns` table are 200 `{ campaigns: [] }`. Query: `SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id`. `busy_timeout` 500. No traffic-log line on success.
- `refreshCampaigns()` returns `void`. `boot` and tab mounts do not await it. Failed fetches keep the previous list and do not `alert`.
- Campaign inputs are `<input type="text">` whose name is exactly `campaignId`. Menu row text is `` `${name} — ${id}` `` (em dash). Choosing a row sets the value to the id.
- Package manager: npm. Tests: `npx vitest run <file>` from the repo root. Node environment. No browser runner.

---

## File map

- Create: `dev/tools/gui/client/schema-skeleton.ts` — JSON skeleton from a tool input schema.
- Create: `dev/tools/gui/client/log-drawer.ts` — collapsed flag and event list.
- Create: `dev/tools/gui/client/campaign-list.ts` — `name — id` rows.
- Create: `dev/tools/gui/client/campaigns.ts` — background fetch and listbox.
- Create: `dev/tools/gui/server/campaigns.ts` — SQLite id/name read.
- Modify: `dev/tools/gui/client/tabs/tools.ts` — fill button and tool picker.
- Modify: `dev/tools/gui/client/tabs/resources.ts` — resource picker.
- Modify: `dev/tools/gui/client/tabs/prompts.ts` — prompt picker.
- Modify: `dev/tools/gui/client/main.ts` — drawer state, boot refresh, refresh after start and save.
- Modify: `dev/tools/gui/client/index.html` — collapse button.
- Modify: `dev/tools/gui/client/styles.css` — collapsed drawer and menu.
- Modify: `dev/tools/gui/server/http.ts` — `GET /api/campaigns`.
- Modify: `dev/tools/gui/README.md` — the three controls.
- Create: `test/dev-gui/schema-skeleton.test.ts`
- Create: `test/dev-gui/log-drawer.test.ts`
- Create: `test/dev-gui/campaign-list.test.ts`
- Create: `test/dev-gui/campaigns.test.ts`

---

### Task 1: Schema skeleton and Fill from schema

**Files:**
- Create: `test/dev-gui/schema-skeleton.test.ts`
- Create: `dev/tools/gui/client/schema-skeleton.ts`
- Modify: `dev/tools/gui/client/tabs/tools.ts`

**Interfaces:**
- Consumes: the tool `inputSchema` object already stored on the selected tool in `mountToolsTab`.
- Produces: `schemaSkeleton(schema: JsonSchema | undefined): unknown`. `JsonSchema` is exported from `schema-skeleton.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/dev-gui/schema-skeleton.test.ts`:

```ts
import { expect, test } from "vitest";
import { schemaSkeleton } from "../../dev/tools/gui/client/schema-skeleton.js";

test("fills every property of a quote_change-shaped schema, including defaults and optionals", () => {
  expect(
    schemaSkeleton({
      type: "object",
      properties: {
        scope: { type: "string", enum: ["village", "city", "region", "nation", "realm"] },
        magnitude: { type: "string", enum: ["plausible", "improbable", "impossible", "vast"] },
        wardRatings: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 20 },
          default: [],
        },
        resisterRatings: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          default: [],
        },
        kind: {
          type: "string",
          enum: ["feature", "fact", "problem_mitigation", "creature_population", "champion", "other"],
        },
        petty: { type: "boolean" },
        deedsRequired: { type: "integer", minimum: 0 },
        challengesRequired: { type: "integer", minimum: 0 },
      },
      required: ["scope", "magnitude"],
    }),
  ).toEqual({
    scope: "village",
    magnitude: "plausible",
    wardRatings: [1],
    resisterRatings: [1],
    kind: "feature",
    petty: false,
    deedsRequired: 0,
    challengesRequired: 0,
  });
});

test("includes one exemplar object for a nested array", () => {
  expect(
    schemaSkeleton({
      type: "object",
      properties: {
        outline: {
          type: "object",
          properties: {
            places: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
      },
    }),
  ).toEqual({ outline: { places: [{ key: "", name: "" }] } });
});

test("emits an empty object for a record with no named fields", () => {
  expect(
    schemaSkeleton({
      type: "object",
      additionalProperties: { type: "array", items: { type: "string" } },
    }),
  ).toEqual({});
});

test("merges every object branch of anyOf and skips non-object branches", () => {
  expect(
    schemaSkeleton({
      anyOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "integer", minimum: 2 } } },
      ],
    }),
  ).toEqual({ a: "", b: 2 });
  expect(
    schemaSkeleton({
      anyOf: [{ type: "null" }, { type: "object", properties: { a: { type: "string" } } }],
    }),
  ).toEqual({ a: "" });
});

test("uses the first union branch when none of them is an object", () => {
  expect(
    schemaSkeleton({
      anyOf: [{ type: "string" }, { type: "integer", minimum: 4 }],
    }),
  ).toBe("");
});

test("merges oneOf when anyOf is absent", () => {
  expect(
    schemaSkeleton({
      oneOf: [{ type: "object", properties: { a: { type: "boolean" } } }],
    }),
  ).toEqual({ a: false });
});

test("lets a later anyOf branch win on a shared key", () => {
  expect(
    schemaSkeleton({
      anyOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { a: { type: "integer", minimum: 3 } } },
      ],
    }),
  ).toEqual({ a: 3 });
});

test("skeletons tuple slots and empty item lists", () => {
  expect(
    schemaSkeleton({ type: "array", items: [{ type: "string" }, { type: "boolean" }] }),
  ).toEqual(["", false]);
  expect(schemaSkeleton({ type: "array" })).toEqual([]);
});

test("treats a missing tool schema as an empty object and an unknown node as null", () => {
  expect(schemaSkeleton(undefined)).toEqual({});
  expect(schemaSkeleton({ type: "object" })).toEqual({});
  expect(schemaSkeleton({})).toBe(null);
  expect(schemaSkeleton({ type: "null" })).toBe(null);
  expect(schemaSkeleton({ type: "number" })).toBe(0);
  expect(schemaSkeleton({ type: "string", enum: [] })).toBe("");
  expect(schemaSkeleton({ type: ["string", "null"] })).toBe("");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/dev-gui/schema-skeleton.test.ts`

Expected: FAIL. The import of `schema-skeleton.js` cannot be resolved.

- [ ] **Step 3: Write the skeleton**

Create `dev/tools/gui/client/schema-skeleton.ts`:

```ts
export type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
};

function nonNullType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((entry) => entry !== "null");
  return schema.type;
}

function isObjectSchema(schema: JsonSchema): boolean {
  return nonNullType(schema) === "object" || schema.properties !== undefined;
}

export function schemaSkeleton(schema: JsonSchema | undefined): unknown {
  if (!schema) return {};
  const union = schema.anyOf ?? schema.oneOf;
  if (union && union.length > 0) {
    const objects = union.filter(isObjectSchema);
    if (objects.length > 0) {
      const properties: Record<string, JsonSchema> = {};
      for (const branch of objects) Object.assign(properties, branch.properties ?? {});
      return schemaSkeleton({ type: "object", properties });
    }
    return schemaSkeleton(union[0]);
  }
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  const type = nonNullType(schema);
  if (type === "array") {
    if (Array.isArray(schema.items)) return schema.items.map((item) => schemaSkeleton(item));
    if (schema.items) return [schemaSkeleton(schema.items)];
    return [];
  }
  if (type === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) out[key] = schemaSkeleton(child);
    return out;
  }
  if (type === "integer" || type === "number") return typeof schema.minimum === "number" ? schema.minimum : 0;
  if (type === "boolean") return false;
  if (type === "string") return "";
  if (type === "null") return null;
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/dev-gui/schema-skeleton.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the button in the Tools tab**

In `dev/tools/gui/client/tabs/tools.ts`, add this import next to the existing imports:

```ts
import { schemaSkeleton } from "../schema-skeleton";
```

In the `mountToolsTab` template string, replace the textarea and Call button with:

```ts
        <div id="tool-fields" class="fields"></div>
        <button id="tool-fill" type="button" disabled>Fill from schema</button>
        <textarea id="tool-json" class="code">{}</textarea>
        <button id="tool-call" type="button">Call</button>
```

After `const jsonArea = ...`, add:

```ts
  const fill = container.querySelector("#tool-fill") as HTMLButtonElement;
```

Inside the tool-button click handler, after `jsonArea.value = "{}";`, add:

```ts
        fill.disabled = false;
```

After the `search.addEventListener` line, add:

```ts
  fill.addEventListener("click", () => {
    if (!selected) return;
    jsonArea.value = JSON.stringify(schemaSkeleton(selected.inputSchema), null, 2);
  });
```

Leave `collectArgs` and the Call handler as they are. Do not fill the textarea when the tool is selected.

- [ ] **Step 6: Commit**

```bash
git add test/dev-gui/schema-skeleton.test.ts dev/tools/gui/client/schema-skeleton.ts dev/tools/gui/client/tabs/tools.ts
git commit -m "feat: fill dev GUI tool JSON from the input schema"
```

---

### Task 2: Campaign list endpoint

**Files:**
- Create: `test/dev-gui/campaigns.test.ts`
- Create: `dev/tools/gui/server/campaigns.ts`
- Modify: `dev/tools/gui/server/http.ts`

**Interfaces:**
- Consumes: `resolveDbPath` from `dev/tools/gui/server/sql-runner.ts`. `session.getDbPath()` and `repoRoot` inside `createGuiHandler`.
- Produces: `listCampaigns(repoRoot: string, dbPath: string): { id: string; name: string }[]`. HTTP `GET /api/campaigns` → `{ campaigns: { id: string; name: string }[] }`.

- [ ] **Step 1: Write the failing test**

Create `test/dev-gui/campaigns.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/dev-gui/campaigns.test.ts`

Expected: FAIL. The import of `campaigns.js` cannot be resolved.

- [ ] **Step 3: Write the reader and the route**

Create `dev/tools/gui/server/campaigns.ts`:

```ts
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolveDbPath } from "./sql-runner.js";

export type CampaignRow = { id: string; name: string };

export function listCampaigns(repoRoot: string, dbPath: string): CampaignRow[] {
  const resolved = resolveDbPath(repoRoot, dbPath);
  if (resolved !== ":memory:" && !existsSync(resolved)) return [];
  const db = new Database(resolved, { fileMustExist: resolved !== ":memory:" });
  try {
    db.pragma("busy_timeout = 500");
    const table = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'")
      .get() as { ok: number } | undefined;
    if (!table) return [];
    return db.prepare("SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id").all() as CampaignRow[];
  } finally {
    db.close();
  }
}
```

In `dev/tools/gui/server/http.ts`, add this import with the other local imports:

```ts
import { listCampaigns } from "./campaigns.js";
```

Immediately before `if (route === "GET /api/logs")`, insert:

```ts
    if (route === "GET /api/campaigns") {
      const campaigns = listCampaigns(repoRoot, session.getDbPath());
      json(res, 200, { campaigns });
      return;
    }
```

Do not push a log event on this route. Let unexpected SQLite errors reach the handler’s existing `sendError` path.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/dev-gui/campaigns.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/dev-gui/campaigns.test.ts dev/tools/gui/server/campaigns.ts dev/tools/gui/server/http.ts
git commit -m "feat: list campaigns for the dev GUI"
```

---

### Task 3: Campaign picker

**Files:**
- Create: `test/dev-gui/campaign-list.test.ts`
- Create: `dev/tools/gui/client/campaign-list.ts`
- Create: `dev/tools/gui/client/campaigns.ts`
- Modify: `dev/tools/gui/client/tabs/tools.ts`
- Modify: `dev/tools/gui/client/tabs/resources.ts`
- Modify: `dev/tools/gui/client/tabs/prompts.ts`
- Modify: `dev/tools/gui/client/main.ts`
- Modify: `dev/tools/gui/client/styles.css`

**Interfaces:**
- Consumes: `GET /api/campaigns` via `api()` in `dev/tools/gui/client/api.ts`. `CampaignOption` from `campaign-list.ts`.
- Produces:
  - `campaignOptionLabel(campaign: { id: string; name: string }): string`
  - `campaignMenuRows(campaigns: { id: string; name: string }[]): { id: string; label: string }[]`
  - `refreshCampaigns(): void`
  - `attachCampaignPicker(input: HTMLInputElement): void`

- [ ] **Step 1: Write the failing test**

Create `test/dev-gui/campaign-list.test.ts`:

```ts
import { expect, test } from "vitest";
import { campaignMenuRows, campaignOptionLabel } from "../../dev/tools/gui/client/campaign-list.js";

test("labels a campaign with its name and id", () => {
  expect(campaignOptionLabel({ id: "c1", name: "Kistelek" })).toBe("Kistelek — c1");
});

test("builds menu rows in list order", () => {
  expect(
    campaignMenuRows([
      { id: "c1", name: "Kistelek" },
      { id: "c2", name: "Buda" },
    ]),
  ).toEqual([
    { id: "c1", label: "Kistelek — c1" },
    { id: "c2", label: "Buda — c2" },
  ]);
});
```

The em dash in `"Kistelek — c1"` is U+2014.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/dev-gui/campaign-list.test.ts`

Expected: FAIL. The import of `campaign-list.js` cannot be resolved.

- [ ] **Step 3: Write the row helper**

Create `dev/tools/gui/client/campaign-list.ts`:

```ts
export type CampaignOption = { id: string; name: string };

export function campaignOptionLabel(campaign: CampaignOption): string {
  return `${campaign.name} — ${campaign.id}`;
}

export function campaignMenuRows(campaigns: CampaignOption[]): { id: string; label: string }[] {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaignOptionLabel(campaign),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/dev-gui/campaign-list.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the fetch and the listbox**

Create `dev/tools/gui/client/campaigns.ts`:

```ts
import { api } from "./api";
import { campaignMenuRows, type CampaignOption } from "./campaign-list";

let options: CampaignOption[] = [];
const listeners = new Set<() => void>();
let chain: Promise<void> = Promise.resolve();

export function getCampaigns(): CampaignOption[] {
  return options;
}

export function subscribeCampaigns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshCampaigns(): void {
  chain = chain.then(load, load);
}

async function load(): Promise<void> {
  try {
    const body = await api<{ campaigns?: CampaignOption[] }>("/api/campaigns");
    if (!Array.isArray(body.campaigns)) return;
    options = body.campaigns;
    for (const listener of listeners) listener();
  } catch {
    // Keep the previous list. Do not alert.
  }
}

export function attachCampaignPicker(input: HTMLInputElement): void {
  input.parentElement?.classList.add("campaign-anchor");
  const menu = document.createElement("div");
  menu.className = "campaign-menu hidden";
  menu.setAttribute("role", "listbox");
  input.insertAdjacentElement("afterend", menu);
  input.setAttribute("aria-haspopup", "listbox");

  const close = () => {
    menu.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
  };

  const render = () => {
    menu.replaceChildren();
    const rows = campaignMenuRows(getCampaigns());
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "schema-meta";
      empty.textContent = "No campaigns";
      menu.append(empty);
      return;
    }
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "campaign-option";
      button.textContent = row.label;
      button.setAttribute("role", "option");
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        input.value = row.id;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        close();
      });
      menu.append(button);
    }
  };

  const open = () => {
    refreshCampaigns();
    menu.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    render();
  };

  input.addEventListener("focus", open);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  const unsubscribe = subscribeCampaigns(() => {
    if (!input.isConnected) {
      unsubscribe();
      return;
    }
    if (!menu.classList.contains("hidden")) render();
  });

  const onDocClick = (event: MouseEvent) => {
    if (!input.isConnected) {
      document.removeEventListener("click", onDocClick);
      unsubscribe();
      return;
    }
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target === input || menu.contains(target)) return;
    close();
  };
  document.addEventListener("click", onDocClick);
  close();
}
```

Append these rules to `dev/tools/gui/client/styles.css`:

```css
.campaign-anchor {
  position: relative;
}

.campaign-menu {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  top: 100%;
  display: flex;
  flex-direction: column;
  max-height: 12rem;
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.campaign-menu.hidden {
  display: none;
}

.campaign-option {
  text-align: left;
  border: 0;
  border-radius: 0;
  background: transparent;
}
```

- [ ] **Step 6: Attach the picker and start the background load**

In `dev/tools/gui/client/tabs/tools.ts`, add:

```ts
import { attachCampaignPicker } from "../campaigns";
```

Replace `renderField` with:

```ts
function renderField(name: string, schema: JsonSchema, required: boolean, editable: boolean): HTMLElement {
  const field = document.createElement("div");
  field.className = "schema-field";

  const head = document.createElement("div");
  head.className = "schema-head";
  const nameEl = document.createElement("span");
  nameEl.className = "schema-name";
  nameEl.textContent = required ? `${name}*` : name;
  const meta = document.createElement("span");
  meta.className = "schema-meta";
  meta.textContent = schema.description ? `${typeLabel(schema)} — ${schema.description}` : typeLabel(schema);
  head.append(nameEl, meta);
  if (editable && !isFillable(schema)) {
    const note = document.createElement("span");
    note.className = "schema-meta";
    note.textContent = "Set this in the JSON arguments.";
    head.append(note);
  }
  field.append(head);

  if (editable && isFillable(schema)) {
    const control = renderInput(name, schema);
    field.append(control);
    if (name === "campaignId" && control instanceof HTMLInputElement && control.type === "text") {
      attachCampaignPicker(control);
    }
  }

  const nest = document.createElement("div");
  nest.className = "schema-nest";
  if (schema.properties && hasNested(schema)) {
    appendSchemaFields(schema, nest);
  } else {
    const item = schemaItem(schema);
    const value = recordValue(schema);
    if (item && hasNested(item)) appendSchemaFields(item, nest);
    else if (value && hasNested(value)) nest.append(renderField("(each value)", value, false, false));
  }
  if (nest.childElementCount > 0) field.append(nest);
  return field;
}
```

The em dash in the `typeLabel` line is the character already in `tools.ts` (U+2014). Keep it.

In `dev/tools/gui/client/tabs/resources.ts`, add:

```ts
import { attachCampaignPicker } from "../campaigns";
```

After `fields.append(label);` inside the param loop, add:

```ts
          if (name === "campaignId") attachCampaignPicker(input);
```

In `dev/tools/gui/client/tabs/prompts.ts`, add:

```ts
import { attachCampaignPicker } from "../campaigns";
```

After `fields.append(label);` inside the argument loop, add:

```ts
          if (arg.name === "campaignId") attachCampaignPicker(input);
```

Replace `dev/tools/gui/client/main.ts` with:

```ts
import { api } from "./api";
import { refreshCampaigns } from "./campaigns";
import { mountToolsTab } from "./tabs/tools";
import { mountResourcesTab } from "./tabs/resources";
import { mountPromptsTab } from "./tabs/prompts";
import { mountSqlTab } from "./tabs/sql";

type Status = {
  status: string;
  dbPath?: string;
  serverVersion?: { name: string; version: string };
};

const statusEl = document.getElementById("status")!;
const dbPathEl = document.getElementById("db-path") as HTMLInputElement;
const saveBtn = document.getElementById("btn-save-path") as HTMLButtonElement;
const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;
const panel = document.getElementById("panel")!;
const logLines = document.getElementById("log-lines")!;

let logFilter: "all" | "mcp" | "sql" | "error" = "all";
const logEvents: Array<{ level: string; direction: string; ts: string; summary: string; detail?: string }> = [];

async function refreshStatus() {
  const s = await api<Status>("/api/mcp/status");
  const connected = s.status === "connected";
  statusEl.textContent =
    s.status === "connected"
      ? `Connected (${s.serverVersion?.name} ${s.serverVersion?.version})`
      : s.status === "connecting"
        ? "Connecting"
        : "Stopped";
  statusEl.className = `badge ${connected ? "ok" : ""}`;
  dbPathEl.disabled = connected || s.status === "connecting";
  saveBtn.disabled = dbPathEl.disabled;
  if (s.dbPath && document.activeElement !== dbPathEl) dbPathEl.value = s.dbPath;
}

startBtn.addEventListener("click", async () => {
  try {
    await api("/api/mcp/start", { method: "POST" });
    await refreshStatus();
    refreshCampaigns();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await api("/api/mcp/stop", { method: "POST" });
    await refreshStatus();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

saveBtn.addEventListener("click", async () => {
  try {
    await api("/api/config/db-path", {
      method: "PUT",
      body: JSON.stringify({ path: dbPathEl.value }),
    });
    await refreshStatus();
    refreshCampaigns();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

function renderLog() {
  logLines.replaceChildren();
  for (const event of logEvents) {
    if (logFilter === "mcp" && event.direction !== "mcp") continue;
    if (logFilter === "sql" && event.direction !== "sql") continue;
    if (logFilter === "error" && event.level !== "error") continue;
    const line = document.createElement("div");
    line.className = `log-line ${event.level === "error" ? "error" : ""}`;
    line.textContent = `${event.ts} [${event.direction}/${event.level}] ${event.summary}${event.detail ? ` — ${event.detail}` : ""}`;
    logLines.append(line);
  }
  logLines.scrollTop = logLines.scrollHeight;
}

const es = new EventSource("/api/logs");
es.onmessage = (ev) => {
  try {
    logEvents.push(JSON.parse(ev.data) as (typeof logEvents)[number]);
    renderLog();
  } catch {
    /* ignore malformed SSE */
  }
};

for (const btn of document.querySelectorAll<HTMLButtonElement>(".filters button")) {
  btn.addEventListener("click", () => {
    logFilter = btn.dataset.filter as typeof logFilter;
    for (const other of document.querySelectorAll(".filters button")) other.classList.remove("active");
    btn.classList.add("active");
    renderLog();
  });
}

const tabs: Record<string, (el: HTMLElement) => void | Promise<void>> = {
  tools: mountToolsTab,
  resources: mountResourcesTab,
  prompts: mountPromptsTab,
  sql: mountSqlTab,
};

async function showTab(name: string) {
  panel.replaceChildren();
  await tabs[name]?.(panel);
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
  btn.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tabs button")) other.classList.remove("active");
    btn.classList.add("active");
    void showTab(btn.dataset.tab ?? "tools");
  });
}

async function boot() {
  refreshCampaigns();
  try {
    const cfg = await api<{ dbPath: string }>("/api/config");
    dbPathEl.value = cfg.dbPath;
  } catch {
    /* status will surface errors */
  }
  await refreshStatus().catch((error) => {
    statusEl.textContent = error instanceof Error ? error.message : "API unreachable";
    statusEl.className = "badge err";
  });
  await showTab("tools");
}

void boot();
```

`refreshCampaigns()` is not awaited. `showTab("tools")` still is.

- [ ] **Step 7: Commit**

```bash
git add test/dev-gui/campaign-list.test.ts dev/tools/gui/client/campaign-list.ts dev/tools/gui/client/campaigns.ts dev/tools/gui/client/tabs/tools.ts dev/tools/gui/client/tabs/resources.ts dev/tools/gui/client/tabs/prompts.ts dev/tools/gui/client/main.ts dev/tools/gui/client/styles.css
git commit -m "feat: pick a campaign id in the dev GUI"
```

---

### Task 4: Collapsible traffic log and README

**Files:**
- Create: `test/dev-gui/log-drawer.test.ts`
- Create: `dev/tools/gui/client/log-drawer.ts`
- Modify: `dev/tools/gui/client/main.ts`
- Modify: `dev/tools/gui/client/index.html`
- Modify: `dev/tools/gui/client/styles.css`
- Modify: `dev/tools/gui/README.md`

**Interfaces:**
- Consumes: the SSE payload already pushed into the client log. `refreshCampaigns` from Task 3 stays in `main.ts`.
- Produces:
  - `initialLogDrawer<E>(): { collapsed: boolean; events: E[] }`
  - `toggleLogDrawer<E>(state: { collapsed: boolean; events: E[] }): { collapsed: boolean; events: E[] }`
  - `appendLogEvent<E>(state: { collapsed: boolean; events: E[] }, event: E): { collapsed: boolean; events: E[] }`

- [ ] **Step 1: Write the failing test**

Create `test/dev-gui/log-drawer.test.ts`:

```ts
import { expect, test } from "vitest";
import { appendLogEvent, initialLogDrawer, toggleLogDrawer } from "../../dev/tools/gui/client/log-drawer.js";

test("starts expanded with no events", () => {
  expect(initialLogDrawer()).toEqual({ collapsed: false, events: [] });
});

test("collapse and expand keep the same events array", () => {
  const state = { collapsed: false, events: ["a"] };
  const collapsed = toggleLogDrawer(state);
  expect(collapsed.collapsed).toBe(true);
  expect(collapsed.events).toBe(state.events);
  const expanded = toggleLogDrawer(collapsed);
  expect(expanded.collapsed).toBe(false);
  expect(expanded.events).toBe(state.events);
});

test("an event that arrives while collapsed stays collapsed and keeps earlier events", () => {
  const collapsed = toggleLogDrawer({ collapsed: false, events: ["a"] });
  const next = appendLogEvent(collapsed, "b");
  expect(next.collapsed).toBe(true);
  expect(next.events).toEqual(["a", "b"]);
  expect(collapsed.events).toEqual(["a"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/dev-gui/log-drawer.test.ts`

Expected: FAIL. The import of `log-drawer.js` cannot be resolved.

- [ ] **Step 3: Write the drawer state**

Create `dev/tools/gui/client/log-drawer.ts`:

```ts
export type LogDrawerState<E> = {
  collapsed: boolean;
  events: E[];
};

export function initialLogDrawer<E>(): LogDrawerState<E> {
  return { collapsed: false, events: [] };
}

export function toggleLogDrawer<E>(state: LogDrawerState<E>): LogDrawerState<E> {
  return { collapsed: !state.collapsed, events: state.events };
}

export function appendLogEvent<E>(state: LogDrawerState<E>, event: E): LogDrawerState<E> {
  return { collapsed: state.collapsed, events: [...state.events, event] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/dev-gui/log-drawer.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire the button**

In `dev/tools/gui/client/index.html`, replace the traffic-log header with:

```html
      <div class="log-header">
        <div class="log-title">
          <strong>Traffic log</strong>
          <button id="log-toggle" type="button" aria-expanded="true" aria-controls="log-lines">Collapse</button>
        </div>
        <div class="filters">
          <button type="button" data-filter="all" class="active">All</button>
          <button type="button" data-filter="mcp">MCP</button>
          <button type="button" data-filter="sql">SQL</button>
          <button type="button" data-filter="error">Errors</button>
        </div>
      </div>
```

Append to `dev/tools/gui/client/styles.css`:

```css
.log-title {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.log-drawer.collapsed .log-lines,
.log-drawer.collapsed .filters {
  display: none;
}

.log-drawer.collapsed {
  max-height: none;
}
```

Replace `dev/tools/gui/client/main.ts` with:

```ts
import { api } from "./api";
import { refreshCampaigns } from "./campaigns";
import { appendLogEvent, initialLogDrawer, toggleLogDrawer } from "./log-drawer";
import { mountToolsTab } from "./tabs/tools";
import { mountResourcesTab } from "./tabs/resources";
import { mountPromptsTab } from "./tabs/prompts";
import { mountSqlTab } from "./tabs/sql";

type Status = {
  status: string;
  dbPath?: string;
  serverVersion?: { name: string; version: string };
};

type ClientLogEvent = {
  level: string;
  direction: string;
  ts: string;
  summary: string;
  detail?: string;
};

const statusEl = document.getElementById("status")!;
const dbPathEl = document.getElementById("db-path") as HTMLInputElement;
const saveBtn = document.getElementById("btn-save-path") as HTMLButtonElement;
const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;
const panel = document.getElementById("panel")!;
const logLines = document.getElementById("log-lines")!;
const logDrawer = document.getElementById("log-drawer")!;
const logToggle = document.getElementById("log-toggle") as HTMLButtonElement;

let logFilter: "all" | "mcp" | "sql" | "error" = "all";
let drawerState = initialLogDrawer<ClientLogEvent>();

function applyLogDrawer(): void {
  logDrawer.classList.toggle("collapsed", drawerState.collapsed);
  logToggle.textContent = drawerState.collapsed ? "Expand" : "Collapse";
  logToggle.setAttribute("aria-expanded", String(!drawerState.collapsed));
}

async function refreshStatus() {
  const s = await api<Status>("/api/mcp/status");
  const connected = s.status === "connected";
  statusEl.textContent =
    s.status === "connected"
      ? `Connected (${s.serverVersion?.name} ${s.serverVersion?.version})`
      : s.status === "connecting"
        ? "Connecting"
        : "Stopped";
  statusEl.className = `badge ${connected ? "ok" : ""}`;
  dbPathEl.disabled = connected || s.status === "connecting";
  saveBtn.disabled = dbPathEl.disabled;
  if (s.dbPath && document.activeElement !== dbPathEl) dbPathEl.value = s.dbPath;
}

startBtn.addEventListener("click", async () => {
  try {
    await api("/api/mcp/start", { method: "POST" });
    await refreshStatus();
    refreshCampaigns();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await api("/api/mcp/stop", { method: "POST" });
    await refreshStatus();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

saveBtn.addEventListener("click", async () => {
  try {
    await api("/api/config/db-path", {
      method: "PUT",
      body: JSON.stringify({ path: dbPathEl.value }),
    });
    await refreshStatus();
    refreshCampaigns();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
});

function renderLog() {
  logLines.replaceChildren();
  for (const event of drawerState.events) {
    if (logFilter === "mcp" && event.direction !== "mcp") continue;
    if (logFilter === "sql" && event.direction !== "sql") continue;
    if (logFilter === "error" && event.level !== "error") continue;
    const line = document.createElement("div");
    line.className = `log-line ${event.level === "error" ? "error" : ""}`;
    line.textContent = `${event.ts} [${event.direction}/${event.level}] ${event.summary}${event.detail ? ` — ${event.detail}` : ""}`;
    logLines.append(line);
  }
  logLines.scrollTop = logLines.scrollHeight;
}

logToggle.addEventListener("click", () => {
  drawerState = toggleLogDrawer(drawerState);
  applyLogDrawer();
});

const es = new EventSource("/api/logs");
es.onmessage = (ev) => {
  try {
    drawerState = appendLogEvent(drawerState, JSON.parse(ev.data) as ClientLogEvent);
    renderLog();
  } catch {
    /* ignore malformed SSE */
  }
};

for (const btn of document.querySelectorAll<HTMLButtonElement>(".filters button")) {
  btn.addEventListener("click", () => {
    logFilter = btn.dataset.filter as typeof logFilter;
    for (const other of document.querySelectorAll(".filters button")) other.classList.remove("active");
    btn.classList.add("active");
    renderLog();
  });
}

const tabs: Record<string, (el: HTMLElement) => void | Promise<void>> = {
  tools: mountToolsTab,
  resources: mountResourcesTab,
  prompts: mountPromptsTab,
  sql: mountSqlTab,
};

async function showTab(name: string) {
  panel.replaceChildren();
  await tabs[name]?.(panel);
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
  btn.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tabs button")) other.classList.remove("active");
    btn.classList.add("active");
    void showTab(btn.dataset.tab ?? "tools");
  });
}

async function boot() {
  refreshCampaigns();
  try {
    const cfg = await api<{ dbPath: string }>("/api/config");
    dbPathEl.value = cfg.dbPath;
  } catch {
    /* status will surface errors */
  }
  await refreshStatus().catch((error) => {
    statusEl.textContent = error instanceof Error ? error.message : "API unreachable";
    statusEl.className = "badge err";
  });
  await showTab("tools");
}

void boot();
```

The click handler does not clear `drawerState.events` and does not close `es`.

- [ ] **Step 6: Update the GUI README**

In `dev/tools/gui/README.md`, replace the `## Using it` section through the example JSON (leave `## Limits` as it is) with:

```md
## Using it

1. Confirm the database path (default `data/campaign.sqlite` under the repo, or `GARDENER_WORLD_DB` if set when the GUI process started).
2. Click **Save path** while MCP is stopped. Changing the path while connected is rejected; stop first, save, then start.
3. Click **Start MCP**. Status should show `Connected (gardener 0.1.0)`. If start fails with `BUILD_REQUIRED`, run `npm run build` from the repo root.
4. **Tools** — pick a tool, fill primitive fields and/or the JSON args textarea, **Call**. **Fill from schema** replaces the JSON textarea with an object that contains every property the tool schema defines, including nested objects and one sample array element. Results show the parsed Gardener envelope when the tool returns JSON text.
5. **Resources** — pick a `world://` template, fill `{params}`, **Read**. Example after `seed_campaign`: `world://campaigns/{campaignId}/brief`.
6. **Prompts** — pick `gm-briefing` or `faction-turn-narration`, set args such as `campaignId`, **Run**.
7. **SQL** — run `SELECT` / `PRAGMA` (table view) or other statements (text/JSON). There is no table explorer in v1. The SQL connection is a separate `better-sqlite3` handle on the same file as MCP; concurrent writes may block briefly.
8. The **traffic log** streams MCP, SQL, and system events (last 500 in memory). Filter All / MCP / SQL / Errors. **Collapse** hides the lines and the filters. The session log stays; **Expand** shows it again, including events that arrived while it was collapsed.
9. Any text field named `campaignId` (tool arguments, resource parameters, prompt arguments) opens a menu of campaigns in the current database file. Each row shows the name and the id. Choosing a row puts the id in the field. The list loads in the background and does not block the rest of the GUI. The field still accepts a typed id when the list is empty.

Example tool call (`quote_change` works on an empty database):

```json
{
  "scope": "city",
  "magnitude": "improbable",
  "wardRatings": [4]
}
```
```

- [ ] **Step 7: Run the dev GUI tests**

Run: `npx vitest run test/dev-gui`

Expected: PASS, including the schema, campaign, campaign-list, and log-drawer tests, plus the existing dev-gui tests.

- [ ] **Step 8: Commit**

```bash
git add test/dev-gui/log-drawer.test.ts dev/tools/gui/client/log-drawer.ts dev/tools/gui/client/main.ts dev/tools/gui/client/index.html dev/tools/gui/client/styles.css dev/tools/gui/README.md
git commit -m "feat: collapse the dev GUI traffic log"
```
