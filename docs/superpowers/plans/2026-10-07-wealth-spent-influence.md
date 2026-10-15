# wealthSpent Influence Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spending Wealth on a change buys Influence-equivalent coverage and leaves the hero's Influence pool unchanged except for the explicit `influence` argument.

**Architecture:** `commitResources` pools each `wealthSpent` offer on the change and calls `influenceFromWealth` on that total, with no `want`. The bought delta is stored on that hero's `change_commitments.influence`, which `coveredOnChange` already sums. The Influence pool is debited only by the `influence` argument. `influenceFromWealth` and the MCP handler stay as they are.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5.0.3, zod 4.6.5 (see `package.json`).

## Global Constraints

- `wealthSpent` is the Wealth offered on this call. Omitted and `0` offer no Wealth.
- `commitResources` calls `influenceFromWealth(prior + wealthSpent)` and does not pass `want`.
- `prior` is `COALESCE(SUM(wealth_spent), 0)` on that change before this offer is stored.
- Hero Wealth decreases by `wealthSpent` when the offer is paid.
- The bought delta is `influenceFromWealth(prior + wealthSpent).influence - influenceFromWealth(prior).influence`.
- That delta is added to the paying hero's `change_commitments.influence`, together with the `influence` argument.
- Hero Influence decreases by the `influence` argument only.
- `change_commitments.wealth_spent` increases by `wealthSpent`.
- `coveredOnChange` stays dominion spent plus the sum of commitment influence.
- `influenceFromWealth` is unchanged.
- `commitResources` does not read or write hero Dominion.
- `withdrawInfluence` is unchanged.
- The MCP handler stays `dbTool((a) => commitResources(db, a))`. The `commit_resources` schema is unchanged.
- Checks run in this order: negative influence, negative wealth, wealth greater than the hero's Wealth, influence greater than the hero's Influence.
- `influence < 0` throws `RuleError("INSUFFICIENT_INFLUENCE", "cannot commit negative influence")`.
- `wealthSpent < 0` throws `RuleError("INSUFFICIENT_WEALTH", "cannot commit negative wealth")`.
- `wealthSpent` greater than the hero's Wealth throws `RuleError("INSUFFICIENT_WEALTH", "not enough wealth to commit")`.
- Hero Influence less than the `influence` argument throws `RuleError("INSUFFICIENT_INFLUENCE", "not enough influence to commit")`.
- Those failures write nothing.
- Regression: hero Influence 4, Wealth 6, Dominion 8, `influence: 1`, `wealthSpent: 2` ends at Influence 3, Wealth 4, Dominion 8, `covered` 2, commitment influence 2, `wealth_spent` 2.
- Three heroes each paying `influence: 0` and `wealthSpent: 1` from Wealth 1 end at `covered` 2, commitment influence 1 then 0 then 1, and each Wealth 0.
- A hero with Influence 5 and Wealth 10 who pays `wealthSpent: 4`, then `influence: 1` and `wealthSpent: 2`, ends at Influence 4, Wealth 4, commitment influence 4, `wealth_spent` 6.
- Delete the known-gap bullet about `wealthSpent` debiting the hero's Influence pool from `docs/design/overview.md`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

---

## File map

- Create: `test/services/wealth-spent.test.ts` — regression, pooled triangle, continuing pool, unpaid offers, omitted offer.
- Modify: `src/services/change.ts` — the `wealthSpent` block inside `commitResources`.
- Modify: `docs/design/overview.md` — delete the `wealthSpent` known-gap bullet.

`src/rules/wealth.ts`, `src/services/util.ts` (`coveredOnChange`), `withdrawInfluence`, and `src/mcp/register.ts` stay as they are.

---

### Task 1: Pool wealthSpent and add the bought coverage

**Files:**
- Create: `test/services/wealth-spent.test.ts`
- Modify: `src/services/change.ts` (`commitResources`, the hero load through the Influence update)

**Interfaces:**
- Consumes: `beginChange` and `commitResources` from `src/services/change.ts`; `influenceFromWealth` from `src/rules/wealth.ts`; `openDb` from `src/store/db.ts`; `RuleError` from `src/domain/types.ts`.
- Produces: `commitResources` still returns `ServiceResult<{ status: string; covered: number }>`. No new export. Paid `wealthSpent` follows the Global Constraints.

- [ ] **Step 1: Write the failing test**

Create `test/services/wealth-spent.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { beginChange, commitResources } from "../../src/services/change.js";

function world(
  heroes: { id: string; influence: number; wealth: number; dominion?: number }[],
): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  for (const hero of heroes) {
    db.prepare(
      `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hero.id,
      "c1",
      hero.id,
      1,
      "[]",
      hero.influence,
      hero.dominion ?? 0,
      hero.wealth,
      "none",
    );
  }
  return db;
}

function beginFact(db: Database.Database): string {
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude: "plausible",
    kind: "fact",
  });
  if (!begun.ok) throw new Error(begun.error.message);
  return begun.data.changeId;
}

function heroRow(db: Database.Database, id: string) {
  return db.prepare("SELECT influence, wealth, dominion FROM heroes WHERE id = ?").get(id) as {
    influence: number;
    wealth: number;
    dominion: number;
  };
}

function commitment(db: Database.Database, changeId: string, heroId: string) {
  return db
    .prepare(
      "SELECT influence, wealth_spent FROM change_commitments WHERE change_id = ? AND hero_id = ?",
    )
    .get(changeId, heroId) as { influence: number; wealth_spent: number } | undefined;
}

function changeStatus(db: Database.Database, changeId: string) {
  return db.prepare("SELECT status FROM changes WHERE id = ?").get(changeId) as { status: string };
}

test("wealthSpent adds converted coverage and debits only the explicit influence", () => {
  const db = world([{ id: "sword", influence: 4, wealth: 6, dominion: 8 }]);
  const changeId = beginFact(db);
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 1,
    wealthSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(2);
  expect(committed.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 4, dominion: 8 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 2, wealth_spent: 2 });
});

test("three heroes pooling 1 wealth each buy 2 influence", () => {
  const db = world([
    { id: "a", influence: 0, wealth: 1 },
    { id: "b", influence: 0, wealth: 1 },
    { id: "c", influence: 0, wealth: 1 },
  ]);
  const changeId = beginFact(db);
  let covered = 0;
  for (const heroId of ["a", "b", "c"]) {
    const committed = commitResources(db, { changeId, heroId, influence: 0, wealthSpent: 1 });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    covered = committed.data.covered;
  }
  expect(covered).toBe(2);
  expect(heroRow(db, "a")).toEqual({ influence: 0, wealth: 0, dominion: 0 });
  expect(heroRow(db, "b")).toEqual({ influence: 0, wealth: 0, dominion: 0 });
  expect(heroRow(db, "c")).toEqual({ influence: 0, wealth: 0, dominion: 0 });
  expect(commitment(db, changeId, "a")).toEqual({ influence: 1, wealth_spent: 1 });
  expect(commitment(db, changeId, "b")).toEqual({ influence: 0, wealth_spent: 1 });
  expect(commitment(db, changeId, "c")).toEqual({ influence: 1, wealth_spent: 1 });
});

test("a later wealthSpent continues the same pool", () => {
  const db = world([{ id: "sword", influence: 5, wealth: 10, dominion: 2 }]);
  const changeId = beginFact(db);
  const first = commitResources(db, { changeId, heroId: "sword", influence: 0, wealthSpent: 4 });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.data.covered).toBe(2);
  expect(heroRow(db, "sword")).toEqual({ influence: 5, wealth: 6, dominion: 2 });

  const second = commitResources(db, { changeId, heroId: "sword", influence: 1, wealthSpent: 2 });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.data.covered).toBe(4);
  expect(heroRow(db, "sword")).toEqual({ influence: 4, wealth: 4, dominion: 2 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 4, wealth_spent: 6 });
});

test("omitted wealthSpent and explicit zero leave Wealth unchanged", () => {
  const db = world([
    { id: "omit", influence: 2, wealth: 6, dominion: 1 },
    { id: "zero", influence: 2, wealth: 6, dominion: 1 },
  ]);
  const omittedId = beginFact(db);
  const omitted = commitResources(db, { changeId: omittedId, heroId: "omit", influence: 1 });
  expect(omitted.ok).toBe(true);
  if (!omitted.ok) return;
  expect(omitted.data.covered).toBe(1);
  expect(heroRow(db, "omit")).toEqual({ influence: 1, wealth: 6, dominion: 1 });
  expect(commitment(db, omittedId, "omit")).toEqual({ influence: 1, wealth_spent: 0 });

  const zeroId = beginFact(db);
  const zero = commitResources(db, {
    changeId: zeroId,
    heroId: "zero",
    influence: 1,
    wealthSpent: 0,
  });
  expect(zero.ok).toBe(true);
  if (!zero.ok) return;
  expect(zero.data.covered).toBe(1);
  expect(heroRow(db, "zero")).toEqual({ influence: 1, wealth: 6, dominion: 1 });
  expect(commitment(db, zeroId, "zero")).toEqual({ influence: 1, wealth_spent: 0 });
});

test("unpaid wealth offers write nothing", () => {
  const db = world([{ id: "sword", influence: 2, wealth: 3, dominion: 8 }]);

  const shortId = beginFact(db);
  const short = commitResources(db, {
    changeId: shortId,
    heroId: "sword",
    influence: 1,
    wealthSpent: 4,
  });
  expect(short.ok).toBe(false);
  if (short.ok) return;
  expect(short.error.code).toBe("INSUFFICIENT_WEALTH");
  expect(short.error.message).toBe("not enough wealth to commit");
  expect(heroRow(db, "sword")).toEqual({ influence: 2, wealth: 3, dominion: 8 });
  expect(commitment(db, shortId, "sword")).toBeUndefined();
  expect(changeStatus(db, shortId).status).toBe("pending");

  const negativeId = beginFact(db);
  const negative = commitResources(db, {
    changeId: negativeId,
    heroId: "sword",
    influence: 1,
    wealthSpent: -1,
  });
  expect(negative.ok).toBe(false);
  if (negative.ok) return;
  expect(negative.error.code).toBe("INSUFFICIENT_WEALTH");
  expect(negative.error.message).toBe("cannot commit negative wealth");
  expect(heroRow(db, "sword")).toEqual({ influence: 2, wealth: 3, dominion: 8 });
  expect(commitment(db, negativeId, "sword")).toBeUndefined();

  const bothId = beginFact(db);
  const both = commitResources(db, {
    changeId: bothId,
    heroId: "sword",
    influence: -1,
    wealthSpent: 4,
  });
  expect(both.ok).toBe(false);
  if (both.ok) return;
  expect(both.error.code).toBe("INSUFFICIENT_INFLUENCE");
  expect(both.error.message).toBe("cannot commit negative influence");
  expect(heroRow(db, "sword")).toEqual({ influence: 2, wealth: 3, dominion: 8 });
  expect(commitment(db, bothId, "sword")).toBeUndefined();

  const broke = world([{ id: "pen", influence: 0, wealth: 6 }]);
  const brokeId = beginFact(broke);
  const brokeCommit = commitResources(broke, {
    changeId: brokeId,
    heroId: "pen",
    influence: 1,
    wealthSpent: 1,
  });
  expect(brokeCommit.ok).toBe(false);
  if (brokeCommit.ok) return;
  expect(brokeCommit.error.code).toBe("INSUFFICIENT_INFLUENCE");
  expect(brokeCommit.error.message).toBe("not enough influence to commit");
  expect(heroRow(broke, "pen")).toEqual({ influence: 0, wealth: 6, dominion: 0 });
  expect(commitment(broke, brokeId, "pen")).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/wealth-spent.test.ts`

Expected: FAIL. The regression receives `covered` 1 where the test expects `covered` 2. Today's commitment stores only the explicit `influence` argument.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/change.ts`, replace the hero load and the `wealthSpent` debit inside `commitResources` with the following. Delete `influenceDebit`. Keep the commitment read and the later `coveredOnChange` block.

```ts
      const hero = db
        .prepare("SELECT id, influence, wealth FROM heroes WHERE id = ?")
        .get(input.heroId) as { id: string; influence: number; wealth: number } | undefined;
      if (!hero) throw new RuleError("ENTITY_NOT_FOUND", `hero ${input.heroId} not found`);
      const wealthSpent = input.wealthSpent ?? 0;
      if (input.influence < 0) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "cannot commit negative influence");
      }
      if (wealthSpent < 0) {
        throw new RuleError("INSUFFICIENT_WEALTH", "cannot commit negative wealth");
      }
      if (wealthSpent > hero.wealth) {
        throw new RuleError("INSUFFICIENT_WEALTH", "not enough wealth to commit");
      }
      if (hero.influence < input.influence) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough influence to commit");
      }

      let bought = 0;
      if (wealthSpent > 0) {
        const priorRow = db
          .prepare(
            "SELECT COALESCE(SUM(wealth_spent), 0) AS wealth FROM change_commitments WHERE change_id = ?",
          )
          .get(input.changeId) as { wealth: number };
        const prior = priorRow.wealth;
        bought =
          influenceFromWealth(prior + wealthSpent).influence - influenceFromWealth(prior).influence;
        db.prepare("UPDATE heroes SET wealth = wealth - ? WHERE id = ?").run(
          wealthSpent,
          input.heroId,
        );
      }
      const existing = db
        .prepare(
          "SELECT influence FROM change_commitments WHERE change_id = ? AND hero_id = ?",
        )
        .get(input.changeId, input.heroId) as { influence: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE change_commitments SET influence = influence + ?, wealth_spent = wealth_spent + ?
           WHERE change_id = ? AND hero_id = ?`,
        ).run(input.influence + bought, wealthSpent, input.changeId, input.heroId);
      } else {
        db.prepare(
          `INSERT INTO change_commitments (change_id, hero_id, influence, wealth_spent)
           VALUES (?, ?, ?, ?)`,
        ).run(input.changeId, input.heroId, input.influence + bought, wealthSpent);
      }
      db.prepare("UPDATE heroes SET influence = influence - ? WHERE id = ?").run(
        input.influence,
        input.heroId,
      );
```

The `influenceFromWealth` import already at the top of `src/services/change.ts` stays. Do not change `withdrawInfluence`, `coveredOnChange`, or `src/mcp/register.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/wealth-spent.test.ts test/services/kistelek.test.ts test/services/feature-change-backlash.test.ts test/rules/cost.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/services/wealth-spent.test.ts src/services/change.ts
git commit -m "fix: wealthSpent buys influence coverage"
```

---

### Task 2: Remove the wealthSpent known-gap bullet

**Files:**
- Modify: `docs/design/overview.md` (the Changes, Influence, and Dominion list)

**Interfaces:**
- Consumes: the behavior from Task 1.
- Produces: `docs/design/overview.md` no longer lists the `wealthSpent` Influence-pool gap. No new export.

- [ ] **Step 1: Delete the bullet**

In `docs/design/overview.md`, under **Changes, Influence, and Dominion**, delete this bullet and leave the surrounding bullets in place:

```markdown
- `wealthSpent` debits the hero's Influence pool instead of adding coverage bought with wealth.
```

The Dominion bullet above it and the `record_deed` bullet below it stay.

Do not add a test that reads `docs/design/overview.md` or any other documentation or prompt file.

- [ ] **Step 2: Commit**

```bash
git add docs/design/overview.md
git commit -m "docs: drop the wealthSpent influence-pool gap"
```
