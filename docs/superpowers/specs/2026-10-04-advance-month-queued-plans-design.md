# advance_month must not abandon queued plans

> Status: design for issue #84. Not implemented on this branch. Living engine docs to update at implementation time: [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md).

## Purpose

`advance_month` may close an open turn only when that turn’s write queue has no queued plan or reaction. If any plan or reaction is still queued, the call errors and leaves the turn open.

Issue #84 already decided the product shape, from the living decision on issue #35 (D17b):

- `advance_month` may close an open turn only when the write queue has no queued plan or reaction.
- If any plan or reaction is still queued, it errors loudly.
- Explicit discard, if ever added, is a separate atomic action.
- The same change removes the matching gap notes from docs and prompts.
- This follows the queued-plan error on `faction_action`, so month advance guards a queue that faction actions cannot silently drop.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec.

The `faction_action` queued-plan error is already on `main` (pull request #92). This spec does not re-do that work.

## Approaches

**A. Guard inside `advanceMonthForCampaign` before it closes the turn. Recommended.**

`advanceMonthForCampaign` in `src/services/turn.ts` is the service behind the `advance_month` tool. Before it sets the open turn to closed, it looks for a `write_queue` row on that turn with status `queued` and kind `plan` or `reaction`. A hit throws `QUEUE_NOT_EMPTY`. The calendar function `advanceMonth` stays a month-and-income update. The MCP handler stays a pass-through.

**B. Guard inside the calendar function `advanceMonth`.**

`closeTurn` in `src/services/queue.ts` calls `advanceMonth` only after it has already set `open = 0`. A check that reads the open turn would see no open turn and would miss the rows. A check of every `queued` row in the campaign would also see leftovers on turns that are already closed, and would block later months, including `run_faction_turn` with `advanceMonth: true`. Rejected.

**C. Apply the queue, or delete the queued rows, then advance.**

Applying runs plans the caller did not ask to resolve, and a queued reaction cannot be finished inside `advance_month`. Deleting the rows is the discard action issue #84 puts out of scope. Rejected.

## Shape

### Where the check lives

`advanceMonthForCampaign` in `src/services/turn.ts`, inside the existing `withTransaction`, before the pending-defender query and before `UPDATE turns SET open = 0`.

The check is a service rule because it reads `write_queue`. It does not move into `src/rules/` (those functions do not touch SQLite) and it does not move into `src/mcp/register.ts`.

`advanceMonth`, `closeTurn`, `applyWriteQueue`, `submitReaction`, and `runFactionTurn` stay as they are. `run_faction_turn` with `advanceMonth: true` still advances only through `closeTurn` → `advanceMonth`, after apply has finished the queue. That path does not call `advanceMonthForCampaign`.

The function takes no write lock today. This change does not add one.

### What counts as queued

On the open turn’s id, any `write_queue` row with:

| Column | Value |
| --- | --- |
| `status` | `queued` |
| `kind` | `plan` or `reaction` |

`unit_type` and `unit_id` are not filtered. A queued plan for a court, character, or hero blocks the same way a faction plan does.

```ts
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
```

Load that open turn once. The later `UPDATE turns SET open = 0` uses the same id. Do not leave a second open-turn `SELECT` above the queue check.

The existing pending-defender query stays after this check:

```ts
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
```

A paused apply stores the attacker’s plan as `applying` and the defender’s reaction as `queued`, and the attack row is `PENDING_DEFENDER_CHOICE`. The queue check runs first, so that state returns `QUEUE_NOT_EMPTY`, not `TURN_ALREADY_OPEN`.

`faction_action` can pause an attack with `PENDING_DEFENDER_CHOICE` and no `write_queue` row. That state still returns `TURN_ALREADY_OPEN` / `defender choice pending`.

### Error

| Field | Value |
| --- | --- |
| Code | `QUEUE_NOT_EMPTY` |
| Message | `plan or reaction queued` |
| Details | `{}` |

`wrapRule` returns `{ ok: false, error: { code, message, details } }`. The MCP envelope already forwards that shape. No new tool argument.

`TURN_ALREADY_OPEN` stays the code for “a turn is already open” (`openParallelTurn`) and for “defender choice pending” (`advanceMonthForCampaign` when no queued plan or reaction is present). A queued plan is a third situation, so it gets its own code.

The `advance_month` description becomes: `Close an open turn if needed and advance the calendar. Returns QUEUE_NOT_EMPTY when the open turn still has a queued plan or reaction.`

### What the error leaves behind

The throw happens before any write in the function. `better-sqlite3` rolls the transaction back. The open turn stays open. Month, hero Dominion, and income events stay as they were. Every matching queue row stays `queued` with the same payload. The call does not apply a plan, does not resolve a reaction, and does not delete a row.

### Calls that still advance

`advanceMonthForCampaign` still closes an open turn and then calls `advanceMonth` when the open turn has no `queued` plan or reaction. That includes:

- No open turn. The queue is not read. Month and Dominion update as they do today.
- An open turn and no `write_queue` rows. This is the turn `faction_action` leaves open.
- Queue rows on that turn whose status is `done`, `rejected`, or `applying`.
- A `queued` plan or reaction on a closed turn, when no turn is open. The check reads only the open turn. The closed turn’s row stays `queued`.

`applying` alone is not this error. The applier only leaves a plan `applying` while a defender reaction is `queued`. That reaction is the hit. A lone `applying` row, with no queued reaction and no `PENDING_DEFENDER_CHOICE` action, does not block.

### Calls that still return the existing pending error

An open turn with an action outcome `PENDING_DEFENDER_CHOICE` and no `queued` plan or reaction still throws `TURN_ALREADY_OPEN` / `defender choice pending`. The turn stays open. Month and Dominion stay as they were.

## Docs and play copy

Remove this known-gap bullet from `docs/design/overview.md`:

```markdown
- `advance_month` abandons queued plans and reactions when it closes a turn. It must fail while anything is queued.
```

In `docs/design/current-engine.md`, add `QUEUE_NOT_EMPTY` to the common error-code list, next to `QUEUE_CLOSED`.

Replace the `advance_month` bullet there with:

```markdown
- **`advance_month`.** Moves the calendar and grants monthly Dominion. It may close an open turn that has nothing queued, such as a turn left open by `faction_action`. A queued plan or reaction on that turn returns `QUEUE_NOT_EMPTY` and leaves the turn open. Discarding queued work, if it is ever needed, would be a separate explicit action.
```

In `user/skills/gdnr-player/references/gdnr-play.md`, add this row to the error table, directly under the `TURN_ALREADY_OPEN` row:

```markdown
| `QUEUE_NOT_EMPTY` | The open turn still has a queued plan or reaction. Apply the queue or finish the reaction, then advance the month. |
```

Replace the `advance_month` paragraph with:

```markdown
`advance_month` moves the calendar. It closes an open turn only when no plan or reaction is still queued. If one is, the call returns `QUEUE_NOT_EMPTY` and leaves the turn open; apply the queue or finish the reaction first. Cult Dominion accrues by the month (`cult_income`). Skipping time is how worship piles up; a campaign that never skips stays Dominion-poor. Encourage spending Dominion on changes rather than hoarding it.
```

Play copy stays inside `user/` and does not link outside `user/`.

`user/skills/gdnr-director/references/gdnr-direct.md` has no `advance_month` gap note. Leave it.

No file under `.cursor/prompts/` or `.cursor/skills/` mentions this gap. Leave them.

The glossary line “Not implemented yet” under **Chart catalog** is a different gap. Leave it.

Do not edit historical specs or plans under `docs/superpowers/` except this design and its implementation plan.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/services/advance-month-queued.test.ts` opens an in-memory database. `advanceMonthForCampaign` does not take a filesystem path or the write lock. A free-divinity hero at level 6 starts at Dominion 0, so a successful advance moves Dominion to 3 (`1 + floor(level / 3)`).

- A `queued` faction plan, a `queued` reaction with no pending action, and a `queued` court plan each return `QUEUE_NOT_EMPTY` / `plan or reaction queued`. The turn stays open, month stays 1, Dominion stays 0, no income event is inserted, and the queue payload stays as it was.
- An `applying` plan plus a `queued` reaction plus `PENDING_DEFENDER_CHOICE` returns `QUEUE_NOT_EMPTY`, not `TURN_ALREADY_OPEN`. The plan stays `applying` and the reaction stays `queued`.
- `PENDING_DEFENDER_CHOICE` with no queue row still returns `TURN_ALREADY_OPEN` / `defender choice pending`. The turn stays open and the month stays 1.
- An open turn whose only queue row is `done`, `rejected`, or `applying` advances: month 2, Dominion 3, the turn is closed, and that row’s status is unchanged.
- An open turn with no queue rows advances the same way.
- No open turn advances the same way.
- A `queued` plan on a closed turn, with no open turn, advances. That row stays `queued`. No turn is opened.

No test reads `docs/` or `user/` and asserts on that file’s text.

## Out of scope

- The `faction_action` queued-plan error. It is already implemented.
- A tool that discards a queued plan or reaction.
- Taking the write lock inside `advanceMonthForCampaign`.
- Changing `advanceMonth`, `closeTurn`, `applyWriteQueue`, `submitReaction`, or `runFactionTurn`.
- Treating `applying`, `done`, or `rejected` as `QUEUE_NOT_EMPTY`.
- Deleting or rewriting `queued` rows that already sit on a closed turn.
- A separate error code for plans and for reactions.

## Global constraints

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
