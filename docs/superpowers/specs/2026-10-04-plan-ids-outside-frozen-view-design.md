# Fail loudly when plan ids are outside the frozen view

> Status: design for issue #85. Not implemented on this branch. Living docs to update at implementation time: [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md), and the error table in [`user/skills/gdnr-player/references/gdnr-play.md`](../../../user/skills/gdnr-player/references/gdnr-play.md).

## Purpose

A caller-supplied plan that names an id outside that unit's frozen view must fail as an error. Today `submit_unit_plan` accepts the call, stores a `write_queue` row with `status = 'rejected'` and `error_code = 'UNKNOWN_TO_UNIT'`, and returns `{ ok: true, data: { status: "rejected", errorCode: "UNKNOWN_TO_UNIT" } }`. `run_faction_turn` ignores that result and still applies the queue, which skips the rejected row.

Issue #85 already decided the product shape, from the living decision on issue #35 (D8):

- A bad plan id outside the frozen view is an error, not a silent reject.
- In the same change, remove the matching gap notes from docs and prompts.

Issue #85 has no **Open questions** section. The boundary calls below are the ones the issue left implicit.

## Approaches

**A. Throw `UNKNOWN_TO_UNIT` before any queue write, and stop `run_faction_turn` before apply. Recommended.**

`submitUnitPlan` runs `planReferencesUnknown` on the whole parsed plan, including `standingOrders`. On a hit it throws `RuleError`. `withTransaction` rolls the write back, so a new plan inserts nothing and a replacement leaves the existing `queued` row alone. `wrapRule` turns the throw into `{ ok: false, error }`. `run_faction_turn` returns that error and does not call `apply_write_queue`. The open turn stays open.

**B. Also fail mechanical plans that `sanitizeActionForSnapshot` turns into `idle`.**

Rejected. That clip is how a goal chart stays inside a unit's view when the unit submitted no plan. Treating it as `UNKNOWN_TO_UNIT` would fail ordinary NPC months. D8's sentence is about a plan in `actions`, which is caller-supplied.

**C. Keep the `rejected` row and only change the return value to `ok: false`.**

Rejected. Apply already skips `status = 'rejected'`, so the unit would still vanish from the month. A replacement would also overwrite a good queued plan with the rejected payload before the caller saw the error.

## Behavior

### Submit

`submitUnitPlan` in `src/services/queue.ts` keeps this order:

1. No open turn: `ENTITY_NOT_FOUND` (`no open turn`).
2. Existing row `applying` or `done`: `QUEUE_CLOSED`.
3. No frozen view for that unit: `ENTITY_NOT_FOUND` (`unit view not found`).
4. `parseUnitPlan` fails: `FILL_INCOMPLETE` (`invalid unit plan`).
5. `planReferencesUnknown(snapshot, unitPlan)` returns an id: `UNKNOWN_TO_UNIT`.
6. Otherwise insert or replace a `queued` row and return `{ status: "queued" }`.

Step 5 throws:

```ts
throw new RuleError(
  "UNKNOWN_TO_UNIT",
  `plan names an id outside the frozen view: ${unknownId}`,
  { id: unknownId, unitType: input.unitType, unitId: input.unitId },
);
```

`unknownId` is the first id `planReferencesUnknown` already returns. The walker stays as it is: depth-first, object key order, and only the keys in its `ID_FIELDS` list. The check receives the parsed `UnitPlan`, not `factionActionFromUnitPlan(unitPlan)`. Standing-order `targetFactionId` values are id fields, so they count.

The success type narrows to `ServiceResult<{ status: "queued" }>`. The function no longer returns `status: "rejected"` for this case. It does not insert or update a row when it throws.

`submit_unit_plan` needs no MCP-layer change. `runDbTool` already publishes a `RuleError` as `{ ok: false, error: { code, message, details } }`.

### `run_faction_turn`

Both `actions` loops (the fresh open and `resume: true`) go through one helper. For each entry, in object key order, it calls `submitUnitPlan`. When the result is `ok: false` and `error.code === "UNKNOWN_TO_UNIT"`, `runFactionTurn` returns that result and does not call `applyWriteQueue`.

Any other `submitUnitPlan` failure is ignored, and the loop continues. That keeps today's drop of a `player` faction's `actions` entry: `defaultActingUnits` does not freeze a view for `control: 'player'`, so the submit fails with `ENTITY_NOT_FOUND` (`unit view not found`) and the month still runs.

Entries queued earlier in the same `actions` object stay queued. The turn opened by this call stays open. A later `submit_unit_plan` can replace a plan, and `apply_write_queue` or `run_faction_turn` with `resume: true` can finish the turn.

### Unchanged paths

- `sanitizeActionForSnapshot` still turns a mechanical plan (a unit with no queued plan, `missing: "mechanical"`) into `idle` when it names an id outside the snapshot.
- `faction_action` does not read the frozen view.
- Apply still skips a queue row that is already `rejected`, and an apply-time rule failure may still mark the current row `rejected` and continue with the next unit.
- Queue conflicts on `faction_action` and `advance_month` stay out of scope.

## Docs and prompts

The matching gap note is the plan-id clause in `docs/design/overview.md` under **Known engine gaps**. After the behavior lands, that bullet keeps only the player-faction drop:

- A `player` faction's entry in `run_faction_turn` `actions` is dropped silently. It must fail loudly.

`docs/design/current-engine.md` **Plan errors** states the new behavior as fact: a caller-supplied plan that names an id absent from that unit's frozen view fails with `UNKNOWN_TO_UNIT` and is not queued; a failed replacement leaves the queued plan; `run_faction_turn` returns the error and does not apply; mechanical plans still become `idle` in that case; `faction_action` does not use the frozen view. Add `UNKNOWN_TO_UNIT` to the common error-code list on that page.

`user/skills/gdnr-player/references/gdnr-play.md` gains one error-table row: `UNKNOWN_TO_UNIT` means a plan names an id that is not in that unit's frozen view. No link to a file outside `user/`.

No prompt under `.cursor/` or `user/` currently says this case is unimplemented. Do not add a deferred-behavior sentence. Historical files under `docs/superpowers/` stay frozen, apart from this design and its plan.

## Tests

Service tests in `test/services/unknown-plan-id.test.ts`. They assert return values and queue rows. They do not read a markdown file.

- An attack whose `targetFactionId` is absent from the frozen view returns `UNKNOWN_TO_UNIT` with `details.id`, `details.unitId`, and `details.unitType`, and inserts no queue row.
- An `idle` plan whose standing order names that same absent id fails the same way.
- An attack whose target and `attackerFeatureId` are both in the view queues `{ status: "queued" }`.
- A queued `idle` plan is still `queued` with that payload after a later out-of-view attack fails.
- `run_faction_turn` with an out-of-view `actions` entry returns `UNKNOWN_TO_UNIT`, leaves the turn open, writes no `actions` row, and does the same again on `resume: true`.
- A legal `idle` earlier in the same `actions` object stays `queued` when a later entry fails.
- A `player` faction's `actions` entry still yields `ok: true` and no queue row for that faction.

## Constraints

- Caller-supplied plans that name an id outside the frozen view fail with `UNKNOWN_TO_UNIT`. The tool envelope is `ok: false`. No `rejected` queue row is written for that failure.
- Error message: `plan names an id outside the frozen view: <id>`. Details: `{ id, unitType, unitId }`.
- The check uses the parsed plan, including `standingOrders`. `planReferencesUnknown` keeps its field list and walk order.
- Check order in `submitUnitPlan`: open turn, queue closed, frozen view exists, parse, unknown id, then write.
- A failed replacement leaves the existing `queued` plan unchanged.
- `run_faction_turn` returns `UNKNOWN_TO_UNIT` and does not call `apply_write_queue`. Earlier entries in the same `actions` object stay queued. The turn stays open.
- Any other `submit_unit_plan` failure inside `run_faction_turn` is ignored. A `player` faction's `actions` entry is still dropped.
- Mechanical plans still pass through `sanitizeActionForSnapshot`. `faction_action` does not check the frozen view.
- Apply still skips a row already marked `rejected`, and an apply-time rule failure may still mark the current row `rejected`.
- Living docs: overview gap bullet loses the plan-id clause; current-engine states the behavior and lists `UNKNOWN_TO_UNIT`; the player error table gains that code. No links from `user/` to files outside `user/`.
- Do not edit historical files under `docs/superpowers/` except this design and its plan.
- Do not add a unit test that reads a documentation or prompt file and asserts on its text.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.

## Out of scope

- The silent drop of a `player` faction's `run_faction_turn` `actions` entry.
- Queue conflicts on `faction_action` or `advance_month`.
- Making mechanical `idle` clipping an error.
- Changing `planReferencesUnknown`'s field list or walk order.
