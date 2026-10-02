# Remove campaign MCP tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP tool `remove-campaign` that deletes one campaign and every row associated with it, and update living design docs to match.

**Architecture:** `removeCampaign` in `src/services/populate.ts` runs ordered `DELETE` statements in one `withTransaction`, after `requireCampaign`. `src/mcp/register.ts` exposes it as `remove-campaign` with `{ campaignId }`, using the existing `dbTool` envelope. No schema version bump. Skill files stay unchanged.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, `zod` 3.24.2, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-01-remove-campaign-design.md`. Issue #67.
- MCP tool name is `remove-campaign` (hyphens). Input field is `campaignId`.
- Success data is `{ campaignId: string }`. Missing campaign is `CAMPAIGN_NOT_FOUND` via `requireCampaign`.
- One SQLite transaction per service call. Rule failures roll back. Foreign keys stay `ON`.
- Do not bump `SCHEMA_VERSION`. Do not add `ON DELETE CASCADE`. Do not take the write lock. Do not edit `user/` skills.
- Delete child rows before parents. Interests go if either faction belongs to the campaign.
- Living docs: `docs/design/current-engine.md` only (tool count 48 → 49). Historical superpowers specs stay frozen.
- Package manager: npm. Tests: `npx vitest run <file>`.

---

## File map

- Modify: `src/services/populate.ts` — export `removeCampaign` next to `createCampaign`.
- Modify: `src/mcp/register.ts` — import and register `remove-campaign` after `create_campaign`.
- Create: `test/services/remove-campaign.test.ts` — service behavior and isolation.
- Modify: `test/mcp.test.ts` — tool is registered and works through MCP.
- Modify: `docs/design/current-engine.md` — 49 tools; document the delete.

---

### Task 1: `removeCampaign` service

**Files:**
- Create: `test/services/remove-campaign.test.ts`
- Modify: `src/services/populate.ts` (insert `removeCampaign` immediately after `createCampaign`, currently ending around the `createPlace` export)

**Interfaces:**
- Consumes: `Database` from `better-sqlite3`. `requireCampaign`, `wrapRule` from `src/services/util.ts`. `withTransaction` from `src/store/db.ts`. `createCampaign`, `seedCampaign`, `createHero`, `createPlace`, `ensureSetpiece` from the same populate module. `beginChange`, `commitResources` from `src/services/change.ts`. `openParallelTurn` from `src/services/queue.ts`. `openDb` from `src/store/db.ts`.
- Produces:
  - `removeCampaign(db: Database.Database, input: { campaignId: string }): ServiceResult<{ campaignId: string }>`

- [ ] **Step 1: Write the failing tests**

Create `test/services/remove-campaign.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { beginChange, commitResources } from "../../src/services/change.js";
import {
  createCampaign,
  createHero,
  createPlace,
  ensureSetpiece,
  removeCampaign,
  seedCampaign,
} from "../../src/services/populate.js";
import { openParallelTurn } from "../../src/services/queue.js";
import { openDb } from "../../src/store/db.js";

function openTemp() {
  const dir = mkdtempSync(join(tmpdir(), "gdnr-rm-camp-"));
  const path = join(dir, "c.sqlite");
  const db = openDb(path);
  return { dir, path, db };
}

function countByCampaign(db: ReturnType<typeof openDb>, campaignId: string): number {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  let total = 0;
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "campaign_id") && name !== "campaigns") continue;
    const column = name === "campaigns" ? "id" : "campaign_id";
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${column} = ?`).get(campaignId) as {
      n: number;
    };
    total += row.n;
  }
  return total;
}

function leftoverChildren(db: ReturnType<typeof openDb>, campaignId: string): number {
  const one = (sql: string) => (db.prepare(sql).get(campaignId) as { n: number }).n;
  const two = (sql: string) => (db.prepare(sql).get(campaignId, campaignId) as { n: number }).n;
  return (
    one(
      `SELECT COUNT(*) AS n FROM feature_parts WHERE feature_id IN (
         SELECT f.id FROM features f JOIN factions fa ON fa.id = f.faction_id WHERE fa.campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM problems WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    ) +
    two(
      `SELECT COUNT(*) AS n FROM interests WHERE from_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)
         OR to_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM features WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM wards WHERE place_id IN (SELECT id FROM places WHERE campaign_id = ?)`,
    ) +
    two(
      `SELECT COUNT(*) AS n FROM court_memberships WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)
         OR character_id IN (SELECT id FROM characters WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM conflicts WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM court_consequences WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM court_dispositions WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM court_defenses WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM unit_views WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM actions WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
    ) +
    two(
      `SELECT COUNT(*) AS n FROM change_commitments WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)
         OR hero_id IN (SELECT id FROM heroes WHERE campaign_id = ?)`,
    ) +
    one(
      `SELECT COUNT(*) AS n FROM resisters WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)`,
    )
  );
}

test("removeCampaign refuses an unknown campaign and writes nothing", () => {
  const { dir, db } = openTemp();
  try {
    const created = createCampaign(db, { name: "Keep" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number };
    const result = removeCampaign(db, { campaignId: "missing-id" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CAMPAIGN_NOT_FOUND");
    expect(result.error.message).toMatch(/missing-id/);
    const after = db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number };
    expect(after.n).toBe(before.n);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeCampaign deletes an empty campaign row", () => {
  const { dir, db } = openTemp();
  try {
    const created = createCampaign(db, { name: "Gone" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.campaignId;
    const result = removeCampaign(db, { campaignId: id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.campaignId).toBe(id);
    expect(countByCampaign(db, id)).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeCampaign deletes associated graph and leaves another campaign", () => {
  const { dir, path, db } = openTemp();
  try {
    const keep = createCampaign(db, { name: "Keep" });
    expect(keep.ok).toBe(true);
    if (!keep.ok) return;
    const keepId = keep.data.campaignId;
    const keepPlace = createPlace(db, {
      campaignId: keepId,
      name: "Keepville",
      scope: "village",
    });
    expect(keepPlace.ok).toBe(true);

    const seeded = seedCampaign(db, {
      name: "Drop",
      seed: 7,
      fill: "missing",
      linkInterests: true,
      rulingCourts: true,
      outline: {
        places: [
          { key: "p1", name: "Hill", scope: "village" },
          { key: "p2", name: "Ford", scope: "village" },
        ],
        factions: [
          { key: "a", name: "A", homePlaceKey: "p1", power: 1, neighborKeys: ["b"] },
          { key: "b", name: "B", homePlaceKey: "p2", power: 1, neighborKeys: ["a"] },
        ],
      },
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const dropId = seeded.data.campaignId;

    const place = db
      .prepare("SELECT id FROM places WHERE campaign_id = ? LIMIT 1")
      .get(dropId) as { id: string };
    db.prepare("INSERT INTO wards (id, place_id, rating) VALUES ('w1', ?, 4)").run(place.id);

    const hero = createHero(db, { campaignId: dropId, name: "Pat", level: 1 });
    expect(hero.ok).toBe(true);
    if (!hero.ok) return;

    const change = beginChange(db, {
      campaignId: dropId,
      owner: "pc",
      scope: "village",
      magnitude: "plausible",
      kind: "fact",
      placeIds: [place.id],
      resisters: [{ rating: 2, label: "priest" }],
    });
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const committed = commitResources(db, {
      changeId: change.data.changeId,
      heroId: hero.data.heroId,
      influence: 1,
    });
    expect(committed.ok).toBe(true);

    const setpiece = ensureSetpiece(db, {
      campaignId: dropId,
      key: "hook-1",
      need: "challenge",
      seed: 3,
    });
    expect(setpiece.ok).toBe(true);

    const faction = db
      .prepare("SELECT id FROM factions WHERE campaign_id = ? LIMIT 1")
      .get(dropId) as { id: string };
    const opened = openParallelTurn(db, path, { campaignId: dropId, unitIds: [faction.id] });
    expect(opened.ok).toBe(true);

    const keepBefore = countByCampaign(db, keepId);
    expect(countByCampaign(db, dropId)).toBeGreaterThan(1);

    const result = removeCampaign(db, { campaignId: dropId });
    expect(result.ok).toBe(true);
    expect(countByCampaign(db, dropId)).toBe(0);
    expect(leftoverChildren(db, dropId)).toBe(0);
    expect(countByCampaign(db, keepId)).toBe(keepBefore);
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    expect(fk).toEqual([]);

    const again = removeCampaign(db, { campaignId: dropId });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe("CAMPAIGN_NOT_FOUND");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

`leftoverChildren` uses `two()` only for SQL with two `?` placeholders.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/services/remove-campaign.test.ts`

Expected: FAIL — `removeCampaign` is not exported from `src/services/populate.js`.

- [ ] **Step 3: Write minimal implementation**

In `src/services/populate.ts`, add this export immediately after `createCampaign` (before `createPlace`):

```ts
export function removeCampaign(
  db: Database.Database,
  input: { campaignId: string },
): ServiceResult<{ campaignId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, input.campaignId);
      const id = input.campaignId;
      db.prepare(
        `DELETE FROM feature_parts WHERE feature_id IN (
           SELECT f.id FROM features f JOIN factions fa ON fa.id = f.faction_id WHERE fa.campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM problems WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM interests WHERE from_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)
           OR to_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
      ).run(id, id);
      db.prepare(
        `DELETE FROM features WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM wards WHERE place_id IN (SELECT id FROM places WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM court_memberships WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)
           OR character_id IN (SELECT id FROM characters WHERE campaign_id = ?)`,
      ).run(id, id);
      db.prepare(
        `DELETE FROM conflicts WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM court_consequences WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM court_dispositions WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM court_defenses WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM change_commitments WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)
           OR hero_id IN (SELECT id FROM heroes WHERE campaign_id = ?)`,
      ).run(id, id);
      db.prepare(
        `DELETE FROM resisters WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM unit_views WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare("DELETE FROM write_queue WHERE campaign_id = ?").run(id);
      db.prepare(
        `DELETE FROM actions WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
      ).run(id);
      db.prepare("DELETE FROM setpieces WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM challenges WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM facts WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM characters WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM courts WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM factions WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM places WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM heroes WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM changes WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM rolls WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM events WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM turns WHERE campaign_id = ?").run(id);
      db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
      return { campaignId: id };
    }),
  );
}
```

Keep every existing function in `populate.ts` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/services/remove-campaign.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add test/services/remove-campaign.test.ts src/services/populate.ts
git commit -m "feat: delete a campaign and its associated rows"
```

---

### Task 2: MCP tool `remove-campaign`

**Files:**
- Modify: `src/mcp/register.ts` (import list from `./services/populate.js`; register after the `create_campaign` block)
- Modify: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `removeCampaign` from Task 1. `dbTool`, `z.string()`.
- Produces: MCP tool `remove-campaign` with `inputSchema: { campaignId: z.string() }`.

- [ ] **Step 1: Write the failing MCP tests**

In `test/mcp.test.ts`, add to the existing `listTools` test (the one that expects `create_hero`):

```ts
  expect(names).toContain("remove-campaign");
```

Append a new test at the end of `test/mcp.test.ts`:

```ts
test("remove-campaign deletes the campaign through MCP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-mcp-rm-"));
  const dbPath = join(dir, "campaign.sqlite");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(dbPath);
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const created = await client.callTool({
    name: "create_campaign",
    arguments: { name: "Drop" },
  });
  const createdBody = JSON.parse((created.content as { text: string }[])[0].text);
  expect(createdBody.ok).toBe(true);
  const campaignId = createdBody.data.campaignId as string;

  const removed = await client.callTool({
    name: "remove-campaign",
    arguments: { campaignId },
  });
  const removedBody = JSON.parse((removed.content as { text: string }[])[0].text);
  expect(removedBody.ok).toBe(true);
  expect(removedBody.data.campaignId).toBe(campaignId);
  expect(removedBody.rolls).toEqual([]);
  expect(removedBody.derived).toEqual({});

  const brief = await client.callTool({
    name: "get_world_brief",
    arguments: { campaignId },
  });
  const briefBody = JSON.parse((brief.content as { text: string }[])[0].text);
  expect(briefBody.ok).toBe(false);
  expect(briefBody.error.code).toBe("CAMPAIGN_NOT_FOUND");

  await client.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mcp.test.ts`

Expected: FAIL — `listTools` does not include `remove-campaign`, and `callTool` for that name errors.

- [ ] **Step 3: Register the tool**

In `src/mcp/register.ts`, add `removeCampaign` to the import from `../services/populate.js` (same list as `createCampaign`).

Immediately after the `create_campaign` `reg(...)` block, add:

```ts
  reg(
    "remove-campaign",
    {
      description: "Remove a campaign and all data associated with it",
      inputSchema: { campaignId: z.string() },
    },
    dbTool((a) => removeCampaign(db, a)),
  );
```

Do not rename existing tools.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/mcp.test.ts test/services/remove-campaign.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register.ts test/mcp.test.ts
git commit -m "feat: expose remove-campaign MCP tool"
```

---

### Task 3: Living design docs

**Files:**
- Modify: `docs/design/current-engine.md`

**Interfaces:**
- Consumes: shipped tool name `remove-campaign` from Task 2.
- Produces: current-engine text that matches the running surface.

- [ ] **Step 1: Update current-engine.md**

In `docs/design/current-engine.md`:

Replace `The server exposes 48 tools` with `The server exposes 49 tools`.

In the **Campaigns and the database file** section, after the paragraph that `create_campaign` and `seed_campaign` each add a row, add:

```markdown
`remove-campaign` takes a `campaignId` and deletes that campaign row and every row associated with it. Other campaigns in the same file stay. The SQLite file is not deleted.
```

Keep the sentence that there is no tool that lists campaigns.

Do not edit `user/` or historical files under `docs/superpowers/specs/` except this plan’s companion design.

- [ ] **Step 2: Confirm the count matches the registry**

Run: `node -e "import { readFileSync } from 'node:fs'; const t=readFileSync('src/mcp/register.ts','utf8'); const n=[...t.matchAll(/^\s*reg\(/gm)].length; console.log(n); if (n!==49) process.exit(1)"`

Expected: prints `49` and exit 0. If the count is wrong, fix the living doc or find a missed `reg(` — do not invent a tool.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/design/current-engine.md
git commit -m "docs: record remove-campaign on the current engine"
```
