# faction_action queued-plan error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `faction_action` return `PLAN_ALREADY_QUEUED` when that faction already has a plan with status `queued` on the open turn, and leave that plan queued.

**Architecture:** The guard is one query inside `factionAction` in `src/services/turn.ts`, after `ensureOpenTurn` and before the `idle` return. `runAction` and `applyWriteQueue` do not grow the check, so applying a queued plan still runs. The MCP tool only changes its description string. Living docs and play copy drop the gap wording and state the error.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-faction-action-queued-plan-design.md`. Issue #83.
- Error code is `PLAN_ALREADY_QUEUED`. Message is `plan already queued`. Details are `{}`.
- The check is only in `factionAction` (`src/services/turn.ts`), after `ensureOpenTurn`, before the `idle` return.
- A hit is a `write_queue` row on that turn with `unit_type = 'faction'`, `unit_id` equal to the faction, `kind = 'plan'`, and `status = 'queued'`.
- The queued payload stays as it was. The call inserts no action and changes no faction column.
- Do not add this check to `runAction`, `applyWriteQueue`, or the MCP handler body.
- Do not take the write lock inside `factionAction`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

---

## File map

- Create: `test/services/faction-action-queued-plan.test.ts` — queued plan blocks `factionAction`; finished, reaction, other-unit, other-faction, and closed-turn rows do not.
- Modify: `src/services/turn.ts` — the guard in `factionAction`.
- Modify: `src/mcp/register.ts` — `faction_action` description string only.
- Modify: `docs/design/overview.md` — delete the known-gap bullet.
- Modify: `docs/design/current-engine.md` — state the error as current behavior.
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` — state the error.
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` — state the error.

---

### Task 1: Reject `factionAction` when a plan is queued

**Files:**
- Create: `test/services/faction-action-queued-plan.test.ts`
- Modify: `src/services/turn.ts` (the `factionAction` transaction, around the `ensureOpenTurn` call)

**Interfaces:**
- Consumes: `factionAction` from `src/services/turn.ts`; `openParallelTurn` and `submitUnitPlan` from `src/services/queue.ts`; `openDb` from `src/store/db.ts`; `RuleError` via `wrapRule` (already imported in `turn.ts`).
- Produces: `factionAction` returns `{ ok: false, error: { code: "PLAN_ALREADY_QUEUED", message: "plan already queued", details: {} } }` when the open turn has a matching queued plan. No new export.

- [ ] **Step 1: Write the failing test**

Create `test/services/faction-action-queued-plan.test.ts`:

```ts
import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn, submitUnitPlan } from "../../src/services/queue.js";
import { factionAction } from "../../src/services/turn.js";

function world(): { db: Database.Database; dbPath: string; campaignId: string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-queued-plan-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run(campaignId, "Queued");
  for (const [id, name] of [
    ["a", "A"],
    ["b", "B"],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, ?, ?, 1, 1, 0, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, campaignId, name);
  }
  return { db, dbPath, campaignId };
}

function queueIdlePlan(db: Database.Database, dbPath: string, campaignId: string, unitId: string) {
  const opened = openParallelTurn(db, dbPath, { campaignId, unitIds: ["a", "b"] });
  expect(opened.ok).toBe(true);
  const submitted = submitUnitPlan(db, dbPath, {
    campaignId,
    unitType: "faction",
    unitId,
    plan: { type: "idle" },
  });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) return;
  expect(submitted.data.status).toBe("queued");
}

function planRow(db: Database.Database, unitId: string) {
  return db
    .prepare(
      `SELECT status, payload FROM write_queue
       WHERE unit_id = ? AND kind = 'plan' AND unit_type = 'faction'
       ORDER BY enqueued_at DESC LIMIT 1`,
    )
    .get(unitId) as { status: string; payload: string };
}

test("faction_action errors when that faction has a queued plan", () => {
  const { db, dbPath, campaignId } = world();
  queueIdlePlan(db, dbPath, campaignId, "a");
  const before = planRow(db, "a");
  const sheet = db.prepare("SELECT cohesion, dominion FROM factions WHERE id = 'a'").get();

  const idle = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(idle.ok).toBe(false);
  if (idle.ok) return;
  expect(idle.error).toEqual({
    code: "PLAN_ALREADY_QUEUED",
    message: "plan already queued",
    details: {},
  });

  const strength = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "build_strength" },
  });
  expect(strength.ok).toBe(false);
  if (strength.ok) return;
  expect(strength.error.code).toBe("PLAN_ALREADY_QUEUED");

  expect(planRow(db, "a")).toEqual(before);
  const actions = db.prepare("SELECT COUNT(*) AS c FROM actions").get() as { c: number };
  expect(actions.c).toBe(0);
  expect(db.prepare("SELECT cohesion, dominion FROM factions WHERE id = 'a'").get()).toEqual(sheet);
});

test("another faction can still act while a plan is queued", () => {
  const { db, dbPath, campaignId } = world();
  queueIdlePlan(db, dbPath, campaignId, "a");
  const before = planRow(db, "a");

  const other = factionAction(db, {
    campaignId,
    factionId: "b",
    action: { type: "idle" },
  });
  expect(other).toEqual({ ok: true, data: { idle: true } });
  expect(planRow(db, "a")).toEqual(before);
});

test.each(["done", "rejected", "applying"] as const)(
  "faction_action runs when the latest plan status is %s",
  (status) => {
    const { db, dbPath, campaignId } = world();
    queueIdlePlan(db, dbPath, campaignId, "a");
    db.prepare(
      `UPDATE write_queue SET status = ? WHERE unit_id = 'a' AND kind = 'plan'`,
    ).run(status);

    const result = factionAction(db, {
      campaignId,
      factionId: "a",
      action: { type: "idle" },
    });
    expect(result).toEqual({ ok: true, data: { idle: true } });
  },
);

test("a queued reaction does not block faction_action", () => {
  const { db, dbPath, campaignId } = world();
  const opened = openParallelTurn(db, dbPath, { campaignId, unitIds: ["a"] });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES ('rx1', ?, ?, 'faction', 'a', 'reaction', '{}', 'queued', NULL, 1)`,
  ).run(campaignId, opened.data.turnId);

  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });
});

test("a queued plan for a non-faction unit does not block faction_action", () => {
  const { db, dbPath, campaignId } = world();
  const opened = openParallelTurn(db, dbPath, { campaignId, unitIds: ["a"] });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES ('court-plan', ?, ?, 'court', 'a', 'plan', '{"type":"idle"}', 'queued', NULL, 1)`,
  ).run(campaignId, opened.data.turnId);

  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });
});

test("a queued plan on a closed turn does not block faction_action", () => {
  const { db, dbPath, campaignId } = world();
  queueIdlePlan(db, dbPath, campaignId, "a");
  const closed = db.prepare("SELECT id FROM turns WHERE open = 1").get() as { id: string };
  db.prepare("UPDATE turns SET open = 0 WHERE id = ?").run(closed.id);

  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });

  const stillQueued = db
    .prepare("SELECT status FROM write_queue WHERE turn_id = ? AND unit_id = 'a' AND kind = 'plan'")
    .get(closed.id) as { status: string };
  expect(stillQueued.status).toBe("queued");
  const openCount = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE open = 1").get() as { c: number };
  expect(openCount.c).toBe(1);
});

test("faction_action with no open turn still idles", () => {
  const { db, campaignId } = world();
  const result = factionAction(db, {
    campaignId,
    factionId: "a",
    action: { type: "idle" },
  });
  expect(result).toEqual({ ok: true, data: { idle: true } });
  const openCount = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE open = 1").get() as { c: number };
  expect(openCount.c).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/faction-action-queued-plan.test.ts`

Expected: FAIL in `faction_action errors when that faction has a queued plan`. `idle.ok` is `true` today, so `expect(idle.ok).toBe(false)` fails. The other tests in the file pass.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/turn.ts`, inside `factionAction`, immediately after `const turnId = ensureOpenTurn(db, input.campaignId);` and before the `idle` return, insert:

```ts
      const queuedPlan = db
        .prepare(
          `SELECT id FROM write_queue
           WHERE turn_id = ? AND unit_type = 'faction' AND unit_id = ? AND kind = 'plan' AND status = 'queued'
           LIMIT 1`,
        )
        .get(turnId, input.factionId);
      if (queuedPlan) {
        throw new RuleError("PLAN_ALREADY_QUEUED", "plan already queued");
      }
```

The following existing lines stay next, unchanged:

```ts
      if (input.action.type === "idle") {
        return { idle: true };
      }
```

Do not add this query to `runAction` in `src/services/actions.ts` or to `applyWriteQueue` in `src/services/queue.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/faction-action-queued-plan.test.ts`

Expected: PASS (9 tests: the queued-plan error, the other faction, three statuses, the reaction, the court row, the closed turn, and no open turn).

- [ ] **Step 5: Commit**

```bash
git add test/services/faction-action-queued-plan.test.ts src/services/turn.ts
git commit -m "fix: reject faction_action while a plan is queued"
```

---

### Task 2: State the error in the tool, living docs, and play copy

**Files:**
- Modify: `src/mcp/register.ts` (the `faction_action` description, around line 740)
- Modify: `docs/design/overview.md` (the Turns and plans gap list)
- Modify: `docs/design/current-engine.md` (the `faction_action` bullet)
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` (the `faction_action` paragraph)
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` (the director-overrides paragraph)

**Interfaces:**
- Consumes: the `PLAN_ALREADY_QUEUED` behavior from Task 1.
- Produces: no new function. The tool description and the four prose files name that code.

There is no test that reads these files and asserts on their text.

- [ ] **Step 1: Update the tool description**

In `src/mcp/register.ts`, replace the `faction_action` description:

```ts
      description: "Take one faction action on the open turn",
```

with:

```ts
      description:
        "Take one faction action now. Returns PLAN_ALREADY_QUEUED when that faction already has a queued plan on the open turn.",
```

Leave the input schema and the `factionAction(db, ...)` call as they are.

- [ ] **Step 2: Update living docs and play copy**

In `docs/design/overview.md`, delete this bullet and leave the `advance_month` bullet:

```markdown
- `faction_action` for a faction with a queued plan leaves that plan unapplied. It must fail.
```

In `docs/design/current-engine.md`, replace:

```markdown
Calling it for a faction that already has a plan in the write queue must fail rather than leave that plan unapplied.
```

with:

```markdown
If that faction already has a plan queued on the open turn, the call returns `PLAN_ALREADY_QUEUED` and leaves that plan queued.
```

In `user/skills/gdnr-player/references/gdnr-play.md`, replace:

```markdown
`faction_action` takes one action for one faction right now. It opens a turn if none is open and counts against the same budgets. Do not use it for a faction that already has a plan queued in the open turn; apply or replace that plan instead.
```

with:

```markdown
`faction_action` takes one action for one faction right now. It opens a turn if none is open and counts against the same budgets. If that faction already has a plan queued on the open turn, the call returns `PLAN_ALREADY_QUEUED` and does not run. Apply the queue, or replace the plan with `submit_unit_plan`, then call `faction_action` only once that plan is no longer queued.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, the overrides paragraph ends with:

```markdown
`faction_action` accepts `forcedRoll`, `forcedAttackerRoll`, `forcedDefenderRoll`, `defenderChoice`, and `willing`. With `willing: true`, `extend_interest` succeeds with no contest. On a new edge the nature is still **rolled**, not chosen, so `willing` grows an existing edge but cannot pick a nature.
```

Add one sentence on that same paragraph:

```markdown
If that faction already has a plan queued on the open turn, `faction_action` returns `PLAN_ALREADY_QUEUED` and does not run. Apply the queue or replace the plan with `submit_unit_plan`.
```

Leave the glossary **Chart catalog** “Not implemented yet” line alone.

- [ ] **Step 3: Re-run the behavior test**

Run: `npx vitest run test/services/faction-action-queued-plan.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/register.ts docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: state PLAN_ALREADY_QUEUED for a queued faction plan"
```
