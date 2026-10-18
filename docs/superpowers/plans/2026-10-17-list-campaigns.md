# Campaign List Resource Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Callers can recover campaign `id` and `name` from the open world database through `world://campaigns` and `get_campaigns`.

**Architecture:** `getCampaigns(db)` in `src/queries/campaigns.ts` selects `id` and `name` ordered by `name COLLATE NOCASE`, then `id`, and returns `{ campaigns }`. The complete resource `world://campaigns` and the thin tool `get_campaigns` both call it. Living docs and both skills name the resource and the tool and drop the old gap sentences.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, better-sqlite3 13.0.3, Vitest 5, zod 4.6.5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-17-list-campaigns-design.md`. Issue #127.
- `getCampaigns` is the only campaign-list reader for MCP. The resource and `get_campaigns` call it.
- `getCampaigns` uses the open store connection. It does not open a file. It does not import `dev/tools/gui/server/campaigns.ts`.
- Resource URI is `world://campaigns`. Resource JSON is `getCampaigns(db)`, not a tool envelope.
- Tool name is `get_campaigns`. No input arguments. Description: `Campaign list. Same body as world://campaigns.`
- Tool success `data` equals the resource JSON: `{ campaigns: { id: string; name: string }[] }`.
- Returned row fields are exactly `id` and `name`.
- SQL is `SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id`.
- Empty table: `{ campaigns: [] }`. Not an error.
- Do not register a `list_campaigns` tool.
- Do not change GUI `listCampaigns` or `GET /api/campaigns`.
- MCP handlers stay pass-throughs. No ad-hoc SQL in `register.ts`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

---

## File map

- Create: `src/queries/campaigns.ts`
- Create: `test/queries/get-campaigns.test.ts`
- Modify: `src/mcp/register.ts`
- Modify: `test/mcp.test.ts`
- Modify: `docs/design/current-engine.md`
- Modify: `docs/design/overview.md`
- Modify: `user/docs/install.md`
- Modify: `user/skills/gdnr-player/SKILL.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

---

### Task 1: Shared campaign list read

**Files:**
- Create: `test/queries/get-campaigns.test.ts`
- Create: `src/queries/campaigns.ts`

**Interfaces:**
- Consumes: `openDb`; `campaigns` rows.
- Produces: `getCampaigns(db: Database.Database): { campaigns: { id: string; name: string }[] }`.

- [ ] **Step 1: Write the failing tests**

Create `test/queries/get-campaigns.test.ts`:

```ts
import { expect, test } from "vitest";
import { getCampaigns } from "../../src/queries/campaigns.js";
import { openDb } from "../../src/store/db.js";

test("getCampaigns returns an empty list when the database has no campaigns", () => {
  const db = openDb(":memory:");
  expect(getCampaigns(db)).toEqual({ campaigns: [] });
});

test("getCampaigns orders by name case-insensitively, then id", () => {
  const db = openDb(":memory:");
  const insert = db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  );
  insert.run("b", "beta");
  insert.run("a2", "Alpha");
  insert.run("a1", "alpha");
  expect(getCampaigns(db)).toEqual({
    campaigns: [
      { id: "a1", name: "alpha" },
      { id: "a2", name: "Alpha" },
      { id: "b", name: "beta" },
    ],
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/queries/get-campaigns.test.ts`

Expected: FAIL. `getCampaigns` is not exported from `src/queries/campaigns.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/queries/campaigns.ts`:

```ts
import type Database from "better-sqlite3";

export type CampaignListRow = { id: string; name: string };

export function getCampaigns(db: Database.Database): { campaigns: CampaignListRow[] } {
  const campaigns = db
    .prepare("SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id")
    .all() as CampaignListRow[];
  return { campaigns };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/queries/get-campaigns.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/queries/campaigns.ts test/queries/get-campaigns.test.ts
git commit -m "feat: read campaign id and name from the open database"
```

---

### Task 2: Resource and thin tool

**Files:**
- Modify: `src/mcp/register.ts`
- Modify: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `getCampaigns(db)` from Task 1. `toEnvelope`, `mcpToolResult`, `jsonResource`.
- Produces: complete resource `world://campaigns` and MCP tool `get_campaigns`. Tool count 54. Resource JSON equals tool `data`.

- [ ] **Step 1: Write the failing tests**

In `test/mcp.test.ts`, add `"get_campaigns"` to the registered-names test and change `toHaveLength(53)` to `toHaveLength(54)`:

```ts
  expect(names).toContain("list_catalog_tables");
  expect(names).toContain("get_campaigns");
  expect(names).toHaveLength(54);
```

Add these three tests after the registered-names test. One rule per test.

```ts
test("get_campaigns returns an empty list when the database has no campaigns", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const listed = JSON.parse(
    ((await client.callTool({ name: "get_campaigns", arguments: {} })).content as {
      text: string;
    }[])[0].text,
  );
  expect(listed).toEqual({
    ok: true,
    data: { campaigns: [] },
    rolls: [],
    advisories: [],
    derived: {},
  });

  await client.close();
});

test("world://campaigns body equals get_campaigns data", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  await client.callTool({
    name: "create_campaign",
    arguments: { name: "Reads", rngSeed: 1 },
  });

  const listed = JSON.parse(
    ((await client.callTool({ name: "get_campaigns", arguments: {} })).content as {
      text: string;
    }[])[0].text,
  );
  const collection = await client.readResource({ uri: "world://campaigns" });
  expect(JSON.parse(collection.contents[0].text as string)).toEqual(listed.data);

  await client.close();
});

test("get_campaigns includes a campaign created by create_campaign", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const created = JSON.parse(
    ((await client.callTool({
      name: "create_campaign",
      arguments: { name: "Reads", rngSeed: 1 },
    })).content as { text: string }[])[0].text,
  );
  const campaignId = created.data.campaignId as string;

  const listed = JSON.parse(
    ((await client.callTool({ name: "get_campaigns", arguments: {} })).content as {
      text: string;
    }[])[0].text,
  );
  expect(listed.ok).toBe(true);
  expect(listed.data.campaigns).toEqual([{ id: campaignId, name: "Reads" }]);

  await client.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`

Expected: FAIL. Tool list length is still 53, and `get_campaigns` is not registered (`Method not found` or equivalent on `callTool`).

- [ ] **Step 3: Write the minimal implementation**

In `src/mcp/register.ts`, add `getCampaigns` to a new import from `../queries/campaigns.js`.

Immediately before the `get_world_brief` `reg(...)` block, add:

```ts
  reg(
    "get_campaigns",
    {
      description: "Campaign list. Same body as world://campaigns.",
      inputSchema: {},
    },
    async () => mcpToolResult(toEnvelope({ ok: true, data: getCampaigns(db) })),
  );
```

Immediately before the `campaign-brief` `registerResource` call, add:

```ts
  server.registerResource(
    "campaigns",
    "world://campaigns",
    { description: "Campaign list JSON" },
    async () => jsonResource(getCampaigns(db)),
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`

Expected: PASS. Adjust the `content` JSON parse if the first run shows a TypeError; keep the assertions.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register.ts test/mcp.test.ts
git commit -m "feat: expose world://campaigns and get_campaigns"
```

---

### Task 3: Living docs and skill copy

**Files:**
- Modify: `docs/design/current-engine.md`
- Modify: `docs/design/overview.md`
- Modify: `user/docs/install.md`
- Modify: `user/skills/gdnr-player/SKILL.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

**Interfaces:**
- Consumes: the sentences in the spec's Docs and play copy section.
- Produces: those edits and no new test.

- [ ] **Step 1: Update the five files**

In `docs/design/current-engine.md`, replace:

```markdown
- **Resources:** `world://campaigns/{campaignId}/brief`, `…/factions/{factionId}`, `…/courts/{courtId}`, `…/heroes/{heroId}`, `…/turns/latest`, `…/hooks`, `world://tables` (the valid `{path}` URI list), and `world://tables/{path}` (a subtree of the chart catalog).
```

with:

```markdown
- **Resources:** `world://campaigns` (every campaign as `id` and `name`), `world://campaigns/{campaignId}/brief`, `…/factions/{factionId}`, `…/courts/{courtId}`, `…/heroes/{heroId}`, `…/turns/latest`, `…/hooks`, `world://tables` (the valid `{path}` URI list), and `world://tables/{path}` (a subtree of the chart catalog).
```

Replace:

```markdown
There is no tool that lists campaigns. The `campaignId` exists only in the reply from `seed_campaign` or `create_campaign`, and a lost id cannot be recovered through any current tool. A list tool is tracked on the Project.
```

with:

```markdown
`world://campaigns` and `get_campaigns` return every campaign in the open file as `id` and `name`, ordered by name (case-insensitive) then id. An empty file returns an empty list. Callers can still keep the `campaignId` from `seed_campaign` or `create_campaign`.
```

In `docs/design/overview.md`, after:

```markdown
Storage, the MCP surface, determinism, and the turn model as they run now are in [current-engine.md](./current-engine.md).
```

add:

```markdown
`world://campaigns` and `get_campaigns` return every campaign in the open file as `id` and `name`.
```

Delete this bullet from Known engine gaps:

```markdown
- There is no tool to list campaigns.
```

In `user/docs/install.md` step 5, replace:

```markdown
One file can hold several campaigns; keep each `campaignId`, because no tool lists them.
```

with:

```markdown
One file can hold several campaigns; keep each `campaignId`. `world://campaigns` and `get_campaigns` return every campaign in the open file as id and name.
```

In `user/skills/gdnr-player/SKILL.md`, replace:

```markdown
- One file can hold several campaigns, and every tool call names a `campaignId`. Keep the `campaignId` from `seed_campaign` or `create_campaign`: no tool lists campaigns, so a lost id cannot be recovered. Do not start a new campaign unless the user asks.
```

with:

```markdown
- One file can hold several campaigns, and every tool call names a `campaignId`. Keep the `campaignId` from `seed_campaign` or `create_campaign`. `world://campaigns` and `get_campaigns` return every campaign in the open file as id and name. Do not start a new campaign unless the user asks.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace:

```markdown
Keep the `campaignId` and tell the user what it is. No tool lists campaigns, so a lost id cannot be recovered.
```

with:

```markdown
Keep the `campaignId` and tell the user what it is. `world://campaigns` and `get_campaigns` return every campaign in the open file as id and name.
```

Do not add a test that reads those files.

- [ ] **Step 2: Commit**

```bash
git add docs/design/current-engine.md docs/design/overview.md user/docs/install.md user/skills/gdnr-player/SKILL.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: name world://campaigns and get_campaigns"
```

- [ ] **Step 3: Run the related tests once more**

Run: `npx vitest run test/queries/get-campaigns.test.ts test/mcp.test.ts`

Expected: PASS.

---

## Self-review

Spec coverage:

- Shared `getCampaigns(db)`, empty `{ campaigns: [] }`, NOCASE then id order: Task 1.
- Resource `world://campaigns`, tool `get_campaigns`, same body, create_campaign round-trip, tool count 54: Task 2.
- Living docs list the resource and the tool; gap sentences removed from the five named files: Task 3.

Placeholder scan: every task names files and the code to write.

Type consistency: `getCampaigns`, `{ campaigns: { id, name }[] }`, tool name `get_campaigns`, URI `world://campaigns` are the same in every task.
