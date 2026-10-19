# `max_interest` picks only neighbors in the frozen view

> Status: design for issue #135. Not implemented on this branch. Parent: #129. Sibling work stays on #136 (a failing step) and #137 (one planning path and docs). Living engine docs are unchanged in this change.

## Purpose

Under `max_interest`, a faction spends its Power picks only on neighbors it can act on: active, below the Interest cap, and inside its frozen view. Today ranking ignores the view, so an out-of-view neighbor still consumes a pick and then becomes `idle` in `sanitizeActionForSnapshot`.

Issue #135 has no **Open questions** section. The decisions below are the ones the issue already made. **Choices made here** are the readings this spec had to pick so the plan can be implemented without a second design pass.

## Decisions already in the issue

- Eligible neighbors are active neighbors whose interest edge is below `interestCap` of the faction's Power die and that are inside the faction's frozen view.
- The faction plans one `extend_interest` per eligible neighbor, in today's ranking order (largest gap, then higher Power, then lower id), up to its Power. It hits each target at most once.
- Fewer eligible neighbors means fewer extends, and zero means `idle`.
- Each step is its own contest with its own roll and adds one point on success.
- The same rules hold through `run_faction_turn` and through `open_parallel_turn` with `missing: "mechanical"`.

## Out of scope

- What happens when a step fails, which is #136.
- Removing the single-step branch in `resolveStrategy` and describing multi-action goal strategies in docs and skills, which is #137.
- Caller plans with several external actions, better Feature choice, and chart weights.
- Classifying factions as neighbors.
- Changing `sanitizeActionForSnapshot`, `half_interest`, or `proxy`.
- Updating `docs/design/` or `user/` copy. That lands with #137.

## Approaches

**A. Pass the frozen-view id set into planning and filter before the Power slice. Recommended.**

`applyWriteQueue` already loads the snapshot and `collectSnapshotIds`. It passes that set into `planFactionAction`. `rankNeighborsBelowCap` drops a neighbor whose id is absent from the set, then ranks and slices. `runSteps` never names an out-of-view target, so a skipped neighbor does not occupy a pick.

**B. Rank as today, then drop steps that `sanitizeActionForSnapshot` turns into `idle`, and backfill.**

Rejected. Eligibility would live in two places, and the Power slice would still run on the unfiltered list unless apply re-ranked. The issue's bug is that sanitizing after the slice burns a pick.

**C. Have `planFactionAction` load `unit_views` itself.**

Rejected. Planning would depend on an open turn row. Direct `planFactionAction` tests and any caller without a snapshot would need a fake view. The apply path already has the set.

## Choices made here

1. **In the view means the neighbor's faction id is in `collectSnapshotIds(snapshot)`.** That is the same set `sanitizeActionForSnapshot` uses. A feature id, place id, or fact id does not make a missing faction eligible.
2. **Filter at rank time, not after `slice(0, power)`.** `rankNeighborsBelowCap` takes optional `allowedIds?: ReadonlySet<string>`. When the set is present, a neighbor must be in it. When it is omitted, ranking stays cap-only (today's behavior for callers that do not pass a view).
3. **The mechanical apply path always passes the set.** `applyWriteQueue` calls `planFactionAction(db, faction, undefined, allowed)` when `missing === "mechanical"`. `run_faction_turn` already opens with `missing: "mechanical"` and apply, so it picks up the same filter. `faction_action` does not plan `max_interest` and does not change.
4. **`sanitizeActionForSnapshot` stays.** It remains a safety net for other strategies and for a missing feature id. It is not how `max_interest` skips an out-of-view neighbor.
5. **Zero eligible is `idle` through the existing `skipRunAction` path.** `planExtendInterest` returning `[]` still makes `planFactionAction` return `{ skipRunAction: true, action: { type: "idle" } }`. Apply records one idle. It does not insert `idle` steps mixed with extends.
6. **Out-of-view fixture: inbound `spies`, no outbound edge, no shared home.** `neighborFactions` includes a faction with Interest *to* the actor. `factionIncluded` does not, when that inbound edge is `spies`, there is no outbound Interest, and `home_place_id` is null or disjoint. Tests use that shape so the skip is a real frozen view, not a hand-edited snapshot.
7. **Neighbors in the tests have no Features**, so `runExtendInterest` takes the no-defender-feature path and the attacker wins. This spec does not force contest faces. Failure mid-plan stays #136.
8. **Ranking order is unchanged:** largest `cap - points` (missing outbound edge counts as 0 points), then higher Power, then lower id. Cap is `interestCap(DIE_BY_POWER[faction.power])`.
9. **Do not touch `resolveStrategy`'s `max_interest` first-step return.** `planFactionAction` still sets `runSteps` first, so that branch stays unreachable for this strategy until #137.

## Shape

### Planning

`rankNeighborsBelowCap` in `src/services/turn.ts`:

- Input: db, actor row, active neighbor rows, optional `allowedIds`.
- Keep a neighbor when `points < cap`, and when `allowedIds` is passed, `allowedIds.has(n.id)`.
- Sort as today.
- `planExtendInterest` for `max_interest` still `slice(0, faction.power)` and maps one `extend_interest` per pick, same lowest-id Feature as today.

`planFactionAction` gains a fourth argument `allowedIds?: ReadonlySet<string>` and passes it only into `planExtendInterest` / `rankNeighborsBelowCap`. `half_interest` in the same `if` still uses `preferredInterestTarget` and does not use this set.

### Apply

In `src/services/queue.ts`, the `missing === "mechanical"` branch already has `allowed`. Pass it into `planFactionAction`. If `runSteps` is set, keep mapping through `sanitizeActionForSnapshot` as today. After this change those steps should already be in-view.

### Unchanged

- Interest cap formula, Feature pick, contest rules, budgets (#103 / #112).
- Caller `submit_unit_plan` (still one action; still `UNKNOWN_TO_UNIT` for a bad id).
- MCP handlers. No new tool or schema field.

## Tests

One rule per test, in `test/services/turn.test.ts`. The existing happy-path test stays as the uniqueness / equal-to-Power case or is split so each name matches one acceptance bullet.

| Rule | Path | Expect |
| --- | --- | --- |
| Count capped at Power when more eligible neighbors than Power | `run_faction_turn` | Power 2, three in-view below-cap neighbors → two `extend_interest` rows, targets the first two in ranking order |
| Stops early when fewer neighbors are below the cap | `run_faction_turn` | Power 3, two below cap, one at cap → two extends, not three, and not padded with `idle` |
| Capped neighbors are skipped | `run_faction_turn` | Highest-Power neighbor at cap is not a target; a lower-Power below-cap neighbor is |
| Neighbors outside the frozen view are skipped and do not use a pick | `run_faction_turn` | Power 2, one out-of-view high-Power neighbor that would rank first, two in-view below-cap → two extends on the in-view ids, none on the hidden id, no `idle` for the actor |
| Same frozen-view skip through `open_parallel_turn` | `openParallelTurn` + `applyWriteQueue` with `missing: "mechanical"` and `interestMode: "pass"` | Same world as the row above; same two in-view targets |
| Each target is hit at most once | `run_faction_turn` | Power 3, three eligible → three distinct `target_id` values |
| Zero eligible neighbors gives `idle` | `run_faction_turn` | Neighbors exist but all at cap → one `idle`, zero `extend_interest` |

Do not add a test that reads a documentation or prompt file and asserts on its text.

## Acceptance

- The seven rules above pass.
- Out-of-view neighbors never appear in `runSteps` and do not reduce the number of in-view extends.
- #129, #136, and #137 stay open.
