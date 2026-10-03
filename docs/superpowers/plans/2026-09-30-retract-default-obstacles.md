# Retract defaultObstacles implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `quoteChange` / `beginChange` from inventing mighty-deed and challenge quotas; default both to 0 unless the caller sets them, including explicit zero.

**Architecture:** Domain `quoteChange` drops `defaultObstacles`. MCP `quote_change` and `begin_change` gain optional non-negative `deedsRequired` and `challengesRequired`. Play copy stops treating the quote as the source of those gates.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 in-memory tests, MCP Zod schemas.

## Global Constraints

- Design: `docs/superpowers/specs/2026-09-30-retract-default-obstacles-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/52
- Do not add ward or resister tooling.
- Do not put game rules in MCP handlers beyond forwarding validated args.
- Public copy: no personal names.

---

### Task 1: Failing quote tests

**Files:**
- Modify: `test/rules/cost.test.ts`

**Interfaces:**
- Consumes: `quoteChange` from `src/rules/cost.ts`
- Produces: tests that fail while `defaultObstacles` still assigns 1+ deeds on impossible/vast

- [ ] **Step 1: Add tests**

Append:

```typescript
test("omitted deed and challenge quotas default to 0, including impossible and vast", () => {
  const impossibleRealm = quoteChange({
    scope: "realm", magnitude: "impossible", wardRatings: [], resisterRatings: [],
  });
  expect(impossibleRealm.deedsRequired).toBe(0);
  expect(impossibleRealm.challengesRequired).toBe(0);
  expect(impossibleRealm.total).toBe(64);

  const vastCity = quoteChange({
    scope: "city", magnitude: "vast", wardRatings: [], resisterRatings: [],
    kind: "creature_population",
  });
  expect(vastCity.deedsRequired).toBe(0);
  expect(vastCity.challengesRequired).toBe(0);
});

test("caller-set deed and challenge quotas including explicit zero", () => {
  const needsDeed = quoteChange({
    scope: "village", magnitude: "impossible", wardRatings: [], resisterRatings: [],
    deedsRequired: 1, challengesRequired: 2,
  });
  expect(needsDeed.deedsRequired).toBe(1);
  expect(needsDeed.challengesRequired).toBe(2);

  const explicitZero = quoteChange({
    scope: "nation", magnitude: "vast", wardRatings: [], resisterRatings: [],
    deedsRequired: 0, challengesRequired: 0,
  });
  expect(explicitZero.deedsRequired).toBe(0);
  expect(explicitZero.challengesRequired).toBe(0);
});
```

`64` is `SCOPE_COST.realm` (16) times impossible multiplier 4 with no wards or resisters. If a nearby test already documents a different total, match that test rather than this number.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/rules/cost.test.ts
```

Expected: FAIL on `deedsRequired` / `challengesRequired` for omitted impossible/vast (today 1+).

- [ ] **Step 3: Commit the failing tests**

```bash
git add test/rules/cost.test.ts
git commit -m "test: quoteChange omits silent deed and challenge quotas"
```

---

### Task 2: Zero defaults in quoteChange

**Files:**
- Modify: `src/rules/cost.ts`

**Interfaces:**
- Consumes: optional `deedsRequired` / `challengesRequired` on `quoteChange` input
- Produces: those fields default to 0; `defaultObstacles` gone

- [ ] **Step 1: Replace defaulting**

In `quoteChange`, delete the `defaultObstacles` call and the function. Return:

```typescript
deedsRequired: input.deedsRequired ?? 0,
challengesRequired: input.challengesRequired ?? 0,
```

Leave `petty` on the input type; do not use it for quotas.

- [ ] **Step 2: Run tests**

```bash
npx vitest run test/rules/cost.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/rules/cost.ts test/rules/cost.test.ts
git commit -m "fix: default change deed and challenge quotas to 0"
```

---

### Task 3: beginChange persistence and MCP args

**Files:**
- Modify: `src/mcp/register.ts` (`quote_change`, `begin_change`)
- Modify: `src/services/change.ts` (`beginChange` negative check)
- Create: `test/services/begin-change-obstacles.test.ts`

**Interfaces:**
- Consumes: optional `deedsRequired` / `challengesRequired` on both tools
- Produces: MCP forwards them; begin persists them; negatives fail `FILL_INCOMPLETE`

- [ ] **Step 1: Write the failing service test**

```typescript
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { beginChange } from "../../src/services/change.js";

function dbWithCampaign() {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Test', 1, 1, 0)",
  ).run();
  return db;
}

test("beginChange stores 0 deed and challenge quotas when omitted", () => {
  const db = dbWithCampaign();
  const result = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "realm",
    magnitude: "impossible",
    kind: "feature",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.quote.deedsRequired).toBe(0);
  expect(result.data.quote.challengesRequired).toBe(0);
  const row = db.prepare("SELECT deeds_required, challenges_required FROM changes WHERE id = ?").get(
    result.data.changeId,
  ) as { deeds_required: number; challenges_required: number };
  expect(row).toEqual({ deeds_required: 0, challenges_required: 0 });
});

test("beginChange stores a caller-set deed quota", () => {
  const db = dbWithCampaign();
  const result = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude: "impossible",
    kind: "feature",
    deedsRequired: 1,
    challengesRequired: 0,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const row = db.prepare("SELECT deeds_required, challenges_required FROM changes WHERE id = ?").get(
    result.data.changeId,
  ) as { deeds_required: number; challenges_required: number };
  expect(row).toEqual({ deeds_required: 1, challenges_required: 0 });
});

test("beginChange rejects a negative deed quota", () => {
  const db = dbWithCampaign();
  const result = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    deedsRequired: -1,
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
});
```

- [ ] **Step 2: Run the new test**

```bash
npx vitest run test/services/begin-change-obstacles.test.ts
```

Expected: omitted-quota case may already pass after Task 2; negative case FAIL until `beginChange` checks `input.deedsRequired < 0 || input.challengesRequired < 0`.

- [ ] **Step 3: Add the negative check at the start of the `beginChange` transaction, after the owner check**

```typescript
if (
  (input.deedsRequired != null && input.deedsRequired < 0) ||
  (input.challengesRequired != null && input.challengesRequired < 0)
) {
  throw new RuleError("FILL_INCOMPLETE", "deeds and challenges cannot be negative");
}
```

- [ ] **Step 4: MCP schemas**

On `quote_change` `inputSchema`, add:

```typescript
deedsRequired: z.number().int().min(0).optional(),
challengesRequired: z.number().int().min(0).optional(),
```

Forward both into `quoteChange({ ... existing fields, deedsRequired: args.deedsRequired, challengesRequired: args.challengesRequired })`.

On `begin_change` `inputSchema`, add the same two optional fields and pass them through the existing `dbTool((a) => beginChange(db, a))` (the object already flows if the keys are on the parsed args).

- [ ] **Step 5: Run targeted tests plus `npm test`**

```bash
npx vitest run test/rules/cost.test.ts test/services/begin-change-obstacles.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/register.ts src/services/change.ts test/services/begin-change-obstacles.test.ts
git commit -m "feat: quote_change and begin_change accept deed and challenge quotas"
```

---

### Task 4: Play copy

**Files:**
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`

**Interfaces:**
- Consumes: design “Play copy”
- Produces: quote/begin do not invent deed gates

- [ ] **Step 1: Rewrite the change checklist**

In the sprawling-ambition list, change step 4 from recording deeds the quote requires to:

```markdown
  4. If the GM sets deed or challenge quotas on `quote_change` / `begin_change` (including explicit zero), record them with `record_deed`, `create_challenge`, and `record_challenge_outcome`. Omitted quotas are 0; the quote does not invent a mighty deed.
```

Keep `record_deed` in the adventure-outcome bullets as counting a deed toward a change that has a quota.

- [ ] **Step 2: Commit**

```bash
git add user/skills/gdnr-player/references/gdnr-play.md
git commit -m "docs: play copy for GM-set change deed quotas"
```

---

## Self-review

- Spec coverage: silent defaults gone, MCP overrides, explicit zero, tests, play copy, wards out of scope.
- `beginChange` already accepted overrides; MCP was the hole.
- Totals in Task 1 must stay consistent with `SCOPE_COST` / `MULTIPLIER`.
