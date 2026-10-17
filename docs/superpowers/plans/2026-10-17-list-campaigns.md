# List Campaigns MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Callers can recover campaign `id` and `name` from the open world database through `list_campaigns`.

**Architecture:** `listCampaigns(db)` in `src/queries/campaigns.ts` selects `id` and `name` ordered by `name COLLATE NOCASE`, then `id`. The MCP tool is a pass-through that returns `{ campaigns }`. Living docs and both skills name the tool and drop the old gap sentences.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, better-sqlite3 13.0.3, Vitest 5, zod 4.6.5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-17-list-campaigns-design.md`. Issue #127.
- `listCampaigns` is the only campaign-list reader for MCP. The tool calls it.
- `listCampaigns` uses the open store connection. It does not open a file. It does not import `dev/tools/gui/server/campaigns.ts`.
- Returned row fields are exactly `id` and `name`.
- SQL is `SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id`.
- Empty table: `{ campaigns: [] }` inside a success envelope, not an error.
- Tool name is `list_campaigns`. No input arguments. Description: `Campaigns in the open world database as id and name.`
- Success data is `{ campaigns: { id: string; name: string }[] }`.
- Do not register a `world://campaigns` resource.
- Do not change GUI `listCampaigns` or `GET /api/campaigns`.
- MCP handlers stay pass-throughs. No ad-hoc SQL in `register.ts`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

---

## File map

- Create: `src/queries/campaigns.ts`
- Create: `test/queries/list-campaigns.test.ts`
- Modify: `src/mcp/register.ts`
- Modify: `test/mcp.test.ts`
- Modify: `docs/design/current-engine.md`
- Modify: `docs/design/overview.md`
- Modify: `user/docs/install.md`
- Modify: `user/skills/gdnr-player/SKILL.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

---

### Task 1: Shared campaign list query

**Files:**
- Create: `test/queries/list-campaigns.test.ts`
- Create: `src/queries/campaigns.ts`

**Interfaces:**
- Consumes: `openDb`; `campaigns` rows.
- Produces: `listCampaigns(db: Database.Database): { id: string; name: string }[]`.

- [ ] **Step 1: Write the failing tests**

Create `test/queries/list-campaigns.test.ts`:

```ts
import { expect, test } from "vitest";
import { listCampaigns } from "../../src/queries/campaigns.js";
import { openDb } from "../../src/store/db.js";

test("listCampaigns returns an empty list when the database has no campaigns", () => {
  const db = openDb(":memory:");
  expect(listCampaigns(db)).toEqual([]);
});

test("listCampaigns orders by name case-insensitively, then id", () => {
  const db = openDb(":memory:");
  const insert = db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  );
  insert.run("b", "beta");
  insert.run("a2", "Alpha");
  insert.run("a1", "alpha");
  expect(listCampaigns(db)).toEqual([
    { id: "a1", name: "alpha" },
    { id: "a2", name: "Alpha" },
    { id: "b", name: "beta" },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/queries/list-campaigns.test.ts`

Expected: FAIL. `listCampaigns` is not exported from `src/queries/campaigns.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/queries/campaigns.ts`:

```ts
import type Database from "better-sqlite3";

export type CampaignListRow = { id: string; name: string };

export function listCampaigns(db: Database.Database): CampaignListRow[] {
  return db
    .prepare("SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id")
    .all() as CampaignListRow[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/queries/list-campaigns.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/queries/campaigns.ts test/queries/list-campaigns.test.ts
git commit -m "feat: list campaigns from the open database"
```

---

### Task 2: MCP tool

**Files:**
- Modify: `src/mcp/register.ts`
- Modify: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `listCampaigns(db)` from Task 1. `toEnvelope`, `mcpToolResult`.
- Produces: MCP tool `list_campaigns` with empty input and success data `{ campaigns: { id: string; name: string }[] }`. Tool count 54.

- [ ] **Step 1: Write the failing tests**

In `test/mcp.test.ts`, add `"list_campaigns"` to the registered-names test and change `toHaveLength(53)` to `toHaveLength(54)`:

```ts
  expect(names).toContain("list_catalog_tables");
  expect(names).toContain("list_campaigns");
  expect(names).toHaveLength(54);
```

Add these two tests after the registered-names test. One rule per test.

```ts
test("list_campaigns returns an empty list when the database has no campaigns", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const listed = JSON.parse(
    ((await client.callTool({ name: "list_campaigns", arguments: {} })).content as {
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

test("list_campaigns includes a campaign created by create_campaign", async () => {
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
    ((await client.callTool({ name: "list_campaigns", arguments: {} })).content as {
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

Expected: FAIL. Tool list length is still 53, and `list_campaigns` is not registered (`Method not found` or equivalent on `callTool`).

- [ ] **Step 3: Write the minimal implementation**

In `src/mcp/register.ts`, add `listCampaigns` to the import from `../queries/campaigns.js`.

Immediately after the `remove-campaign` `reg(...)` block, add:

```ts
  reg(
    "list_campaigns",
    {
      description: "Campaigns in the open world database as id and name.",
      inputSchema: {},
    },
    async () => mcpToolResult(toEnvelope({ ok: true, data: { campaigns: listCampaigns(db) } })),
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`

Expected: PASS. Adjust the `content` JSON parse if the first run shows a TypeError; keep the assertions.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register.ts test/mcp.test.ts
git commit -m "feat: add list_campaigns MCP tool"
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
There is no tool that lists campaigns. The `campaignId` exists only in the reply from `seed_campaign` or `create_campaign`, and a lost id cannot be recovered through any current tool. A list tool is tracked on the Project.
```

with:

```markdown
`list_campaigns` returns every campaign in the open file as `id` and `name`, ordered by name (case-insensitive) then id. An empty file returns an empty list. Callers can still keep the `campaignId` from `seed_campaign` or `create_campaign`.
```

In `docs/design/overview.md`, after:

```markdown
Storage, the MCP surface, determinism, and the turn model as they run now are in [current-engine.md](./current-engine.md).
```

add:

```markdown
`list_campaigns` returns every campaign in the open file as `id` and `name`.
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
One file can hold several campaigns; keep each `campaignId`. `list_campaigns` returns every campaign in the open file as id and name.
```

In `user/skills/gdnr-player/SKILL.md`, replace:

```markdown
- One file can hold several campaigns, and every tool call names a `campaignId`. Keep the `campaignId` from `seed_campaign` or `create_campaign`: no tool lists campaigns, so a lost id cannot be recovered. Do not start a new campaign unless the user asks.
```

with:

```markdown
- One file can hold several campaigns, and every tool call names a `campaignId`. Keep the `campaignId` from `seed_campaign` or `create_campaign`. `list_campaigns` returns every campaign in the open file as id and name. Do not start a new campaign unless the user asks.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace:

```markdown
Keep the `campaignId` and tell the user what it is. No tool lists campaigns, so a lost id cannot be recovered.
```

with:

```markdown
Keep the `campaignId` and tell the user what it is. `list_campaigns` returns every campaign in the open file as id and name.
```

Do not add a test that reads those files.

- [ ] **Step 2: Commit**

```bash
git add docs/design/current-engine.md docs/design/overview.md user/docs/install.md user/skills/gdnr-player/SKILL.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: name list_campaigns and drop the list-tool gap"
```

- [ ] **Step 3: Run the related tests once more**

Run: `npx vitest run test/queries/list-campaigns.test.ts test/mcp.test.ts`

Expected: PASS.

---

## Self-review

Spec coverage:

- Shared `listCampaigns(db)`, empty list, NOCASE then id order: Task 1.
- `list_campaigns` tool, no args, `{ campaigns }`, create_campaign round-trip, tool count 54: Task 2.
- Living docs list the tool; gap sentences removed from the five named files: Task 3.

Placeholder scan: every task names files and the code to write.

Type consistency: `listCampaigns`, `{ campaigns: { id, name }[] }`, tool name `list_campaigns`, and description text are the same in every task.
