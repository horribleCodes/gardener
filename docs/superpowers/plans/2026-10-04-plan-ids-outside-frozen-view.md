# Loud failure for plan ids outside the frozen view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caller-supplied plan that names an id outside the unit's frozen view returns `UNKNOWN_TO_UNIT` and writes no rejected queue row.

**Architecture:** `submitUnitPlan` throws `RuleError` after parse and before any queue write, so the transaction rolls back. `runFactionTurn` sends both `actions` loops through one helper that returns that error and skips `applyWriteQueue`. Mechanical idle-clipping and the player-faction drop stay as they are.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, better-sqlite3 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

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

---

## File map

- Create: `test/services/unknown-plan-id.test.ts` — submit and `run_faction_turn` cases.
- Modify: `src/services/queue.ts` — `submitUnitPlan` throws instead of storing `rejected` for an unknown id. Leave `sanitizeActionForSnapshot` and the apply-time `rejected` branches alone.
- Modify: `src/services/turn.ts` — one helper for both `actions` loops in `runFactionTurn`.
- Modify: `docs/design/overview.md` — drop the plan-id clause from the known-gap bullet.
- Modify: `docs/design/current-engine.md` — state the behavior and add the error code.
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` — one error-table row.

---

### Task 1: `submitUnitPlan` throws `UNKNOWN_TO_UNIT`

**Files:**
- Create: `test/services/unknown-plan-id.test.ts`
- Modify: `src/services/queue.ts` (`submitUnitPlan`, about lines 494–568)
- Test: `test/services/unknown-plan-id.test.ts`

**Interfaces:**
- Consumes: `planReferencesUnknown(snapshot, plan) -> string | undefined` from `src/rules/knowledge.ts`. `parseUnitPlan` from `src/services/unitPlan.ts`. `RuleError` from `src/domain/types.ts`.
- Produces: `submitUnitPlan(...) -> ServiceResult<{ status: "queued" }>`. On an id outside the frozen view the result is `{ ok: false, error: { code: "UNKNOWN_TO_UNIT", message: "plan names an id outside the frozen view: <id>", details: { id, unitType, unitId } } }`. No queue write for that failure.

- [ ] **Step 1: Write the failing test**

Create `test/services/unknown-plan-id.test.ts`:

```ts
import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn, submitUnitPlan } from "../../src/services/queue.js";

const attackThem = {
  type: "attack" as const,
  targetFactionId: "them",
  attackerFeatureId: "army",
};

function seedWorld(
  db: Database.Database,
  input: {
    samePlace: boolean;
    usControl: "npc" | "player";
    themControl: "npc" | "player";
  },
): void {
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'View', 1, 1, 0)",
  ).run();
  db.prepare(
    `INSERT INTO places (id, campaign_id, name, scope, parent_place_id)
     VALUES ('home', 'c1', 'Home', 'village', NULL), ('far', 'c1', 'Far', 'city', NULL)`,
  ).run();
  const themPlace = input.samePlace ? "home" : "far";
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status, home_place_id
     ) VALUES
       ('us', 'c1', 'Us', 1, 1, 0, 'existing', 'directed', ?, 0, 'active', 'home'),
       ('them', 'c1', 'Them', 2, 2, 0, 'existing', 'martial_conqueror', ?, 0, 'active', ?)`,
  ).run(input.usControl, input.themControl, themPlace);
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin)
     VALUES ('army', 'us', 'Army', 'military', 'native')`,
  ).run();
}

function openTemp(): { db: Database.Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-unknown-plan-"));
  const dbPath = join(dir, "campaign.sqlite");
  return { db: openDb(dbPath), dbPath };
}

function queueRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT unit_id, status, error_code, payload FROM write_queue ORDER BY unit_id, enqueued_at`,
    )
    .all() as {
    unit_id: string;
    status: string;
    error_code: string | null;
    payload: string;
  }[];
}

test("submitUnitPlan rejects an attack outside the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: attackThem,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  expect(result.error.message).toBe("plan names an id outside the frozen view: them");
  expect(result.error.details).toEqual({ id: "them", unitType: "faction", unitId: "us" });
  expect(queueRows(db)).toEqual([]);
});

test("submitUnitPlan rejects a standing order outside the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: {
      type: "idle",
      standingOrders: [{ targetFactionId: "them", side: "harm", maxSpend: 1 }],
    },
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  expect(result.error.details).toEqual({ id: "them", unitType: "faction", unitId: "us" });
  expect(queueRows(db)).toEqual([]);
});

test("submitUnitPlan queues an attack whose ids are in the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: true, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: attackThem,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toEqual({ status: "queued" });
  const rows = queueRows(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("queued");
  expect(rows[0]?.error_code).toBeNull();
  expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject(attackThem);
});

test("a failed replacement leaves the previous queued plan in place", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  openParallelTurn(db, dbPath, { campaignId: "c1", unitIds: ["us"] });

  const queued = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: { type: "idle" },
  });
  expect(queued.ok).toBe(true);

  const result = submitUnitPlan(db, dbPath, {
    campaignId: "c1",
    unitType: "faction",
    unitId: "us",
    plan: attackThem,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  const rows = queueRows(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("queued");
  expect(rows[0]?.error_code).toBeNull();
  expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ type: "idle" });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run test/services/unknown-plan-id.test.ts`

Expected: FAIL, 3 failed and 1 passed. The attack, standing-order, and replacement tests fail because `result.ok` is `true` (`expected true to be false`). `submitUnitPlan queues an attack whose ids are in the frozen view` already passes.

- [ ] **Step 3: Throw before writing the queue**

In `submitUnitPlan`, change the return type to `ServiceResult<{ status: "queued" }>`.

Delete `const planObj = factionActionFromUnitPlan(unitPlan) ...`. Delete both branches that insert or update a row with `status = 'rejected'` and `UNKNOWN_TO_UNIT`.

After a successful `parseUnitPlan`, and before `const now` / the queue write:

```ts
        const unknownId = planReferencesUnknown(
          snapshot,
          unitPlan as Record<string, unknown>,
        );
        if (unknownId) {
          throw new RuleError(
            "UNKNOWN_TO_UNIT",
            `plan names an id outside the frozen view: ${unknownId}`,
            { id: unknownId, unitType: input.unitType, unitId: input.unitId },
          );
        }
```

Keep the existing `queued` update and the existing `queued` insert, in that order, after the throw. Do not reindent the rest of the function. Do not edit `sanitizeActionForSnapshot` or the `row?.status === "rejected"` continues in `applyUnitsInOrder`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/unknown-plan-id.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add test/services/unknown-plan-id.test.ts src/services/queue.ts
git commit -m "$(cat <<'EOF'
fix: reject out-of-view plan ids with UNKNOWN_TO_UNIT

EOF
)"
```

---

### Task 2: `run_faction_turn` returns the error and does not apply

**Files:**
- Modify: `src/services/turn.ts` (`runFactionTurn`, about lines 818–873)
- Modify: `test/services/unknown-plan-id.test.ts`
- Test: `test/services/unknown-plan-id.test.ts`

**Interfaces:**
- Consumes: `submitUnitPlan` from Task 1. `RunFactionTurnInput.actions` is `Record<string, FactionAction> | undefined`.
- Produces: `runFactionTurn` returns the `UNKNOWN_TO_UNIT` `ServiceResult` from `submitUnitPlan` and does not call `applyWriteQueue` in that case. Other submit failures are ignored.

- [ ] **Step 1: Write the failing tests**

Add this import to `test/services/unknown-plan-id.test.ts`:

```ts
import { runFactionTurn } from "../../src/services/turn.js";
```

Append these tests:

```ts
test("run_faction_turn returns UNKNOWN_TO_UNIT and does not apply", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });

  const first = runFactionTurn(db, dbPath, {
    campaignId: "c1",
    actions: { us: attackThem },
  });

  expect(first.ok).toBe(false);
  if (first.ok) return;
  expect(first.error.code).toBe("UNKNOWN_TO_UNIT");
  expect(first.error.details).toEqual({ id: "them", unitType: "faction", unitId: "us" });
  const open = db.prepare("SELECT open FROM turns WHERE campaign_id = 'c1'").get() as {
    open: number;
  };
  expect(open.open).toBe(1);
  const actions = db.prepare("SELECT COUNT(*) AS n FROM actions").get() as { n: number };
  expect(actions.n).toBe(0);

  const second = runFactionTurn(db, dbPath, {
    campaignId: "c1",
    resume: true,
    actions: { us: attackThem },
  });
  expect(second.ok).toBe(false);
  if (second.ok) return;
  expect(second.error.code).toBe("UNKNOWN_TO_UNIT");
  const stillOpen = db.prepare("SELECT open FROM turns WHERE campaign_id = 'c1'").get() as {
    open: number;
  };
  expect(stillOpen.open).toBe(1);
  const stillNone = db.prepare("SELECT COUNT(*) AS n FROM actions").get() as { n: number };
  expect(stillNone.n).toBe(0);
});

test("run_faction_turn keeps an earlier queued plan when a later id is outside the frozen view", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: false, usControl: "npc", themControl: "npc" });
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status, home_place_id
     ) VALUES ('ally', 'c1', 'Ally', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active', 'home')`,
  ).run();

  const result = runFactionTurn(db, dbPath, {
    campaignId: "c1",
    actions: {
      ally: { type: "idle" },
      us: attackThem,
    },
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("UNKNOWN_TO_UNIT");
  const rows = queueRows(db);
  expect(rows.map((row) => row.unit_id)).toEqual(["ally"]);
  expect(rows[0]?.status).toBe("queued");
  expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({ type: "idle" });
  const actions = db.prepare("SELECT COUNT(*) AS n FROM actions").get() as { n: number };
  expect(actions.n).toBe(0);
});

test("run_faction_turn still drops a player faction action", () => {
  const { db, dbPath } = openTemp();
  seedWorld(db, { samePlace: true, usControl: "player", themControl: "npc" });

  const result = runFactionTurn(db, dbPath, {
    campaignId: "c1",
    actions: { us: { type: "idle" } },
  });

  expect(result.ok).toBe(true);
  expect(queueRows(db).filter((row) => row.unit_id === "us")).toEqual([]);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run test/services/unknown-plan-id.test.ts -t "run_faction_turn"`

Expected: FAIL. The two `UNKNOWN_TO_UNIT` tests fail because `runFactionTurn` returns `ok: true` and apply writes action rows (`expected true to be false`). `run_faction_turn still drops a player faction action` already passes.

- [ ] **Step 3: Share one helper between the two loops**

In `src/services/turn.ts`, immediately above `export function runFactionTurn`, add:

```ts
function submitCallerPlans(
  db: Database.Database,
  dbPath: string,
  campaignId: string,
  actions: Record<string, FactionAction> | undefined,
): { ok: false; error: { code: string; message: string; details: Record<string, unknown> } } | undefined {
  if (!actions) return undefined;
  for (const [factionId, action] of Object.entries(actions)) {
    const submitted = submitUnitPlan(db, dbPath, {
      campaignId,
      unitType: "faction",
      unitId: factionId,
      plan: action,
    });
    if (!submitted.ok && submitted.error.code === "UNKNOWN_TO_UNIT") return submitted;
  }
  return undefined;
}
```

`submitUnitPlan` is already imported from `./queue.js`. `Database` is already imported in this file.

Replace the `if (input.actions) { for ... }` block in the `input.resume` branch with:

```ts
    const rejected = submitCallerPlans(db, dbPath, input.campaignId, input.actions);
    if (rejected) return rejected;
```

Replace the same `if (input.actions)` block in the fresh-open branch, after `if (!opened.ok) return opened;`, with the same two lines. `applyWriteQueue` stays where it is, reached only when the helper returns `undefined`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/unknown-plan-id.test.ts`

Expected: PASS, 7 tests.

Run: `npx vitest run`

Expected: PASS. The suite does not need a server or a `./data` folder.

- [ ] **Step 5: Commit**

```bash
git add src/services/turn.ts test/services/unknown-plan-id.test.ts
git commit -m "$(cat <<'EOF'
fix: stop run_faction_turn before apply on UNKNOWN_TO_UNIT

EOF
)"
```

---

### Task 3: Remove the plan-id gap note and name the error

**Files:**
- Modify: `docs/design/overview.md` (known-gap bullet, about line 71)
- Modify: `docs/design/current-engine.md` (error-code sentence about line 44, and **Plan errors** about line 59)
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` (error table, about lines 35–38)

**Interfaces:**
- Consumes: the behavior from Tasks 1 and 2.
- Produces: the three doc edits below. No new test file.

- [ ] **Step 1: Edit the overview gap bullet**

In `docs/design/overview.md`, replace:

```markdown
- A plan naming an id outside the unit's view is dropped silently, and a `player` faction's entry in `run_faction_turn` `actions` is dropped silently. Both must fail loudly.
```

with:

```markdown
- A `player` faction's entry in `run_faction_turn` `actions` is dropped silently. It must fail loudly.
```

- [ ] **Step 2: State the behavior in the current engine page**

In `docs/design/current-engine.md`, in the common error-code sentence, insert `` `UNKNOWN_TO_UNIT`, `` immediately after `` `WRITE_LOCKED`, ``.

Replace:

```markdown
- **Plan errors.** A plan that names an entity absent from the unit's view must fail loudly, not be dropped.
```

with:

```markdown
- **Plan errors.** A caller-supplied plan that names an id absent from that unit's frozen view fails with `UNKNOWN_TO_UNIT` and is not queued. A failed replacement leaves the queued plan in place. `run_faction_turn` returns that error and does not apply the queue. A mechanical plan for a unit with no queued plan still becomes `idle` when it would name an id outside the view. `faction_action` does not use the frozen view.
```

- [ ] **Step 3: Add the player error row**

In `user/skills/gdnr-player/references/gdnr-play.md`, immediately after the table row for `CAMPAIGN_NOT_FOUND`, `ENTITY_NOT_FOUND`, add:

```markdown
| `UNKNOWN_TO_UNIT` | A plan names an id that is not in that unit's frozen view. |
```

Do not add a link or a path that points outside `user/`.

- [ ] **Step 4: Confirm the old gap sentence is gone**

Run: `rg -n "outside the unit's view is dropped silently" docs/design user .cursor`

Expected: no matches. This command is a check for the implementer. Do not turn it into a unit test.

- [ ] **Step 5: Commit**

```bash
git add docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-player/references/gdnr-play.md
git commit -m "$(cat <<'EOF'
docs: describe UNKNOWN_TO_UNIT for plans outside the frozen view

EOF
)"
```
