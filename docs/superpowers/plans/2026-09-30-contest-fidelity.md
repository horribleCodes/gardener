# Contest fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score contest bonuses from feature origin plus caller-stated edges, and take marginality only from the caller.

**Architecture:** `src/rules/contest.ts` owns the bonus and the boolean checks. `runAttack` and `runExtendInterest` pass stored origin and the caller's `marginal`, `attackerEdge`, and `defenderEdge` into that module. Goal planning stops attaching `marginal`. `relevant_features` reports the origin bonus only. Player-facing text under `user/` states the same rule.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Zod on unit plans.

## Global Constraints

- Domain rules stay in `src/rules/`. Services coordinate. MCP handlers do not implement contest math and do not run ad-hoc SQL.
- One feature versus one feature.
- Automatic bonus is feature `origin` only: `improbable` +1, `impossible` +2, anything else +0, and only when the other side has a feature.
- Scale, quality, and supernatural relevance are `vast`, `superior`, and `edged` on `attackerEdge` and `defenderEdge`. Omitted means false. Stored `size`, `quality`, and `magical` are unread by contest resolution.
- `vast` and `superior` are comparative. `edged` scores +1 for that side whenever it is true.
- `marginal` is one boolean for the contest. Omitted means false. Domain mismatch does not set it. Goal planning does not set it.
- A kept natural 1 zeros the bonus.
- A non-boolean `marginal` or edge field fails with `FILL_INCOMPLETE`.
- `relevant_features` `unevenBonus` is the origin bonus against a resolved opposing feature, otherwise 0.
- No schema migration. No new authoring path for feature marks.
- Player-facing sentences live under `user/` and do not link outside `user/`.
- Every new or changed behavior has a test. `npm test` uses in-memory or temp databases.

Design: `docs/superpowers/specs/2026-09-30-contest-fidelity-design.md`. If this plan disagrees with that file, fix the plan.

---

### Task 1: Origin bonus and caller edges in the domain rule

**Files:**
- Modify: `src/rules/contest.ts`
- Modify: `test/rules/contest.test.ts`

**Interfaces:**
- Consumes: `FeatureOrigin` and `RuleError` from `src/domain/types.ts`. `featureRoll` and `resolveContest` stay.
- Produces:
  - `export type ContestEdge = { vast?: boolean; superior?: boolean; edged?: boolean }`
  - `export type ResolvedEdge = { vast: boolean; superior: boolean; edged: boolean }`
  - `export function readMarginal(raw: unknown): boolean`
  - `export function resolveContestEdge(raw: unknown, label: string): ResolvedEdge`
  - `export function unevenBonus(input: { origin: string; edge: ResolvedEdge; opposingEdge: ResolvedEdge | null }): number`
  - Deletes `defaultRelevance`.

- [ ] **Step 1: Write the failing test**

Replace `test/rules/contest.test.ts` with:

```ts
import { expect, test } from "vitest";
import { featureRoll, resolveContest, resolveContestEdge, unevenBonus } from "../../src/rules/contest.js";
import { cultBudget, monthlyDominion } from "../../src/rules/cults.js";
import { mulberry32 } from "../../src/rules/dice.js";
import { RuleError } from "../../src/domain/types.js";

const none = resolveContestEdge(undefined, "edge");
const every = resolveContestEdge(
  { vast: true, superior: true, edged: true },
  "edge",
);

test("origin is the only automatic bonus", () => {
  expect(unevenBonus({ origin: "impossible", edge: none, opposingEdge: none })).toBe(2);
  expect(unevenBonus({ origin: "improbable", edge: none, opposingEdge: none })).toBe(1);
  expect(unevenBonus({ origin: "native", edge: none, opposingEdge: none })).toBe(0);
  expect(unevenBonus({ origin: "other", edge: none, opposingEdge: none })).toBe(0);
  expect(unevenBonus({ origin: "impossible", edge: every, opposingEdge: null })).toBe(0);
});

test("caller edges add scale, quality, and supernatural bonuses", () => {
  expect(unevenBonus({ origin: "impossible", edge: every, opposingEdge: none })).toBe(5);
  expect(
    unevenBonus({
      origin: "native",
      edge: resolveContestEdge({ vast: true, superior: true }, "edge"),
      opposingEdge: resolveContestEdge({ vast: true }, "edge"),
    }),
  ).toBe(1);
  const bothEdged = resolveContestEdge({ edged: true }, "edge");
  expect(unevenBonus({ origin: "native", edge: bothEdged, opposingEdge: bothEdged })).toBe(1);
});

test("a natural 1 zeros the bonus and a marginal roll keeps the lower die", () => {
  const lucky = featureRoll({
    rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 1,
  });
  expect(lucky.bonus).toBe(0);
  expect(lucky.total).toBe(1);
  const strong = featureRoll({
    rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 7,
  });
  expect(strong.total).toBe(12);
  const roll = featureRoll({
    rng: mulberry32(1), faces: 8, marginal: true, bonus: 0, forcedPair: [2, 8],
  });
  expect(roll.kept).toBe(2);
});

test("a non-boolean edge field is FILL_INCOMPLETE", () => {
  expect(() => resolveContestEdge({ vast: "yes" }, "attackerEdge")).toThrow(RuleError);
  try {
    resolveContestEdge({ vast: "yes" }, "attackerEdge");
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe("FILL_INCOMPLETE");
  }
  expect(() => resolveContestEdge("vast", "attackerEdge")).toThrow(RuleError);
});

test("ties go to higher power, then to the defender", () => {
  expect(resolveContest({
    attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 1,
  })).toBe("attacker");
  expect(resolveContest({
    attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 2,
  })).toBe("defender");
});

test("cult budgets and incomes", () => {
  expect(cultBudget("sharp", 6)).toBe(2);
  expect(cultBudget("grueling", 6)).toBe(3);
  expect(cultBudget("overwhelming", 6)).toBe(5);
  expect(monthlyDominion({ kind: "cult", power: 1, harshness: "nominal", level: 2 })).toBe(1);
  expect(monthlyDominion({ kind: "cult", power: 1, harshness: "sharp", level: 2 })).toBe(2);
  expect(monthlyDominion({ kind: "free", power: 1, harshness: "nominal", level: 2 })).toBe(1);
  expect(monthlyDominion({ kind: "free", power: 1, harshness: "nominal", level: 6 })).toBe(3);
  expect(monthlyDominion({ kind: "none", power: 1, harshness: "nominal", level: 9 })).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/rules/contest.test.ts`

Expected: FAIL. `unevenBonus` still takes two `FeatureTags` arguments, so the new call returns 0 or throws.

- [ ] **Step 3: Write the minimal implementation**

Replace `src/rules/contest.ts` with:

```ts
import type { Power, RollRecord } from "../domain/types.js";
import { RuleError } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export type ContestEdge = {
  vast?: boolean;
  superior?: boolean;
  edged?: boolean;
};

export type ResolvedEdge = {
  vast: boolean;
  superior: boolean;
  edged: boolean;
};

const EDGE_KEYS = ["vast", "superior", "edged"] as const;

export function readMarginal(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw !== "boolean") {
    throw new RuleError("FILL_INCOMPLETE", "marginal must be a boolean");
  }
  return raw;
}

export function resolveContestEdge(raw: unknown, label: string): ResolvedEdge {
  if (raw == null) return { vast: false, superior: false, edged: false };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new RuleError("FILL_INCOMPLETE", `${label} must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const resolved: ResolvedEdge = { vast: false, superior: false, edged: false };
  for (const key of EDGE_KEYS) {
    if (!(key in obj) || obj[key] === undefined) continue;
    if (typeof obj[key] !== "boolean") {
      throw new RuleError("FILL_INCOMPLETE", `${label}.${key} must be a boolean`);
    }
    resolved[key] = obj[key];
  }
  return resolved;
}

export function unevenBonus(input: {
  origin: string;
  edge: ResolvedEdge;
  opposingEdge: ResolvedEdge | null;
}): number {
  if (!input.opposingEdge) return 0;
  let bonus = 0;
  if (input.origin === "improbable") bonus += 1;
  if (input.origin === "impossible") bonus += 2;
  if (input.edge.vast && !input.opposingEdge.vast) bonus += 1;
  if (input.edge.superior && !input.opposingEdge.superior) bonus += 1;
  if (input.edge.edged) bonus += 1;
  return bonus;
}

export function featureRoll(input: {
  rng: Rng; faces: number; marginal: boolean; bonus: number;
  forced?: number; forcedPair?: [number, number];
}): RollRecord {
  const first = rollDie(input.rng, input.faces, input.forcedPair?.[0] ?? input.forced);
  const second = input.marginal
    ? rollDie(input.rng, input.faces, input.forcedPair?.[1])
    : first;
  const kept = input.marginal ? Math.min(first.natural, second.natural) : first.natural;
  const bonus = kept === 1 ? 0 : input.bonus;
  return {
    faces: input.faces, natural: kept, kept, bonus, total: kept + bonus,
    forced: input.forced != null || input.forcedPair != null,
  };
}

export function resolveContest(input: {
  attackerTotal: number; defenderTotal: number; attackerPower: Power; defenderPower: Power;
}): "attacker" | "defender" {
  if (input.attackerTotal > input.defenderTotal) return "attacker";
  if (input.defenderTotal > input.attackerTotal) return "defender";
  if (input.attackerPower > input.defenderPower) return "attacker";
  return "defender";
}
```

`FeatureTags` stays in `src/domain/types.ts`. This module no longer imports it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/rules/contest.test.ts`

Expected: PASS. 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/rules/contest.ts test/rules/contest.test.ts
git commit -m "feat: score contest bonuses from origin and caller edges"
```

---

### Task 2: Attack and extend accept marginal and edges

**Files:**
- Modify: `src/services/actions.ts`
- Modify: `src/services/turn.ts` (`FactionAction` only in this task)
- Modify: `src/services/unitPlan.ts`
- Create: `test/services/contest-fidelity.test.ts`

**Interfaces:**
- Consumes: `readMarginal`, `resolveContestEdge`, `unevenBonus`, `featureRoll`, `resolveContest` from `src/rules/contest.ts`.
- Produces: `attack` and `extend_interest` on `RunActionInput` and `FactionAction` accept `marginal?: boolean`, `attackerEdge?: ContestEdge`, and `defenderEdge?: ContestEdge`. `FactionAction` `extend_interest` also includes `defenderFeatureId?: string`. Unit-plan Zod accepts the same edge objects. `defaultRelevance` is no longer imported.

- [ ] **Step 1: Write the failing test**

Create `test/services/contest-fidelity.test.ts`:

```ts
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { runAction } from "../../src/services/actions.js";
import { parseUnitPlan } from "../../src/services/unitPlan.js";
import type Database from "better-sqlite3";

function contestDb(): { db: Database.Database; campaignId: string } {
  const db = openDb(":memory:");
  const campaignId = "c1";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)",
  ).run(campaignId, "T");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('atk', ?, 'Atk', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active'),
            ('def', ?, 'Def', 1, 1, 1, 'existing', 'martial_conqueror', 'npc', 0, 'active')`,
  ).run(campaignId, campaignId);
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('af', 'atk', 'A', 'cultural', 'vast', 'superior', 1, 'impossible'),
            ('df', 'def', 'D', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES ('pa', 'af', 'A', 0), ('pd', 'df', 'D', 0)",
  ).run();
  db.prepare(
    "INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order) VALUES ('t1', ?, 1, 1, 1, '[]')",
  ).run(campaignId);
  return { db, campaignId };
}

function attackerRoll(db: Database.Database): { natural: number; kept: number; bonus: number; total: number } {
  const row = db.prepare("SELECT payload FROM rolls").get() as { payload: string };
  const payload = JSON.parse(row.payload) as {
    attacker: { natural: number; kept: number; bonus: number; total: number };
  };
  return payload.attacker;
}

test("domain mismatch keeps one die and ignores stored vast, superior, and magical marks", () => {
  const { db, campaignId } = contestDb();
  const result = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
    defenderChoice: "cohesion",
  });
  expect(result.ok).toBe(true);
  const roll = attackerRoll(db);
  expect(roll.natural).toBe(6);
  expect(roll.kept).toBe(6);
  expect(roll.bonus).toBe(2);
  expect(roll.total).toBe(8);
});

test("explicit edges add comparative scale and quality plus one-sided edged", () => {
  const { db, campaignId } = contestDb();
  runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
    defenderChoice: "cohesion",
    attackerEdge: { vast: true, superior: true, edged: true },
    defenderEdge: { vast: true },
  });
  expect(attackerRoll(db).bonus).toBe(4);
});

test("a natural 1 zeros origin and edges", () => {
  const { db, campaignId } = contestDb();
  runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 1,
    forcedDefenderRoll: 6,
    attackerEdge: { vast: true, superior: true, edged: true },
  });
  const roll = attackerRoll(db);
  expect(roll.bonus).toBe(0);
  expect(roll.total).toBe(1);
});

test("extend_interest uses the same origin bonus", () => {
  const { db, campaignId } = contestDb();
  const result = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "extend_interest",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    forcedAttackerRoll: 6,
    forcedDefenderRoll: 1,
  });
  expect(result.ok).toBe(true);
  expect(attackerRoll(db).bonus).toBe(2);
});

test("a non-boolean edge or marginal returns FILL_INCOMPLETE", () => {
  const { db, campaignId } = contestDb();
  const badEdge = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    defenderFeatureId: "df",
    attackerEdge: { vast: "yes" },
  } as never);
  expect(badEdge.ok).toBe(false);
  if (!badEdge.ok) expect(badEdge.error.code).toBe("FILL_INCOMPLETE");

  const badMarginal = runAction(db, {
    campaignId,
    factionId: "atk",
    type: "extend_interest",
    targetFactionId: "def",
    attackerFeatureId: "af",
    willing: true,
    marginal: "yes",
  } as never);
  expect(badMarginal.ok).toBe(false);
  if (!badMarginal.ok) expect(badMarginal.error.code).toBe("FILL_INCOMPLETE");
  const rolls = db.prepare("SELECT COUNT(*) AS n FROM rolls").get() as { n: number };
  expect(rolls.n).toBe(0);
});

test("a unit plan accepts contest edges and rejects a non-boolean vast", () => {
  const plan = parseUnitPlan({
    type: "attack",
    targetFactionId: "def",
    attackerFeatureId: "af",
    attackerEdge: { edged: true },
    defenderEdge: { superior: true },
    marginal: true,
  });
  expect(plan).toMatchObject({
    marginal: true,
    attackerEdge: { edged: true },
    defenderEdge: { superior: true },
  });
  expect(() =>
    parseUnitPlan({
      type: "extend_interest",
      targetFactionId: "def",
      attackerFeatureId: "af",
      attackerEdge: { vast: "yes" },
    }),
  ).toThrow();
});
```

The domain-mismatch case is deterministic: campaign seed 1 and `roll_counter` 0 make an unforced second d6 a 4. A marginal roll with forced 6 would keep 4. The assertion `natural === 6` fails while `defaultRelevance` still marks different domains marginal.

The attacker row is vast, superior, and magical; the defender row is normal, not superior, and not magical. With edges omitted, the bonus is origin only (+2). A tag-stacking implementation scores +5 and fails `bonus === 2`. The willing extend with `marginal: "yes"` must fail before any roll row is written.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/contest-fidelity.test.ts`

Expected: FAIL. `natural` is 4 while domain auto-marginal is still on, or `bonus` is greater than 2 while tag stacking is still on. The unit-plan case fails Zod's unknown-key strip or a parse error on `attackerEdge`.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/actions.ts`:

- Drop `defaultRelevance` from the contest import. Import `readMarginal`, `resolveContestEdge`, and `unevenBonus`.
- Add `attackerEdge?: ContestEdge` and `defenderEdge?: ContestEdge` to the `attack` and `extend_interest` variants of `RunActionInput`. Import `ContestEdge` from `../rules/contest.js`. `marginal` is already on both variants.
- Add this helper next to `runAttack`:

```ts
function settledContest(input: {
  rng: Rng;
  attackerFaces: number;
  defenderFaces: number;
  attackerOrigin: string;
  defenderOrigin: string;
  marginal: unknown;
  attackerEdge: unknown;
  defenderEdge: unknown;
  forcedAttackerRoll?: number;
  forcedDefenderRoll?: number;
}): { attackerRoll: ReturnType<typeof featureRoll>; defenderRoll: ReturnType<typeof featureRoll> } {
  const marginal = readMarginal(input.marginal);
  const attackerEdge = resolveContestEdge(input.attackerEdge, "attackerEdge");
  const defenderEdge = resolveContestEdge(input.defenderEdge, "defenderEdge");
  return {
    attackerRoll: featureRoll({
      rng: input.rng,
      faces: input.attackerFaces,
      marginal,
      bonus: unevenBonus({
        origin: input.attackerOrigin,
        edge: attackerEdge,
        opposingEdge: defenderEdge,
      }),
      forced: input.forcedAttackerRoll,
    }),
    defenderRoll: featureRoll({
      rng: input.rng,
      faces: input.defenderFaces,
      marginal,
      bonus: unevenBonus({
        origin: input.defenderOrigin,
        edge: defenderEdge,
        opposingEdge: attackerEdge,
      }),
      forced: input.forcedDefenderRoll,
    }),
  };
}
```

Import `Rng` from `../rules/dice.js` if it is not already in scope. `rollDie` is already imported from that module.

At the start of `runAttack`, before feature lookup is finished is too early to need origin, but validation does not need the rows. Immediately after the attacker-feature ownership check:

```ts
const marginal = readMarginal(input.marginal);
resolveContestEdge(input.attackerEdge, "attackerEdge");
resolveContestEdge(input.defenderEdge, "defenderEdge");
```

Use `marginal` in the no-defender `featureRoll` (`bonus: 0`). Delete the `FeatureTags` construction and the `defaultRelevance` / `unevenBonus(attackerTags, defenderTags)` block. When `defenderFeature` exists, replace that block with:

```ts
const rng = nextRng(db, attacker.campaign_id);
const settled = settledContest({
  rng,
  attackerFaces,
  defenderFaces: DIE_BY_POWER[defender.power],
  attackerOrigin: attackerFeature.origin,
  defenderOrigin: defenderFeature.origin,
  marginal: input.marginal,
  attackerEdge: input.attackerEdge,
  defenderEdge: input.defenderEdge,
  forcedAttackerRoll: input.forcedAttackerRoll,
  forcedDefenderRoll: input.forcedDefenderRoll,
});
attackerRoll = settled.attackerRoll;
defenderTotal = settled.defenderRoll.total;
```

`settledContest` calls `readMarginal` and `resolveContestEdge` again. That second call sees the same booleans. Keep the early calls so a bad edge fails before `nextRng` on the no-defender path too. Passing `input.marginal` into `settledContest` is the value both rolls share.

In `runExtendInterest`, run the same three checks before `if (input.willing)`:

```ts
const marginal = readMarginal(input.marginal);
resolveContestEdge(input.attackerEdge, "attackerEdge");
resolveContestEdge(input.defenderEdge, "defenderEdge");
```

Then keep the willing branch as it is, with no roll. The no-defender branch uses that `marginal` and bonus 0. The both-features branch calls `settledContest` with `input.marginal`, `input.attackerEdge`, `input.defenderEdge`, the two origins, and the two forced rolls, and stores `settled.defenderRoll.total` as `defenderTotal`.

Remove the `FeatureTags` import from `src/services/actions.ts` once both contest paths stop building tag objects.

In `src/services/turn.ts`, add the fields to `FactionAction`:

```ts
import type { ContestEdge } from "../rules/contest.js";
```

```ts
  | {
      type: "attack";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      defenderChoice?: "cohesion" | "sacrifice" | "problem";
      marginal?: boolean;
      attackerEdge?: ContestEdge;
      defenderEdge?: ContestEdge;
      forcedAttackerRoll?: number;
      forcedDefenderRoll?: number;
    }
  | {
      type: "extend_interest";
      targetFactionId: string;
      attackerFeatureId: string;
      defenderFeatureId?: string;
      marginal?: boolean;
      attackerEdge?: ContestEdge;
      defenderEdge?: ContestEdge;
      forcedAttackerRoll?: number;
      forcedDefenderRoll?: number;
    };
```

`defenderFeatureId` on `extend_interest` records the argument `runExtendInterest` already reads.

In `src/services/unitPlan.ts`, add:

```ts
const contestEdgeSchema = z.object({
  vast: z.boolean().optional(),
  superior: z.boolean().optional(),
  edged: z.boolean().optional(),
});
```

On the `attack` and `extend_interest` plan objects, next to the existing `marginal` field:

```ts
attackerEdge: contestEdgeSchema.optional(),
defenderEdge: contestEdgeSchema.optional(),
```

Leave `marginal`, `attackerEdge`, and `defenderEdge` off the forbidden-field list in `parseUnitPlan`.

MCP `faction_action` already passes `action` through as `FactionAction`. Do not add contest math in `src/mcp/register.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/contest-fidelity.test.ts test/rules/contest.test.ts test/final-review-critical.test.ts`

Expected: PASS. The final-review attack test still has a defender win on forced 1 vs 6 with native origins.

- [ ] **Step 5: Commit**

```bash
git add src/services/actions.ts src/services/turn.ts src/services/unitPlan.ts test/services/contest-fidelity.test.ts
git commit -m "feat: accept contest marginality and qualitative edges"
```

---

### Task 3: Goal planning does not set marginality

**Files:**
- Modify: `src/services/turn.ts` (the `military_defeat` branch inside `resolveStrategy`)
- Modify: `test/services/turn.test.ts`

**Interfaces:**
- Consumes: `planFactionAction` and `loadFactionRow`, already exported from `src/services/turn.ts`.
- Produces: a `military_defeat` attack whose object has no `marginal` property.

- [ ] **Step 1: Write the failing test**

In `test/services/turn.test.ts`, import `loadFactionRow` and `planFactionAction` from `../../src/services/turn.js`.

Add this test beside `military_defeat with only non-military feature sets marginal on attack`:

```ts
test("military_defeat with only a non-military feature does not set marginal", () => {
  const seed = 815;
  const shuffleCounter = forceStrategyRoll(seed, 3, 4);

  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, ?, 0)",
  ).run("c1", "Test", seed);
  db.prepare("UPDATE campaigns SET roll_counter = ? WHERE id = 'c1'").run(shuffleCounter + 1);

  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('actor', 'c1', 'Actor', 1, 1, 5, 'native', 'despotic_tyrant', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('neighbor', 'c1', 'Neighbor', 1, 1, 1, 'native', 'directed', 'player', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('i1', 'actor', 'neighbor', 3, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('cult', 'actor', 'Court', 'cultural', 'normal', 'normal', 0, 'native')`,
  ).run();

  const planned = planFactionAction(db, loadFactionRow(db, "actor"));
  expect(planned.action).toEqual({
    type: "attack",
    targetFactionId: "neighbor",
    attackerFeatureId: "cult",
  });
});
```

`roll_counter` is `shuffleCounter + 1` because this call rolls the goal directly. `forceStrategyRoll` finds the counter whose following d10 is 3 or 4, which is `military_defeat` for `despotic_tyrant`. There is no faction-order shuffle in this call.

Keep the existing full-turn test. Rename it to `military_defeat with only a non-military feature still attacks`. Its assertion stays "an attack row exists".

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/turn.test.ts -t "does not set marginal"`

Expected: FAIL. `planned.action` is `{ type: "attack", targetFactionId: "neighbor", attackerFeatureId: "cult", marginal: true }`.

- [ ] **Step 3: Write the minimal implementation**

In the `military_defeat` branch of `resolveStrategy` in `src/services/turn.ts`, delete `let marginal = false`, delete `if (feature.domain !== "military") marginal = true`, and return:

```ts
return {
  type: "attack",
  targetFactionId: target.id,
  attackerFeatureId: feature.id,
};
```

The other strategies in that block already omit `marginal`. Leave their feature choice as it is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/turn.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/turn.ts test/services/turn.test.ts
git commit -m "fix: stop goal planning from setting contest marginality"
```

---

### Task 4: relevant_features reports the origin bonus only

**Files:**
- Modify: `src/queries/detail.ts` (`relevantFeatures`)
- Modify: `src/mcp/register.ts` (the `relevant_features` description string only)
- Create: `test/queries/relevant-features.test.ts`

**Interfaces:**
- Consumes: `unevenBonus` and `resolveContestEdge` from `src/rules/contest.ts`.
- Produces: each listed feature's `unevenBonus` is 0 without a resolved opposing row, otherwise that feature's origin amount. The tool description is `Features relevant to a domain. unevenBonus is the automatic origin bonus only.`

- [ ] **Step 1: Write the failing test**

Create `test/queries/relevant-features.test.ts`:

```ts
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { relevantFeatures } from "../../src/queries/detail.js";

test("relevant_features reports origin bonus only", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'T', 1, 1, 0)",
  ).run();
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES ('f1', 'c1', 'F', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, size, quality, magical, origin)
     VALUES ('wide', 'f1', 'Wide', 'military', 'vast', 'superior', 1, 'impossible'),
            ('econ', 'f1', 'Market', 'economic', 'normal', 'normal', 0, 'improbable'),
            ('foe', 'f1', 'Foe', 'military', 'normal', 'normal', 0, 'native')`,
  ).run();

  const alone = relevantFeatures(db, { factionId: "f1", domain: "military" });
  expect(alone.map((f) => [f.id, f.unevenBonus])).toEqual([["wide", 0]]);

  const against = relevantFeatures(db, {
    factionId: "f1",
    domain: "military",
    opposingFeatureId: "foe",
  });
  expect(against.map((f) => [f.id, f.unevenBonus])).toEqual([["wide", 2]]);

  const missing = relevantFeatures(db, {
    factionId: "f1",
    domain: "economic",
    opposingFeatureId: "missing",
  });
  expect(missing.map((f) => [f.id, f.unevenBonus])).toEqual([["econ", 0]]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/queries/relevant-features.test.ts`

Expected: FAIL. `wide` against `foe` scores 5 from vast, superior, magical, and impossible origin. The current `magicRelevant` default is true.

- [ ] **Step 3: Write the minimal implementation**

In `relevantFeatures`, keep the domain filter. Replace the tag-built `unevenBonus` call with:

```ts
const quiet = resolveContestEdge(undefined, "edge");
const bonus = opposing
  ? unevenBonus({ origin: f.origin, edge: quiet, opposingEdge: quiet })
  : 0;
```

Do not pass `f.size`, `f.quality`, or `f.magical` into the edge. Do not pass the opposing row's origin into the rolling feature's bonus. Keep returning `{ ...f, unevenBonus: bonus }`.

In `src/mcp/register.ts`, change the `relevant_features` description to:

```ts
description: "Features relevant to a domain. unevenBonus is the automatic origin bonus only.",
```

Leave the input schema as `factionId`, `domain`, and optional `opposingFeatureId`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/queries/relevant-features.test.ts test/queries/detail.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/queries/detail.ts src/mcp/register.ts test/queries/relevant-features.test.ts
git commit -m "feat: report origin-only bonuses from relevant_features"
```

---

### Task 5: Player-facing text and the living gap bullet

**Files:**
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`
- Modify: `docs/design/overview.md`

**Interfaces:**
- Consumes: the contest rule in the design spec.
- Produces: the sentences below. No links from `user/` to files outside `user/`.

- [ ] **Step 1: Write the failing check**

Run:

```bash
rg -n "different domains" user/skills/gdnr-player/references/gdnr-play.md
rg -n "Uneven contest bonuses are always 0" docs/design/overview.md
```

Expected: both commands print a match.

- [ ] **Step 2: Replace the player contest bullet**

In `user/skills/gdnr-player/references/gdnr-play.md`, replace:

```md
- In a contest the higher total wins; a tie goes to the higher Power, then to the defender. When the two features are in different domains the roll is marginal: roll twice and keep the lower.
```

with:

```md
- In a contest the higher total wins; a tie goes to the higher Power, then to the defender. A natural 1 on the kept die adds no bonus.
- Marginality is the caller's `marginal` on that contest. `marginal: true` rolls the action die twice and keeps the lower. Different feature domains leave the roll as one die.
- The only automatic bonus is the rolling feature's `origin`: +1 for `improbable`, +2 for `impossible`, and +0 for `native` or any other stored value. It applies when the other side has a feature.
- Scale, quality, and supernatural relevance are `vast`, `superior`, and `edged` on `attackerEdge` and `defenderEdge` for this contest. `vast` and `superior` each add +1 when this side has them and the other side does not. `edged` adds +1 for a side whenever it is true. Stored size, quality, and magical marks are unread.
```

- [ ] **Step 3: Add the director paragraph**

In `user/skills/gdnr-director/references/gdnr-direct.md`, immediately after the paragraph that ends with `Unit plans cannot carry them.`, add:

```md
On `attack` and `extend_interest`, `marginal`, `attackerEdge`, and `defenderEdge` state the contest. A unit plan may carry them. Omit them and the contest is one die per side with no scale, quality, or supernatural bonus. Different domains do not set `marginal`. Stored size, quality, and magical marks are unread. A feature's stored `origin` still adds +1 (`improbable`) or +2 (`impossible`) when both sides have a feature. No setup tool writes a non-native feature origin.
```

- [ ] **Step 4: Replace the overview gap bullet**

In `docs/design/overview.md`, replace:

```md
- Uneven contest bonuses are always 0, because no tool sets feature size, quality, magical, or origin.
```

with:

```md
- Contest uneven bonuses follow stored feature origin only (+1 `improbable`, +2 `impossible`) when both sides have a feature. Scale, quality, and supernatural edges are per-contest caller input. Domain mismatch does not set marginality. No play tool yet writes a non-native feature origin.
```

- [ ] **Step 5: Check the wording**

Run:

```bash
rg -n "different domains the roll is marginal|Uneven contest bonuses are always 0" user docs/design
rg -n "attackerEdge" user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-director/references/gdnr-direct.md
```

Expected: the first command prints nothing. The second prints a match in both files.

Confirm neither edited `user/` file contains a link or path outside `user/`.

- [ ] **Step 6: Commit**

```bash
git add user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-director/references/gdnr-direct.md docs/design/overview.md
git commit -m "docs: state contest origin bonuses and caller marginality"
```

---

### Task 6: Full test run

**Files:**
- None.

**Interfaces:**
- Consumes: the tests from Tasks 1–4.
- Produces: a green `npm test`.

- [ ] **Step 1: Run the suite**

Run: `npm test`

Expected: PASS. If a test still expects tag-stacked bonuses or domain-driven `marginal: true`, update that assertion to the rule in the Global Constraints section and rerun.

- [ ] **Step 2: Commit only if Step 1 required a fix**

```bash
git add -u
git commit -m "test: align remaining contest expectations with origin bonuses"
```

Skip this commit when `npm test` passed without further edits.
