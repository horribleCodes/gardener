# Faction turn budgets and spend_interest after-roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one faction turn per stored month, the internal/external budget, slow-faction skip, and Spend Interest offers that move a kept face and then the outcome.

**Architecture:** `assertFactionBudget` lives in its own module and `runAction` calls it. Month uniqueness is a check in `ensureOpenTurn` and `openParallelTurn`. Interest offers are one `write_queue` row (`kind = 'interest'`) driven by `src/services/interestWindow.ts`. `run_faction_turn` passes every offer. `faction_action` and `apply_write_queue` pause with `PENDING_INTEREST`. After-roll spends change the stored kept face and `followRolledAction` applies or reverses consequences.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-07-faction-turn-budgets-design.md`. Issue #103.
- Error `TURN_ALREADY_TAKEN`, message `turn already taken this month`, details `{}`.
- Error `FACTION_SKIPPED`, message `faction skipped this month`, details `{}`.
- Error `ALREADY_ACTED`, message `faction already acted`, details `{}`.
- Error `NOT_PENDING`, message `no interest window`, details `{}`, when a roll spend or a pass has no matching window.
- Error `MODIFIER_EXCEEDS_DIE`, message `roll cannot move past the die`, details `{}`, when an after-roll spend would not move the kept face. Message `modifier must be at least 1` when `modifier < 1`.
- Error `FILL_INCOMPLETE`, message `direction must be raise or lower`, details `{}`, when `before` or `after` omits `direction`.
- Pending code `PENDING_INTEREST`. Fields: `windowId`, `phase`, `subjectFactionId`, `eligibleFactionIds`, `actionId`.
- Kept face clamps to `1` through `DIE_BY_POWER[target.power]`.
- `run_faction_turn` passes Interest offers. `faction_action` and `apply_write_queue` pause.
- `interestModifier` is unchanged and is not called from `spendInterest`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on this spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

---

## File map

- Create: `src/services/factionBudget.ts` — internal/external/skip budget check.
- Create: `src/services/interestWindow.ts` — eligibility, window row, pass, resume, before/after/steal.
- Create: `test/services/faction-turn-budget.test.ts` — budget, crisis choice, skip.
- Create: `test/services/spend-interest-reaction.test.ts` — steal, offers, victory, hinder, roll change.
- Modify: `src/rules/actions.ts` — `movedKeptFace`.
- Modify: `src/services/util.ts` — `ensureOpenTurn` rejects a second turn this month.
- Modify: `src/services/queue.ts` — same rejection in `openParallelTurn`; pause on an interest row; `interestMode`.
- Modify: `src/services/turn.ts` — skip, `spendInterest` charge rules, `runFactionTurn` passes offers.
- Modify: `src/services/actions.ts` — call the budget helper; accept `interestDeltas`; `followRolledAction`.
- Modify: `src/mcp/register.ts` — `direction`, `pass_interest`, descriptions.
- Modify: `test/rules/actions.test.ts` — clamp cases.
- Modify: `test/services/turn.test.ts` — `before`/`after` with no window expect `NOT_PENDING`.
- Modify: `docs/design/overview.md`, `docs/design/current-engine.md`, `docs/design/glossary.md`.
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`, `user/skills/gdnr-director/references/gdnr-direct.md`.

---

### Task 1: One turn per month, and skip

**Files:**
- Create: `test/services/faction-turn-budget.test.ts`
- Modify: `src/services/util.ts` (`ensureOpenTurn`)
- Modify: `src/services/queue.ts` (`openParallelTurn`, after the open-turn check)
- Modify: `src/services/turn.ts` (`FactionAction` union and `factionAction`)

**Interfaces:**
- Consumes: `ensureOpenTurn` from `src/services/util.ts`; `openParallelTurn` from `src/services/queue.ts`; `factionAction` and `advanceMonthForCampaign` from `src/services/turn.ts`; `openDb` from `src/store/db.ts`.
- Produces: `factionAction` accepts `{ type: "skip" }`. Errors `TURN_ALREADY_TAKEN`, `FACTION_SKIPPED`, `ALREADY_ACTED` with the messages in Global Constraints.

- [ ] **Step 1: Write the failing test**

Create `test/services/faction-turn-budget.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/store/db.js";
import { openParallelTurn } from "../../src/services/queue.js";
import { advanceMonthForCampaign, factionAction } from "../../src/services/turn.js";

function world(): { db: Database.Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "gb-budget-"));
  const dbPath = join(dir, "campaign.sqlite");
  const db = openDb(dbPath);
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Budget', 1, 1, 0)",
  ).run();
  for (const [id, name, power] of [
    ["a", "A", 1],
    ["b", "B", 1],
  ] as const) {
    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES (?, 'c1', ?, ?, ?, 3, 'native', 'directed', 'npc', 0, 'active')`,
    ).run(id, name, power, power);
  }
  return { db, dbPath };
}

function closeOpenTurn(db: Database.Database): void {
  db.prepare("UPDATE turns SET open = 0 WHERE campaign_id = 'c1' AND open = 1").run();
}

test("a second turn in the same month is the rejected crisis choice", () => {
  const { db, dbPath } = world();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "idle" },
  });
  expect(opened.ok).toBe(true);
  closeOpenTurn(db);

  const again = openParallelTurn(db, dbPath, { campaignId: "c1" });
  expect(again.ok).toBe(false);
  if (!again.ok) {
    expect(again.error).toEqual({
      code: "TURN_ALREADY_TAKEN",
      message: "turn already taken this month",
      details: {},
    });
  }
  const viaAction = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "idle" },
  });
  expect(viaAction.ok).toBe(false);
  if (!viaAction.ok) {
    expect(viaAction.error.code).toBe("TURN_ALREADY_TAKEN");
    expect(viaAction.error.message).toBe("turn already taken this month");
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE campaign_id = 'c1'").get() as {
    c: number;
  };
  expect(count.c).toBe(1);
});

test("advance_month allows a turn in the new month", () => {
  const { db, dbPath } = world();
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "idle" } }).ok,
  ).toBe(true);
  closeOpenTurn(db);
  const advanced = advanceMonthForCampaign(db, "c1");
  expect(advanced.ok).toBe(true);
  const next = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "idle" },
  });
  expect(next.ok).toBe(true);
  const months = db.prepare("SELECT month FROM turns WHERE campaign_id = 'c1' ORDER BY sequence").all() as {
    month: number;
  }[];
  expect(months.map((row) => row.month)).toEqual([1, 2]);
  expect(openParallelTurn(db, dbPath, { campaignId: "c1" }).ok).toBe(false);
});

test("skip with no open turn does not insert a turn", () => {
  const { db } = world();
  const result = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toEqual({
      code: "ENTITY_NOT_FOUND",
      message: "no open turn",
      details: {},
    });
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM turns").get() as { c: number };
  expect(count.c).toBe(0);
});

test("skip is recorded and a second skip fails", () => {
  const { db } = world();
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "idle" } }).ok,
  ).toBe(true);
  const skipped = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(skipped.ok).toBe(true);
  if (skipped.ok) expect(skipped.data).toEqual({ skipped: true });
  const row = db.prepare("SELECT type, outcome FROM actions WHERE actor_id = 'a'").get() as {
    type: string;
    outcome: string;
  };
  expect(row).toEqual({ type: "skip", outcome: "skipped" });
  const again = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error.code).toBe("FACTION_SKIPPED");
});

test("skip after a budgeted action returns ALREADY_ACTED", () => {
  const { db } = world();
  expect(
    factionAction(db, {
      campaignId: "c1",
      factionId: "a",
      action: { type: "build_strength", forcedRoll: 6 },
    }).ok,
  ).toBe(true);
  const skipped = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "skip" },
  });
  expect(skipped.ok).toBe(false);
  if (!skipped.ok) {
    expect(skipped.error).toEqual({
      code: "ALREADY_ACTED",
      message: "faction already acted",
      details: {},
    });
  }
});
```

The `advance_month` test calls `openParallelTurn` while the new month's turn is still open, so that call is `TURN_ALREADY_OPEN`. The assertion is only `ok === false`. Do not assert `TURN_ALREADY_TAKEN` on that last call. `build_strength` with `forcedRoll: 6` on Power 1 (d6) and Trouble 0 succeeds, and no Interest edge points at `a`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/faction-turn-budget.test.ts`

Expected: FAIL. `skip` is not a known action, and a second `factionAction` idle still opens a turn.

- [ ] **Step 3: Implement the month check and skip**

Replace `ensureOpenTurn` in `src/services/util.ts` with:

```ts
export function ensureOpenTurn(db: Database.Database, campaignId: string): string {
  const open = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(campaignId) as { id: string } | undefined;
  if (open) return open.id;
  const campaign = requireCampaign(db, campaignId);
  const taken = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND month = ? LIMIT 1")
    .get(campaignId, campaign.month) as { id: string } | undefined;
  if (taken) throw new RuleError("TURN_ALREADY_TAKEN", "turn already taken this month");
  const turnId = newId();
  const seqRow = db
    .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM turns WHERE campaign_id = ?")
    .get(campaignId) as { seq: number };
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES (?, ?, ?, ?, 1, '[]')`,
  ).run(turnId, campaignId, campaign.month, seqRow.seq);
  return turnId;
}
```

`util.ts` already imports `RuleError`. If it does not, import it from `../domain/types.js`.

In `openParallelTurn`, immediately after the block that throws `TURN_ALREADY_OPEN`, and before `missing` is computed, load the campaign and throw when this month already has a row:

```ts
const campaign = requireCampaign(db, input.campaignId);
const taken = db
  .prepare("SELECT id FROM turns WHERE campaign_id = ? AND month = ? LIMIT 1")
  .get(input.campaignId, campaign.month);
if (taken) throw new RuleError("TURN_ALREADY_TAKEN", "turn already taken this month");
```

Delete the later `const campaign = requireCampaign(db, input.campaignId)` in that same function so the campaign is loaded once. The insert still uses `campaign.month`.

Add `{ type: "skip" }` to the `FactionAction` union in `src/services/turn.ts`.

At the start of the `factionAction` transaction, after the faction/campaign check and before `ensureOpenTurn`:

```ts
if (input.action.type === "skip") {
  const turn = db
    .prepare("SELECT id FROM turns WHERE campaign_id = ? AND open = 1 LIMIT 1")
    .get(input.campaignId) as { id: string } | undefined;
  if (!turn) throw new RuleError("ENTITY_NOT_FOUND", "no open turn");
  const queuedPlan = db
    .prepare(
      `SELECT id FROM write_queue
       WHERE turn_id = ? AND unit_type = 'faction' AND unit_id = ? AND kind = 'plan' AND status = 'queued'
       LIMIT 1`,
    )
    .get(turn.id, input.factionId);
  if (queuedPlan) throw new RuleError("PLAN_ALREADY_QUEUED", "plan already queued");
  const prior = db
    .prepare(
      `SELECT type FROM actions WHERE turn_id = ? AND actor_type = 'faction' AND actor_id = ?`,
    )
    .all(turn.id, input.factionId) as { type: string }[];
  const budgeted = new Set([
    "build_strength",
    "enact_change",
    "restore_cohesion",
    "set_theology",
    "attack",
    "extend_interest",
    "aid",
    "remove_interest",
  ]);
  if (prior.some((row) => budgeted.has(row.type))) {
    throw new RuleError("ALREADY_ACTED", "faction already acted");
  }
  if (prior.some((row) => row.type === "skip")) {
    throw new RuleError("FACTION_SKIPPED", "faction skipped this month");
  }
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, outcome)
     VALUES (?, ?, 'skip', 'faction', ?, 'skipped')`,
  ).run(newId(), turn.id, input.factionId);
  return { skipped: true };
}
```

A later `build_strength` after skip is Task 2. This task's skip test only checks the recorded row and a second skip.

- [ ] **Step 4: Run the file**

Run: `npx vitest run test/services/faction-turn-budget.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/util.ts src/services/queue.ts src/services/turn.ts test/services/faction-turn-budget.test.ts
git commit -m "feat: reject a second faction turn in the same month"
```

---

### Task 2: Shared action budget

**Files:**
- Create: `src/services/factionBudget.ts`
- Modify: `src/services/actions.ts` (`runAction`)
- Modify: `src/services/turn.ts` (remove the inline budget count in `factionAction`)
- Modify: `test/services/faction-turn-budget.test.ts`

**Interfaces:**
- Consumes: `requireFaction` from `src/services/util.ts`.
- Produces: `assertFactionBudget(db, turnId, factionId, actionType, targetFactionId?: string): void`.

- [ ] **Step 1: Add the failing budget cases**

Append to `test/services/faction-turn-budget.test.ts`:

```ts
test("one internal action and power external actions, one per target", () => {
  const { db } = world();
  db.prepare("UPDATE factions SET power = 1, cohesion = 1 WHERE id = 'a'").run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin) VALUES ('fa', 'a', 'Envoy', 'cultural', 'native')`,
  ).run();
  const first = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "build_strength", forcedRoll: 6 },
  });
  expect(first.ok).toBe(true);
  const secondInternal = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "restore_cohesion" },
  });
  expect(secondInternal.ok).toBe(false);
  if (!secondInternal.ok) {
    expect(secondInternal.error).toEqual({
      code: "INTERNAL_BUDGET",
      message: "internal action already taken",
      details: {},
    });
  }
  const external = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: {
      type: "extend_interest",
      targetFactionId: "b",
      attackerFeatureId: "fa",
      willing: true,
    },
  });
  expect(external.ok).toBe(true);
  const repeated = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: {
      type: "remove_interest",
      targetFactionId: "b",
      willing: true,
    },
  });
  expect(repeated.ok).toBe(false);
  if (!repeated.ok) {
    expect(repeated.error.code).toBe("DUPLICATE_EXTERNAL_TARGET");
    expect(repeated.error.message).toBe("already acted on target");
  }
});

test("a free steal does not consume the external budget", () => {
  const { db } = world();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('edge', 'a', 'b', 2, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin) VALUES ('fa', 'a', 'Envoy', 'cultural', 'native')`,
  ).run();
  expect(
    factionAction(db, {
      campaignId: "c1",
      factionId: "a",
      action: { type: "idle" },
    }).ok,
  ).toBe(true);
  expect(
    factionAction(db, {
      campaignId: "c1",
      factionId: "a",
      action: {
        type: "extend_interest",
        targetFactionId: "b",
        attackerFeatureId: "fa",
        willing: true,
      },
    }).ok,
  ).toBe(true);
  const { spendInterest } = require("../../src/services/turn.js") as typeof import("../../src/services/turn.js");
  const stolen = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "a",
    toFactionId: "b",
    timing: "steal",
    modifier: 1,
  });
  expect(stolen.ok).toBe(true);
  const exhausted = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "aid", targetFactionId: "b", amount: 1 },
  });
  expect(exhausted.ok).toBe(false);
  if (!exhausted.ok) expect(exhausted.error.code).toBe("EXTERNAL_BUDGET");
});
```

Use a real import of `spendInterest` at the top of the file instead of `require`. Power 1 allows one external action, so the aid after `extend_interest` is the exhausted budget. The steal in between must succeed.

Also append the already-acted skip case:

```ts
test("a budgeted action after skip returns FACTION_SKIPPED", () => {
  const { db } = world();
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "idle" } }).ok,
  ).toBe(true);
  expect(
    factionAction(db, { campaignId: "c1", factionId: "a", action: { type: "skip" } }).ok,
  ).toBe(true);
  const blocked = factionAction(db, {
    campaignId: "c1",
    factionId: "a",
    action: { type: "build_strength" },
  });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.error).toEqual({
      code: "FACTION_SKIPPED",
      message: "faction skipped this month",
      details: {},
    });
  }
});

`build_strength` with `forcedRoll: 6` on Power 1 (d6) and Trouble 0 succeeds. No Interest edge points at `a`, so no offer opens.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/faction-turn-budget.test.ts -t "FACTION_SKIPPED"`

Expected: FAIL. `build_strength` after skip still runs, because the budget helper does not yet treat a `skip` row as blocking.

- [ ] **Step 3: Write the helper and call it from `runAction`**

Create `src/services/factionBudget.ts`:

```ts
import type Database from "better-sqlite3";
import { RuleError } from "../domain/types.js";
import { requireFaction } from "./util.js";

const INTERNAL_ACTIONS = new Set([
  "build_strength",
  "enact_change",
  "restore_cohesion",
  "set_theology",
]);
const EXTERNAL_ACTIONS = new Set(["attack", "extend_interest", "aid", "remove_interest"]);

export function assertFactionBudget(
  db: Database.Database,
  turnId: string,
  factionId: string,
  actionType: string,
  targetFactionId?: string,
): void {
  const faction = requireFaction(db, factionId);
  const prior = db
    .prepare(
      `SELECT type, target_id FROM actions WHERE turn_id = ? AND actor_type = 'faction' AND actor_id = ?`,
    )
    .all(turnId, factionId) as { type: string; target_id: string | null }[];
  if (prior.some((row) => row.type === "skip")) {
    throw new RuleError("FACTION_SKIPPED", "faction skipped this month");
  }
  if (INTERNAL_ACTIONS.has(actionType)) {
    if (prior.some((row) => INTERNAL_ACTIONS.has(row.type))) {
      throw new RuleError("INTERNAL_BUDGET", "internal action already taken");
    }
  }
  if (EXTERNAL_ACTIONS.has(actionType)) {
    const externalCount = prior.filter((row) => EXTERNAL_ACTIONS.has(row.type)).length;
    if (externalCount >= faction.power) {
      throw new RuleError("EXTERNAL_BUDGET", "external action budget exhausted");
    }
    if (
      targetFactionId &&
      prior.some((row) => row.target_id === targetFactionId && EXTERNAL_ACTIONS.has(row.type))
    ) {
      throw new RuleError("DUPLICATE_EXTERNAL_TARGET", "already acted on target");
    }
  }
}
```

In `runAction`, after the faction is loaded and the turn id is known, and before the `if (input.type === "build_strength")` chain:

```ts
const targetFactionId =
  "targetFactionId" in input ? input.targetFactionId : undefined;
assertFactionBudget(db, turnId, faction.id, input.type, targetFactionId);
```

Import `assertFactionBudget` from `./factionBudget.js`.

Delete the budget-counting block in `factionAction` (the `prior` / `isInternal` / `isExternal` section). Keep the queued-plan check and the `idle` return. `runAction` now owns the budget, including `FACTION_SKIPPED`.

`spend_interest` rows are not in either set, so they do not count. Do not add them.

- [ ] **Step 4: Run the budget file**

Run: `npx vitest run test/services/faction-turn-budget.test.ts`

Expected: PASS, including skip-blocks and the free steal.

- [ ] **Step 5: Commit**

```bash
git add src/services/factionBudget.ts src/services/actions.ts src/services/turn.ts test/services/faction-turn-budget.test.ts
git commit -m "feat: share the faction action budget"
```

---

### Task 3: Kept-face clamp and free steal

**Files:**
- Modify: `src/rules/actions.ts`
- Modify: `test/rules/actions.test.ts`
- Modify: `src/services/turn.ts` (`spendInterest`)
- Modify: `test/services/turn.test.ts`

**Interfaces:**
- Produces: `movedKeptFace(input: { kept: number; dieMax: number; direction: "raise" | "lower"; requested: number }): { kept: number; spent: number }`.
- `spendInterest` stops calling `interestModifier`. `before` and `after` with no window return `NOT_PENDING`. Free `steal` is unchanged in transfer math.

- [ ] **Step 1: Write the failing clamp test and retarget the no-window spends**

Append to `test/rules/actions.test.ts`:

```ts
import { movedKeptFace } from "../../src/rules/actions.js";

test("movedKeptFace clamps to 1 and the die maximum and reports points that moved", () => {
  expect(movedKeptFace({ kept: 3, dieMax: 6, direction: "raise", requested: 2 })).toEqual({
    kept: 5,
    spent: 2,
  });
  expect(movedKeptFace({ kept: 5, dieMax: 6, direction: "raise", requested: 4 })).toEqual({
    kept: 6,
    spent: 1,
  });
  expect(movedKeptFace({ kept: 2, dieMax: 6, direction: "lower", requested: 5 })).toEqual({
    kept: 1,
    spent: 1,
  });
  expect(movedKeptFace({ kept: 6, dieMax: 6, direction: "raise", requested: 1 }).spent).toBe(0);
});
```

Merge the import into the existing import line instead of adding a second import.

In `test/services/turn.test.ts`, replace the body of `spendInterest before reduces interest without charging dominion` so it expects failure:

```ts
test("spendInterest before with no window returns NOT_PENDING", () => {
  const db = spendInterestFixture();
  const result = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "spender",
    toFactionId: "target",
    timing: "before",
    modifier: 2,
    direction: "raise",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toEqual({
      code: "NOT_PENDING",
      message: "no interest window",
      details: {},
    });
  }
  const points = (
    db.prepare("SELECT points FROM interests WHERE from_faction_id = 'spender'").get() as {
      points: number;
    }
  ).points;
  expect(points).toBe(5);
});
```

Replace `spendInterest after with short dominion leaves interest unchanged` with the same `NOT_PENDING` expectation for `timing: "after"`, `direction: "lower"`, `modifier: 2`. Interest points stay 5. Dominion stays 1.

Leave the steal test and the no-open-turn test as they are.

The `spendInterest` input type must accept optional `direction` or this test will not typecheck. Add the field in Step 3 before running the typecheck. Vitest strips types, so the test can fail on the assertion first.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/rules/actions.test.ts test/services/turn.test.ts -t "movedKeptFace|no window|NOT_PENDING|short dominion"`

Expected: FAIL. `movedKeptFace` is not exported. The old before-spend still debits Interest.

- [ ] **Step 3: Implement the clamp and the no-window rule**

Add to `src/rules/actions.ts`:

```ts
export function movedKeptFace(input: {
  kept: number;
  dieMax: number;
  direction: "raise" | "lower";
  requested: number;
}): { kept: number; spent: number } {
  if (!Number.isInteger(input.requested) || input.requested < 1) {
    throw new RuleError("MODIFIER_EXCEEDS_DIE", "modifier must be at least 1");
  }
  const raw = input.direction === "raise" ? input.kept + input.requested : input.kept - input.requested;
  const kept = Math.min(input.dieMax, Math.max(1, raw));
  return { kept, spent: Math.abs(kept - input.kept) };
}
```

Do not change `interestModifier`.

On `spendInterest`'s input type, add `direction?: "raise" | "lower"`.

Inside the transaction, delete the `interestModifier(dieMax, input.modifier)` call. Replace the start of the transaction body, after the faction is loaded and the open turn is required, with:

```ts
if (!Number.isInteger(input.modifier) || input.modifier < 1) {
  throw new RuleError("MODIFIER_EXCEEDS_DIE", "modifier must be at least 1");
}
const window = loadOpenInterestWindow(db, turn.id);
if (input.timing === "before" || input.timing === "after") {
  if (!input.direction) {
    throw new RuleError("FILL_INCOMPLETE", "direction must be raise or lower");
  }
  if (!window || window.phase !== input.timing || window.subjectFactionId !== input.toFactionId) {
    throw new RuleError("NOT_PENDING", "no interest window");
  }
}
if (window && (window.phase !== input.timing || window.subjectFactionId !== input.toFactionId)) {
  throw new RuleError("NOT_PENDING", "no interest window");
}
```

`loadOpenInterestWindow` arrives in Task 4. For this task, add a local function in `turn.ts` that returns `undefined` always:

```ts
function loadOpenInterestWindow(
  _db: Database.Database,
  _turnId: string,
): { phase: "steal" | "before" | "after"; subjectFactionId: string } | undefined {
  return undefined;
}
```

Task 4 replaces it with the real reader. With it returning `undefined`, `before` and `after` throw `NOT_PENDING`, and free `steal` still runs the existing transfer block.

Keep the existing steal transfer, the Interest debit, and the `spend_interest` insert for `timing === "steal"`. Do not debit Interest for `before` or `after` in this task; those timings throw first.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/rules/actions.test.ts test/services/turn.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/actions.ts test/rules/actions.test.ts src/services/turn.ts test/services/turn.test.ts
git commit -m "feat: clamp interest shifts and require a window to change a roll"
```

---

### Task 4: Interest offers, pass, and re-offer

**Files:**
- Create: `src/services/interestWindow.ts`
- Create: `test/services/spend-interest-reaction.test.ts`
- Modify: `src/services/turn.ts`
- Modify: `src/services/queue.ts`
- Modify: `src/services/actions.ts`
- Modify: `src/mcp/register.ts`

**Interfaces:**
- Consumes: `assertFactionBudget`, `runAction`, `movedKeptFace`, `newId`, `requireFaction`, `DIE_BY_POWER`.
- Produces:
  - `beginInterestWindow(db, input): { pending: true; code: "PENDING_INTEREST"; windowId: string; phase: "steal" | "before" | "after"; subjectFactionId: string; eligibleFactionIds: string[]; actionId: string | null } | { pending: false; result: unknown }`
  - `passInterest(db, input: { campaignId: string; fromFactionId: string; toFactionId: string }): ServiceResult<unknown>`
  - `loadOpenInterestWindow(db, turnId)` used by `spendInterest`
  - `RunActionInput.interestDeltas?: Record<string, number>`

- [ ] **Step 1: Write the failing offer tests**

Create `test/services/spend-interest-reaction.test.ts` with a fixture of campaign `c1`, month 1, factions `actor` (Power 1, cohesion 1, Dominion 4), `watcher` (Power 1, Dominion 4), and `other` (Power 1, Dominion 4). Give `watcher` and `other` each an Interest edge of 3 points into `actor`, nature `rivalry`. Open a turn row `turn1`. Export nothing.

Tests:

```ts
test("before and after with no window return NOT_PENDING", () => {
  const db = reactionFixture();
  for (const timing of ["before", "after"] as const) {
    const result = spendInterest(db, {
      campaignId: "c1",
      fromFactionId: "watcher",
      toFactionId: "actor",
      timing,
      direction: "raise",
      modifier: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "NOT_PENDING",
        message: "no interest window",
        details: {},
      });
    }
  }
});

test("a faction without interest, or one that already spent, is not offered", () => {
  const db = reactionFixture();
  db.prepare("DELETE FROM interests WHERE from_faction_id = 'other'").run();
  const pending = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "build_strength", forcedRoll: 1 },
  });
  expect(pending.ok).toBe(true);
  if (!pending.ok) return;
  const data = pending.data as {
    code: string;
    eligibleFactionIds: string[];
    phase: string;
    subjectFactionId: string;
  };
  expect(data.code).toBe("PENDING_INTEREST");
  expect(data.phase).toBe("before");
  expect(data.subjectFactionId).toBe("actor");
  expect(data.eligibleFactionIds).toEqual(["watcher"]);
});

test("a spend re-opens the offer for a faction that already passed", () => {
  const db = reactionFixture();
  const first = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "build_strength", forcedRoll: 1 },
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const passed = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "other",
    toFactionId: "actor",
  });
  expect(passed.ok).toBe(true);
  const spent = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "before",
    direction: "raise",
    modifier: 1,
  });
  expect(spent.ok).toBe(true);
  if (!spent.ok) return;
  const data = spent.data as { code: string; eligibleFactionIds: string[] };
  expect(data.code).toBe("PENDING_INTEREST");
  expect(data.eligibleFactionIds).toEqual(["other"]);
  expect(data.eligibleFactionIds).not.toContain("watcher");
});
```

`build_strength` has no Dominion cost, so the first phase is `before` on `actor`. Trouble is 0. `forcedRoll: 1` would succeed (`1 > 0`) once the windows pass; these tests stop at the offer.

`eligibleFactionIds` order is the `interests` row order. Insert `watcher` before `other` so the equality checks hold. `passInterest` of `other` leaves `watcher` still eligible, so the pass result stays pending. Then `watcher` spends and `other` is offered again.

A second test in this file, added in this same step, covers the once-per-target rule on free steal and the empty stockpile. Those do not need a window:

```ts
test("steal from an empty stockpile yields no dominion and spends the interest", () => {
  const db = reactionFixture();
  db.prepare("UPDATE factions SET dominion = 0 WHERE id = 'actor'").run();
  db.prepare("UPDATE turns SET open = 1 WHERE id = 'turn1'").run();
  const result = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "steal",
    modifier: 2,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toMatchObject({ stolenDominion: 0, spent: 2, timing: "steal" });
  const watcher = db.prepare("SELECT dominion FROM factions WHERE id = 'watcher'").get() as {
    dominion: number;
  };
  const actor = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as {
    dominion: number;
  };
  expect(watcher.dominion).toBe(4);
  expect(actor.dominion).toBe(0);
  const points = db
    .prepare("SELECT points FROM interests WHERE from_faction_id = 'watcher'")
    .get() as { points: number };
  expect(points.points).toBe(1);
  const again = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "steal",
    modifier: 1,
  });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error.code).toBe("INTEREST_ALREADY_SPENT");
  const other = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "other",
    toFactionId: "actor",
    timing: "steal",
    modifier: 1,
  });
  expect(other.ok).toBe(true);
});
```

The fixture must leave the turn open. Do not close it in `reactionFixture`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/spend-interest-reaction.test.ts`

Expected: FAIL. `passInterest` is not exported. `factionAction` build_strength does not return `PENDING_INTEREST`.

- [ ] **Step 3: Implement the window**

Create `src/services/interestWindow.ts` with these exported functions. Use one transaction per public function only when the caller is not already inside one. `beginInterestWindow`, `passInterest`, and `applyWindowSpend` assume the caller holds the transaction. `passInterest` in `turn.ts` opens the transaction itself.

Eligibility:

```ts
export function eligibleSpenders(db: Database.Database, turnId: string, subjectFactionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT i.from_faction_id AS id
       FROM interests i
       WHERE i.to_faction_id = ? AND i.points >= 1 AND i.from_faction_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM actions a
           WHERE a.turn_id = ? AND a.type = 'spend_interest'
             AND a.actor_id = i.from_faction_id AND a.target_id = ?
         )
       ORDER BY i.id ASC`,
    )
    .all(subjectFactionId, subjectFactionId, turnId, subjectFactionId) as { id: string }[];
  return rows.map((row) => row.id);
}
```

Phase list for `build_strength`, `aid`, `restore_cohesion`, and `enact_change`: steal on the actor only when `dominionCost > 0`, then `before` on the actor, then `roll`, then `after` on the actor, then `resolve`. Attack and extend: steal never (cost 0); `before`/`after` on the actor, and on the defender only when `resolveDefenderFeature` returns a feature. `remove_interest` with `willing: true`: no window. Without `willing`: both sides roll. `idle`, `skip`, `set_theology`: no window.

`beginInterestWindow` with `mode: "pause"` walks the queue. On a steal/before/after step whose eligible list is non-empty, it inserts the `write_queue` row (`kind = 'interest'`, `status = 'queued'`, `unit_id` = subject) and returns the pending object. On `roll`, it calls `runAction` with `interestDeltas` built by summing `beforeDeltas` per subject, stores `actionId` from the insert (query the newest action for that actor on the turn), and continues. On `resolve`, it marks the interest row `done` if one exists and returns `{ pending: false, result }`.

`mode: "pass"` does not insert a row and does not return pending. At each offer step it treats every eligible id as passed, so it falls through to `runAction` and returns that result. Standing orders inside `runAction` are unchanged.

`passInterest` loads the queued interest row for the open turn. If `toFactionId` is not the payload subject, or `fromFactionId` is not eligible, or that id is already in `passedFactionIds`, throw `NOT_PENDING` / `no interest window`. Append the id. If any eligible id is missing from `passedFactionIds`, save the payload and return pending with the remaining ids. If all have passed, advance the cursor to the next step and continue with the same walker as `beginInterestWindow`.

`applyWindowSpend` is what `spendInterest` calls when a window matches. For `before`: debit `modifier` Interest, insert `spend_interest`, push `{ subjectFactionId, delta }` where delta is `modifier` or `-modifier`, clear `passedFactionIds`, recompute eligible, and either return pending or advance. For `steal` inside the window: keep the transfer (`stolen = min(modifier, target.dominion)`), debit the full `modifier` Interest, insert the action, then the same re-offer. For `after`: Task 6 fills consequence follow-through. In this task, `after` calls `movedKeptFace` on the subject's stored kept face, throws `MODIFIER_EXCEEDS_DIE` / `roll cannot move past the die` when `spent === 0`, otherwise debits `spent` Interest and `spent` Dominion, writes `kept` and recomputed `total` (`bonus` is 0 when `kept === 1`, otherwise the previous bonus), and re-offers. Do not change the action outcome in this task.

Replace `loadOpenInterestWindow` in `turn.ts` with a re-export from `interestWindow.ts` that reads the queued row.

`beginInterestWindow` calls `assertFactionBudget` before it inserts a row and before it calls `runAction`. An action that is already over budget, or a budgeted action after `skip`, throws and does not open a window. `factionAction`, after the idle return, calls `beginInterestWindow` with `mode: "pause"` instead of calling `runAction` directly. If `pending` is false, return `result`. Reject a caller-supplied `interestDeltas` key on the action object with `FILL_INCOMPLETE` / `forbidden action field: interestDeltas` before the window starts.

`applyFactionPlan` calls `beginInterestWindow` with the mode threaded from `applyWriteQueue`. Default mode is `"pause"`. `runFactionTurn` passes `interestMode: "pass"` into both `applyWriteQueue` calls.

`applyWriteQueue`, before the queued-reaction check:

```ts
const interest = queuedInterest(db, turn.id);
if (interest) return { paused: true, interest };
```

`queuedInterest` returns the pending fields, not a `defenderUnit`. `applyUnitsInOrder`, when `beginInterestWindow` returns pending, returns `{ paused: true, interest }` without enqueueing a defender reaction and without marking the plan `done`. Leave the plan `applying`.

`RunActionInput` gains optional `interestDeltas`. In `runBuildStrength` and the contest rollers, after the natural roll is produced, if `interestDeltas[factionId]` is a non-zero number, apply it with `movedKeptFace` (one direction for the whole delta) and use the new `kept` as the compared face. Trouble success becomes `kept > trouble` (or `kept <= trouble` when inverted). Contest totals use the adjusted kept face plus the existing bonus rule.

Add `pass_interest` in `src/mcp/register.ts` next to `spend_interest`, calling `passInterest(db, a)`. Add `direction: z.enum(["raise", "lower"]).optional()` to the `spend_interest` schema. Set the descriptions to the sentences in the spec's Tools section.

- [ ] **Step 4: Run the offer tests and the existing turn tests**

Run: `npx vitest run test/services/spend-interest-reaction.test.ts test/services/turn.test.ts test/services/task13-review.test.ts test/store/lock.test.ts`

Expected: PASS. `task13-review` attacks a defender with no feature, and nobody holds Interest in the attacker, so no window opens. If a test newly returns `PENDING_INTEREST`, pass that window with `passInterest` until the previous assertion holds. Do not delete the Interest edge to silence it.

- [ ] **Step 5: Commit**

```bash
git add src/services/interestWindow.ts src/services/turn.ts src/services/queue.ts src/services/actions.ts src/mcp/register.ts test/services/spend-interest-reaction.test.ts
git commit -m "feat: offer spend interest and re-offer after a spend"
```

---

### Task 5: A steal that leaves the action unpaid fails it

**Files:**
- Modify: `src/services/interestWindow.ts`
- Modify: `test/services/spend-interest-reaction.test.ts`

**Interfaces:**
- Consumes: `eligibleSpenders`, the steal phase, `factionProjectCost`, `restoreCohesionCost`.
- Produces: an action row `outcome = 'failed'` when Dominion after the steal window is below the cost. No roll. The budget slot is consumed.

- [ ] **Step 1: Write the failing test**

Append:

```ts
test("a steal that leaves the actor short fails the dominion action", () => {
  const db = reactionFixture();
  db.prepare("UPDATE factions SET dominion = 1 WHERE id = 'actor'").run();
  const opened = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "aid", targetFactionId: "watcher", amount: 1 },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.data).toMatchObject({ code: "PENDING_INTEREST", phase: "steal", subjectFactionId: "actor" });
  const stolen = spendInterest(db, {
    campaignId: "c1",
    fromFactionId: "watcher",
    toFactionId: "actor",
    timing: "steal",
    modifier: 1,
  });
  expect(stolen.ok).toBe(true);
  if (!stolen.ok) return;
  expect(stolen.data).toMatchObject({ stolenDominion: 1 });
  const passed = passInterest(db, {
    campaignId: "c1",
    fromFactionId: "other",
    toFactionId: "actor",
  });
  expect(passed.ok).toBe(true);
  if (!passed.ok) return;
  expect(passed.data).toMatchObject({ failed: true, reason: "insufficient dominion" });
  const action = db.prepare("SELECT type, outcome, roll_id, dominion_delta FROM actions WHERE type = 'aid'").get() as {
    type: string;
    outcome: string;
    roll_id: string | null;
    dominion_delta: number;
  };
  expect(action).toEqual({ type: "aid", outcome: "failed", roll_id: null, dominion_delta: 0 });
  const actor = db.prepare("SELECT dominion FROM factions WHERE id = 'actor'").get() as { dominion: number };
  expect(actor.dominion).toBe(0);
  const again = factionAction(db, {
    campaignId: "c1",
    factionId: "actor",
    action: { type: "aid", targetFactionId: "other", amount: 1 },
  });
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error.code).toBe("EXTERNAL_BUDGET");
});
```

Aid amount 1 with Dominion 1 opens a steal window (cost is 1, which is greater than 0). Watcher steals 1. Other passes. Actor Dominion is 0, which is below 1, so the aid fails and consumes the only external slot (Power 1).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/spend-interest-reaction.test.ts -t "leaves the actor short"`

Expected: FAIL. The aid still runs, or the pass continues into a roll.

- [ ] **Step 3: Fail the action at the start of the roll step**

In the walker, when the step `kind` is `roll` and the pending action's Dominion cost is greater than the actor's current Dominion:

```ts
db.prepare(
  `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, target_type, target_id, outcome, dominion_delta)
   VALUES (?, ?, ?, 'faction', ?, ?, ?, 'failed', 0)`,
).run(
  newId(),
  turnId,
  action.type,
  actorId,
  "targetFactionId" in action ? "faction" : null,
  "targetFactionId" in action ? action.targetFactionId : null,
);
```

Mark the interest row `done`. Return `{ pending: false, result: { failed: true, reason: "insufficient dominion" } }`. Do not call `runAction`. Do not walk `after` steps.

- [ ] **Step 4: Run the reaction tests**

Run: `npx vitest run test/services/spend-interest-reaction.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/interestWindow.ts test/services/spend-interest-reaction.test.ts
git commit -m "feat: fail a dominion action that a steal leaves unpaid"
```

---

### Task 6: The outcome follows the new face

**Files:**
- Modify: `src/services/actions.ts`
- Modify: `src/services/interestWindow.ts`
- Modify: `test/services/spend-interest-reaction.test.ts`

**Interfaces:**
- Produces: `followRolledAction(db, actionId: string): { featureNotRestored?: true }`. Called from the `after` branch of `applyWindowSpend` after `kept` and `total` are saved, only when the contest winner or the trouble success bit changed.

- [ ] **Step 1: Write the failing outcome tests**

Append three tests.

Victory. Two features, equal Power 1, no problems, defender cohesion 1 so `chooseDefense` takes the problem (cohesion loss would collapse; problem damage is 1 and Trouble 0 does not). `forcedAttackerRoll: 2`, `forcedDefenderRoll: 4`. Give the watcher 4 Interest in the attacker and 4 Dominion. Do not give the attacker an Interest edge into the defender, so the defender's windows are empty. Pass the attacker's before window. After the roll the outcome is `defender_win` and the defender has no problem. The after window on the attacker offers the watcher. `spend_interest` `after` / `raise` / `modifier: 3` moves kept from 2 to 5, which beats the defender's 4. Expect `attacker_win`, a problem row on the defender, watcher Interest down by 3, and watcher Dominion down by 3.

Hinder. Same layout with `forcedAttackerRoll: 5` and `forcedDefenderRoll: 3`, so the attacker wins and a problem is created before the after window. Watcher raises nothing; they `lower` the attacker by 3. Kept becomes 2, which loses to 3. Expect `defender_win`, the created problem gone, watcher Dominion down by 3.

Roll change. `build_strength`, one problem worth 2 points on the actor, `forcedRoll: 2` (not greater than Trouble 2, so failure). Watcher `after` / `raise` / `modifier: 1`. Expect action outcome `success`, roll `kept` 3, actor Dominion increased by `ceil(1 / 2)` which is 1, watcher Interest down by 1, watcher Dominion down by 1.

Each test passes the before window, then spends on the after window, and passes any remaining eligible faction so the call returns the finished action rather than another pending offer. With a single watcher, the after spend has an empty re-offer list and the walker finishes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/spend-interest-reaction.test.ts -t "victory|hinder|roll change"`

Expected: FAIL. The outcome string is still the pre-spend result, or Dominion was not granted.

- [ ] **Step 3: Store the effect and follow it**

When `runAttack`, `runBuildStrength`, `runAid`, `runRestoreCohesion`, `runEnactChange`, `runExtendInterest`, and `runRemoveInterest` persist a roll, add an `effect` object to that payload:

- Attack attacker win: `{ kind: "attack", defense, problemId, createdProblem, damage }`. `createdProblem` is true when this call inserted the problem row.
- Attack defender win: `{ kind: "attack", defense: null }`.
- Build strength: `{ kind: "build_strength", granted }` where `granted` is the Dominion added, or 0.
- Aid: `{ kind: "aid", amount, success }`.
- Restore cohesion: `{ kind: "restore_cohesion", raised: boolean }`.
- Enact change: `{ kind: "enact_change", success, inverted, featureId, partId, problemId, createdProblem, culpritId }`. Use null for ids this call did not write.
- Extend: `{ kind: "extend_interest", added: boolean }`.
- Remove: `{ kind: "remove_interest", removed: boolean, nature }`.

Export `followRolledAction`. It re-reads the roll. Contest: recompute the winner with `resolveContest` from the stored totals and both factions' Power. Trouble: success is `kept > trouble`, or `kept <= trouble` when `effect.inverted` is true.

Attack defender to attacker: run the same defense path as `applyAttackDefense` and store the new `effect`. Attacker to defender: if `defense` was `cohesion`, add 1 cohesion. If `defense` was `problem`, subtract `damage` from `problemId` and delete the row when `createdProblem` is true and points reach 0. If `defense` was `sacrifice`, leave the feature deleted and set `featureNotRestored: true` on the return value. Set the action outcome to the new winner.

Build strength failure to success: add `ceil(power / 2)` Dominion, set `dominion_delta`, set `effect.granted`. Success to failure: subtract `effect.granted` and set `dominion_delta` to 0.

Aid: Dominion has already left the actor. Failure to success: add `amount` to the target. Success to failure: subtract `min(amount, target.dominion)` from the target. Set outcome `success` or `failure`.

Restore cohesion: Dominion stays spent. Apply ±1 cohesion. Do not exceed Power and do not go below 0. If a failure-to-success raise cannot increase cohesion, leave outcome `failure`.

Enact change: Dominion stays spent. Apply or reverse the feature, part, backlash point, solve point, and culprit point named on `effect`, using the same writes `runEnactChange` uses. Reinsert a deleted problem with the stored id, text, domain, and position.

Extend: attacker win adds one point unless the edge is at `interestCap`. If it is at the cap, leave outcome `defender_win` and add nothing. Defender win removes the point this action added and deletes the edge at 0.

Remove: attacker win removes one point. Defender win puts that point back on `effect.nature`.

Call `followRolledAction` at the end of the `after` branch, after the roll payload is saved, only when the winner or success bit differs from the action's current outcome. Return `featureNotRestored` on the spend report when the function returns it.

- [ ] **Step 4: Run the reaction tests and the turn suite**

Run: `npx vitest run test/services/spend-interest-reaction.test.ts test/services/turn.test.ts test/services/faction-turn-budget.test.ts`

Expected: PASS.

Then run: `npx vitest run`

Expected: PASS. Fix any older test that now pauses by passing the window, as Task 4 said.

- [ ] **Step 5: Commit**

```bash
git add src/services/actions.ts src/services/interestWindow.ts test/services/spend-interest-reaction.test.ts
git commit -m "feat: apply the outcome after an interest-shifted roll"
```

---

### Task 7: Living docs and play copy

**Files:**
- Modify: `docs/design/overview.md`
- Modify: `docs/design/current-engine.md`
- Modify: `docs/design/glossary.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

**Interfaces:**
- Consumes: the sentences in the spec section **Docs and play copy**. Copy them verbatim.
- Produces: no new exports.

- [ ] **Step 1: Edit the five files**

Apply each replacement in the spec's **Docs and play copy** section. Do not leave the two deleted overview bullets. Do not add links in `user/` that point outside `user/`.

- [ ] **Step 2: Commit**

```bash
git add docs/design/overview.md docs/design/current-engine.md docs/design/glossary.md user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: describe faction turn budgets and spend interest"
```

There is no test step. Do not add a test that reads these files.

---

## Self-review

Spec coverage:

- Budget, one per target, free steal: Task 2.
- Crisis choice (`TURN_ALREADY_TAKEN`) and the next month: Task 1.
- Slow-faction skip, including not opening a turn: Task 1 and Task 2.
- Empty steal, once per target, a different target: Task 4.
- Offers, pass, re-offer, ineligible factions: Task 4.
- Unpaid action after a steal: Task 5.
- Lost attack becomes a victory, hinder, trouble roll change: Task 6.
- Play and director copy, living docs: Task 7.
- `run_faction_turn` passes offers: Task 4.
- Standing orders, write lock, `set_theology`, auto-advance: untouched, matching the spec's out-of-scope list.

Placeholder scan: no TBD, TODO, or "write tests for the above" without the test body. Task 4's window walker is specified step by step; Task 6 names the `effect` payload per action.

Type consistency: `PENDING_INTEREST` fields, `movedKeptFace`, `beginInterestWindow`, `passInterest`, `followRolledAction`, and `assertFactionBudget` use the same names in every task.
