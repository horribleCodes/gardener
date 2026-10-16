# Hero Read Surface Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Callers can read heroes and catalog table URIs without an open turn, and `form_cult` can bind `home_place_id`.

**Architecture:** `getHero` in `src/queries/detail.ts` is the hero sheet. `worldBrief` adds a `heroes` list. `catalogTableUris` in `src/tables/catalog.ts` is the catalog URI list. MCP resources and thin tools call those functions. `formCult` takes optional `homePlaceId` and refuses a place that is not in the campaign.

**Tech Stack:** Node >= 22, TypeScript, better-sqlite3, Vitest, zod (see `package.json`).

## Global Constraints

- `getHero` is the only reader of a hero sheet for MCP. The resource and `get_hero` call it.
- `getHero` does not consult turns.
- Missing hero id: `getHero` returns `null`; the tool returns `ENTITY_NOT_FOUND` / `hero not found`.
- Returned hero fields are exactly `id`, `name`, `level`, `divinity`, `dominion`, `cult_faction_id`, `words`.
- `words` is a parsed JSON array of strings, or `[]` when parse fails or the value is not an array.
- Hero resource URI is `world://campaigns/{campaignId}/heroes/{heroId}`.
- `worldBrief.heroes` is `{ id, name, level, divinity, dominion }[]` ordered by id.
- `catalogTableUris` is the only enumerator of catalog table URIs. The collection resource, the `{path}` list callback, and `list_catalog_tables` call it.
- Every listed URI's path succeeds in `catalogRowsAt` and returns a non-empty array.
- `formCult` optional `homePlaceId` must match `places.id` in that campaign or the call returns `ENTITY_NOT_FOUND` / `place not found` and writes nothing.
- Adopted home is unchanged when `homePlaceId` is omitted.
- `get_faction` continues to return `home_place_id`.
- MCP handlers stay pass-throughs. No ad-hoc SQL in `register.ts`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

---

## File map

- Create: `test/queries/get-hero.test.ts`
- Create: `test/tables/catalog-uris.test.ts`
- Modify: `test/services/form-cult.test.ts`
- Modify: `test/mcp.test.ts`
- Modify: `src/queries/detail.ts`
- Modify: `src/queries/rumors.ts`
- Modify: `src/tables/catalog.ts`
- Modify: `src/services/populate.ts`
- Modify: `src/mcp/register.ts`
- Modify: `docs/design/current-engine.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`
- Modify: `user/skills/gdnr-player/SKILL.md`
- Modify: `user/README.md`

---

### Task 1: Shared hero read and world brief list

**Files:**
- Create: `test/queries/get-hero.test.ts`
- Modify: `src/queries/detail.ts`
- Modify: `src/queries/rumors.ts`

**Interfaces:**
- Consumes: `openDb`; `heroes` rows.
- Produces: `getHero(db, heroId)` returning the sheet or `null`. `worldBrief` gains `heroes`.

- [ ] **Step 1: Write the failing test**

Create `test/queries/get-hero.test.ts`:

```ts
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { getHero } from "../../src/queries/detail.js";
import { worldBrief } from "../../src/queries/rumors.js";

function world() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Reads', 1, 42, 0)",
  ).run();
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES ('h1', 'c1', 'Lira', 2, ?, 0, 3, 0, 'free')`,
  ).run(JSON.stringify(["Sun"]));
  return db;
}

test("getHero returns the sheet with no open turn", () => {
  const db = world();
  expect(getHero(db, "h1")).toEqual({
    id: "h1",
    name: "Lira",
    level: 2,
    divinity: "free",
    dominion: 3,
    cult_faction_id: null,
    words: ["Sun"],
  });
  expect(getHero(db, "missing")).toBeNull();
});

test("worldBrief lists the campaign heroes", () => {
  const db = world();
  expect(worldBrief(db, "c1")?.heroes).toEqual([
    { id: "h1", name: "Lira", level: 2, divinity: "free", dominion: 3 },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/queries/get-hero.test.ts`

Expected: FAIL. `getHero` is not exported. `worldBrief` has no `heroes`.

- [ ] **Step 3: Write the minimal implementation**

In `src/queries/detail.ts`, add:

```ts
export function getHero(db: Database.Database, heroId: string) {
  const hero = db
    .prepare(
      `SELECT id, name, level, divinity, dominion, cult_faction_id, words
       FROM heroes WHERE id = ?`,
    )
    .get(heroId) as
    | {
        id: string;
        name: string;
        level: number;
        divinity: string;
        dominion: number;
        cult_faction_id: string | null;
        words: string;
      }
    | undefined;
  if (!hero) return null;
  let words: string[] = [];
  try {
    const parsed: unknown = JSON.parse(hero.words);
    if (Array.isArray(parsed) && parsed.every((w) => typeof w === "string")) {
      words = parsed;
    }
  } catch {
    words = [];
  }
  return {
    id: hero.id,
    name: hero.name,
    level: hero.level,
    divinity: hero.divinity,
    dominion: hero.dominion,
    cult_faction_id: hero.cult_faction_id,
    words,
  };
}
```

In `src/queries/rumors.ts`, after `factionBriefs` is built, load heroes and include them in the returned object:

```ts
  const heroes = db
    .prepare(
      `SELECT id, name, level, divinity, dominion FROM heroes WHERE campaign_id = ? ORDER BY id ASC`,
    )
    .all(campaignId) as {
    id: string;
    name: string;
    level: number;
    divinity: string;
    dominion: number;
  }[];
```

Add `heroes` to the return object next to `factions`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/queries/get-hero.test.ts test/services/turn.test.ts test/services/campaign-flags.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/queries/get-hero.test.ts src/queries/detail.ts src/queries/rumors.ts
git commit -m "feat: read heroes without an open turn"
```

---

### Task 2: Catalog table URI list

**Files:**
- Create: `test/tables/catalog-uris.test.ts`
- Modify: `src/tables/catalog.ts`

**Interfaces:**
- Consumes: `loadCatalog`.
- Produces: `catalogTableUris(): string[]`.

- [ ] **Step 1: Write the failing test**

Create `test/tables/catalog-uris.test.ts`:

```ts
import { expect, test } from "vitest";
import { catalogRowsAt, catalogTableUris } from "../../src/tables/catalog.js";

test("catalogTableUris lists paths catalogRowsAt can read", () => {
  const uris = catalogTableUris();
  expect(uris.length).toBeGreaterThan(0);
  expect(uris).toContain("world://tables/powerStructure");
  expect(uris).toContain("world://tables/backlash");
  for (const uri of uris) {
    expect(uri.startsWith("world://tables/")).toBe(true);
    const rows = catalogRowsAt(uri.slice("world://tables/".length));
    expect(rows.length).toBeGreaterThan(0);
  }
  expect(uris.some((uri) => uri.endsWith("/cults") || uri.endsWith(".cults"))).toBe(false);
  expect(uris.some((uri) => uri.endsWith("/godbound") || uri.endsWith(".godbound"))).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tables/catalog-uris.test.ts`

Expected: FAIL. `catalogTableUris` is not exported.

- [ ] **Step 3: Write the minimal implementation**

In `src/tables/catalog.ts`, add:

```ts
export function catalogTableUris(): string[] {
  const uris: string[] = [];
  walk(loadCatalog(), "", uris);
  return uris;
}

function walk(value: unknown, prefix: string, uris: string[]): void {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value as object)) {
    const next = prefix === "" ? key : `${prefix}.${key}`;
    const child = (value as Record<string, unknown>)[key];
    if (Array.isArray(child)) uris.push(`world://tables/${next}`);
    else walk(child, next, uris);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tables/catalog-uris.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/tables/catalog-uris.test.ts src/tables/catalog.ts
git commit -m "feat: list valid catalog table URIs"
```

---

### Task 3: Bind home_place_id on form_cult

**Files:**
- Modify: `test/services/form-cult.test.ts`
- Modify: `src/services/populate.ts`

**Interfaces:**
- Consumes: `places` rows; existing `formCult` gates.
- Produces: `formCult` input `homePlaceId?: string`. Successful return stays `{ factionId: string }`.

- [ ] **Step 1: Write the failing test**

Append to `test/services/form-cult.test.ts`. Import `getFaction` from `../../src/queries/detail.js`. Add a `place` helper and these tests:

```ts
function place(db: Database.Database, id: string, name: string): void {
  db.prepare(
    `INSERT INTO places (id, campaign_id, name, scope, parent_place_id) VALUES (?, 'c1', ?, 'village', NULL)`,
  ).run(id, name);
}

test("form_cult stores homePlaceId on a new cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  place(db, "vale", "Ash Vale");
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    homePlaceId: "vale",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(getFaction(db, result.data.factionId)?.home_place_id).toBe("vale");
});

test("an unknown homePlaceId forms nothing", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    homePlaceId: "missing",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "place not found", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("adopting keeps the stored home unless homePlaceId is passed", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  place(db, "old", "Old Home");
  place(db, "new", "New Home");
  faction(db, { id: "f1", power: 3 });
  db.prepare("UPDATE factions SET home_place_id = 'old' WHERE id = 'f1'").run();
  const kept = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
  });
  expect(kept.ok).toBe(true);
  expect(getFaction(db, "f1")?.home_place_id).toBe("old");

  const db2 = world();
  hero(db2, { id: "h1", level: 2 });
  place(db2, "old", "Old Home");
  place(db2, "new", "New Home");
  faction(db2, { id: "f1", power: 3 });
  db2.prepare("UPDATE factions SET home_place_id = 'old' WHERE id = 'f1'").run();
  const moved = formCult(db2, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
    homePlaceId: "new",
  });
  expect(moved.ok).toBe(true);
  expect(getFaction(db2, "f1")?.home_place_id).toBe("new");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: FAIL. `homePlaceId` is ignored or is a type error; new cult `home_place_id` stays null.

- [ ] **Step 3: Write the minimal implementation**

Add `homePlaceId?: string` to the `formCult` input type.

After `const harshness = ...` and before `let factionId = input.adoptFactionId`, insert:

```ts
      if (input.homePlaceId !== undefined) {
        const place = db
          .prepare("SELECT id FROM places WHERE id = ? AND campaign_id = ?")
          .get(input.homePlaceId, input.campaignId) as { id: string } | undefined;
        if (!place) throw new RuleError("ENTITY_NOT_FOUND", "place not found");
      }
```

Pass `homePlaceId: input.homePlaceId` into `createFaction` when creating. After the adopt-or-create block, if `input.homePlaceId !== undefined`, run:

```ts
        db.prepare("UPDATE factions SET home_place_id = ? WHERE id = ?").run(
          input.homePlaceId,
          factionId,
        );
```

The create path may set the column twice; that is acceptable. Adopt without `homePlaceId` must not run that UPDATE.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/services/form-cult.test.ts src/services/populate.ts
git commit -m "feat: bind form_cult home_place_id"
```

---

### Task 4: MCP tools and resources

**Files:**
- Modify: `src/mcp/register.ts`
- Modify: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `getHero`, `catalogTableUris`, `formCult` with `homePlaceId`.
- Produces: tools `get_hero` and `list_catalog_tables`; resources `campaign-hero` and `catalog-tables`; catalog `{path}` list callback. Tool count 53.

- [ ] **Step 1: Write the failing test**

In `test/mcp.test.ts`, change `expect(names).toHaveLength(51)` to `53` and add `expect(names).toContain("get_hero")` and `expect(names).toContain("list_catalog_tables")`.

Add this test:

```ts
test("get_hero and catalog table list work with no open turn", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const created = JSON.parse(
    (
      await client.callTool({
        name: "create_campaign",
        arguments: { name: "Reads", rngSeed: 1 },
      })
    ).content as { text: string }[],
  )[0].text;
  const createdBody = JSON.parse(created);
  const campaignId = createdBody.data.campaignId as string;
  const heroText = (
    await client.callTool({
      name: "create_hero",
      arguments: { campaignId, name: "Lira", level: 2, words: ["Sun"], dominion: 3, divinity: "free" },
    })
  ).content as { text: string }[];
  const heroBody = JSON.parse(heroText[0].text);
  const heroId = heroBody.data.heroId as string;

  const sheetText = (
    await client.callTool({ name: "get_hero", arguments: { heroId } })
  ).content as { text: string }[];
  const sheet = JSON.parse(sheetText[0].text);
  expect(sheet.ok).toBe(true);
  expect(sheet.data).toEqual({
    id: heroId,
    name: "Lira",
    level: 2,
    divinity: "free",
    dominion: 3,
    cult_faction_id: null,
    words: ["Sun"],
  });

  const missingText = (
    await client.callTool({ name: "get_hero", arguments: { heroId: "missing" } })
  ).content as { text: string }[];
  const missing = JSON.parse(missingText[0].text);
  expect(missing).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "hero not found", details: {} },
  });

  const listedText = (
    await client.callTool({ name: "list_catalog_tables", arguments: {} })
  ).content as { text: string }[];
  const listed = JSON.parse(listedText[0].text);
  expect(listed.ok).toBe(true);
  expect(listed.data.uris).toContain("world://tables/powerStructure");

  const collection = await client.readResource({ uri: "world://tables" });
  const collectionBody = JSON.parse(collection.contents[0].text as string);
  expect(collectionBody.uris).toEqual(listed.data.uris);

  const table = await client.readResource({ uri: "world://tables/powerStructure" });
  const rows = JSON.parse(table.contents[0].text as string);
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);

  await client.close();
});
```

Fix the `created` parse if the existing `set_interest` test's pattern is simpler: copy that test's `callTool` / `JSON.parse` style exactly if the snippet above disagrees with `content` typing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`

Expected: FAIL. Tool count still 51. `get_hero` is missing.

- [ ] **Step 3: Write the minimal implementation**

In `src/mcp/register.ts`, import `getHero` from detail and `catalogTableUris` from catalog.

Register `get_hero` next to `get_faction`:

```ts
  reg(
    "get_hero",
    { description: "Hero sheet. No open turn required.", inputSchema: { heroId: z.string() } },
    async (a) => {
      const data = getHero(db, a.heroId as string);
      if (!data) {
        return mcpToolResult({
          ok: false,
          error: { code: "ENTITY_NOT_FOUND", message: "hero not found", details: {} },
        });
      }
      return mcpToolResult(toEnvelope({ ok: true, data }));
    },
  );
```

Register `list_catalog_tables` next to `get_world_brief` or the other reads:

```ts
  reg(
    "list_catalog_tables",
    { description: "List valid world://tables/{path} URIs.", inputSchema: {} },
    async () => mcpToolResult(toEnvelope({ ok: true, data: { uris: catalogTableUris() } })),
  );
```

On `form_cult`, add `homePlaceId: z.string().optional()` and set description to:

`Bind a hero of level 2 or higher to a cult faction. Requires gmOverride for free divinities. Optional homePlaceId must be a place in the campaign.`

Register the hero resource after `campaign-faction`:

```ts
  server.registerResource(
    "campaign-hero",
    new ResourceTemplate("world://campaigns/{campaignId}/heroes/{heroId}", { list: undefined }),
    { description: "Hero JSON" },
    async (_uri, { heroId }) => {
      const data = getHero(db, heroId as string);
      if (!data) {
        return jsonResource({
          ok: false,
          error: { code: "ENTITY_NOT_FOUND", message: "hero not found", details: {} },
        });
      }
      return jsonResource(data);
    },
  );
```

Before the `{path}` template, register:

```ts
  server.registerResource(
    "catalog-tables",
    "world://tables",
    { description: "Catalog table URI list" },
    async () => jsonResource({ uris: catalogTableUris() }),
  );
```

Change the `{path}` template's second argument to:

```ts
    new ResourceTemplate("world://tables/{path}", {
      list: async () => ({
        resources: catalogTableUris().map((uri) => ({
          uri,
          name: uri,
          mimeType: "application/json",
        })),
      }),
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`

Expected: PASS. Adjust the create_campaign JSON parse in the new test if the first run shows a TypeError on `content`; keep the assertions.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register.ts test/mcp.test.ts
git commit -m "feat: expose get_hero and catalog table list"
```

---

### Task 5: Living docs and skill copy

**Files:**
- Modify: `docs/design/current-engine.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`
- Modify: `user/skills/gdnr-player/SKILL.md`
- Modify: `user/README.md`

**Interfaces:**
- Consumes: the sentences in the spec's Docs and play copy section.
- Produces: those edits and no new test.

- [ ] **Step 1: Update the five files**

Apply the exact replacements named in the spec. Do not add a test that reads those files.

- [ ] **Step 2: Commit**

```bash
git add docs/design/current-engine.md user/skills/gdnr-director/references/gdnr-direct.md user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-player/SKILL.md user/README.md
git commit -m "docs: name hero reads and cult home place"
```

- [ ] **Step 3: Run the related tests once more**

Run: `npx vitest run test/queries/get-hero.test.ts test/tables/catalog-uris.test.ts test/services/form-cult.test.ts test/mcp.test.ts`

Expected: PASS.

---

## Self-review

Spec coverage:

- Shared `getHero`, no open turn, `ENTITY_NOT_FOUND` on the tool and hero resource: Tasks 1 and 4.
- `worldBrief.heroes`: Task 1.
- Catalog URI list from one function, collection resource, list callback, thin tool, each path readable: Tasks 2 and 4.
- `form_cult` `homePlaceId` store, adopt keep, unknown place: Task 3.
- Descriptions and skill copy: Tasks 4 and 5.

Placeholder scan: every task names files, error codes, and the code to write.

Type consistency: `getHero`, `catalogTableUris`, `homePlaceId`, `ENTITY_NOT_FOUND` / `hero not found` and `place not found` are the same in every task. Tool count is 53.

## Execution handoff

Implementation continues on this draft pull request. Check out this branch. Do not branch from `main`. Do not open a second pull request.
