# advance_month queued-work error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `advance_month` return `QUEUE_NOT_EMPTY` when the open turn still has a queued plan or reaction, and leave that turn open.

**Architecture:** The guard is one query inside `advanceMonthForCampaign` in `src/services/turn.ts`, before the pending-defender check and before the turn is closed. The calendar function `advanceMonth` stays a month-and-income update, so `closeTurn` can still grant income after a finished apply. The MCP tool only changes its description string. Living docs and play copy drop the gap wording and state the error.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-advance-month-queued-plans-design.md`. Issue #84.
- Error code is `QUEUE_NOT_EMPTY`. Message is `plan or reaction queued`. Details are `{}`.
- The check is only in `advanceMonthForCampaign` (`src/services/turn.ts`), inside the transaction, before the pending-defender query and before `UPDATE turns SET open = 0`.
- A hit is a `write_queue` row on the open turn with `status = 'queued'` and `kind` of `plan` or `reaction`. Any `unit_type` counts.
- The throw happens before any write. The turn stays open. Month, Dominion, income events, and queue payloads stay as they were.
- A pending defender choice with no queued plan or reaction still throws `RuleError("TURN_ALREADY_OPEN", "defender choice pending")`.
- Do not add this check to `advanceMonth`, `closeTurn`, `applyWriteQueue`, or the MCP handler body.
- Do not take the write lock inside `advanceMonthForCampaign`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

---

## File map

- Create: `test/services/advance-month-queued.test.ts` — queued plan or reaction blocks `advanceMonthForCampaign`; finished rows, a lone `applying` row, an empty open turn, no open turn, and a closed-turn row do not. A pending defender choice with no queue row stays `TURN_ALREADY_OPEN`.
- Modify: `src/services/turn.ts` — the guard in `advanceMonthForCampaign`.
- Modify: `src/mcp/register.ts` — `advance_month` description string only.
- Modify: `docs/design/overview.md` — delete the known-gap bullet.
- Modify: `docs/design/current-engine.md` — name `QUEUE_NOT_EMPTY` as current behavior.
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` — name the error in the table and the calendar paragraph.

---

### Task 1: Reject `advanceMonthForCampaign` when a plan or reaction is queued

**Files:**
- Create: `test/services/advance-month-queued.test.ts`
- Modify: `src/services/turn.ts` (`advanceMonthForCampaign`, the transaction that starts at the pending-defender query)

**Interfaces:**
- Consumes: `advanceMonthForCampaign` from `src/services/turn.ts`; `openDb` from `src/store/db.ts`; `RuleError` (already imported in `turn.ts`).
- Produces: `advanceMonthForCampaign` returns `{ ok: false, error: { code: "QUEUE_NOT_EMPTY", message: "plan or reaction queued", details: {} } }` when the open turn has a queued plan or reaction. No new export. `advanceMonth` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `test/services/advance-month-queued.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { advanceMonthForCampaign } from "../../src/services/turn.js";

function world(): { db: Database.Database; campaignId: string } {
  const db = openDb(":memory:");
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run(campaignId, "Month");
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES ('h1', ?, 'Hero', 6, '[]', 0, 0, 0, 'free')`,
  ).run(campaignId);
  return { db, campaignId };
}

function openTurn(db: Database.Database, campaignId: string): void {
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
     VALUES ('t1', ?, 1, 1, 1, '[]', 'idle', 0)`,
  ).run(campaignId);
}

function queue(
  db: Database.Database,
  campaignId: string,
  row: {
    id: string;
    unitType: string;
    unitId: string;
    kind: string;
    status: string;
    payload?: string;
  },
): void {
  db.prepare(
    `INSERT INTO write_queue (id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, error_code, enqueued_at)
     VALUES (?, ?, 't1', ?, ?, ?, ?, ?, NULL, 1)`,
  ).run(
    row.id,
    campaignId,
    row.unitType,
    row.unitId,
    row.kind,
    row.payload ?? '{"type":"idle"}',
    row.status,
  );
}

function calendar(db: Database.Database, campaignId: string): {
  month: number;
  dominion: number;
  open: number | null;
  income: number;
} {
  const campaign = db.prepare("SELECT month FROM campaigns WHERE id = ?").get(campaignId) as {
    month: number;
  };
  const hero = db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get() as {
    dominion: number;
  };
  const turn = db.prepare("SELECT open FROM turns WHERE id = 't1'").get() as
    | { open: number }
    | undefined;
  const income = db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE campaign_id = ? AND type = 'income'")
    .get(campaignId) as { n: number };
  return {
    month: campaign.month,
    dominion: hero.dominion,
    open: turn?.open ?? null,
    income: income.n,
  };
}

function statusOf(db: Database.Database, id: string): string {
  const row = db.prepare("SELECT status FROM write_queue WHERE id = ?").get(id) as {
    status: string;
  };
  return row.status;
}

function expectBlocked(db: Database.Database, campaignId: string): void {
  const result = advanceMonthForCampaign(db, campaignId);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({
    code: "QUEUE_NOT_EMPTY",
    message: "plan or reaction queued",
    details: {},
  });
  expect(calendar(db, campaignId)).toEqual({ month: 1, dominion: 0, open: 1, income: 0 });
}

function expectAdvanced(
  db: Database.Database,
  campaignId: string,
  open: number | null,
): void {
  const result = advanceMonthForCampaign(db, campaignId);
  expect(result).toEqual({ ok: true, data: { month: 2 } });
  expect(calendar(db, campaignId)).toEqual({ month: 2, dominion: 3, open, income: 1 });
}

test("advance_month errors when a faction plan is queued", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "queued",
  });

  expectBlocked(db, campaignId);

  const row = db.prepare("SELECT status, payload FROM write_queue WHERE id = 'q1'").get() as {
    status: string;
    payload: string;
  };
  expect(row).toEqual({ status: "queued", payload: '{"type":"idle"}' });
});

test("advance_month errors when a reaction is queued", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "rx1",
    unitType: "faction",
    unitId: "def",
    kind: "reaction",
    status: "queued",
    payload: "{}",
  });

  expectBlocked(db, campaignId);
  expect(statusOf(db, "rx1")).toBe("queued");
});

test("advance_month errors when a non-faction plan is queued", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "court1",
    unitType: "court",
    unitId: "court-a",
    kind: "plan",
    status: "queued",
  });

  expectBlocked(db, campaignId);
  expect(statusOf(db, "court1")).toBe("queued");
});

test("a paused apply with a queued reaction returns QUEUE_NOT_EMPTY", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "plan1",
    unitType: "faction",
    unitId: "att",
    kind: "plan",
    status: "applying",
  });
  queue(db, campaignId, {
    id: "rx1",
    unitType: "faction",
    unitId: "def",
    kind: "reaction",
    status: "queued",
    payload: "{}",
  });
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome)
     VALUES ('act1', 't1', 'attack', 'faction', 'att', 'faction', 'def', 'PENDING_DEFENDER_CHOICE')`,
  ).run();

  expectBlocked(db, campaignId);
  expect(statusOf(db, "plan1")).toBe("applying");
  expect(statusOf(db, "rx1")).toBe("queued");
});

test("a pending defender choice with no queue row stays TURN_ALREADY_OPEN", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome)
     VALUES ('act1', 't1', 'attack', 'faction', 'att', 'faction', 'def', 'PENDING_DEFENDER_CHOICE')`,
  ).run();

  const result = advanceMonthForCampaign(db, campaignId);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({
    code: "TURN_ALREADY_OPEN",
    message: "defender choice pending",
    details: {},
  });
  expect(calendar(db, campaignId)).toEqual({ month: 1, dominion: 0, open: 1, income: 0 });
});

test("a done plan does not block advance_month", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "done",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("done");
});

test("a rejected plan does not block advance_month", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "rejected",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("rejected");
});

test("an applying plan with no queued reaction does not block advance_month", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "applying",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("applying");
});

test("an open turn with an empty queue still advances", () => {
  const { db, campaignId } = world();
  openTurn(db, campaignId);

  expectAdvanced(db, campaignId, 0);
});

test("advance_month with no open turn still advances", () => {
  const { db, campaignId } = world();

  expectAdvanced(db, campaignId, null);
});

test("a queued plan on a closed turn does not block advance_month", () => {
  const { db, campaignId } = world();
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
     VALUES ('t1', ?, 1, 1, 0, '[]', 'idle', 0)`,
  ).run(campaignId);
  queue(db, campaignId, {
    id: "q1",
    unitType: "faction",
    unitId: "a",
    kind: "plan",
    status: "queued",
  });

  expectAdvanced(db, campaignId, 0);
  expect(statusOf(db, "q1")).toBe("queued");
  const openCount = db
    .prepare("SELECT COUNT(*) AS n FROM turns WHERE campaign_id = ? AND open = 1")
    .get(campaignId) as { n: number };
  expect(openCount.n).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/advance-month-queued.test.ts`

Expected: FAIL, 4 failed and 7 passed.

These four fail:

- `advance_month errors when a faction plan is queued`
- `advance_month errors when a reaction is queued`
- `advance_month errors when a non-faction plan is queued`
- `a paused apply with a queued reaction returns QUEUE_NOT_EMPTY`

The first three fail because `result.ok` is `true` today: the function closes the turn and advances. The fourth fails because the code is `TURN_ALREADY_OPEN` today (the pending-defender check runs first). The other seven tests pass.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/turn.ts`, replace `advanceMonthForCampaign` with:

```ts
export function advanceMonthForCampaign(
  db: Database.Database,
  campaignId: string,
): ServiceResult<{ month: number }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      const openTurn = db
        .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
        .get(campaignId) as { id: string } | undefined;

      if (openTurn) {
        const queued = db
          .prepare(
            `SELECT id FROM write_queue
             WHERE turn_id = ? AND status = 'queued' AND kind IN ('plan', 'reaction')
             LIMIT 1`,
          )
          .get(openTurn.id);
        if (queued) {
          throw new RuleError("QUEUE_NOT_EMPTY", "plan or reaction queued");
        }
      }

      const pending = db
        .prepare(
          `SELECT a.id FROM actions a
           JOIN turns t ON t.id = a.turn_id
           WHERE t.campaign_id = ? AND t.open = 1 AND a.outcome = 'PENDING_DEFENDER_CHOICE' LIMIT 1`,
        )
        .get(campaignId);
      if (pending) {
        throw new RuleError("TURN_ALREADY_OPEN", "defender choice pending");
      }

      if (openTurn) {
        db.prepare("UPDATE turns SET open = 0 WHERE id = ?").run(openTurn.id);
      }

      advanceMonth(db, campaignId);
      const campaign = requireCampaign(db, campaignId);
      return { month: campaign.month };
    }),
  );
}
```

Do not change `advanceMonth`. Do not change `src/services/queue.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/advance-month-queued.test.ts test/services/turn.test.ts test/services/task13-review.test.ts`

Expected: PASS. The new file has 11 tests. `turn.test.ts` and `task13-review.test.ts` still pass, because `runFactionTurn` and `closeTurn` call `advanceMonth` after the queue is finished, not `advanceMonthForCampaign`.

- [ ] **Step 5: Commit**

```bash
git add test/services/advance-month-queued.test.ts src/services/turn.ts
git commit -m "fix: reject advance_month while a plan or reaction is queued"
```

---

### Task 2: Name the error in the tool description and the living docs

**Files:**
- Modify: `src/mcp/register.ts` (the `advance_month` registration, the description string)
- Modify: `docs/design/overview.md` (the Turns and plans gap list)
- Modify: `docs/design/current-engine.md` (the common error-code sentence, and the `advance_month` bullet)
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` (the error table and the calendar paragraph)

**Interfaces:**
- Consumes: the `QUEUE_NOT_EMPTY` behavior from Task 1.
- Produces: no new export. The tool description, the gap list, the current-engine page, and the player manual state the error.

- [ ] **Step 1: Update the tool description**

In `src/mcp/register.ts`, replace the `advance_month` description:

```ts
{ description: "Close an open turn if needed and advance the calendar", inputSchema: { campaignId: z.string() } },
```

with:

```ts
{
  description:
    "Close an open turn if needed and advance the calendar. Returns QUEUE_NOT_EMPTY when the open turn still has a queued plan or reaction.",
  inputSchema: { campaignId: z.string() },
},
```

Leave the handler as `dbTool((a) => advanceMonthForCampaign(db, a.campaignId))`.

- [ ] **Step 2: Remove the known-gap bullet**

In `docs/design/overview.md`, delete this bullet and leave the bullet above it and the bullet below it:

```markdown
- `advance_month` abandons queued plans and reactions when it closes a turn. It must fail while anything is queued.
```

The bullet above stays: a plan naming an id outside the unit's view, and a `player` faction's `run_faction_turn` `actions` entry, are dropped silently. The bullet below stays: after `faction_action`, `run_faction_turn` with `resume: true` automates nobody.

- [ ] **Step 3: State the error on the current-engine page**

In `docs/design/current-engine.md`, in the common error-code sentence, insert `QUEUE_NOT_EMPTY` immediately after `QUEUE_CLOSED`, so that pair reads `` `QUEUE_CLOSED`, `QUEUE_NOT_EMPTY` ``.

Replace the `advance_month` bullet with:

```markdown
- **`advance_month`.** Moves the calendar and grants monthly Dominion. It may close an open turn that has nothing queued, such as a turn left open by `faction_action`. A queued plan or reaction on that turn returns `QUEUE_NOT_EMPTY` and leaves the turn open. Discarding queued work, if it is ever needed, would be a separate explicit action.
```

- [ ] **Step 4: State the error in the player manual**

In `user/skills/gdnr-player/references/gdnr-play.md`, add this row directly under the `TURN_ALREADY_OPEN` row:

```markdown
| `QUEUE_NOT_EMPTY` | The open turn still has a queued plan or reaction. Apply the queue or finish the reaction, then advance the month. |
```

Replace the `advance_month` paragraph under “Advance the calendar” with:

```markdown
`advance_month` moves the calendar. It closes an open turn only when no plan or reaction is still queued. If one is, the call returns `QUEUE_NOT_EMPTY` and leaves the turn open; apply the queue or finish the reaction first. Cult Dominion accrues by the month (`cult_income`). Skipping time is how worship piles up; a campaign that never skips stays Dominion-poor. Encourage spending Dominion on changes rather than hoarding it.
```

Do not link outside `user/`. Do not edit `user/skills/gdnr-director/references/gdnr-direct.md`. Do not edit `.cursor/prompts/` or `.cursor/skills/`. Leave the glossary **Chart catalog** “Not implemented yet” line alone.

- [ ] **Step 5: Re-run the service tests**

Run: `npx vitest run test/services/advance-month-queued.test.ts test/services/turn.test.ts test/services/task13-review.test.ts`

Expected: PASS. These edits do not change the service behavior.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/register.ts docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-player/references/gdnr-play.md
git commit -m "docs: state QUEUE_NOT_EMPTY when advance_month finds queued work"
```
