# faction_action errors when a plan is queued

> Status: design for issue #83. Not implemented on this branch. Living engine docs to update at implementation time: [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md), [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

Calling `faction_action` for a faction that already has a plan queued on the open turn must return an error. The call does not run, and the queued plan stays queued.

Issue #83 already decided the product shape, from the living decision on issue #35 (D10):

- If a plan is already queued, `faction_action` errors instead of running.
- Today the call can run and leave that queued plan unapplied. That stops.
- The same change removes the matching gap notes from living docs and play copy.
- `advance_month` queue handling is a separate issue.
- Discarding a queued plan is a separate explicit action, if it is ever added.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec.

## Approaches

**A. Guard inside `factionAction` when a plan row is `queued`. Recommended.**

`src/services/turn.ts` `factionAction` checks the open turn’s `write_queue` after it resolves the turn and before it runs the action. A matching row throws `PLAN_ALREADY_QUEUED`. The MCP handler stays a pass-through. `runAction` and `applyWriteQueue` do not grow this check, so applying a queued plan still runs.

**B. Guard in the MCP handler.**

The tool would reject the call before the service. That puts a game rule in the MCP layer, which this repo does not do. Rejected.

**C. Apply or drop the queued plan, then run `faction_action`.**

That hides the conflict and either runs two actions or discards a plan. Issue #83 requires an error, and discarding a queued plan is out of scope. Rejected.

## Shape

### Where the check lives

`factionAction` in `src/services/turn.ts`, inside the existing transaction, after `ensureOpenTurn` and before the `idle` return. The check is a service rule because it reads `write_queue`. It does not move into `src/rules/` (those functions do not touch SQLite) and it does not move into `src/mcp/register.ts`.

`runAction`, `applyWriteQueue`, and `runFactionTurn` stay as they are. Apply turns a `queued` row into `applying` and then calls `applyFactionPlan`. A guard inside `runAction` would reject that apply.

### What counts as queued

On the turn id `ensureOpenTurn` returned, any `write_queue` row with all of:

| Column | Value |
| --- | --- |
| `unit_type` | `faction` |
| `unit_id` | the `factionId` argument |
| `kind` | `plan` |
| `status` | `queued` |

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

`idle` is included. The check sits above the `idle` return, so an idle call hits the same error.

### Error

| Field | Value |
| --- | --- |
| Code | `PLAN_ALREADY_QUEUED` |
| Message | `plan already queued` |
| Details | `{}` |

`wrapRule` returns `{ ok: false, error: { code, message, details } }`. The MCP envelope already forwards that shape. No new tool argument.

The `faction_action` description becomes: `Take one faction action now. Returns PLAN_ALREADY_QUEUED when that faction already has a queued plan on the open turn.`

### What the error leaves behind

The throw rolls the transaction back. The queued row stays `queued` with the same payload. No `actions` row is inserted for this call. Cohesion and Dominion stay as they were. `ensureOpenTurn` only inserts a turn when none is open, and a queued plan already implies an open turn, so the error does not create a turn.

`submit_unit_plan` still replaces a `queued` plan. This change does not apply the plan and does not delete it.

### Calls that still run

`faction_action` runs when the open turn has no `queued` plan for that faction. That includes:

- No open turn. `ensureOpenTurn` still opens one, then the action runs.
- An open turn and no `write_queue` plan for this faction.
- Another faction’s `queued` plan on the same turn.
- A `queued` plan on a closed turn. The check reads only the open turn. `faction_action` opens a new turn and runs. The closed turn’s row stays `queued`.
- The latest plan row for this faction on the open turn has status `done`, `rejected`, or `applying`.
- A `queued` row with `kind` `reaction`, or with `unit_type` other than `faction`.

`applying` is the paused-apply state (a defender choice is in progress). It is not an unapplied queued plan, so it does not use this error.

## Docs and play copy

Remove the known-gap bullet in `docs/design/overview.md`:

`- `faction_action` for a faction with a queued plan leaves that plan unapplied. It must fail.`

Leave the `advance_month` bullet in place.

In `docs/design/current-engine.md`, replace the last sentence of the `faction_action` bullet with:

`If that faction already has a plan queued on the open turn, the call returns `PLAN_ALREADY_QUEUED` and leaves that plan queued.`

In `user/skills/gdnr-player/references/gdnr-play.md`, replace the `faction_action` paragraph with:

`` `faction_action` takes one action for one faction right now. It opens a turn if none is open and counts against the same budgets. If that faction already has a plan queued on the open turn, the call returns `PLAN_ALREADY_QUEUED` and does not run. Apply the queue, or replace the plan with `submit_unit_plan`, then call `faction_action` only once that plan is no longer queued. ``

In `user/skills/gdnr-director/references/gdnr-direct.md`, add this sentence at the end of the `faction_action` overrides paragraph:

`If that faction already has a plan queued on the open turn, `faction_action` returns `PLAN_ALREADY_QUEUED` and does not run. Apply the queue or replace the plan with `submit_unit_plan`.`

Play copy stays inside `user/` and does not link outside `user/`.

The glossary line “Not implemented yet” under **Chart catalog** is a different gap. Leave it.

Do not edit historical specs or plans under `docs/superpowers/` except this design and its implementation plan.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/services/faction-action-queued-plan.test.ts` opens a temp-file database (the queue tools take a filesystem path and the write lock):

- A `queued` idle plan makes `faction_action` idle and `faction_action` `build_strength` return `PLAN_ALREADY_QUEUED` / `plan already queued`. The queue payload is unchanged, no `actions` row exists, and cohesion and Dominion are unchanged.
- The other faction’s `faction_action` idle succeeds on that same turn, and the first faction’s row stays `queued`.
- `done`, `rejected`, and `applying` plan rows do not return this error. `faction_action` idle succeeds.
- A `queued` reaction, and a `queued` plan with `unit_type` `court`, do not return this error.
- A `queued` plan on a turn that is then closed does not return this error. The closed turn’s row stays `queued`, and the successful call has an open turn of its own.
- With no open turn, `faction_action` idle still succeeds.

No test reads `docs/` or `user/` and asserts on that file’s text.

## Out of scope

- `advance_month` while a plan or reaction is queued.
- A tool that discards a queued plan.
- Taking the write lock on every mutation. `faction_action` still does not take it.
- Treating `applying`, `done`, `rejected`, or `kind = 'reaction'` as `PLAN_ALREADY_QUEUED`.
- Changing budgets, `run_faction_turn`, or how `apply_write_queue` runs a queued plan.

## Global constraints

- Error code is `PLAN_ALREADY_QUEUED`. Message is `plan already queued`. Details are `{}`.
- The check is only in `factionAction` (`src/services/turn.ts`), after `ensureOpenTurn`, before the `idle` return.
- A hit is a `write_queue` row on that turn with `unit_type = 'faction'`, `unit_id` equal to the faction, `kind = 'plan'`, and `status = 'queued'`.
- The queued payload stays as it was. The call inserts no action and changes no faction column.
- Do not add this check to `runAction`, `applyWriteQueue`, or the MCP handler body.
- Do not take the write lock inside `factionAction`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.
