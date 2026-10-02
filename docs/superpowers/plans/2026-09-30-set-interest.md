# Direct interest edge implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-setup writer `set_interest` that creates a directed interest edge with an explicit catalog nature (default 1 point), without changing seed pairing or `extend_interest` rolling.

**Architecture:** New service `setInterest` in `src/services/populate.ts`. MCP `set_interest` adapts it. Play and director manuals stop claiming the writer is missing. Tool count 49.

**Tech Stack:** TypeScript, Zod, Vitest, better-sqlite3.

## Global Constraints

- Design: `docs/superpowers/specs/2026-09-30-set-interest-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/41
- Do not change `seed_campaign` linking rules.
- Do not add `nature` to `extend_interest` / `faction_action`.
- Do not implement auto-intervention.
- No game rules in MCP handlers.
- Public copy: no personal names. `user/` files must not link outside `user/`.

---

### Task 1: Failing service tests

**Files:**
- Create: `test/services/set-interest.test.ts`

**Interfaces:**
- Consumes: `setInterest` (does not exist yet)
- Produces: failing tests for the locked rules

- [ ] **Step 1: Write the test file**

```typescript
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { setInterest } from "../../src/services/populate.js";

function twoFactions() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Test', 1, 1, 0)",
  ).run();
  for (const id of ["a", "b"] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, id);
  }
  return db;
}

test("setInterest creates a spies edge at 1 point", () => {
  const db = twoFactions();
  const result = setInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    nature: "spies",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toMatchObject({ nature: "spies", points: 1, fromFactionId: "a", toFactionId: "b" });
  const row = db
    .prepare("SELECT points, nature FROM interests WHERE from_faction_id = 'a' AND to_faction_id = 'b'")
    .get() as { points: number; nature: string };
  expect(row).toEqual({ points: 1, nature: "spies" });
});

test("setInterest honors caller points within cap and rejects over cap", () => {
  const db = twoFactions();
  const ok = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "rivalry", points: 6,
  });
  expect(ok.ok).toBe(true);
  const over = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "trade", points: 13, replaceNature: true,
  });
  expect(over.ok).toBe(false);
  if (!over.ok) expect(over.error.code).toBe("INTEREST_CAP");
});

test("setInterest refuses self-edges and nature mismatch without replaceNature", () => {
  const db = twoFactions();
  const self = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "a", nature: "alliance",
  });
  expect(self.ok).toBe(false);
  if (!self.ok) expect(self.error.code).toBe("FILL_INCOMPLETE");

  setInterest(db, { campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "alliance" });
  const clash = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "spies",
  });
  expect(clash.ok).toBe(false);
  if (!clash.ok) expect(clash.error.code).toBe("INTEREST_NATURE_MISMATCH");
  const kept = db.prepare("SELECT nature FROM interests WHERE from_faction_id = 'a'").get() as { nature: string };
  expect(kept.nature).toBe("alliance");

  const replaced = setInterest(db, {
    campaignId: "c1", fromFactionId: "a", toFactionId: "b", nature: "spies", replaceNature: true,
  });
  expect(replaced.ok).toBe(true);
  const after = db.prepare("SELECT nature FROM interests WHERE from_faction_id = 'a'").get() as { nature: string };
  expect(after.nature).toBe("spies");
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run test/services/set-interest.test.ts
```

Expected: FAIL (cannot import `setInterest` or the function is missing).

- [ ] **Step 3: Commit**

```bash
git add test/services/set-interest.test.ts
git commit -m "test: setInterest explicit nature writer"
```

---

### Task 2: Implement setInterest

**Files:**
- Modify: `src/services/populate.ts`
- Modify: `src/domain/types.ts` only if `RuleError` codes are typed there (they are string codes on `RuleError`; no type change required unless a union exists)

**Interfaces:**
- Consumes: `interestCap` from `src/rules/actions.ts`, `DIE_BY_POWER`, `InterestNature`, `requireCampaign`
- Produces: `setInterest` as specified

- [ ] **Step 1: Implement `setInterest` in `populate.ts` next to other setup writers**

Use `wrapRule` + `withTransaction`. Validate campaign and both factions with the same `requireCampaign` / faction lookup pattern as `createFact`. Throw:

- `RuleError("ENTITY_NOT_FOUND", "faction not found")` when either faction is missing or `campaign_id` mismatches
- `RuleError("FILL_INCOMPLETE", "cannot set interest to self")`
- `RuleError("PICK_UNKNOWN", "unknown interest nature")` if nature is not in the seven-id list
- `RuleError("FILL_INCOMPLETE", "interest points must be at least 1")` when `points` is 0 or negative
- `RuleError("INTEREST_CAP", "interest already at cap")` when `points > interestCap(...)`
- `RuleError("INTEREST_NATURE_MISMATCH", "existing interest has a different nature")` when natures differ and `replaceNature` is not true

INSERT or UPDATE `interests` as in the design. Return `{ interestId, fromFactionId, toFactionId, nature, points }`.

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run test/services/set-interest.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/populate.ts
git commit -m "feat: setInterest writes a directed edge with chosen nature"
```

---

### Task 3: MCP tool and engine inventory

**Files:**
- Modify: `src/mcp/register.ts`
- Modify: `docs/design/current-engine.md`

**Interfaces:**
- Consumes: `setInterest`
- Produces: tool `set_interest`; 49 tools; error code listed

- [ ] **Step 1: Register the tool** after `create_faction` (or beside `create_fact`):

```typescript
reg(
  "set_interest",
  {
    description: "Create or update a directed interest edge with an explicit catalog nature",
    inputSchema: {
      campaignId: z.string(),
      fromFactionId: z.string(),
      toFactionId: z.string(),
      nature: z.enum(["alliance", "rivalry", "trade", "marriage", "spies", "aid", "tribute"]),
      points: z.number().int().min(1).optional(),
      replaceNature: z.boolean().optional(),
    },
  },
  dbTool((a) => setInterest(db, a)),
);
```

Import `setInterest` from `populate.ts` at the top of `register.ts` (same import list as `createFaction`).

- [ ] **Step 2: current-engine.md**

Change “The server exposes 48 tools” to **49**. Add `INTEREST_NATURE_MISMATCH` to the common error-code sentence.

- [ ] **Step 3: `npm test`**

Expected: PASS. If a test snapshots the tool count, update that snapshot to 49.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/register.ts docs/design/current-engine.md
git commit -m "feat: register set_interest MCP tool"
```

---

### Task 4: Play and director manuals

**Files:**
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`

- [ ] **Step 1: Director**

In the adding-entities table, add a row:

```markdown
| `set_interest` | Directed edge `fromFactionId` → `toFactionId` with required catalog `nature`. Default `points` is 1. Does not roll. Existing different nature fails unless `replaceNature: true`. |
```

Replace the section **When the user wants a chosen interest nature** so it tells the agent to call `set_interest`, and keep the `create_fact` warning. Keep `extend_interest` under **What not to use for setup** as a contest that still rolls nature on a new edge.

- [ ] **Step 2: Player**

In the intent table, change standing war / spies rows to name `set_interest` for the edge. Replace the closing paragraph that says tools cannot write a chosen nature after seed with: after seed, use `set_interest`; `extend_interest` still rolls nature on a brand-new edge during a month.

Add `INTEREST_NATURE_MISMATCH` to the error table: the directed pair already has a different nature; pass `replaceNature: true` or pick the existing nature.

- [ ] **Step 3: Confirm no `user/` links leave `user/`.**

- [ ] **Step 4: Commit**

```bash
git add user/skills/gdnr-director/references/gdnr-direct.md user/skills/gdnr-player/references/gdnr-play.md
git commit -m "docs: manuals for set_interest post-setup edges"
```

---

## Self-review

- Spec coverage: new tool, default 1, no silent overwrite, seed/extend unchanged, docs, tests, tool count.
- `setInterest` name matches MCP `set_interest`.
- No placeholders.
