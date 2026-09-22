# Godbound Faction World MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a stdio MCP whose tools create a faction world, fill omitted fields from generator tables, apply Godbound court and faction procedures, and answer from the stored state.

**Architecture:** Pure TypeScript rules functions sit under `src/rules` and never touch SQLite or the MCP SDK. Generation reads `src/tables/catalog.json`. Services persist one transaction per tool call. `src/mcp/register.ts` is a thin adapter. Ruin layouts are not implemented.

**Tech Stack:** Node 22, TypeScript 5.6, `@modelcontextprotocol/sdk` 1.30.0, `zod` 3.24, `better-sqlite3` 11, Vitest 2.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md`. Catalog: `docs/superpowers/specs/generator-catalog.json`. If this plan and the spec disagree, the spec wins; fix the plan before coding the disagreement.
- Server name `godbound-world`, version `0.1.0`, stdio only.
- Derived fields (Trouble, action die, cost, collapse, interest cap, cult income) are computed. Never accept them as writes.
- Fill modes are only `require`, `missing`, and `blank`. Default `missing`.
- Faction Enact Change and Restore Cohesion do not add mundus wards or resisters. PC changes do.
- Factions cannot pay for `impossible` or `vast` unless `prepared: true`.
- Do not generate ruin purpose, hazards, rewards, inhabitants, or rooms. `clear_danger` is a challenge card only.
- Do not copy rulebook prose into new strings. Use the catalog file.
- Error codes are the spec's list, including `NOTHING_TO_SOLVE`, `INTERNAL_BUDGET`, and `TURN_ALREADY_OPEN`.
- One SQLite transaction per tool call. Mutations take the write lock first. Rule failures roll back, including roll-counter increments, then release the lock.
- Turn agents see `projectUnitView` output only. A plan that names an id outside that snapshot fails `UNKNOWN_TO_UNIT`.
- Parallel `submit_unit_plan` calls enqueue. `apply_write_queue` applies the shuffled order under the lock file `{dbPath}.lock`.
- Default missing plan is `idle`. Mechanical goal strategies are opt-in and may only select entities present in the snapshot.
- The server does not call a language model.
- Package manager: npm.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/domain/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: the types below, imported as `../domain/types.js` from other modules (NodeNext)

- [ ] **Step 1: Write the config files**

`package.json`:

```json
{
  "name": "godbound-world-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node --experimental-strip-types src/server.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.30.0",
    "better-sqlite3": "11.10.0",
    "zod": "3.24.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.12",
    "@types/node": "22.13.10",
    "typescript": "5.8.2",
    "vitest": "2.1.9"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

`.gitignore`:

```gitignore
node_modules/
dist/
data/*.sqlite
data/*.sqlite-*
uploads/
```

- [ ] **Step 2: Write `src/domain/types.ts`**

```ts
export type Scope = "village" | "city" | "region" | "nation" | "realm";
export type Magnitude = "plausible" | "improbable" | "impossible" | "vast";
export type Power = 1 | 2 | 3 | 4 | 5;
export type Die = 6 | 8 | 10 | 12 | 20;
export type FillMode = "require" | "missing" | "blank";
export type Domain = "cultural" | "military" | "economic" | "other";
export type FeatureOrigin = "native" | "improbable" | "impossible";
export type InterestNature =
  | "alliance" | "rivalry" | "trade" | "marriage" | "spies" | "aid" | "tribute";
export type Behavior =
  | "despotic_tyrant" | "self_absorbed_survivor"
  | "scheming_manipulator" | "martial_conqueror" | "directed";
export type Harshness = "nominal" | "sharp" | "grueling" | "overwhelming";

export const DIE_BY_POWER: Record<Power, Die> = { 1: 6, 2: 8, 3: 10, 4: 12, 5: 20 };
export const SCOPE_BY_POWER: Record<Power, Scope> = {
  1: "village", 2: "city", 3: "region", 4: "nation", 5: "realm",
};
export const SCOPE_COST: Record<Scope, number> = {
  village: 1, city: 2, region: 4, nation: 8, realm: 16,
};
export const MULTIPLIER: Record<Magnitude, number> = {
  plausible: 1, improbable: 2, impossible: 4, vast: 8,
};

export interface ProblemRef { id: string; points: number; intrinsic?: boolean }

export interface FeatureTags {
  size: "normal" | "vast";
  quality: "normal" | "superior";
  magical: boolean;
  origin: FeatureOrigin;
  domain: Domain;
}

export interface RollRecord {
  faces: number;
  natural: number;
  kept: number;
  bonus: number;
  total: number;
  forced: boolean;
}

export class RuleError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
```

- [ ] **Step 3: Install and confirm the test runner**

Run: `npm install`
Expected: `node_modules` present, exit 0.

Run: `npx vitest run`
Expected: exit 0, "No test files found" (Vitest 2 exits 0 in that case). If it exits 1, add an empty `test/.gitkeep` is not enough; add `test/smoke.test.ts` with `import { expect, test } from "vitest"; test("smoke", () => { expect(1).toBe(1); });` and rerun. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/domain/types.ts test
git commit -m "chore: scaffold godbound world MCP"
```

### Task 2: Dice, trouble blame, collapse

**Files:**
- Create: `src/rules/dice.ts`
- Create: `src/rules/trouble.ts`
- Create: `src/rules/collapse.ts`
- Test: `test/rules/dice.test.ts`

**Interfaces:**
- Consumes: `RuleError`, `ProblemRef`, `Power`, `DIE_BY_POWER` from `src/domain/types.ts`
- Produces: `Rng`, `rollDie`, `blameProblem`, `troubleCheck`, `collapseState`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { mulberry32, rollDie, sequenceRng } from "../../src/rules/dice.js";
import { blameProblem, troubleCheck } from "../../src/rules/trouble.js";
import { collapseState } from "../../src/rules/collapse.js";

test("rollDie stays inside the faces", () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 50; i++) {
    const face = rollDie(rng, 6).natural;
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(6);
  }
});

test("blame bands use stored order and point width", () => {
  const problems = [
    { id: "raid", points: 1 },
    { id: "tax", points: 1 },
    { id: "despair", points: 2 },
  ];
  expect(blameProblem(problems, 1).id).toBe("raid");
  expect(blameProblem(problems, 2).id).toBe("tax");
  expect(blameProblem(problems, 4).id).toBe("despair");
});

test("normal trouble check fails on equal, solve check succeeds on equal", () => {
  const rng = sequenceRng([4]);
  const problems = [
    { id: "raid", points: 1 },
    { id: "tax", points: 1 },
    { id: "despair", points: 2 },
  ];
  const failed = troubleCheck({ rng, faces: 6, trouble: 4, problems, inverted: false });
  expect(failed.success).toBe(false);
  expect(failed.culpritId).toBe("despair");
  const solved = troubleCheck({
    rng: sequenceRng([4]), faces: 6, trouble: 4, problems, inverted: true,
  });
  expect(solved.success).toBe(true);
  expect(solved.culpritId).toBeNull();
});

test("collapse when trouble reaches the die maximum or cohesion hits zero", () => {
  expect(collapseState({ power: 1, trouble: 6, cohesion: 1 }).collapsed).toBe(true);
  expect(collapseState({ power: 1, trouble: 5, cohesion: 1 }).collapsed).toBe(false);
  expect(collapseState({ power: 4, trouble: 3, cohesion: 0 }).collapsed).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/rules/dice.test.ts`
Expected: FAIL, cannot find module `src/rules/dice.js`.

- [ ] **Step 3: Implement**

`src/rules/dice.ts`:

```ts
import type { RollRecord } from "../domain/types.js";

export interface Rng { next(): number }

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function sequenceRng(values: number[]): Rng {
  let i = 0;
  return {
    next() {
      const face = values[i++] ?? 1;
      return (face - 1) / 6;
    },
  };
}

export function rollDie(rng: Rng, faces: number, forced?: number): RollRecord {
  const natural = forced ?? 1 + Math.floor(rng.next() * faces);
  if (natural < 1 || natural > faces) {
    throw new Error(`die face ${natural} outside 1..${faces}`);
  }
  return { faces, natural, kept: natural, bonus: 0, total: natural, forced: forced != null };
}
```

`sequenceRng` is a test double for a d6 only. Queued face F returns `(F - 1) / 6`, and `rollDie` with `faces: 6` reconstructs F. Do not use it for any other die. `troubleCheck` accepts optional `forcedRoll` so later tests can pin a face without that double.

`src/rules/trouble.ts`:

```ts
import { RuleError, type ProblemRef } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export function blameProblem(problems: ProblemRef[], roll: number): ProblemRef {
  let cursor = 1;
  for (const problem of problems) {
    const end = cursor + problem.points - 1;
    if (roll >= cursor && roll <= end) return problem;
    cursor = end + 1;
  }
  throw new RuleError("NOTHING_TO_SOLVE", `roll ${roll} matched no problem band`);
}

export function troubleCheck(input: {
  rng: Rng;
  faces: number;
  trouble: number;
  problems: ProblemRef[];
  inverted: boolean;
  forcedRoll?: number;
}): { success: boolean; culpritId: string | null; roll: ReturnType<typeof rollDie> } {
  const roll = rollDie(input.rng, input.faces, input.forcedRoll);
  const success = input.inverted
    ? roll.natural <= input.trouble
    : roll.natural > input.trouble;
  const culpritId = !input.inverted && !success
    ? blameProblem(input.problems, roll.natural).id
    : null;
  return { success, culpritId, roll };
}
```

`src/rules/collapse.ts`:

```ts
import { DIE_BY_POWER, type Power } from "../domain/types.js";

export function collapseState(input: { power: Power; trouble: number; cohesion: number }): {
  collapsed: boolean;
  dieMax: number;
  margin: number;
} {
  const dieMax = DIE_BY_POWER[input.power];
  const collapsed = input.cohesion <= 0 || input.trouble >= dieMax;
  return { collapsed, dieMax, margin: dieMax - input.trouble };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/rules/dice.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rules/dice.ts src/rules/trouble.ts src/rules/collapse.ts test/rules/dice.test.ts
git commit -m "feat: add dice, trouble blame, and collapse"
```

### Task 3: Change cost, wealth, champion stats

**Files:**
- Create: `src/rules/cost.ts`
- Create: `src/rules/wealth.ts`
- Test: `test/rules/cost.test.ts`

**Interfaces:**
- Consumes: `Scope`, `Magnitude`, `SCOPE_COST`, `MULTIPLIER`, `RuleError`, `Power`, `SCOPE_BY_POWER`
- Produces: `quoteChange`, `factionProjectCost`, `restoreCohesionCost`, `influenceFromWealth`, `championStats`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { championStats, factionProjectCost, quoteChange, restoreCohesionCost } from "../../src/rules/cost.js";
import { influenceFromWealth } from "../../src/rules/wealth.js";

test("improbable city with ward 4 costs 12", () => {
  const quote = quoteChange({
    scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [],
  });
  expect(quote.base).toBe(6);
  expect(quote.total).toBe(12);
});

test("city ward 4 plus a rating-6 resister has base 12", () => {
  const quote = quoteChange({
    scope: "city", magnitude: "plausible", wardRatings: [4], resisterRatings: [6],
  });
  expect(quote.base).toBe(12);
  expect(quote.total).toBe(12);
  const hard = quoteChange({
    scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [6],
  });
  expect(hard.total).toBe(24);
});

test("only the highest ward applies, and extra resisters add 1", () => {
  const wards = quoteChange({
    scope: "village", magnitude: "plausible", wardRatings: [3, 10], resisterRatings: [],
  });
  expect(wards.ward).toBe(10);
  expect(wards.total).toBe(11);
  const resisted = quoteChange({
    scope: "village", magnitude: "plausible", wardRatings: [], resisterRatings: [8, 4],
  });
  expect(resisted.opposition).toBe(9);
  expect(resisted.total).toBe(10);
});

test("faction projects ignore wards; restore cohesion is scope times 2", () => {
  expect(factionProjectCost(1, "plausible")).toBe(1);
  expect(factionProjectCost(5, "improbable")).toBe(32);
  expect(restoreCohesionCost(1)).toBe(2);
  expect(restoreCohesionCost(5)).toBe(32);
});

test("wealth pools before it becomes influence", () => {
  expect(influenceFromWealth(6)).toEqual({ influence: 3, wealthUsed: 6 });
  expect(influenceFromWealth(3)).toEqual({ influence: 2, wealthUsed: 3 });
  expect(influenceFromWealth(3, 2)).toEqual({ influence: 2, wealthUsed: 3 });
});

test("a loyal champion uses half the creator level, rounded up, and always costs 8", () => {
  expect(championStats(5, false).hitDice).toBe(15);
  expect(championStats(5, true).effectiveLevel).toBe(3);
  expect(championStats(5, true).hitDice).toBe(11);
  expect(championStats(1, false).attacks).toBe(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/rules/cost.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `src/rules/cost.ts`**

```ts
import {
  MULTIPLIER, SCOPE_BY_POWER, SCOPE_COST,
  type Magnitude, type Power, type Scope,
} from "../domain/types.js";

export interface Quote {
  scopeCost: number;
  ward: number;
  opposition: number;
  base: number;
  multiplier: number;
  total: number;
  deedsRequired: number;
  challengesRequired: number;
}

export function quoteChange(input: {
  scope: Scope;
  magnitude: Magnitude;
  wardRatings: number[];
  resisterRatings: number[];
  kind?: "feature" | "fact" | "problem_mitigation" | "creature_population" | "champion" | "other";
  petty?: boolean;
  deedsRequired?: number;
  challengesRequired?: number;
}): Quote {
  const scopeCost = SCOPE_COST[input.scope];
  const ward = input.wardRatings.length ? Math.max(...input.wardRatings) : 0;
  const opposition = input.resisterRatings.length
    ? Math.max(...input.resisterRatings) + (input.resisterRatings.length - 1)
    : 0;
  const multiplier = MULTIPLIER[input.magnitude];
  const base = scopeCost + ward + opposition;
  const defaults = defaultObstacles(input.scope, input.magnitude, input.kind, input.petty ?? false);
  return {
    scopeCost, ward, opposition, base, multiplier, total: base * multiplier,
    deedsRequired: input.deedsRequired ?? defaults.deeds,
    challengesRequired: input.challengesRequired ?? defaults.challenges,
  };
}

function defaultObstacles(scope: Scope, magnitude: Magnitude, kind: string | undefined, petty: boolean): {
  deeds: number; challenges: number;
} {
  if (petty && magnitude === "impossible" && scope === "village") return { deeds: 0, challenges: 0 };
  if (kind === "creature_population" && (magnitude === "impossible" || magnitude === "vast")) {
    const deeds = SCOPE_COST[scope];
    return { deeds, challenges: deeds };
  }
  const large = scope === "region" || scope === "nation" || scope === "realm";
  if (magnitude === "plausible" || magnitude === "improbable") {
    return { deeds: 0, challenges: large ? 1 : 0 };
  }
  const challenges = scope === "realm" ? 6 : scope === "nation" ? 3 : scope === "region" ? 2 : 1;
  return {
    deeds: 1,
    challenges: magnitude === "vast" ? Math.max(2, challenges) : challenges,
  };
}

export function factionProjectCost(power: Power, magnitude: "plausible" | "improbable"): number {
  return SCOPE_COST[SCOPE_BY_POWER[power]] * MULTIPLIER[magnitude];
}

export function restoreCohesionCost(power: Power): number {
  return SCOPE_COST[SCOPE_BY_POWER[power]] * 2;
}

export function championStats(level: number, loyal: boolean): {
  effectiveLevel: number; hitDice: number; attacks: number; actions: number;
  damage: string; effort: number; lesserGifts: number; dominionCost: 8;
} {
  const effectiveLevel = loyal ? Math.ceil(level / 2) : level;
  return {
    effectiveLevel,
    hitDice: 5 + 2 * effectiveLevel,
    attacks: Math.ceil(effectiveLevel / 3),
    actions: Math.ceil(effectiveLevel / 5),
    damage: "1d8",
    effort: effectiveLevel,
    lesserGifts: Math.ceil(effectiveLevel / 3),
    dominionCost: 8,
  };
}
```

`src/rules/wealth.ts`:

```ts
import { RuleError } from "../domain/types.js";

export function influenceFromWealth(wealth: number, want?: number): { influence: number; wealthUsed: number } {
  if (want != null) {
    const wealthUsed = (want * (want + 1)) / 2;
    if (wealth < wealthUsed) throw new RuleError("INSUFFICIENT_WEALTH", `need ${wealthUsed} wealth for ${want} influence`);
    return { influence: want, wealthUsed };
  }
  let influence = 0;
  let wealthUsed = 0;
  let next = 1;
  while (wealth - wealthUsed >= next) {
    wealthUsed += next;
    influence += 1;
    next += 1;
  }
  return { influence, wealthUsed };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/rules/cost.test.ts`
Expected: PASS. `championStats(5, false).hitDice` is `5 + 2*5 = 15`. `loyal` effective level `ceil(5/2) = 3`, hit dice `5 + 6 = 11`.

- [ ] **Step 5: Commit**

```bash
git add src/rules/cost.ts src/rules/wealth.ts test/rules/cost.test.ts
git commit -m "feat: quote change costs, wealth, and champions"
```

### Task 4: Contests and cult income

**Files:**
- Create: `src/rules/contest.ts`
- Create: `src/rules/cults.ts`
- Test: `test/rules/contest.test.ts`

**Interfaces:**
- Consumes: `FeatureTags`, `Rng`, `rollDie`, `Power`, `DIE_BY_POWER`, `Harshness`
- Produces: `unevenBonus`, `featureRoll`, `resolveContest`, `cultBudget`, `monthlyDominion`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { featureRoll, resolveContest, unevenBonus } from "../../src/rules/contest.js";
import { cultBudget, monthlyDominion } from "../../src/rules/cults.js";
import { mulberry32 } from "../../src/rules/dice.js";
import type { FeatureTags } from "../../src/domain/types.js";

const rifle: FeatureTags = {
  size: "vast", quality: "superior", magical: true, origin: "impossible", domain: "military",
};
const militia: FeatureTags = {
  size: "normal", quality: "normal", magical: false, origin: "native", domain: "military",
};

test("enchanted flying riflemen are worth +5 and a natural 1 takes none of it", () => {
  expect(unevenBonus(rifle, militia)).toBe(5);
  const lucky = featureRoll({ rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 1 });
  expect(lucky.bonus).toBe(0);
  expect(lucky.total).toBe(1);
  const strong = featureRoll({ rng: mulberry32(1), faces: 20, marginal: false, bonus: 5, forced: 7 });
  expect(strong.total).toBe(12);
});

test("marginal rolls keep the lower die", () => {
  const roll = featureRoll({
    rng: mulberry32(1), faces: 8, marginal: true, bonus: 0, forcedPair: [2, 8],
  });
  expect(roll.kept).toBe(2);
});

test("ties go to higher power, then to the defender", () => {
  expect(resolveContest({ attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 1 })).toBe("attacker");
  expect(resolveContest({ attackerTotal: 4, defenderTotal: 4, attackerPower: 2, defenderPower: 2 })).toBe("defender");
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

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/rules/contest.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `src/rules/contest.ts`**

```ts
import type { FeatureTags, Power, RollRecord } from "../domain/types.js";
import { rollDie, type Rng } from "./dice.js";

export function unevenBonus(mine: FeatureTags, theirs: FeatureTags | null, magicRelevant = true): number {
  if (!theirs) return 0;
  let bonus = 0;
  if (mine.size === "vast" && theirs.size !== "vast") bonus += 1;
  if (mine.quality === "superior" && theirs.quality !== "superior") bonus += 1;
  if (mine.magical && magicRelevant) bonus += 1;
  if (mine.origin === "improbable") bonus += 1;
  if (mine.origin === "impossible") bonus += 2;
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

When the defender has no feature, the service does not call `resolveContest`. It records an attacker `featureRoll` and sets the winner to `"attacker"` even if `kept === 1`.

`src/rules/cults.ts`:

```ts
import type { Harshness } from "../domain/types.js";

export function cultBudget(harshness: Harshness, dieMax: number): number {
  if (harshness === "nominal") return 0;
  if (harshness === "sharp") return Math.ceil(dieMax / 4);
  if (harshness === "grueling") return dieMax / 2;
  return Math.ceil((dieMax * 3) / 4);
}

export function monthlyDominion(input: {
  kind: "cult" | "free" | "none"; power: number; harshness: Harshness; level: number;
}): number {
  if (input.kind === "none") return 0;
  if (input.kind === "free") return 1 + Math.floor(input.level / 3);
  const extra = input.harshness === "sharp" ? 1
    : input.harshness === "grueling" ? 2
    : input.harshness === "overwhelming" ? 3 : 0;
  return input.power + extra;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/rules/contest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rules/contest.ts src/rules/cults.ts test/rules/contest.test.ts
git commit -m "feat: resolve contests and cult income"
```

### Task 5: Attack damage and defender policy

**Files:**
- Create: `src/rules/actions.ts`
- Test: `test/rules/actions.test.ts`

**Interfaces:**
- Consumes: `Power`, `RuleError`
- Produces: `attackProblemDamage`, `chooseDefense`, `interestCap`, `interestModifier`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { attackProblemDamage, chooseDefense, interestCap, interestModifier } from "../../src/rules/actions.js";

test("a power-4 attacker inflicts 4 problem points on a power-1 defender", () => {
  expect(attackProblemDamage(4, 1)).toBe(4);
  expect(attackProblemDamage(1, 1)).toBe(1);
  expect(attackProblemDamage(1, 4)).toBe(1);
});

test("preserve_existence avoids collapse", () => {
  const choice = chooseDefense({
    policy: "preserve_existence",
    cohesion: 1,
    trouble: 4,
    dieMax: 6,
    problemDamage: 2,
    canSacrifice: true,
  });
  expect(choice).toBe("sacrifice");
  const wounded = chooseDefense({
    policy: "preserve_existence",
    cohesion: 2,
    trouble: 1,
    dieMax: 6,
    problemDamage: 1,
    canSacrifice: true,
  });
  expect(wounded).toBe("problem");
});

test("interest cap is twice the owner die and the modifier cannot exceed that die", () => {
  expect(interestCap(6)).toBe(12);
  expect(interestModifier(6, 6)).toBe(6);
  try {
    interestModifier(6, 7);
    throw new Error("should have thrown");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("MODIFIER_EXCEEDS_DIE");
  }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/rules/actions.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `src/rules/actions.ts`**

```ts
import { RuleError, type Power } from "../domain/types.js";

export function attackProblemDamage(attacker: Power, defender: Power): number {
  return 1 + Math.max(0, attacker - defender);
}

export type DefenseChoice = "cohesion" | "sacrifice" | "problem";

export function chooseDefense(input: {
  policy: "preserve_existence";
  cohesion: number;
  trouble: number;
  dieMax: number;
  problemDamage: number;
  canSacrifice: boolean;
}): DefenseChoice {
  const options: DefenseChoice[] = ["problem", "cohesion"];
  if (input.canSacrifice) options.push("sacrifice");
  const collapses = (choice: DefenseChoice) => {
    if (choice === "sacrifice") return false;
    if (choice === "cohesion") return input.cohesion - 1 <= 0;
    return input.trouble + input.problemDamage >= input.dieMax;
  };
  const safe = options.find((choice) => !collapses(choice));
  if (safe) return safe;
  if (input.canSacrifice) return "sacrifice";
  return "problem";
}

export function interestCap(dieMax: number): number {
  return dieMax * 2;
}

export function interestModifier(dieMax: number, spend: number): number {
  if (spend > dieMax) {
    throw new RuleError("MODIFIER_EXCEEDS_DIE", `cannot modify by ${spend} with a d${dieMax}`);
  }
  if (spend < 1) throw new RuleError("MODIFIER_EXCEEDS_DIE", "modifier must be at least 1");
  return spend;
}
```

`chooseDefense` walks `problem`, then `cohesion`, then `sacrifice`, and returns the first that does not collapse. That is the spec order: prefer the problem, then cohesion loss, then sacrifice. When all collapse, sacrifice if possible, else the problem.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/rules/actions.test.ts`
Expected: PASS. The first case has cohesion 1 and trouble 4 on a d6 with 2 damage: the problem reaches 6 and cohesion loss reaches 0, so the choice is `sacrifice`.

- [ ] **Step 5: Commit**

```bash
git add src/rules/actions.ts test/rules/actions.test.ts
git commit -m "feat: add attack damage and defender policy"
```

### Task 6: Catalog loader and partial fill

**Files:**
- Create: `src/tables/catalog.json` (copy of the spec catalog)
- Create: `src/tables/catalog.ts`
- Test: `test/generate/fill.test.ts`

**Interfaces:**
- Consumes: `Rng`, `RuleError`
- Produces: `loadCatalog`, `pickOrRoll`

The spec file map names `src/generate/fill.ts`. This task's steps only load the catalog and honor picks. Task 7 creates `fill.ts` and uses it for the `require` / `missing` / `blank` contract. There is no `FillSession` type.

- [ ] **Step 1: Copy the catalog and write the failing test**

Run: `mkdir -p src/tables && cp docs/superpowers/specs/generator-catalog.json src/tables/catalog.json`

```ts
import { expect, test } from "vitest";
import { loadCatalog, pickOrRoll } from "../../src/tables/catalog.js";
import { mulberry32 } from "../../src/rules/dice.js";

test("aristocratic conflicts are a d12 and picks are 1-based", () => {
  const catalog = loadCatalog();
  expect(catalog.courts.aristocratic.conflict).toHaveLength(12);
  const picked = pickOrRoll(catalog, "courts.aristocratic.conflict", mulberry32(1), 1);
  expect(picked.text).toBe(catalog.courts.aristocratic.conflict[0]);
  expect(picked.forced).toBe(true);
  expect(() => pickOrRoll(catalog, "courts.aristocratic.conflict", mulberry32(1), 13)).toThrow(/PICK_OUT_OF_RANGE/);
});

test("a missing field rolls once and a provided field is kept", () => {
  const catalog = loadCatalog();
  const kept = pickOrRoll(catalog, "courts.aristocratic.atmosphere", mulberry32(1), undefined, "Already chosen");
  expect(kept.text).toBe("Already chosen");
  expect(kept.forced).toBe(false);
  const rolled = pickOrRoll(catalog, "powerStructure", mulberry32(2));
  expect(rolled.index).toBeGreaterThanOrEqual(1);
  expect(rolled.index).toBeLessThanOrEqual(6);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/generate/fill.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `src/tables/catalog.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RuleError } from "../domain/types.js";
import type { Rng } from "../rules/dice.js";

export interface Catalog {
  powerStructure: { id: string; text: string; agreement: string }[];
  minorRelationship: { id: string; text: string }[];
  interestNature: { id: string; text: string; autoIntervene: "help" | "harm" | "none" }[];
  courts: Record<string, Record<string, string[]>>;
  challenges: Record<string, string[]>;
  features: Record<string, string[]>;
  problems: Record<string, string[]>;
  backlash: string[];
  goals: Record<string, { min: number; max: number; strategy: string }[]>;
}

let cached: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const path = fileURLToPath(new URL("./catalog.json", import.meta.url));
  cached = JSON.parse(readFileSync(path, "utf8")) as Catalog;
  return cached;
}

function rowsAt(catalog: Catalog, path: string): { id?: string; text: string }[] {
  const parts = path.split(".");
  let cursor: unknown = catalog;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) {
      throw new RuleError("PICK_UNKNOWN", `unknown table ${path}`);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (!Array.isArray(cursor)) throw new RuleError("PICK_UNKNOWN", `unknown table ${path}`);
  return cursor.map((row: unknown, index: number) => {
    if (typeof row === "string") return { id: String(index + 1), text: row };
    const obj = row as { id?: string; text: string };
    return { id: obj.id, text: obj.text };
  });
}

export function pickOrRoll(
  catalog: Catalog,
  path: string,
  rng: Rng,
  pick?: number | string,
  provided?: string,
): { text: string; index: number; forced: boolean } {
  if (provided != null) return { text: provided, index: 0, forced: false };
  const rows = rowsAt(catalog, path);
  if (pick == null) {
    const index = 1 + Math.floor(rng.next() * rows.length);
    return { text: rows[index - 1].text, index, forced: false };
  }
  if (typeof pick === "number") {
    if (pick < 1 || pick > rows.length) throw new RuleError("PICK_OUT_OF_RANGE", `${path} has no row ${pick}`);
    return { text: rows[pick - 1].text, index: pick, forced: true };
  }
  const found = rows.findIndex((row) => row.id === pick || row.text.toLowerCase() === pick.toLowerCase());
  if (found < 0) throw new RuleError("PICK_UNKNOWN", `${pick} is not in ${path}`);
  return { text: rows[found].text, index: found + 1, forced: true };
}
```

Resolve JSON import by reading the file, as above, so Vitest and Node both work without `resolveJsonModule`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/generate/fill.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tables/catalog.json src/tables/catalog.ts test/generate/fill.test.ts
git commit -m "feat: load generator tables and honor picks"
```

### Task 7: Court and faction generators

**Files:**
- Create: `src/generate/fill.ts`
- Create: `src/generate/court.ts`
- Create: `src/generate/faction.ts`
- Test: `test/generate/court.test.ts`

**Interfaces:**
- Consumes: `pickOrRoll`, `loadCatalog`, `FillMode`, `RuleError`, `interestCap`, `DIE_BY_POWER`
- Produces: `defaultFill`, `assertRequired`, `displayName`, `quarrelSummary`, `generateCourt`, `problemBudget`, `splitProblemPoints`, `generateProblems`

A generated court is a plain object, not a database row. Names are null in `blank` mode. In `missing` mode, names are `Unnamed {role}` unless `names` provides one. In `require` mode, `generateCourt` throws `FILL_INCOMPLETE` if `type` or `powerStructure` is missing; it does not roll.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { generateCourt } from "../../src/generate/court.js";
import { problemBudget } from "../../src/generate/faction.js";

test("blank courts roll structure and leave names empty", () => {
  const court = generateCourt({ fill: "blank", seed: 7, majorCount: 3, minorCount: 2 });
  expect(court.actors.filter((actor) => actor.rank === "major")).toHaveLength(3);
  expect(court.actors.every((actor) => actor.name == null)).toBe(true);
  expect(court.conflict.fittedSummary).toBeNull();
  expect(court.conflict.text.length).toBeGreaterThan(0);
  const leaders = court.actors.filter((actor) => actor.isLeader || actor.isHiddenController || actor.sharesAuthority);
  if (court.powerStructure === "autocratic") expect(court.actors.filter((a) => a.isLeader)).toHaveLength(1);
  expect(leaders.length).toBeGreaterThanOrEqual(0);
});

test("require mode does not invent a type", () => {
  try {
    generateCourt({ fill: "require", seed: 1 });
    throw new Error("should have thrown");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("FILL_INCOMPLETE");
  }
});

test("a supplied conflict is kept", () => {
  const court = generateCourt({
    fill: "missing", seed: 3, type: "temple", conflict: "Who keeps the relic",
  });
  expect(court.type).toBe("temple");
  expect(court.conflict.text).toBe("Who keeps the relic");
});

test("prosperous and crisis budgets", () => {
  expect(problemBudget(6, "prosperous", "half")).toBe(2);
  expect(problemBudget(12, "prosperous", "half")).toBe(3);
  expect(problemBudget(6, "crisis", "half")).toBe(3);
  expect(problemBudget(6, "crisis", "three-quarter")).toBe(5);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/generate/court.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`src/generate/fill.ts` exports the generation-contract helpers. `RuleError.message` is the message only; the code stays on `.code`.

```ts
import { RuleError, type FillMode } from "../domain/types.js";

export function defaultFill(fill?: FillMode): FillMode {
  return fill ?? "missing";
}

export function assertRequired(fill: FillMode, fields: Record<string, unknown>): void {
  if (fill !== "require") return;
  const missing = Object.entries(fields)
    .filter(([, value]) => value == null || value === "")
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new RuleError("FILL_INCOMPLETE", `missing ${missing.join(", ")}`, { fields: missing });
  }
}

export function displayName(fill: FillMode, role: string, provided?: string | null): string | null {
  if (fill === "blank") return null;
  if (provided != null && provided !== "") return provided;
  return `Unnamed ${role}`;
}

export function quarrelSummary(
  fill: FillMode,
  protagonist: string | null,
  conflict: string,
  antagonist: string | null,
): string | null {
  if (fill === "blank") return null;
  return `${protagonist} presses the quarrel (${conflict}). ${antagonist} opposes.`;
}
```

`generateCourt` calls `assertRequired(fill, { type: input.type, powerStructure: input.powerStructure })` before any roll. Names come from `displayName`. `fittedSummary` comes from `quarrelSummary`. Do not invent a `FillSession` type.

`generateCourt` input:

```ts
export interface CourtDraftInput {
  fill: FillMode;
  seed: number;
  type?: string;
  powerStructure?: string;
  conflict?: string;
  atmosphere?: string;
  majorCount?: number;
  minorCount?: number;
  names?: string[];
}
```

Algorithm:

1. `const rng = mulberry32(input.seed)`.
2. If `fill === "require"` and (`type` or `powerStructure` is missing), throw `RuleError("FILL_INCOMPLETE", ...)`.
3. Roll or keep `powerStructure` via `pickOrRoll(catalog, "powerStructure", rng, undefined, input.powerStructure)`. The power-structure rows are objects; `pickOrRoll` returns `text`. Also return the row `id` by looking up the text. Store `agreement` from that row.
4. Type: if missing and fill is not require, `1 + floor(rng.next() * 6)` indexes `Object.keys(catalog.courts)`.
5. `majorCount` defaults to 3 and is clamped to 2..5. Push an advisory string if the caller asked outside that range and was clamped.
6. For each major, roll `courts.${type}.majorActor` and `courts.${type}.powerSource`. Name is null when `fill === "blank"`, else the next unused `names` entry, else `` `Unnamed ${role}` ``.
7. Assign flags from `agreement`:
   - `leader`: first major `isLeader`.
   - `hidden`: first major `isLeader`, second `isHiddenController`.
   - `all-sharers`: first two `sharesAuthority`.
   - `majority`: first major `isLeader`.
   - `all-major` and `none`: no flags.
8. Conflict text from the type's `conflict` table unless provided. Protagonist is major index 0, antagonist is major index 1. Other majors get side `protagonist` | `antagonist` | `neutral` from `floor(rng.next() * 3)`. `fittedSummary` is null when blank, otherwise `"{name0} presses the quarrel ({conflict}). {name1} opposes."`
9. Minors default to 3, from `minorActor`, plus `minorRelationship`.
10. One `destruction` row and one `defense` row. One `atmosphere` row unless provided.

`src/generate/faction.ts` exports:

```ts
export function problemBudget(dieMax: number, pressure: "prosperous" | "strained" | "crisis", crisisBand: "half" | "three-quarter"): number {
  if (pressure === "prosperous") return Math.round(dieMax / 4);
  if (pressure === "strained") return Math.round(dieMax / 3);
  if (crisisBand === "three-quarter") return Math.ceil((dieMax * 3) / 4);
  return dieMax / 2;
}
```

Also export `splitProblemPoints(budget: number, rng: Rng): number[]` which emits 1s, and a 2 when `remaining >= 2` and `rng.next() < 0.5`, without exceeding `budget`.

Export `generateProblems(budget, rng, catalog)` walking domains `cultural`, `military`, `economic` round-robin and calling `pickOrRoll` on `problems.${domain}`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/generate/court.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/generate/fill.ts src/generate/court.ts src/generate/faction.ts test/generate/court.test.ts
git commit -m "feat: generate courts and faction problem budgets"
```

### Task 8: SQLite schema and repositories

**Files:**
- Create: `src/store/db.ts`
- Create: `src/store/schema.sql`
- Test: `test/store/db.test.ts`

**Interfaces:**
- Consumes: nothing from rules
- Produces: `openDb(path: string): Database`, `migrate(db)`, `withTransaction`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";

test("migrate creates campaigns and rolls back a failed transaction", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 1, 0)").run("c1", "Test");
  expect(() => {
    db.transaction(() => {
      db.prepare("UPDATE campaigns SET month = 2 WHERE id = ?").run("c1");
      throw new Error("nope");
    })();
  }).toThrow(/nope/);
  const row = db.prepare("SELECT month FROM campaigns WHERE id = ?").get("c1") as { month: number };
  expect(row.month).toBe(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/store/db.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`src/store/schema.sql` creates, with `PRAGMA foreign_keys = ON` applied in `openDb` rather than in the file:

- `campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, month INTEGER NOT NULL, rng_seed INTEGER NOT NULL, roll_counter INTEGER NOT NULL, name_lists TEXT NOT NULL DEFAULT '{}')`
- `places (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), name TEXT NOT NULL, scope TEXT NOT NULL, parent_place_id TEXT, culture_id TEXT)`
- `wards (id TEXT PRIMARY KEY, place_id TEXT NOT NULL REFERENCES places(id), rating INTEGER NOT NULL, key_holder_ids TEXT NOT NULL DEFAULT '[]')`
- `factions (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, name TEXT NOT NULL, power INTEGER NOT NULL, cohesion INTEGER NOT NULL, dominion INTEGER NOT NULL, origin TEXT NOT NULL, behavior TEXT NOT NULL, control TEXT NOT NULL, auto_intervene INTEGER NOT NULL, status TEXT NOT NULL, patron_godbound_id TEXT, contested_control INTEGER NOT NULL DEFAULT 0, home_place_id TEXT, harshness TEXT, cult INTEGER NOT NULL DEFAULT 0)`
- `features` and `feature_parts` as in the spec, with `usable` implied by remaining parts. `features.covert INTEGER NOT NULL DEFAULT 0`
- `problems (id, faction_id, text, points, domain, intrinsic, external, resistance, face_character_id, position INTEGER NOT NULL)`
- `interests (id, from_faction_id, to_faction_id, points, nature, UNIQUE(from_faction_id, to_faction_id))`
- `characters` includes `acts_on_own INTEGER NOT NULL DEFAULT 0`
- `courts` includes `acts_on_own INTEGER NOT NULL DEFAULT 0`
- `court_memberships`, `conflicts`, `court_consequences`, `court_defenses`
- `facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id, superseded_by, visibility TEXT NOT NULL DEFAULT 'public')`. `visibility` is `public`, `local`, `privileged`, or `hidden`
- `godbound (id, campaign_id, name, level, words TEXT, influence INTEGER, dominion INTEGER, wealth INTEGER, divinity TEXT, cult_faction_id TEXT, acts_on_own INTEGER NOT NULL DEFAULT 0)`
- `changes` with the status and counter columns from the spec
- `change_commitments (change_id, godbound_id, influence, wealth_spent, PRIMARY KEY(change_id, godbound_id))`
- `resisters (id, change_id, rating, label)`
- `challenges`, `setpieces (id, campaign_id, key TEXT NOT NULL, need TEXT, status TEXT, UNIQUE(campaign_id, key))`
- `turns (id, campaign_id, month, sequence, open INTEGER NOT NULL, faction_order TEXT NOT NULL)`
- `unit_views (id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id), unit_type TEXT NOT NULL, unit_id TEXT NOT NULL, snapshot TEXT NOT NULL, UNIQUE(turn_id, unit_type, unit_id))`
- `write_queue (id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id), unit_type TEXT NOT NULL, unit_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL)`. `status` is `queued`, `applying`, `done`, or `rejected`
- `actions`, `rolls (id, campaign_id, turn_id, payload TEXT NOT NULL)`, `events (id, campaign_id, turn_id, type TEXT, payload TEXT NOT NULL)`

`openDb` reads the SQL file via `fileURLToPath(new URL("./schema.sql", import.meta.url))`, runs it, and sets `db.pragma("foreign_keys = ON")`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/store/db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts src/store/schema.sql test/store/db.test.ts
git commit -m "feat: add campaign sqlite schema"
```

### Task 9: Change and faction services

**Files:**
- Create: `src/services/change.ts`
- Create: `src/services/actions.ts`
- Test: `test/services/kistelek.test.ts`

**Interfaces:**
- Consumes: every `src/rules` export, `openDb`
- Produces: `beginChange`, `commitResources`, `applyOutcome`, `runAction`

This task wires the numeric rules into the database. It does not register MCP tools yet.

- [ ] **Step 1: Write the failing integration test**

Use `:memory:` and insert a Power 1 faction with cohesion 1, dominion 0, problems in order `(raid, 1)`, `(tax, 1)`, `(despair, 2)`, and no features. Insert a Power 2 faction with one military feature.

```ts
test("a forced trouble roll of 4 blames despair and gains no dominion", () => {
  const result = runAction(db, {
    campaignId: "c1", factionId: "village", type: "build_strength", forcedRoll: 4,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.success).toBe(false);
    expect(result.data.culpritId).toBe("despair");
  }
  const faction = db.prepare("SELECT dominion FROM factions WHERE id = ?").get("village") as { dominion: number };
  expect(faction.dominion).toBe(0);
});

test("pc feature creation adds one backlash problem and not a trouble check", () => {
  const begun = beginChange(db, {
    campaignId: "c1", owner: "pc", factionId: "village", scope: "village",
    magnitude: "plausible", kind: "feature", featureText: "The village has a band of trained warriors.",
    godboundId: "sword",
  });
  const committed = commitResources(db, { changeId: begun.data.changeId, godboundId: "sword", influence: 1 });
  expect(committed.data.status).toBe("active");
  const trouble = db.prepare("SELECT COALESCE(SUM(points), 0) AS t FROM problems WHERE faction_id = ?").get("village") as { t: number };
  expect(trouble.t).toBe(5);
});
```

Create the Godbound with influence 2 and dominion 0 in the arrange section. `beginChange` must quote total 1 for a plausible village with no ward.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/services/kistelek.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the two services**

`runAction` for `build_strength` loads the faction, refuses `COLLAPSED_FACTION`, calls `troubleCheck` with `forcedRoll`, and on success adds `Math.ceil(power / 2)` dominion. On failure it writes the roll and the action and does not change problems.

`beginChange` + `commitResources`:

- Quote with `quoteChange`. Store the quote on the change row.
- `commitResources` adds the influence commitment, sets `covered`, and if coverage, deeds, and challenges are all met, inserts the feature and one 1-point backlash problem from `catalog.backlash[0]` when the caller did not pass `backlash`.
- Faction-owned changes are rejected here; faction feature creation goes through `runAction` type `enact_change`, which calls `factionProjectCost`, spends dominion first, runs the normal trouble check, and on failure increments the culprit's points. On success it inserts the feature and a new 1-point problem. It does not also insert a PC backlash.

`applyOutcome` deletes or ruins a feature without a roll, or reduces a problem. Reducing `intrinsic = 1` throws `INTRINSIC_PROBLEM`. Adding a feature inserts the backlash problem.

Attack resolution in `runAction` type `attack`:

- Load both features. If the defender has no usable feature, winner is `attacker` after the attacker still rolls.
- Otherwise `featureRoll` both sides and `resolveContest`.
- On attacker win, if defender `control === "player"` and no `defenderChoice`, insert the action with `pending = 1` and return `PENDING_DEFENDER_CHOICE` without applying damage. The transaction commits.
- Otherwise `chooseDefense` or the explicit choice, then apply cohesion -1, ruin the feature, or add `attackProblemDamage` points.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/services/kistelek.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/change.ts src/services/actions.ts test/services/kistelek.test.ts
git commit -m "feat: persist changes and faction actions"
```

### Task 10: Turns, goals, cults, and queries

**Files:**
- Create: `src/rules/goals.ts`
- Create: `src/services/turn.ts`
- Create: `src/queries/brief.ts`
- Create: `src/queries/rumors.ts`
- Test: `test/services/turn.test.ts`

**Interfaces:**
- Consumes: `runAction`, `monthlyDominion`, `cultBudget`, catalog `goals`
- Produces: `planGoal`, `runFactionTurn`, `advanceMonth`, `worldBrief`, `rumorLines`, `decisionMakers`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { planGoal } from "../../src/rules/goals.js";
import { decisionMakers } from "../../src/queries/brief.js";

test("a despotic 1 or 2 is glorify", () => {
  expect(planGoal("despotic_tyrant", 1).strategy).toBe("glorify");
  expect(planGoal("despotic_tyrant", 9).strategy).toBe("expand_reach");
  expect(planGoal("martial_conqueror", 5).strategy).toBe("half_interest");
});

test("anarchic courts bind nobody", () => {
  const result = decisionMakers({
    powerStructure: "anarchic",
    actors: [{ id: "a", rank: "major", isLeader: false, isHiddenController: false, sharesAuthority: false }],
  });
  expect(result.binds).toBe(false);
  expect(result.approaches).toEqual(["a"]);
});
```

Add one database test: two active NPC factions, `runFactionTurn` with seed forcing a known shuffle, `advanceMonth: true`, and a free divinity at level 6. After the call, that Godbound's dominion increased by 3 and `month` is 2.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/services/turn.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`planGoal` reads `loadCatalog().goals[behavior]`, finds the row whose `min <= roll <= max`, and returns `{ strategy }`. `directed` throws `RuleError("MAGNITUDE_REJECTED", "directed factions need an explicit plan")` if called.

`runFactionTurn` is the mechanical one-shot from the spec: shuffle the acting units, build each plan from the goal table, apply in that order, close the turn, then `advanceMonth` when requested. It may read full faction rows. It does not spend Interest on a faction's behalf. Standing orders and the privy-information filter arrive in Task 13, which wraps target selection so a mechanical plan cannot name an id outside `projectUnitView`. When a strategy is satisfied (`stockpile` and dominion already `>= 2 * power`, or `half_interest` already at the die maximum against that target), roll the d10 once more via `rollDie`. Explicit `actions` on the request skip `planGoal` for that faction.

`decisionMakers` implements the six-row table in the spec. `rumorLines` maps each closed turn's actions to:

`"{faction} attempted {action} against {target} with {feature} and {outcome} because {reason}."`

Use `themselves` when there is no target. `reason` is the culprit text, `won the contest`, or `lost the contest`.

`worldBrief` returns month, each faction's power, trouble (sum of points), cohesion, status, and `dieMax - trouble`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/services/turn.test.ts test/rules test/services/kistelek.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rules/goals.ts src/services/turn.ts src/queries/brief.ts src/queries/rumors.ts test/services/turn.test.ts
git commit -m "feat: run faction turns and derived briefs"
```

### Task 11: MCP adapter

**Files:**
- Create: `src/mcp/register.ts`
- Create: `src/server.ts`
- Create: `src/app.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- Consumes: the service functions from Tasks 9 and 10, plus `generateCourt` and a `seedCampaign` function added in this task to `src/services/populate.ts`
- Produces: `buildServer(): McpServer`, stdio `main`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/mcp/register.js";

test("quote_change through MCP returns the ward example", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "quote_change",
    arguments: { scope: "city", magnitude: "improbable", wardRatings: [4], resisterRatings: [] },
  });
  const text = (result.content as { text: string }[])[0].text;
  const body = JSON.parse(text);
  expect(body.ok).toBe(true);
  expect(body.data.total).toBe(12);
  await client.close();
});
```

`InMemoryTransport.createLinkedPair` is the export in `@modelcontextprotocol/sdk` 1.30.0. Do not spawn a network port.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the adapter**

`buildServer(dbPath: string)` opens the database once and registers tools with `server.registerTool(name, { description, inputSchema }, handler)`. `inputSchema` is a raw Zod shape. Every handler returns:

```ts
{ content: [{ type: "text", text: JSON.stringify(envelope) }], structuredContent: envelope }
```

Catch `RuleError` and return `{ ok: false, error: { code, message, details } }` as that envelope. Do not throw out of the handler.

Register these tools, each calling the service of the same name. Schemas use `z.string()`, `z.number().int()`, `z.enum(...)`, and `.optional()` matching the spec fields:

`create_campaign`, `seed_campaign`, `create_place`, `create_godbound`, `advance_month`, `create_faction`, `create_court`, `fit_blank`, `create_character`, `create_fact`, `ensure_setpiece`, `create_challenge`, `quote_change`, `begin_change`, `commit_resources`, `withdraw_influence`, `assess_withdrawal`, `resolve_withdrawal`, `record_deed`, `record_challenge_outcome`, `expand_change`, `create_champion`, `apply_outcome`, `sway_court`, `form_cult`, `set_theology`, `set_divinity`, `set_power`, `run_faction_turn`, `faction_action`, `resolve_attack`, `spend_interest`, `record_shatter`, `get_world_brief`, `get_faction`, `get_court`, `explain_roll`, `list_hooks`, `list_rumors`, `decision_makers`, `cult_income`, `interest_map`, `relevant_features`.

`quote_change` is pure and does not need a campaign id. Its schema is `{ scope, magnitude, wardRatings: z.array(z.number().int().min(1).max(20)).default([]), resisterRatings: z.array(z.number().int().min(1)).default([]), kind: optional, petty: optional }`.

`seed_campaign` writes places, factions, interests, and optional ruling courts through `generateCourt` and `generateProblems`, using `fill` from the request.

Resources:

- `world://campaigns/{id}/brief` → `worldBrief`
- `world://campaigns/{id}/factions/{factionId}` → faction query
- `world://campaigns/{id}/courts/{courtId}` → court query
- `world://campaigns/{id}/turns/latest` → rumor lines plus raw actions
- `world://campaigns/{id}/hooks` → `list_hooks`
- `world://tables/{path}` → `rowsAt` text JSON

Prompts `gm-briefing` and `faction-turn-narration` take `campaignId` and embed the JSON from those queries. The prompt text tells the model to narrate only the JSON and not to invent dice results.

Before registering tools, implement these remaining service functions in `src/services/populate.ts`, `src/services/change.ts`, and `src/services/turn.ts`. Each one is a transaction. Each one throws `RuleError` with the spec code. None of them rerolls a field that is already stored.

| Function | Behavior |
| --- | --- |
| `seedCampaign` | Insert campaign, places, factions, features, problems from `problemBudget` and `splitProblemPoints`, mutual interests at each side's die maximum, optional ruling court via `generateCourt`. |
| `fitBlank` | Set null character names from the culture list or `Unnamed {role} {n}`. Set `fittedSummary` from the caller or the court template in the spec. Set `blank = 0`. |
| `ensureSetpiece` | Select by `(campaign_id, key)`. If a row exists, return it and roll nothing. Otherwise create the need from the spec's ensure table and insert the setpiece. |
| `createFact` | `missing` without `statement` throws `FILL_INCOMPLETE`. `blank` inserts a null statement. |
| `withdrawInfluence` | Zero that Godbound's commitment. If coverage drops below `total`, set `decaying` and `maintained = 0`. Do not refund dominion. |
| `assessWithdrawal` | Read-only. Return `opposed`, `beyond_local_maintenance`, and `persists_uncontrolled` per the spec. |
| `resolveWithdrawal` | Require `decaying`. `undo` ruins the feature and supersedes the fact. `leave_fragile` adds one problem point. `stable` sets `resolved` and `maintained = 1`. |
| `expandChange` | Same scope and magnitude: insert a child fact, spend 0. Otherwise charge `max(0, newTotal - oldTotal)` and raise deed and challenge counters to the new quote. |
| `swayCourt` | `favor` writes a fact. `control` sets disposition and, when the court rules a faction and `prepared` is not true, inserts the 2-point usurper problem from the spec. |
| `formCult` | Require `acknowledged: true`. Create or adopt the faction. Insert the caller's feature. Set intrinsic points from `cultBudget`. |
| `setTheology` | If power is 1, collapse the cult. Otherwise power -= 1 and clamp cohesion. Rescale intrinsic points to the new budget. Occupy the internal action. |
| `setDivinity` | `free` with an existing cult requires `gmOverride: true`. Free divinities have a null `cult_faction_id`. |
| `setPower` | GM write of power 1–5. Clamp cohesion to the new power. Do not delete interest above the new cap. |
| `spendInterest` | Enforce one spend per target per turn, `interestModifier`, and the before/after/steal costs in the spec. After-roll spends fail with `INSUFFICIENT_DOMINION` without reducing interest when dominion is short. |
| `advanceMonth` | The function specified in Task 10. |
| `listHooks` | Problems with null face, open challenges, decaying changes, blank courts, court destruction texts, factions with margin ≤ 1. |

`src/server.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./mcp/register.js";

const db = process.env.GODBOUND_WORLD_DB ?? "./data/campaign.sqlite";
const server = buildServer(db);
await server.connect(new StdioServerTransport());
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every file from Tasks 2–11.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0. If `src/server.ts` is excluded because it is executed via strip-types, still typecheck it. `better-sqlite3` types must compile.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register.ts src/server.ts src/app.ts src/services/populate.ts test/mcp.test.ts
git commit -m "feat: expose the world engine over MCP"
```

### Task 12: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the scripts from Task 1
- Produces: operator instructions

- [ ] **Step 1: Write `README.md`**

Title: Godbound faction world MCP.

Say what it is: a local MCP that stores one campaign world, fills omitted court and faction fields from `src/tables/catalog.json`, runs faction turns, and quotes Influence and Dominion. Say ruin layouts are absent.

How to run:

```bash
npm install
npm test
mkdir -p data
GODBOUND_WORLD_DB=./data/campaign.sqlite npm start
```

The process speaks MCP on stdin and stdout. Point a client at that command. There is no HTTP port.

Mention the design docs:

- `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md`
- `docs/superpowers/plans/2026-09-21-godbound-faction-mcp.md`

State that generator sentences are original category prompts, and that a caller can pass any field in full instead of rolling.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: explain how to run the faction MCP"
```

The README in this step replaces a design-only README if one was committed with the spec. Keep one README.

### Task 13: Privy views, lock file, and write queue

**Files:**
- Create: `src/rules/knowledge.ts`
- Create: `src/store/lock.ts`
- Create: `src/services/queue.ts`
- Test: `test/rules/knowledge.test.ts`
- Test: `test/store/lock.test.ts`

**Interfaces:**
- Consumes: faction, feature, problem, interest, court, and fact rows from Tasks 8–10. `RuleError` codes `UNKNOWN_TO_UNIT`, `WRITE_LOCKED`, `QUEUE_CLOSED`.
- Produces: `projectUnitView`, `withWriteLock`, `openParallelTurn`, `submitUnitPlan`, `applyWriteQueue`

- [ ] **Step 1: Write the failing knowledge test**

```ts
import { expect, test } from "vitest";
import { projectUnitView } from "../../src/rules/knowledge.js";

const world = {
  factions: [
    { id: "us", name: "Us", power: 1, cohesion: 1, dominion: 3, homePlaceId: "p", behavior: "directed", status: "active" },
    { id: "them", name: "Them", power: 2, cohesion: 2, dominion: 9, homePlaceId: "far", behavior: "despotic_tyrant", status: "active" },
  ],
  places: [{ id: "p", name: "Home", scope: "village", parentPlaceId: null }, { id: "far", name: "Far", scope: "city", parentPlaceId: null }],
  features: [
    { id: "f1", factionId: "them", text: "Open market", domain: "economic", covert: false },
    { id: "f2", factionId: "them", text: "Secret rifles", domain: "military", covert: true },
  ],
  problems: [
    { id: "pr1", factionId: "them", text: "Bandits", domain: "military", points: 1, intrinsic: false },
    { id: "pr2", factionId: "them", text: "Empty treasury", domain: "economic", points: 1, intrinsic: false },
  ],
  interests: [{ fromFactionId: "us", toFactionId: "them", points: 4, nature: "rivalry" }],
  courts: [],
  characters: [{ id: "c1", name: "Spy", statNote: "HD 4", courtId: null, isHiddenController: false }],
  facts: [],
  events: [],
};

test("a rival sees military secrets and not dominion", () => {
  const view = projectUnitView(world, { type: "faction", id: "us" });
  const them = view.known.factions.find((faction) => faction.id === "them");
  expect(them?.features.map((feature) => feature.id).sort()).toEqual(["f1", "f2"]);
  expect(them?.problems.map((problem) => problem.id)).toEqual(["pr1"]);
  expect(them).not.toHaveProperty("dominion");
  expect(JSON.stringify(view)).not.toContain("HD 4");
  expect(JSON.stringify(view)).not.toContain("despotic_tyrant");
});
```

Them is known because Us holds rivalry, even though the places do not touch. Non-covert features are always included for a known faction, and rivalry adds covert military features and military problems. The economic problem stays out. Dominion, cohesion, behavior, and `statNote` stay out.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/rules/knowledge.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `projectUnitView`**

Follow the spec section "Who is privy to what" field for field. Own sheet is complete. Another faction is omitted when no inclusion rule matches. Rivalry adds military features and military problems and does not copy `dominion`, `cohesion`, or `behavior`. Strip `statNote` everywhere in the output. Figurehead courts the viewer cannot see through report `agreement: "leader"`.

- [ ] **Step 4: Write the lock and queue tests**

Use a temporary directory and a file database, not `:memory:`, for the lock file.

```ts
import { expect, test } from "vitest";
import { withWriteLock } from "../../src/store/lock.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a dead stale lock is reclaimed", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-"));
  const dbPath = join(dir, "campaign.sqlite");
  // seed the lock file with pid 2**22 (not running) and a timestamp 60s ago
  // then withWriteLock(dbPath, () => "entered") returns "entered"
});

test("two plans both persist and apply in shuffle order", () => {
  // openParallelTurn with a forced order ["late", "early"]
  // submit early after late
  // applyWriteQueue resolves late's plan first
});
```

The second test builds two Power 1 factions that know each other, opens a turn whose stored order is `["b", "a"]`, submits `a` first and `b` second, and asserts the action log lists `b` before `a`.

`withWriteLock` uses exclusive create on `dbPath + ".lock"`. Timeout throws `RuleError` code `WRITE_LOCKED`. A lock older than 30000 ms whose `process.kill(pid, 0)` throws is unlinked.

- [ ] **Step 5: Implement the queue service**

`submitUnitPlan` validates ids against the stored snapshot, then inserts under `withWriteLock`. `applyWriteQueue` applies in `turns.faction_order`. Missing units with `missing: "idle"` write an idle action. A plan targeting an unknown id is stored `rejected` with `UNKNOWN_TO_UNIT` and does not throw away the rest of the queue.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/rules/knowledge.test.ts test/store/lock.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/rules/knowledge.ts src/store/lock.ts src/services/queue.ts test/rules/knowledge.test.ts test/store/lock.test.ts
git commit -m "feat: isolate unit knowledge and serialize parallel plans"
```
