# Remove campaign implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `remove_campaign`, which deletes one campaign and every row associated with it, and document that tool in the living engine page.

**Architecture:** `removeCampaign` in its own service runs ordered deletes inside one transaction with foreign keys left on. The MCP handler registers the tool and calls that service. `docs/design/current-engine.md` records the tool and the new tool count.

**Tech Stack:** SQLite (`better-sqlite3`), TypeScript, Vitest, `@modelcontextprotocol/sdk`.

## Global Constraints

- Design: `docs/superpowers/specs/2026-10-01-remove-campaign-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/67
- Registered tool name: `remove_campaign`. Input field: `campaignId`.
- Missing campaign: `CAMPAIGN_NOT_FOUND`, message `campaign ${campaignId} not found`.
- Do not edit files under `user/`.
- Do not bump `SCHEMA_VERSION`. Do not add `ON DELETE CASCADE`. Do not set `PRAGMA foreign_keys = OFF`.
- Do not add a list-campaigns tool. Do not change the living sentence that a lost id cannot be recovered.
- No game rules and no SQL in MCP handlers.
- Public copy: no personal names.
- `npm test` does not need a running server.

---

### Task 1: removeCampaign service

**Files:**
- Create: `test/services/remove-campaign.test.ts`
- Create: `src/services/removeCampaign.ts`
- Test: `test/services/remove-campaign.test.ts`

**Interfaces:**
- Consumes: `openDb`, `withTransaction` from `src/store/db.ts`; `requireCampaign`, `wrapRule`, `ServiceResult` from `src/services/util.ts`; `createCampaign` from `src/services/populate.ts`; `worldBrief` from `src/queries/rumors.ts`.
- Produces: `removeCampaign(db: Database.Database, campaignId: string): ServiceResult<{ campaignId: string }>`. Throws (does not return `ok: false`) when a foreign-key constraint fails inside the transaction.

- [ ] **Step 1: Write the failing test**

Create `test/services/remove-campaign.test.ts`:

```typescript
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createCampaign } from "../../src/services/populate.js";
import { worldBrief } from "../../src/queries/rumors.js";
import { removeCampaign } from "../../src/services/removeCampaign.js";

const TABLES = [
  "actions",
  "campaigns",
  "challenges",
  "change_commitments",
  "changes",
  "characters",
  "conflicts",
  "court_consequences",
  "court_defenses",
  "court_dispositions",
  "court_memberships",
  "courts",
  "events",
  "factions",
  "facts",
  "feature_parts",
  "features",
  "heroes",
  "interests",
  "places",
  "problems",
  "resisters",
  "rolls",
  "setpieces",
  "turns",
  "unit_views",
  "wards",
  "write_queue",
];

function count(db: ReturnType<typeof openDb>, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function associatedCounts(db: ReturnType<typeof openDb>, campaignId: string): Record<string, number> {
  const id = campaignId;
  return {
    campaigns: count(db, "SELECT COUNT(*) AS n FROM campaigns WHERE id = ?", id),
    places: count(db, "SELECT COUNT(*) AS n FROM places WHERE campaign_id = ?", id),
    wards: count(
      db,
      "SELECT COUNT(*) AS n FROM wards WHERE place_id IN (SELECT id FROM places WHERE campaign_id = ?)",
      id,
    ),
    factions: count(db, "SELECT COUNT(*) AS n FROM factions WHERE campaign_id = ?", id),
    features: count(
      db,
      "SELECT COUNT(*) AS n FROM features WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)",
      id,
    ),
    feature_parts: count(
      db,
      `SELECT COUNT(*) AS n FROM feature_parts WHERE feature_id IN (
         SELECT fe.id FROM features fe
         JOIN factions fa ON fa.id = fe.faction_id
         WHERE fa.campaign_id = ?
       )`,
      id,
    ),
    problems: count(
      db,
      "SELECT COUNT(*) AS n FROM problems WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)",
      id,
    ),
    interests: count(
      db,
      `SELECT COUNT(*) AS n FROM interests
       WHERE from_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)
          OR to_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
      id,
      id,
    ),
    courts: count(db, "SELECT COUNT(*) AS n FROM courts WHERE campaign_id = ?", id),
    characters: count(db, "SELECT COUNT(*) AS n FROM characters WHERE campaign_id = ?", id),
    court_memberships: count(
      db,
      `SELECT COUNT(*) AS n FROM court_memberships
       WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)
          OR character_id IN (SELECT id FROM characters WHERE campaign_id = ?)`,
      id,
      id,
    ),
    conflicts: count(
      db,
      "SELECT COUNT(*) AS n FROM conflicts WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)",
      id,
    ),
    court_consequences: count(
      db,
      "SELECT COUNT(*) AS n FROM court_consequences WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)",
      id,
    ),
    court_dispositions: count(
      db,
      "SELECT COUNT(*) AS n FROM court_dispositions WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)",
      id,
    ),
    court_defenses: count(
      db,
      "SELECT COUNT(*) AS n FROM court_defenses WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)",
      id,
    ),
    facts: count(db, "SELECT COUNT(*) AS n FROM facts WHERE campaign_id = ?", id),
    heroes: count(db, "SELECT COUNT(*) AS n FROM heroes WHERE campaign_id = ?", id),
    changes: count(db, "SELECT COUNT(*) AS n FROM changes WHERE campaign_id = ?", id),
    change_commitments: count(
      db,
      `SELECT COUNT(*) AS n FROM change_commitments
       WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)
          OR hero_id IN (SELECT id FROM heroes WHERE campaign_id = ?)`,
      id,
      id,
    ),
    resisters: count(
      db,
      "SELECT COUNT(*) AS n FROM resisters WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)",
      id,
    ),
    challenges: count(db, "SELECT COUNT(*) AS n FROM challenges WHERE campaign_id = ?", id),
    setpieces: count(db, "SELECT COUNT(*) AS n FROM setpieces WHERE campaign_id = ?", id),
    turns: count(db, "SELECT COUNT(*) AS n FROM turns WHERE campaign_id = ?", id),
    unit_views: count(
      db,
      "SELECT COUNT(*) AS n FROM unit_views WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)",
      id,
    ),
    write_queue: count(db, "SELECT COUNT(*) AS n FROM write_queue WHERE campaign_id = ?", id),
    rolls: count(db, "SELECT COUNT(*) AS n FROM rolls WHERE campaign_id = ?", id),
    actions: count(
      db,
      "SELECT COUNT(*) AS n FROM actions WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)",
      id,
    ),
    events: count(db, "SELECT COUNT(*) AS n FROM events WHERE campaign_id = ?", id),
  };
}

function seedTwoCampaigns(db: ReturnType<typeof openDb>): void {
  db.exec(`
    INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES
      ('a', 'A', 1, 1, 0),
      ('b', 'B', 1, 2, 0);
    INSERT INTO places (id, campaign_id, name, scope) VALUES
      ('p1', 'a', 'Home', 'village'),
      ('pb', 'b', 'Kept', 'village');
    INSERT INTO wards (id, place_id, rating) VALUES ('w1', 'p1', 2);
    INSERT INTO factions (
      id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status
    ) VALUES
      ('fa1', 'a', 'One', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active'),
      ('fa2', 'a', 'Two', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active'),
      ('fb', 'b', 'Kept faction', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active');
    INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
      VALUES ('feat1', 'fa1', 'Market', 'economic', 'normal', 'normal', 0, 'native');
    INSERT INTO feature_parts (id, feature_id, text, position) VALUES ('part1', 'feat1', 'Stalls', 0);
    INSERT INTO problems (
      id, faction_id, text, points, domain, intrinsic, external, resistance, position
    ) VALUES ('prob1', 'fa1', 'Bandits', 1, 'military', 0, 0, 0, 0);
    INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature) VALUES
      ('i1', 'fa1', 'fa2', 1, 'rivalry'),
      ('i-cross', 'fa1', 'fb', 1, 'rivalry');
    INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, blank)
      VALUES ('court1', 'a', 'guild', 'council', 'tense', 0);
    INSERT INTO characters (
      id, campaign_id, role, side, is_leader, is_hidden_controller, shares_authority
    ) VALUES ('char1', 'a', 'elder', 'neutral', 0, 0, 0);
    INSERT INTO court_memberships (court_id, character_id, rank, side)
      VALUES ('court1', 'char1', 'member', 'neutral');
    INSERT INTO conflicts (id, court_id, text) VALUES ('conf1', 'court1', 'A quarrel');
    INSERT INTO court_consequences (id, court_id, text) VALUES ('cons1', 'court1', 'A cost');
    INSERT INTO court_dispositions (court_id, target_type, target_id, disposition)
      VALUES ('court1', 'faction', 'fa2', 'wary');
    INSERT INTO court_defenses (id, court_id, text) VALUES ('def1', 'court1', 'A wall');
    INSERT INTO facts (id, campaign_id, subject, subject_id, kind)
      VALUES ('fact1', 'a', 'place', 'p1', 'trait');
    INSERT INTO heroes (id, campaign_id, name, level, influence, dominion, wealth, divinity)
      VALUES ('hero1', 'a', 'Ada', 1, 0, 0, 0, 'none');
    INSERT INTO changes (id, campaign_id, scope, magnitude, kind, owner, status)
      VALUES ('ch1', 'a', 'village', 'plausible', 'other', 'hero1', 'open');
    INSERT INTO change_commitments (change_id, hero_id, influence, wealth_spent)
      VALUES ('ch1', 'hero1', 1, 0);
    INSERT INTO resisters (id, change_id, rating, label) VALUES ('res1', 'ch1', 1, 'militia');
    INSERT INTO challenges (id, campaign_id, kind, text, change_id, status)
      VALUES ('chal1', 'a', 'find_thing', 'A decoy', 'ch1', 'open');
    INSERT INTO setpieces (id, campaign_id, key, need, status, court_id, challenge_id, character_id, fact_id)
      VALUES ('sp1', 'a', 'hook', 'a need', 'open', 'court1', 'chal1', 'char1', 'fact1');
    INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
      VALUES ('turn1', 'a', 1, 1, 0, '[]');
    INSERT INTO unit_views (id, turn_id, unit_type, unit_id, snapshot)
      VALUES ('uv1', 'turn1', 'faction', 'fa1', '{}');
    INSERT INTO write_queue (
      id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, enqueued_at
    ) VALUES ('wq1', 'a', 'turn1', 'faction', 'fa1', 'plan', '{}', 'pending', 1);
    INSERT INTO rolls (id, campaign_id, payload) VALUES ('roll1', 'a', '{}');
    INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id)
      VALUES ('act1', 'turn1', 'attack', 'faction', 'fa1', 'roll1');
    INSERT INTO events (id, campaign_id, type, payload, created_at)
      VALUES ('ev1', 'a', 'note', '{}', 1);
  `);
}

test("removeCampaign deletes one campaign and leaves the other", () => {
  const db = openDb(":memory:");
  const names = (
    db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as { name: string }[]
  ).map((row) => row.name);
  expect(names).toEqual(TABLES);

  seedTwoCampaigns(db);
  const before = associatedCounts(db, "a");
  expect(Object.entries(before).filter(([, n]) => n === 0)).toEqual([]);
  expect(associatedCounts(db, "b")).toMatchObject({
    campaigns: 1,
    places: 1,
    factions: 1,
    interests: 1,
  });

  const missing = removeCampaign(db, "missing");
  expect(missing).toEqual({
    ok: false,
    error: { code: "CAMPAIGN_NOT_FOUND", message: "campaign missing not found", details: {} },
  });
  expect(associatedCounts(db, "a").campaigns).toBe(1);
  expect(associatedCounts(db, "b").campaigns).toBe(1);

  const removed = removeCampaign(db, "a");
  expect(removed).toEqual({ ok: true, data: { campaignId: "a" } });
  expect(associatedCounts(db, "a")).toEqual({
    campaigns: 0,
    places: 0,
    wards: 0,
    factions: 0,
    features: 0,
    feature_parts: 0,
    problems: 0,
    interests: 0,
    courts: 0,
    characters: 0,
    court_memberships: 0,
    conflicts: 0,
    court_consequences: 0,
    court_dispositions: 0,
    court_defenses: 0,
    facts: 0,
    heroes: 0,
    changes: 0,
    change_commitments: 0,
    resisters: 0,
    challenges: 0,
    setpieces: 0,
    turns: 0,
    unit_views: 0,
    write_queue: 0,
    rolls: 0,
    actions: 0,
    events: 0,
  });
  expect(associatedCounts(db, "b")).toMatchObject({
    campaigns: 1,
    places: 1,
    factions: 1,
    interests: 0,
  });
  expect(db.prepare("SELECT id FROM factions WHERE id = 'fb'").get()).toEqual({ id: "fb" });
  expect(worldBrief(db, "a")).toBeNull();
  expect(worldBrief(db, "b")?.month).toBe(1);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

  const again = removeCampaign(db, "a");
  expect(again).toEqual({
    ok: false,
    error: { code: "CAMPAIGN_NOT_FOUND", message: "campaign a not found", details: {} },
  });
  expect(associatedCounts(db, "b").campaigns).toBe(1);
});

test("removeCampaign deletes a campaign that has no child rows", () => {
  const db = openDb(":memory:");
  const created = createCampaign(db, { name: "Empty" });
  const kept = createCampaign(db, { name: "Kept" });
  expect(created.ok).toBe(true);
  expect(kept.ok).toBe(true);
  if (!created.ok || !kept.ok) return;

  const removed = removeCampaign(db, created.data.campaignId);
  expect(removed).toEqual({ ok: true, data: { campaignId: created.data.campaignId } });
  expect(worldBrief(db, created.data.campaignId)).toBeNull();
  expect(worldBrief(db, kept.data.campaignId)?.month).toBe(1);
});

test("a foreign key from another campaign aborts removal", () => {
  const db = openDb(":memory:");
  db.exec(`
    INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES
      ('a', 'A', 1, 1, 0),
      ('b', 'B', 1, 1, 0);
    INSERT INTO rolls (id, campaign_id, payload) VALUES ('roll-a', 'a', '{}');
    INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
      VALUES ('turn-b', 'b', 1, 1, 0, '[]');
    INSERT INTO actions (id, turn_id, type, actor_type, actor_id, roll_id)
      VALUES ('act-b', 'turn-b', 'attack', 'faction', 'fb', 'roll-a');
  `);

  expect(() => removeCampaign(db, "a")).toThrow();
  expect(db.prepare("SELECT id FROM campaigns ORDER BY id").all()).toEqual([{ id: "a" }, { id: "b" }]);
  expect(db.prepare("SELECT id FROM rolls").all()).toEqual([{ id: "roll-a" }]);
  expect(db.prepare("SELECT id FROM actions").all()).toEqual([{ id: "act-b" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/remove-campaign.test.ts`

Expected: FAIL. The failure names `src/services/removeCampaign.js` as a missing module.

- [ ] **Step 3: Write the service**

Create `src/services/removeCampaign.ts`:

```typescript
import type Database from "better-sqlite3";
import { withTransaction } from "../store/db.js";
import { requireCampaign, wrapRule, type ServiceResult } from "./util.js";

const DELETES: readonly string[] = [
  `DELETE FROM feature_parts WHERE feature_id IN (
     SELECT fe.id FROM features fe
     JOIN factions fa ON fa.id = fe.faction_id
     WHERE fa.campaign_id = ?
   )`,
  `DELETE FROM actions WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
  `DELETE FROM unit_views WHERE turn_id IN (SELECT id FROM turns WHERE campaign_id = ?)`,
  `DELETE FROM write_queue WHERE campaign_id = ?`,
  `DELETE FROM court_memberships
   WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)
      OR character_id IN (SELECT id FROM characters WHERE campaign_id = ?)`,
  `DELETE FROM conflicts WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
  `DELETE FROM court_consequences WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
  `DELETE FROM court_dispositions WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
  `DELETE FROM court_defenses WHERE court_id IN (SELECT id FROM courts WHERE campaign_id = ?)`,
  `DELETE FROM setpieces WHERE campaign_id = ?`,
  `DELETE FROM change_commitments
   WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)
      OR hero_id IN (SELECT id FROM heroes WHERE campaign_id = ?)`,
  `DELETE FROM resisters WHERE change_id IN (SELECT id FROM changes WHERE campaign_id = ?)`,
  `DELETE FROM challenges WHERE campaign_id = ?`,
  `DELETE FROM features WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
  `DELETE FROM problems WHERE faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
  `DELETE FROM interests
   WHERE from_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)
      OR to_faction_id IN (SELECT id FROM factions WHERE campaign_id = ?)`,
  `DELETE FROM wards WHERE place_id IN (SELECT id FROM places WHERE campaign_id = ?)`,
  `DELETE FROM events WHERE campaign_id = ?`,
  `DELETE FROM rolls WHERE campaign_id = ?`,
  `DELETE FROM turns WHERE campaign_id = ?`,
  `DELETE FROM changes WHERE campaign_id = ?`,
  `DELETE FROM heroes WHERE campaign_id = ?`,
  `DELETE FROM facts WHERE campaign_id = ?`,
  `DELETE FROM characters WHERE campaign_id = ?`,
  `DELETE FROM courts WHERE campaign_id = ?`,
  `DELETE FROM factions WHERE campaign_id = ?`,
  `DELETE FROM places WHERE campaign_id = ?`,
  `DELETE FROM campaigns WHERE id = ?`,
];

export function removeCampaign(
  db: Database.Database,
  campaignId: string,
): ServiceResult<{ campaignId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      requireCampaign(db, campaignId);
      for (const sql of DELETES) {
        const binds = [...sql].filter((ch) => ch === "?").length;
        db.prepare(sql).run(...Array.from({ length: binds }, () => campaignId));
      }
      return { campaignId };
    }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/remove-campaign.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add test/services/remove-campaign.test.ts src/services/removeCampaign.ts
git commit -m "feat: remove a campaign and its rows"
```

---

### Task 2: MCP tool

**Files:**
- Modify: `test/mcp.test.ts`
- Modify: `src/mcp/register.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `removeCampaign(db, campaignId)` from Task 1. `dbTool` in `src/mcp/register.ts`.
- Produces: MCP tool `remove_campaign` with description `Remove a campaign and all data associated with it` and input `{ campaignId: string }`.

- [ ] **Step 1: Write the failing test**

Append to `test/mcp.test.ts`:

```typescript
test("remove_campaign deletes one campaign and leaves another", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);

  const listed = await client.listTools();
  const tool = listed.tools.find((entry) => entry.name === "remove_campaign");
  expect(tool?.description).toBe("Remove a campaign and all data associated with it");

  const parse = (result: Awaited<ReturnType<typeof client.callTool>>) =>
    JSON.parse((result.content as { text: string }[])[0].text) as {
      ok: boolean;
      data?: { campaignId?: string; month?: number };
      rolls?: unknown[];
      advisories?: unknown[];
      derived?: Record<string, unknown>;
      error?: { code: string; message: string };
    };

  const gone = parse(
    await client.callTool({ name: "create_campaign", arguments: { name: "Gone" } }),
  );
  const kept = parse(
    await client.callTool({ name: "create_campaign", arguments: { name: "Kept" } }),
  );
  expect(gone.ok).toBe(true);
  expect(kept.ok).toBe(true);
  const goneId = gone.data?.campaignId as string;
  const keptId = kept.data?.campaignId as string;

  const removed = parse(
    await client.callTool({ name: "remove_campaign", arguments: { campaignId: goneId } }),
  );
  expect(removed).toEqual({
    ok: true,
    data: { campaignId: goneId },
    rolls: [],
    advisories: [],
    derived: {},
  });

  const goneBrief = parse(
    await client.callTool({ name: "get_world_brief", arguments: { campaignId: goneId } }),
  );
  expect(goneBrief.ok).toBe(false);
  expect(goneBrief.error?.code).toBe("CAMPAIGN_NOT_FOUND");

  const keptBrief = parse(
    await client.callTool({ name: "get_world_brief", arguments: { campaignId: keptId } }),
  );
  expect(keptBrief.ok).toBe(true);
  expect(keptBrief.data?.month).toBe(1);

  const again = parse(
    await client.callTool({ name: "remove_campaign", arguments: { campaignId: goneId } }),
  );
  expect(again.ok).toBe(false);
  expect(again.error).toEqual({
    code: "CAMPAIGN_NOT_FOUND",
    message: `campaign ${goneId} not found`,
    details: {},
  });

  await client.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`

Expected: FAIL. The new test fails because `remove_campaign` is absent from `listTools` (`tool` is undefined). The earlier tests in the file still pass.

- [ ] **Step 3: Register the tool**

In `src/mcp/register.ts`, add this import next to the other service imports:

```typescript
import { removeCampaign } from "../services/removeCampaign.js";
```

Immediately after the `seed_campaign` registration (the `reg("seed_campaign", ...)` block), add:

```typescript
  reg(
    "remove_campaign",
    {
      description: "Remove a campaign and all data associated with it",
      inputSchema: { campaignId: z.string() },
    },
    dbTool((a) => removeCampaign(db, a.campaignId)),
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp.test.ts test/services/remove-campaign.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/mcp.test.ts src/mcp/register.ts
git commit -m "feat: expose remove_campaign"
```

---

### Task 3: Living engine doc

**Files:**
- Modify: `docs/design/current-engine.md`

**Interfaces:**
- Consumes: the registered tool from Task 2.
- Produces: the campaign paragraph and the tool count in `docs/design/current-engine.md` describe `remove_campaign`.

- [ ] **Step 1: Update the campaign paragraph**

In `docs/design/current-engine.md`, the campaign section ends the first paragraph with:

```markdown
Every tool call names its `campaignId`.
```

Replace that sentence with:

```markdown
Every tool call names its `campaignId`. `remove_campaign` deletes that campaign and every row associated with it. Other campaigns in the same file stay. The file stays, including when no campaigns remain.
```

Leave the following paragraph, the one that begins `There is no tool that lists campaigns.`, unchanged.

- [ ] **Step 2: Update the tool count**

Replace:

```markdown
The server exposes 48 tools, 6 resource templates, and 2 prompts.
```

with:

```markdown
The server exposes 49 tools, 6 resource templates, and 2 prompts.
```

- [ ] **Step 3: Commit**

```bash
git add docs/design/current-engine.md
git commit -m "docs: describe remove_campaign in the current engine"
```

---

## Self-review

Spec coverage: ordered deletes, join-row rules, missing-id error, second call, empty campaign, blocking foreign key, MCP name and envelope, sibling campaign preserved, living doc tool count and campaign paragraph, no skill edits, no schema bump. Each of those has a task step above.

Placeholder scan: delete statements, fixtures, and assertions are written out. No deferred steps.

Type consistency: `removeCampaign(db, campaignId)` returns `ServiceResult<{ campaignId: string }>` in Task 1 and Task 2. The tool name is `remove_campaign` in the design, the registration, and the MCP test.
