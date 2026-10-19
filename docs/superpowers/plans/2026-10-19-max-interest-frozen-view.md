# Max Interest Frozen-View Neighbor Picks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `max_interest`, Power picks go only to active in-view neighbors below the Interest cap, so an out-of-view neighbor is skipped instead of burning a pick.

**Architecture:** `applyWriteQueue` already has `collectSnapshotIds`. It passes that set into `planFactionAction`. `rankNeighborsBelowCap` drops ids absent from the set, then ranks (largest gap, higher Power, lower id) and slices to Power. Zero eligible neighbors still returns `idle` via `skipRunAction`.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-19-max-interest-frozen-view-design.md`. Issue #135.
- Eligible: `status === "active"`, outbound points `< interestCap(DIE_BY_POWER[power])` (missing edge is 0 points), and when `allowedIds` is passed, `allowedIds.has(neighbor.id)`.
- Rank: largest `cap - points`, then higher Power, then lower id. Slice `faction.power`. One `extend_interest` per pick. Lowest-id Feature, unchanged.
- `planFactionAction(db, faction, explicit?, allowedIds?: ReadonlySet<string>)`.
- Mechanical apply calls `planFactionAction(db, faction, undefined, allowed)`.
- Omit `allowedIds` means no view filter.
- Do not change `resolveStrategy`, `sanitizeActionForSnapshot`, `half_interest`, `proxy`, MCP, or living docs.
- Do not define mid-plan failure; that is #136.
- Neighbors in these tests have no Features so extend succeeds without a contest.
- `open_parallel_turn` tests call `applyWriteQueue` with `interestMode: "pass"`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on this spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

---

## File map

- Modify: `src/services/turn.ts` (`rankNeighborsBelowCap`, `planExtendInterest`, `planFactionAction`)
- Modify: `src/services/queue.ts` (mechanical `planFactionAction` call)
- Modify: `test/services/turn.test.ts` (acceptance tests; keep `forceStrategyRoll`)

---

### Task 1: Filter frozen-view neighbors before the Power slice

**Files:**
- Modify: `test/services/turn.test.ts`
- Modify: `src/services/turn.ts` (`rankNeighborsBelowCap`, `planExtendInterest`, `planFactionAction`)
- Modify: `src/services/queue.ts` (the `missing === "mechanical"` branch around the `planFactionAction` call)

**Interfaces:**
- Consumes: `runFactionTurn` from `src/services/turn.ts`; `openParallelTurn` and `applyWriteQueue` from `src/services/queue.ts`; `openDb` from `src/store/db.ts`; existing `forceStrategyRoll` in `test/services/turn.test.ts`.
- Produces: `planFactionAction(db, faction, explicit?, allowedIds?: ReadonlySet<string>)`. `rankNeighborsBelowCap(db, faction, neighborRows, allowedIds?: ReadonlySet<string>)`. Mechanical apply passes `allowed` as that fourth argument.

- [ ] **Step 1: Write the failing tests**

In `test/services/turn.test.ts`, add this import next to the existing `runFactionTurn` import:

```ts
import { applyWriteQueue, openParallelTurn } from "../../src/services/queue.js";
```

Keep the existing test `"max_interest extends once per neighbor up to power"`. After it, add the helper and tests below.

```ts
function extendTargets(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT target_id FROM actions WHERE actor_id = 'actor' AND type = 'extend_interest' ORDER BY id`,
      )
      .all() as { target_id: string }[]
  ).map((row) => row.target_id);
}

function actorActionTypes(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT type FROM actions WHERE actor_id = 'actor' ORDER BY id`)
      .all() as { type: string }[]
  ).map((row) => row.type);
}

function maxInterestWorld(input: {
  seed: number;
  power: 1 | 2 | 3 | 4 | 5;
  neighbors: { id: string; power: 1 | 2 | 3 | 4 | 5; points: number }[];
  hidden?: { id: string; power: 1 | 2 | 3 | 4 | 5 };
}): Database.Database {
  const shuffleCounter = forceStrategyRoll(input.seed, 1, 2);
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", input.seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter);
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', ?, 1, 5, 'native', 'scheming_manipulator', 'npc', 0, 'active')`,
  ).run(input.power);
  for (const n of input.neighbors) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, ?, 1, 1, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(n.id, n.id, n.power);
    db.prepare(
      `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
       VALUES (?, 'actor', ?, ?, 'trade')`,
    ).run(`i-${n.id}`, n.id, n.points);
  }
  if (input.hidden) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, ?, 1, 1, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(input.hidden.id, input.hidden.id, input.hidden.power);
    db.prepare(
      `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
       VALUES (?, ?, 'actor', 1, 'spies')`,
    ).run(`i-${input.hidden.id}`, input.hidden.id);
  }
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin)
     VALUES ('a-feat', 'actor', 'Spies', 'cultural', 'native')`,
  ).run();
  return db;
}

test("max_interest count is capped at Power when more neighbors are eligible", () => {
  const db = maxInterestWorld({
    seed: 821,
    power: 2,
    neighbors: [
      { id: "n-a", power: 3, points: 0 },
      { id: "n-b", power: 2, points: 0 },
      { id: "n-c", power: 1, points: 0 },
    ],
  });
  const result = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(result.ok).toBe(true);
  expect(extendTargets(db)).toEqual(["n-a", "n-b"]);
  expect(actorActionTypes(db).filter((t) => t === "idle")).toEqual([]);
});

test("max_interest stops early when fewer neighbors are below the cap", () => {
  const db = maxInterestWorld({
    seed: 822,
    power: 3,
    neighbors: [
      { id: "n-a", power: 2, points: 0 },
      { id: "n-b", power: 1, points: 0 },
      { id: "n-c", power: 1, points: 20 },
    ],
  });
  const result = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(result.ok).toBe(true);
  expect(extendTargets(db)).toEqual(["n-a", "n-b"]);
  expect(actorActionTypes(db)).not.toContain("idle");
});

test("max_interest skips a neighbor already at the cap", () => {
  const db = maxInterestWorld({
    seed: 823,
    power: 3,
    neighbors: [
      { id: "n-strong", power: 5, points: 20 },
      { id: "n-weak", power: 1, points: 0 },
    ],
  });
  const result = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(result.ok).toBe(true);
  expect(extendTargets(db)).toEqual(["n-weak"]);
});

test("max_interest skips a neighbor outside the frozen view and does not spend a pick on it", () => {
  const db = maxInterestWorld({
    seed: 824,
    power: 2,
    neighbors: [
      { id: "n-a", power: 2, points: 0 },
      { id: "n-b", power: 1, points: 0 },
    ],
    hidden: { id: "n-hidden", power: 5 },
  });
  const result = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(result.ok).toBe(true);
  expect(extendTargets(db)).toEqual(["n-a", "n-b"]);
  expect(extendTargets(db)).not.toContain("n-hidden");
  expect(actorActionTypes(db)).not.toContain("idle");
});

test("max_interest frozen-view skip is the same through open_parallel_turn with missing mechanical", () => {
  const db = maxInterestWorld({
    seed: 825,
    power: 2,
    neighbors: [
      { id: "n-a", power: 2, points: 0 },
      { id: "n-b", power: 1, points: 0 },
    ],
    hidden: { id: "n-hidden", power: 5 },
  });
  const opened = openParallelTurn(db, ":memory:", {
    campaignId: "c1",
    unitIds: ["actor"],
    missing: "mechanical",
  });
  expect(opened.ok).toBe(true);
  const applied = applyWriteQueue(db, ":memory:", {
    campaignId: "c1",
    interestMode: "pass",
  });
  expect(applied.ok).toBe(true);
  expect(extendTargets(db)).toEqual(["n-a", "n-b"]);
  expect(extendTargets(db)).not.toContain("n-hidden");
  expect(actorActionTypes(db)).not.toContain("idle");
});

test("max_interest hits each target at most once", () => {
  const db = maxInterestWorld({
    seed: 826,
    power: 3,
    neighbors: [
      { id: "n-a", power: 2, points: 0 },
      { id: "n-b", power: 1, points: 0 },
      { id: "n-c", power: 1, points: 0 },
    ],
  });
  const result = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(result.ok).toBe(true);
  const targets = extendTargets(db);
  expect(targets).toHaveLength(3);
  expect(new Set(targets).size).toBe(3);
});

test("max_interest idles when no neighbor is eligible", () => {
  const db = maxInterestWorld({
    seed: 827,
    power: 2,
    neighbors: [
      { id: "n-a", power: 2, points: 16 },
      { id: "n-b", power: 1, points: 16 },
    ],
  });
  const result = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(result.ok).toBe(true);
  expect(extendTargets(db)).toEqual([]);
  expect(actorActionTypes(db)).toEqual(["idle"]);
});
```

Cap values in those fixtures: Power 3 die is 10, cap 20; Power 2 die is 8, cap 16.

- [ ] **Step 2: Run the new tests and confirm the frozen-view skip fails**

Run:

```bash
npx vitest run test/services/turn.test.ts -t "max_interest"
```

Expected: `"max_interest skips a neighbor outside the frozen view and does not spend a pick on it"` and `"max_interest frozen-view skip is the same through open_parallel_turn with missing mechanical"` fail. Current ranking puts `n-hidden` first (gap from 0 points, Power 5), `slice(0, 2)` keeps `n-hidden` and `n-a`, then sanitize turns the hidden step into `idle`, so the actor does not get both `n-a` and `n-b`. The Power-cap, below-cap, uniqueness, and idle tests may already pass; leave them in place.

- [ ] **Step 3: Filter on `allowedIds` before the Power slice**

In `src/services/turn.ts`, change `rankNeighborsBelowCap` to:

```ts
function rankNeighborsBelowCap(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  neighborRows: ReturnType<typeof loadFactionRow>[],
  allowedIds?: ReadonlySet<string>,
): ReturnType<typeof loadFactionRow>[] {
  const cap = interestCap(DIE_BY_POWER[faction.power]);
  return [...neighborRows]
    .filter((n) => {
      if (allowedIds && !allowedIds.has(n.id)) return false;
      const edge = interestTo(db, faction.id, n.id);
      const points = edge?.points ?? 0;
      return points < cap;
    })
    .sort((a, b) => {
      const gapA = cap - (interestTo(db, faction.id, a.id)?.points ?? 0);
      const gapB = cap - (interestTo(db, faction.id, b.id)?.points ?? 0);
      if (gapB !== gapA) return gapB - gapA;
      if (b.power !== a.power) return b.power - a.power;
      return a.id.localeCompare(b.id);
    });
}
```

Thread the set through `planExtendInterest` and `planFactionAction` only. Do not pass it from `resolveStrategy`.

`planExtendInterest` signature:

```ts
function planExtendInterest(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  strategy: string,
  neighborRows: ReturnType<typeof loadFactionRow>[],
  allowedIds?: ReadonlySet<string>,
): FactionAction[] {
```

In the `max_interest` branch, call `rankNeighborsBelowCap(db, faction, neighborRows, allowedIds)`. Leave the `half_interest` and `proxy` branches as they are.

`planFactionAction` signature:

```ts
export function planFactionAction(
  db: Database.Database,
  faction: ReturnType<typeof loadFactionRow>,
  explicit?: FactionAction,
  allowedIds?: ReadonlySet<string>,
): FactionPlanResult {
```

In the existing

```ts
if (strategy === "max_interest" || strategy === "half_interest") {
```

block, call `planExtendInterest(db, faction, strategy, neighborRows, allowedIds)`.

In `src/services/queue.ts`, in the `missing === "mechanical"` branch, after `const allowed = collectSnapshotIds(snapshot);`, replace

```ts
const planned = planFactionAction(db, faction, undefined);
```

with

```ts
const planned = planFactionAction(db, faction, undefined, allowed);
```

Leave the `sanitizeActionForSnapshot` mapping on `runSteps` in place.

- [ ] **Step 4: Re-run the max_interest tests**

Run:

```bash
npx vitest run test/services/turn.test.ts -t "max_interest"
```

Expected: all of those tests PASS.

Then:

```bash
npx vitest run test/services/turn.test.ts
```

Expected: PASS (the file's other tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/services/turn.ts src/services/queue.ts test/services/turn.test.ts
git commit -m "fix: max_interest skips neighbors outside the frozen view"
```

---

## Spec coverage

- Cap at Power → Task 1 test `"max_interest count is capped at Power when more neighbors are eligible"`.
- Stop early when fewer below cap → `"max_interest stops early when fewer neighbors are below the cap"`.
- Skip capped → `"max_interest skips a neighbor already at the cap"`.
- Skip out of view without spending a pick → both frozen-view tests.
- Same through `run_faction_turn` and `open_parallel_turn` + mechanical apply → those two tests.
- Each target at most once → `"max_interest hits each target at most once"` plus the existing happy-path test.
- Zero eligible → idle → `"max_interest idles when no neighbor is eligible"`.
- Filter before slice → Step 3 `rankNeighborsBelowCap` + fourth argument from apply.
- No #136 / #137 / docs / `resolveStrategy` edits.
