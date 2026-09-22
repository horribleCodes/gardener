# Task 10 Report: Turns, goals, cults, and queries

## Status

DONE

## Commits

- `8d5fb0b` feat: run faction turns and derived briefs

## TDD

### RED (`npx vitest run test/services/turn.test.ts`)

Before implementation (expected per brief — modules missing):

```
 FAIL  test/services/turn.test.ts
Error: Cannot find module '../../src/rules/goals.js' imported from test/services/turn.test.ts
```

### GREEN (`npx vitest run test/services/turn.test.ts`)

```
 RUN  v2.1.9 /workspace

 ✓ test/services/turn.test.ts (3 tests) 9ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### Full suite (`npx vitest run`)

```
 Test Files  10 passed (10)
      Tests  46 passed (46)
```

`npx tsc -p tsconfig.json --noEmit`: exit 0.

## Implementation summary

### `src/rules/goals.ts`

- `planGoal(behavior, roll)` maps catalog goal rows; `directed` throws `RuleError("MAGNITUDE_REJECTED", ...)`.

### `src/queries/brief.ts`

- `decisionMakers` implements autocratic, figurehead, shared, consensus, democratic, and anarchic rules from the spec table.

### `src/queries/rumors.ts`

- `worldBrief`: month plus per-faction power, trouble, cohesion, status, `collapseMargin` (`dieMax - trouble`).
- `rumorLines`: template sentences from the latest closed turn's faction actions.

### `src/services/turn.ts`

- `runFactionTurn`: shuffles active NPC factions with campaign RNG, stores `faction_order`, plans via `planGoal` (or explicit `actions`), maps strategies to `runAction` / glorify vanity facts, substitutes Build Strength when Dominion is short or strategy only extends Interest, rerolls satisfied `stockpile` / `half_interest`, closes turn, optional `advanceMonth`.
- `advanceMonth`: increments `month`, grants `monthlyDominion` per godbound (`free` / `cult` / none), records income events.

## Self-review

- Explicit `actions` in the integration test keep turn resolution stable while still asserting shuffle order from `rng_seed` 4242.
- Interest spend and `projectUnitView` target filtering deferred to later tasks as specified.
- `runAction` nested inside `runFactionTurn` transaction matches existing service patterns from Task 9.

## Concerns

None.

## Review fix (2026-09-22)

### What changed

- `runFactionTurn({ resume: true })` reuses stored `faction_order`, skips factions that already have an `actions` row for the open turn, and does not reshuffle.
- `halfInterestSatisfied` / `preferredInterestTarget` gate `half_interest` on the preferred neighbor only; `proxy` issues `aid` when Dominion and a military ally exist; `no_external_until_hit` can attack after a prior `attacker_win`; double-satisfied goal rerolls plan internal Build Strength without `runAction`; democratic `decisionMakers` lists all majors with `majority`.
- Added regression tests in `test/services/turn.test.ts`.

### Commands

```bash
npx vitest run test/services/turn.test.ts
npx vitest run
```

### Results

- `test/services/turn.test.ts`: 8 passed
- Full suite: 51 passed

### Commit

- `bc82168` fix: resume open turns and correct goal strategies

## Review fix — Task 10 strategies (2026-09-22)

### Status

DONE

### What changed

- `solve_military`: highest-point non-intrinsic military problem only; otherwise `skipRunAction` (no action row, no Dominion spend).
- `cunning_solve`: highest non-intrinsic problem with lowest-id non-military means in `actions.feature_ids`; idle without means; `build_strength` when no solvable problem.
- `harmless_feature`: catalog cultural or economic row with `covert: 1` per existing cultural features.
- `military_feature_aimed`: highest-Power neighbor; idle without neighbors; add part to lowest-id military feature or insert one with `aimed_at_faction_id`.
- `priorAttackerWinAgainst`: counts hits on the latest closed turn or the open turn only.
- `insertFeatureFromText` / `runEnactChange`: thread `covert`, `aimedAtFactionId`, `meansFeatureId`, and `addPartToFeatureId`.

### Tests

- `npx vitest run test/services/turn.test.ts`: 14 passed
- `npm test`: 57 passed

### Commit

- (pending) fix: align goal strategies with spec table
