# Require scope on seed outline places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `seed_campaign` outline place require a caller-chosen `scope`, with no village default and no rolled scope.

**Architecture:** `seedCampaign` throws the existing `FILL_INCOMPLETE` / `place scope required` error whenever a place omits `scope`, for every fill mode, and the transaction rolls back. The `seed_campaign` tool schema marks `scope` required with the existing five-value enum, so a tool call fails validation before the handler. Faction power and behavior defaults stay. Living docs drop the place-scope gap and describe the rule on the current-engine page.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, Zod 3.24.2, `@modelcontextprotocol/sdk` 1.30.1, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-seed-outline-place-scope-design.md`. Issue #81.
- `scope` is always required when seeding outline places. There is no silent village default. Scope is never randomly generated.
- Service error for a missing scope: `RuleError("FILL_INCOMPLETE", "place scope required")`. The whole seed transaction rolls back.
- Tool schema: `scope: scopeZ` with `scopeZ = z.enum(["village", "city", "region", "nation", "realm"])`. Place-item `required` is `["key", "name", "scope"]`.
- Faction seed behavior stays: omitted behavior is `self_absorbed_survivor`; omitted power follows the home place; the `"village"` stand-in in that power lookup stays.
- Scope values do not change. `SCHEMA_VERSION` stays 4. No migration.
- Do not edit `user/skills/**` or `.cursor/prompts/**`. Do not edit historical files under `docs/superpowers/` other than this plan and its design, and do not edit `test/reviews/`.
- Do not add a unit test that reads a documentation file or a prompt file and asserts on that file’s text.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Package manager: npm. Tests: `npx vitest run <file>`.

---

## File map

- Create: `test/services/seed-place-scope.test.ts` — service contract for required scope, rollback, stored scope, and unchanged faction defaults.
- Create: `test/mcp/seed-campaign-scope.test.ts` — tool schema `required` array, validation errors, and a successful seed with an explicit scope.
- Modify: `src/services/populate.ts` — place loop in `seedCampaign` (around the current village default).
- Modify: `src/mcp/register.ts` — `seed_campaign` place `scope` field.
- Modify: `docs/design/overview.md` — generation gap bullet keeps only the behavior half.
- Modify: `docs/design/current-engine.md` — one paragraph on required outline place scope.

---

### Task 1: Service requires scope

**Files:**
- Create: `test/services/seed-place-scope.test.ts`
- Modify: `src/services/populate.ts:580-593`

**Interfaces:**
- Consumes: `seedCampaign(db, input)` from `src/services/populate.ts`. Place input keeps `scope?: Scope`. `openDb` from `src/store/db.ts`.
- Produces: a missing `scope` returns `{ ok: false, error: { code: "FILL_INCOMPLETE", message: "place scope required" } }` for `fill` `require`, `missing`, `blank`, and omitted. No campaign row remains. A provided scope is stored unchanged. Faction defaults are unchanged for later tasks.

- [ ] **Step 1: Write the failing test**

Create `test/services/seed-place-scope.test.ts`:

```ts
import { expect, test } from "vitest";
import type { FillMode } from "../../src/domain/types.js";
import { seedCampaign } from "../../src/services/populate.js";
import { openDb } from "../../src/store/db.js";

function counts(db: ReturnType<typeof openDb>) {
  const campaigns = db.prepare("SELECT COUNT(*) AS c FROM campaigns").get() as { c: number };
  const places = db.prepare("SELECT COUNT(*) AS c FROM places").get() as { c: number };
  return { campaigns: campaigns.c, places: places.c };
}

test.each<{ fill?: FillMode }>([
  { fill: "require" },
  { fill: "missing" },
  { fill: "blank" },
  {},
])("omitted place scope fails and writes nothing (fill %j)", ({ fill }) => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    ...(fill ? { fill } : {}),
    outline: { places: [{ key: "home", name: "Home" }] },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
  expect(result.error.message).toBe("place scope required");
  expect(counts(db)).toEqual({ campaigns: 0, places: 0 });
  db.close();
});

test("a later place missing scope rolls back the earlier place", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    fill: "missing",
    outline: {
      places: [
        { key: "home", name: "Home", scope: "city" },
        { key: "far", name: "Far" },
      ],
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({
    code: "FILL_INCOMPLETE",
    message: "place scope required",
    details: {},
  });
  expect(counts(db)).toEqual({ campaigns: 0, places: 0 });
  db.close();
});

test("an explicit scope is stored as given", () => {
  const db = openDb(":memory:");
  const city = seedCampaign(db, {
    name: "City campaign",
    seed: 1,
    fill: "missing",
    outline: { places: [{ key: "home", name: "Home", scope: "city" }] },
  });
  expect(city.ok).toBe(true);
  if (!city.ok) return;
  const cityRow = db
    .prepare("SELECT name, scope FROM places WHERE campaign_id = ?")
    .get(city.data.campaignId) as { name: string; scope: string };
  expect(cityRow).toEqual({ name: "Home", scope: "city" });

  const village = seedCampaign(db, {
    name: "Village campaign",
    seed: 99,
    fill: "require",
    outline: { places: [{ key: "home", name: "Home", scope: "village" }] },
  });
  expect(village.ok).toBe(true);
  if (!village.ok) return;
  const villageRow = db
    .prepare("SELECT scope FROM places WHERE campaign_id = ?")
    .get(village.data.campaignId) as { scope: string };
  expect(villageRow.scope).toBe("village");

  const blank = seedCampaign(db, {
    name: "Blank campaign",
    seed: 2,
    fill: "blank",
    outline: { places: [{ key: "home", name: "Home", scope: "city" }] },
  });
  expect(blank.ok).toBe(true);
  if (!blank.ok) return;
  const blankRow = db
    .prepare("SELECT scope FROM places WHERE campaign_id = ?")
    .get(blank.data.campaignId) as { scope: string };
  expect(blankRow.scope).toBe("city");
  db.close();
});

test("omitted faction power and behavior stay on the home scope and the survivor default", () => {
  const db = openDb(":memory:");
  const seeded = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    fill: "missing",
    linkInterests: false,
    outline: {
      places: [{ key: "home", name: "Home", scope: "city" }],
      factions: [{ key: "a", name: "Guild", homePlaceKey: "home" }],
    },
  });
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) return;
  const faction = db
    .prepare("SELECT power, behavior FROM factions WHERE campaign_id = ?")
    .get(seeded.data.campaignId) as { power: number; behavior: string };
  expect(faction).toEqual({ power: 2, behavior: "self_absorbed_survivor" });
  db.close();
});

test("a home key that matches no place still seeds power 1", () => {
  const db = openDb(":memory:");
  const seeded = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    outline: {
      factions: [{ key: "a", name: "Guild", homePlaceKey: "missing" }],
    },
  });
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) return;
  const faction = db
    .prepare("SELECT power, behavior FROM factions WHERE campaign_id = ?")
    .get(seeded.data.campaignId) as { power: number; behavior: string };
  expect(faction).toEqual({ power: 1, behavior: "self_absorbed_survivor" });
  db.close();
});

test("an empty places array still creates a campaign", () => {
  const db = openDb(":memory:");
  const seeded = seedCampaign(db, {
    name: "Campaign",
    seed: 1,
    outline: { places: [] },
  });
  expect(seeded.ok).toBe(true);
  expect(counts(db)).toEqual({ campaigns: 1, places: 0 });
  db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/seed-place-scope.test.ts`

Expected: FAIL. The `require` case already returns `FILL_INCOMPLETE`. The `missing`, `blank`, and omitted-fill cases currently return `ok: true` and store `village`, so those three fail. The explicit-scope, faction, and empty-outline cases already pass.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/populate.ts`, replace the place loop’s scope lines. The loop is the `for (const place of input.outline?.places ?? [])` block. It currently reads:

```ts
      for (const place of input.outline?.places ?? []) {
        const scope = place.scope ?? (fill === "require" ? undefined : "village");
        if (!scope) throw new RuleError("FILL_INCOMPLETE", "place scope required");
        const parentPlaceId = place.parentKey ? placeIds.get(place.parentKey) : undefined;
        const res = createPlace(db, {
          campaignId,
          name: place.name,
          scope,
          parentPlaceId,
          cultureId: place.cultureId,
        });
```

Replace that with:

```ts
      for (const place of input.outline?.places ?? []) {
        if (!place.scope) throw new RuleError("FILL_INCOMPLETE", "place scope required");
        const parentPlaceId = place.parentKey ? placeIds.get(place.parentKey) : undefined;
        const res = createPlace(db, {
          campaignId,
          name: place.name,
          scope: place.scope,
          parentPlaceId,
          cultureId: place.cultureId,
        });
```

Leave the rest of the loop, the `fill` variable, and the faction loop unchanged. In particular leave these faction lines untouched:

```ts
          const scope = place?.scope ?? "village";
```

```ts
          behavior: fac.behavior ?? "self_absorbed_survivor",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/seed-place-scope.test.ts`

Expected: PASS. 8 tests (4 from `test.each`, plus 4).

- [ ] **Step 5: Commit**

```bash
git add test/services/seed-place-scope.test.ts src/services/populate.ts
git commit -m "Require scope on every seeded outline place."
```

---

### Task 2: Tool schema requires scope

**Files:**
- Create: `test/mcp/seed-campaign-scope.test.ts`
- Modify: `src/mcp/register.ts:195`

**Interfaces:**
- Consumes: `buildServer` from `src/mcp/register.ts`. `scopeZ` is the existing enum. Task 1’s service rejects a missing scope if a caller bypasses the schema.
- Produces: `seed_campaign` place items require `scope`. Omitting it, or sending a value outside the enum, returns `isError: true` with the validation strings below. An explicit `city` or `village` returns `{ ok: true, data: { campaignId } }`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp/seed-campaign-scope.test.ts`:

```ts
import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/mcp/register.js";

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function textOf(result: { content: unknown }): string {
  return (result.content as { text: string }[])[0].text;
}

test("seed_campaign place scope is required and stays the five-value enum", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const seed = tools.tools.find((tool) => tool.name === "seed_campaign");
    expect(seed).toBeDefined();
    const schema = seed!.inputSchema as {
      required?: string[];
      properties: {
        outline: {
          properties: {
            places: { items: { required?: string[]; properties: { scope: { enum: string[] } } } };
            factions: { items: { required?: string[] } };
          };
        };
      };
    };
    expect(schema.required).toEqual(["name"]);
    expect(schema.properties.outline.properties.places.items.required).toEqual([
      "key",
      "name",
      "scope",
    ]);
    expect(schema.properties.outline.properties.places.items.properties.scope.enum).toEqual([
      "village",
      "city",
      "region",
      "nation",
      "realm",
    ]);
    expect(schema.properties.outline.properties.factions.items.required).toEqual(["key", "name"]);
  });
});

test("omitted place scope fails validation before the handler", async () => {
  await withClient(async (client) => {
    const missing = await client.callTool({
      name: "seed_campaign",
      arguments: {
        name: "Campaign",
        outline: { places: [{ key: "home", name: "Home" }] },
      },
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Required at outline.places[0].scope",
    );

    const later = await client.callTool({
      name: "seed_campaign",
      arguments: {
        name: "Campaign",
        outline: {
          places: [
            { key: "home", name: "Home", scope: "city" },
            { key: "far", name: "Far" },
          ],
        },
      },
    });
    expect(later.isError).toBe(true);
    expect(textOf(later)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Required at outline.places[1].scope",
    );
  });
});

test("a scope outside the enum is rejected", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "seed_campaign",
      arguments: {
        name: "Campaign",
        outline: { places: [{ key: "home", name: "Home", scope: "hamlet" }] },
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Invalid enum value. Expected 'village' | 'city' | 'region' | 'nation' | 'realm', received 'hamlet' at outline.places[0].scope",
    );
  });
});

test("an explicit city or village scope seeds", async () => {
  await withClient(async (client) => {
    for (const scope of ["city", "village"] as const) {
      const result = await client.callTool({
        name: "seed_campaign",
        arguments: {
          name: "Campaign",
          seed: 1,
          outline: { places: [{ key: "home", name: "Home", scope }] },
        },
      });
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(textOf(result)) as { ok: boolean; data: { campaignId: string } };
      expect(body.ok).toBe(true);
      expect(body.data.campaignId).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp/seed-campaign-scope.test.ts`

Expected: FAIL. Place items are currently `required: ["key", "name"]`, so the schema assertion fails. The omitted-scope calls currently succeed (`isError` is not true). The hamlet call and the explicit-scope call already behave as asserted.

- [ ] **Step 3: Write the minimal implementation**

In `src/mcp/register.ts`, in the `seed_campaign` place object, change:

```ts
                  scope: scopeZ.optional(),
```

to:

```ts
                  scope: scopeZ,
```

Do not change `scopeZ`, faction fields, or `create_place`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp/seed-campaign-scope.test.ts test/services/seed-place-scope.test.ts`

Expected: PASS. Both files.

- [ ] **Step 5: Commit**

```bash
git add test/mcp/seed-campaign-scope.test.ts src/mcp/register.ts
git commit -m "Require scope on the seed_campaign place schema."
```

---

### Task 3: Living docs

**Files:**
- Modify: `docs/design/overview.md:102`
- Modify: `docs/design/current-engine.md:7`

**Interfaces:**
- Consumes: the behavior described in Tasks 1 and 2.
- Produces: the generation gap no longer mentions place scope. `current-engine.md` states that an outline place requires `scope`. No new test file.

- [ ] **Step 1: Replace the generation gap bullet**

In `docs/design/overview.md`, under **Generation and setup**, replace this bullet:

```markdown
- `seed_campaign` defaults an omitted place scope to `village` and an omitted behavior to `self_absorbed_survivor`. Intent: place scope is always required, and behavior is required unless the caller opts into random generation.
```

with this bullet:

```markdown
- `seed_campaign` defaults an omitted behavior to `self_absorbed_survivor`. Intent: behavior is required unless the caller opts into random generation.
```

- [ ] **Step 2: Describe the rule on the current-engine page**

In `docs/design/current-engine.md`, the first paragraph of **Campaigns and the database file** ends with:

```markdown
Every tool call names its `campaignId`.
```

Add this paragraph immediately after it:

```markdown
An outline place on `seed_campaign` requires `scope`: `village`, `city`, `region`, `nation`, or `realm`. Omitting it fails the call. `fill` does not supply a scope. The server does not default an omitted scope to `village` and does not roll one.
```

Do not edit `user/skills/gdnr-director/references/gdnr-direct.md`. Its places section already tells the director to pass `scope`.

- [ ] **Step 3: Check the wording with search**

Run:

```bash
rg -n "omitted place scope|does not default an omitted scope|self_absorbed_survivor" docs/design/overview.md docs/design/current-engine.md
```

Expected: `overview.md` has the behavior bullet and no `omitted place scope`. `current-engine.md` has `does not default an omitted scope`.

Run:

```bash
rg -n "Always pass \`scope\`" user/skills/gdnr-director/references/gdnr-direct.md
```

Expected: one hit, the existing sentence. The file is not in `git diff`.

Do not add a Vitest file for these searches.

- [ ] **Step 4: Run the scope tests again**

Run: `npx vitest run test/services/seed-place-scope.test.ts test/mcp/seed-campaign-scope.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/design/overview.md docs/design/current-engine.md
git commit -m "Record that seed outline places require scope."
```
