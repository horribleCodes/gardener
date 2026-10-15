# Hero Dominion commit_resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hero Dominion can fully or partially fund a PC change through `commit_resources`, mixed with Influence, without refunding Dominion on withdraw.

**Architecture:** `commitResources` takes optional `dominionSpent`, decrements `heroes.dominion`, and increments `changes.dominion_spent`. `coveredOnChange` already sums that column with commitment Influence. `withdrawInfluence` stays as it is. The MCP handler stays a pass-through; the schema gains the optional integer.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5.0.3, zod 4.6.5 (see `package.json`).

## Global Constraints

- `dominionSpent` is the hero Dominion offered on this call. Omitted and `0` spend none.
- `commitResources` decrements `heroes.dominion` by `paidDominion` and increments `changes.dominion_spent` by the same amount when the offer is paid.
- `coveredOnChange` stays dominion spent plus the sum of commitment influence, and uses the updated `dominion_spent`.
- Hero Influence decreases by the `influence` argument only.
- Wealth conversion is unchanged.
- `withdrawInfluence` is unchanged: it returns commitment Influence, does not refund Dominion, and decays the change when coverage falls below the quote.
- Mixed coverage that then withdraws Influence leaves `dominion_spent` in place.
- Paying the remaining cost after decay, with Influence or Dominion, returns the change to `active` without repaying Dominion already spent.
- Full Dominion coverage of the quote, with deeds and challenges met, sets status `active`. Partial Dominion coverage leaves `pending` when the quote is not reached.
- A feature change that lands on Dominion-only coverage still inserts the Feature and one backlash Problem inside `commitResources`.
- `create_champion` is unchanged.
- The MCP handler stays `dbTool((a) => commitResources(db, a))`. The schema adds optional `dominionSpent: z.number().int()`.
- Checks run in this order: negative influence, negative wealth, negative dominion, wealth greater than the hero's Wealth, influence greater than the hero's Influence, dominion greater than the hero's Dominion.
- `dominionSpent < 0` throws `RuleError("INSUFFICIENT_DOMINION", "cannot commit negative dominion")`.
- Hero Dominion less than `paidDominion` throws `RuleError("INSUFFICIENT_DOMINION", "not enough dominion to commit")`.
- Those failures write nothing.
- Delete the known-gap bullet about hero Dominion on changes from `docs/design/overview.md`.
- Play copy names `dominionSpent` on `commit_resources`. Director copy distinguishes that spend from `create_champion`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

---

## File map

- Create: `test/services/hero-dominion-commit.test.ts` — full, partial, mixed, withdraw, unpaid, omitted, feature landing.
- Modify: `src/services/change.ts` — `commitResources` input, hero load, checks, Dominion debit, coverage argument.
- Modify: `src/mcp/register.ts` — optional `dominionSpent` and the `commit_resources` description.
- Modify: `docs/design/overview.md` — delete the hero-Dominion known-gap bullet.
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` — name `dominionSpent` on `commit_resources`.
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` — distinguish PC change Dominion from `create_champion`.

`createChampion`, `withdrawInfluence`, `coveredOnChange`, and `test/services/wealth-spent.test.ts` stay as they are except as the new tests call `withdrawInfluence`.

---

### Task 1: Spend hero Dominion in commitResources

**Files:**
- Create: `test/services/hero-dominion-commit.test.ts`
- Modify: `src/services/change.ts` (`commitResources` from the input type through `coveredOnChange`)

**Interfaces:**
- Consumes: `beginChange`, `commitResources`, and `withdrawInfluence` from `src/services/change.ts`; `openDb` from `src/store/db.ts`; `RuleError` from `src/domain/types.ts`.
- Produces: `commitResources` still returns `ServiceResult<{ status: string; covered: number }>`. Input gains optional `dominionSpent?: number`. No new export.

- [ ] **Step 1: Write the failing test**

Create `test/services/hero-dominion-commit.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { beginChange, commitResources, withdrawInfluence } from "../../src/services/change.js";

function world(
  heroes: { id: string; influence: number; wealth: number; dominion?: number }[],
): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("village", "c1", "Village", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");
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

function beginFact(
  db: Database.Database,
  magnitude: "plausible" | "impossible" = "plausible",
): string {
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    scope: "village",
    magnitude,
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

function changeRow(db: Database.Database, changeId: string) {
  return db.prepare("SELECT status, dominion_spent FROM changes WHERE id = ?").get(changeId) as {
    status: string;
    dominion_spent: number;
  };
}

test("hero Dominion can fully fund an eligible change", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 4,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(4);
  expect(committed.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(changeRow(db, changeId)).toEqual({ status: "active", dominion_spent: 4 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 0, wealth_spent: 0 });
});

test("hero Dominion can partially cover a change", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(2);
  expect(committed.data.status).toBe("pending");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 6 });
  expect(changeRow(db, changeId)).toEqual({ status: "pending", dominion_spent: 2 });
});

test("mixed Influence and Dominion cover the quote", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 2,
    dominionSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.covered).toBe(4);
  expect(committed.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 1, wealth: 0, dominion: 6 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 2, wealth_spent: 0 });
  expect(changeRow(db, changeId)).toEqual({ status: "active", dominion_spent: 2 });
});

test("withdrawing mixed Influence leaves Dominion spent and decays the change", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 8 }]);
  const changeId = beginFact(db, "impossible");
  const committed = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 2,
    dominionSpent: 2,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;

  const withdrawn = withdrawInfluence(db, { changeId, heroId: "sword" });
  expect(withdrawn.ok).toBe(true);
  if (!withdrawn.ok) return;
  expect(withdrawn.data.covered).toBe(2);
  expect(withdrawn.data.status).toBe("decaying");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 6 });
  expect(commitment(db, changeId, "sword")).toEqual({ influence: 0, wealth_spent: 0 });
  expect(changeRow(db, changeId)).toEqual({ status: "decaying", dominion_spent: 2 });

  const restored = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 2,
  });
  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(restored.data.covered).toBe(4);
  expect(restored.data.status).toBe("active");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(changeRow(db, changeId)).toEqual({ status: "active", dominion_spent: 4 });
});

test("unpaid Dominion offers write nothing", () => {
  const db = world([{ id: "sword", influence: 3, wealth: 0, dominion: 4 }]);

  const negativeId = beginFact(db, "impossible");
  const negative = commitResources(db, {
    changeId: negativeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: -1,
  });
  expect(negative.ok).toBe(false);
  if (negative.ok) return;
  expect(negative.error.code).toBe("INSUFFICIENT_DOMINION");
  expect(negative.error.message).toBe("cannot commit negative dominion");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(commitment(db, negativeId, "sword")).toBeUndefined();
  expect(changeRow(db, negativeId)).toEqual({ status: "pending", dominion_spent: 0 });

  const orderId = beginFact(db, "impossible");
  const order = commitResources(db, {
    changeId: orderId,
    heroId: "sword",
    influence: -1,
    dominionSpent: 5,
  });
  expect(order.ok).toBe(false);
  if (order.ok) return;
  expect(order.error.code).toBe("INSUFFICIENT_INFLUENCE");
  expect(order.error.message).toBe("cannot commit negative influence");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(commitment(db, orderId, "sword")).toBeUndefined();

  const shortId = beginFact(db, "impossible");
  const short = commitResources(db, {
    changeId: shortId,
    heroId: "sword",
    influence: 1,
    dominionSpent: 5,
  });
  expect(short.ok).toBe(false);
  if (short.ok) return;
  expect(short.error.code).toBe("INSUFFICIENT_DOMINION");
  expect(short.error.message).toBe("not enough dominion to commit");
  expect(heroRow(db, "sword")).toEqual({ influence: 3, wealth: 0, dominion: 4 });
  expect(commitment(db, shortId, "sword")).toBeUndefined();
  expect(changeRow(db, shortId)).toEqual({ status: "pending", dominion_spent: 0 });
});

test("omitted dominionSpent and explicit zero leave Dominion unchanged", () => {
  const db = world([
    { id: "omit", influence: 2, wealth: 6, dominion: 8 },
    { id: "zero", influence: 4, wealth: 6, dominion: 8 },
  ]);
  const omittedId = beginFact(db);
  const omitted = commitResources(db, { changeId: omittedId, heroId: "omit", influence: 1 });
  expect(omitted.ok).toBe(true);
  if (!omitted.ok) return;
  expect(omitted.data.covered).toBe(1);
  expect(heroRow(db, "omit")).toEqual({ influence: 1, wealth: 6, dominion: 8 });

  const zeroId = beginFact(db);
  const zero = commitResources(db, {
    changeId: zeroId,
    heroId: "zero",
    influence: 1,
    wealthSpent: 2,
    dominionSpent: 0,
  });
  expect(zero.ok).toBe(true);
  if (!zero.ok) return;
  expect(zero.data.covered).toBe(2);
  expect(zero.data.status).toBe("active");
  expect(heroRow(db, "zero")).toEqual({ influence: 3, wealth: 4, dominion: 8 });
  expect(commitment(db, zeroId, "zero")).toEqual({ influence: 2, wealth_spent: 2 });
  expect(changeRow(db, zeroId)).toEqual({ status: "active", dominion_spent: 0 });
});

test("Dominion-only coverage lands a feature change and one backlash", () => {
  const db = world([{ id: "sword", influence: 0, wealth: 0, dominion: 2 }]);
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: "The village has a band of trained warriors.",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) throw new Error("begin");
  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    heroId: "sword",
    influence: 0,
    dominionSpent: 1,
    backlash: "The warriors demand pay.",
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data.status).toBe("active");
  expect(committed.data.covered).toBe(1);
  expect(heroRow(db, "sword")).toEqual({ influence: 0, wealth: 0, dominion: 1 });
  const features = db
    .prepare("SELECT COUNT(*) AS c FROM features WHERE faction_id = ?")
    .get("village") as { c: number };
  const problems = db
    .prepare("SELECT text FROM problems WHERE faction_id = ?")
    .all("village") as { text: string }[];
  expect(features.c).toBe(1);
  expect(problems.map((p) => p.text)).toEqual(["The warriors demand pay."]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/hero-dominion-commit.test.ts`

Expected: FAIL. Full coverage stays `pending` at `covered` 0 because `commitResources` ignores `dominionSpent` and never writes `changes.dominion_spent`. TypeScript may also fail the object literal until the argument exists.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/change.ts`, add `dominionSpent?: number` to the `commitResources` input type.

Replace the hero load, the unpaid-offer checks, and the `coveredOnChange` call inside `commitResources` with the following. Keep the Wealth conversion block and the commitment write as they are. Insert the Dominion debit after the Influence pool update and before `quoteForChangeRow`.

```ts
      const hero = db
        .prepare("SELECT id, influence, wealth, dominion FROM heroes WHERE id = ?")
        .get(input.heroId) as
        | { id: string; influence: number; wealth: number; dominion: number }
        | undefined;
      if (!hero) throw new RuleError("ENTITY_NOT_FOUND", `hero ${input.heroId} not found`);
      const wealthSpent = input.wealthSpent ?? 0;
      const paidDominion = input.dominionSpent ?? 0;
      if (input.influence < 0) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "cannot commit negative influence");
      }
      if (wealthSpent < 0) {
        throw new RuleError("INSUFFICIENT_WEALTH", "cannot commit negative wealth");
      }
      if (paidDominion < 0) {
        throw new RuleError("INSUFFICIENT_DOMINION", "cannot commit negative dominion");
      }
      if (wealthSpent > hero.wealth) {
        throw new RuleError("INSUFFICIENT_WEALTH", "not enough wealth to commit");
      }
      if (hero.influence < input.influence) {
        throw new RuleError("INSUFFICIENT_INFLUENCE", "not enough influence to commit");
      }
      if (hero.dominion < paidDominion) {
        throw new RuleError("INSUFFICIENT_DOMINION", "not enough dominion to commit");
      }
```

After the existing `UPDATE heroes SET influence = influence - ?` block, add:

```ts
      if (paidDominion > 0) {
        db.prepare("UPDATE heroes SET dominion = dominion - ? WHERE id = ?").run(
          paidDominion,
          input.heroId,
        );
        db.prepare("UPDATE changes SET dominion_spent = dominion_spent + ? WHERE id = ?").run(
          paidDominion,
          change.id,
        );
      }
      const quote = quoteForChangeRow(db, change);
      const covered = coveredOnChange(db, change.id, change.dominion_spent + paidDominion);
```

Delete the previous `const quote = quoteForChangeRow` / `coveredOnChange(db, change.id, change.dominion_spent)` pair so coverage is read only once, after the Dominion write.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/services/hero-dominion-commit.test.ts test/services/wealth-spent.test.ts test/services/feature-change-backlash.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/services/hero-dominion-commit.test.ts src/services/change.ts
git commit -m "feat: spend hero Dominion on commit_resources"
```

---

### Task 2: Accept dominionSpent on the MCP tool

**Files:**
- Modify: `src/mcp/register.ts` (the `commit_resources` description and `inputSchema`)

**Interfaces:**
- Consumes: `commitResources` from Task 1, including optional `dominionSpent?: number`.
- Produces: `commit_resources` still handled by `dbTool((a) => commitResources(db, a))`. Schema includes `dominionSpent: z.number().int().optional()`.

- [ ] **Step 1: Confirm the service tests still pass before editing the tool**

Run: `npx vitest run test/services/hero-dominion-commit.test.ts`

Expected: PASS. Do not add a test that reads `register.ts` or asserts on the description string.

- [ ] **Step 2: Update the tool description and schema**

In `src/mcp/register.ts`, replace the `commit_resources` description `Commit influence or wealth to a change. When a feature change's coverage, deeds, and challenges are met, this call adds the Feature and one backlash Problem.` with:

`Commit influence, wealth, or Dominion to a change. When a feature change's coverage, deeds, and challenges are met, this call adds the Feature and one backlash Problem.`

Add `dominionSpent: z.number().int().optional()` to that tool's `inputSchema`, next to `wealthSpent`. Leave `influence` required. Leave the handler `dbTool((a) => commitResources(db, a))`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/register.ts
git commit -m "feat: accept dominionSpent on commit_resources"
```

---

### Task 3: Drop the gap and name the spend in play copy

**Files:**
- Modify: `docs/design/overview.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

**Interfaces:**
- Consumes: the behavior Task 1 locked.
- Produces: living docs that match that behavior. No code export.

- [ ] **Step 1: Delete the known-gap bullet**

In `docs/design/overview.md`, under **Changes, Influence, and Dominion**, delete this bullet and leave the surrounding bullets:

```markdown
- Hero Dominion cannot be spent on changes; only `create_champion` debits it.
```

- [ ] **Step 2: Name dominionSpent in play copy**

In `user/skills/gdnr-player/references/gdnr-play.md`, in the Influence / Dominion bullets after `**Dominion** is spent. It makes a result last and is never refunded.`, add this sentence as its own bullet:

```markdown
- `commit_resources` spends that Dominion with `dominionSpent`. Omitted or `0` spends none. Withdrawing Influence does not return it.
```

Leave the coverage sentence (`Dominion spent plus Influence committed`) as it is.

- [ ] **Step 3: Distinguish create_champion in director copy**

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `create_champion` bullet

```markdown
- `create_champion`: spends a flat 8 Dominion from a hero to create a champion of a given level (`loyal` halves the effective level).
```

with:

```markdown
- `create_champion`: spends a flat 8 Dominion from a hero to create a champion of a given level (`loyal` halves the effective level). Quoted PC change costs take hero Dominion on `commit_resources` (`dominionSpent`), not on this tool.
```

- [ ] **Step 4: Commit**

```bash
git add docs/design/overview.md user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: hero Dominion funds changes through commit_resources"
```

Do not add a test that reads those files or asserts on their text.

- [ ] **Step 5: Run the related tests once more**

Run: `npx vitest run test/services/hero-dominion-commit.test.ts test/services/wealth-spent.test.ts test/services/feature-change-backlash.test.ts`

Expected: PASS.
