# Seed outline faction behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `seed_campaign` from storing `self_absorbed_survivor` when an outline faction omits `behavior`, and roll a chart behavior only when the caller opted in by leaving it out under `fill: "missing"`.

**Architecture:** `rollChartBehavior` in `src/generate/faction.ts` picks a sorted `goals` key. `seedCampaign` decides whether to call it from `fill` and the outline index, on a RNG stream that does not touch feature, court, or interest rolls. The MCP schema stays optional. The overview gap keeps only the place-scope sentence, and the director manual states the fill rule.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, better-sqlite3 13.0.3, Vitest 5, Zod 3.24.2 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-seed-faction-behavior-design.md`. Issue #82.
- Opt-in is omission of `behavior` while `fill` is `missing`. An omitted `fill` is `missing` (`defaultFill`).
- `fill: "require"` and `fill: "blank"` with an omitted `behavior` throw `RuleError("FILL_INCOMPLETE", "behavior required")` inside the seed transaction, so nothing from that call is committed.
- Empty string is omission. Any other string, including free text and `directed`, is stored unchanged.
- Roll pool is `Object.keys(catalog.goals)` sorted lexicographically. `directed` is never rolled. Do not edit `src/tables/catalog.json`.
- Behavior RNG is `mulberry32(seed + 17000 + index)` with `index` the zero-based index in `outline.factions`.
- Feature RNG stays `seed + factionIds.size`. Court offset stays `seed + 100 + factionIds.size`. Interest offset stays `seed + 999`.
- Do not edit `src/mcp/register.ts`, place-scope resolution, or `create_faction`.
- Overview bullet becomes exactly: `` `seed_campaign` defaults an omitted place scope to `village`. Intent: place scope is always required. ``
- Director sentence becomes the paragraph in Task 2. Do not link outside `user/`.
- No unit test reads a documentation file or a prompt file and asserts on that file's text. No `rg` step that asserts those files' wording.
- Implement on this spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Package manager: npm. Tests: `npx vitest run <file>`.

---

## File map

- Create: `test/services/seed-faction-behavior.test.ts` — seed behavior contract.
- Modify: `src/generate/faction.ts` — `rollChartBehavior`.
- Modify: `src/services/populate.ts` — `outlineBehavior` and the faction loop in `seedCampaign`.
- Modify: `docs/design/overview.md` — drop the behavior half of the generation gap bullet.
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` — state when omission rolls.

`test/services/remove-campaign.test.ts` omits `behavior` under `fill: "missing"` and does not read the column. Leave it unchanged.

---

### Task 1: Seed outline behavior

**Files:**
- Create: `test/services/seed-faction-behavior.test.ts`
- Modify: `src/generate/faction.ts`
- Modify: `src/services/populate.ts` (`seedCampaign` faction loop, around the `behavior: fac.behavior ?? "self_absorbed_survivor"` argument)
- Test: `test/services/seed-faction-behavior.test.ts`

**Interfaces:**
- Consumes: `seedCampaign` from `src/services/populate.ts`. `openDb` from `src/store/db.ts`. `FillMode` from `src/domain/types.ts`. `Catalog` and `loadCatalog` from `src/tables/catalog.ts`. `Rng` and `mulberry32` from `src/rules/dice.ts`. `RuleError` from `src/domain/types.ts`.
- Produces: `export function rollChartBehavior(catalog: Catalog, rng: Rng): string` from `src/generate/faction.ts`. File-private `outlineBehavior(provided: string | undefined, fill: FillMode, seed: number, index: number): string` in `src/services/populate.ts`. `seedCampaign` stores that result on the faction row.

- [ ] **Step 1: Write the failing test**

Create `test/services/seed-faction-behavior.test.ts`:

```ts
import { expect, test } from "vitest";
import { seedCampaign } from "../../src/services/populate.js";
import { openDb } from "../../src/store/db.js";

const CHART = [
  "despotic_tyrant",
  "martial_conqueror",
  "scheming_manipulator",
  "self_absorbed_survivor",
] as const;

function behaviorOf(
  db: ReturnType<typeof openDb>,
  campaignId: string,
  name: string,
): string {
  const row = db
    .prepare("SELECT behavior FROM factions WHERE campaign_id = ? AND name = ?")
    .get(campaignId, name) as { behavior: string };
  return row.behavior;
}

function campaignCount(db: ReturnType<typeof openDb>): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number }).n;
}

test("omitted behavior under fill missing rolls the chart for seed 42", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("martial_conqueror");
});

test("omitted fill is missing, so seed 42 still rolls martial_conqueror", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("martial_conqueror");
});

test("seed 1 rolls survivor then schemer by outline index", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 1,
    linkInterests: false,
    outline: {
      factions: [
        { key: "a", name: "A" },
        { key: "b", name: "B" },
      ],
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("self_absorbed_survivor");
  expect(behaviorOf(db, result.data.campaignId, "B")).toBe("scheming_manipulator");
});

test("an explicit behavior wins over the roll", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "despotic_tyrant" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("despotic_tyrant");
});

test("explicit directed is stored and not replaced by a chart roll", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "directed" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("directed");
});

test("the outline index includes factions that passed a behavior", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 1,
    linkInterests: false,
    outline: {
      factions: [
        { key: "a", name: "A", behavior: "despotic_tyrant" },
        { key: "b", name: "B" },
      ],
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("despotic_tyrant");
  expect(behaviorOf(db, result.data.campaignId, "B")).toBe("scheming_manipulator");
});

test("an empty behavior string is omission and rolls", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("martial_conqueror");
});

test("fill require rejects an omitted behavior and commits nothing", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Nope",
    fill: "require",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
  expect(result.error.message).toBe("behavior required");
  expect(campaignCount(db)).toBe(0);
});

test("fill blank rejects an omitted behavior and commits nothing", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Nope",
    fill: "blank",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
  expect(result.error.message).toBe("behavior required");
  expect(campaignCount(db)).toBe(0);
});

test("fill require stores an explicit behavior", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Kept",
    fill: "require",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "despotic_tyrant" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("despotic_tyrant");
});

test("a missing-fill roll stays on a chart behavior", () => {
  for (let seed = 1; seed <= 24; seed++) {
    const db = openDb(":memory:");
    const result = seedCampaign(db, {
      name: "Roll",
      fill: "missing",
      seed,
      linkInterests: false,
      outline: { factions: [{ key: "a", name: "A" }] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(CHART).toContain(behaviorOf(db, result.data.campaignId, "A"));
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/seed-faction-behavior.test.ts`

Expected: FAIL. `fill: "require"` and `fill: "blank"` still return `ok: true` because the silent default stores `self_absorbed_survivor`. Seed `42` with an omitted behavior fails the `martial_conqueror` assertion for the same reason.

- [ ] **Step 3: Implement the helper and the resolver**

In `src/generate/faction.ts`, add `RuleError` to the imports from `../domain/types.js` and export this function:

```ts
export function rollChartBehavior(catalog: Catalog, rng: Rng): string {
  const keys = Object.keys(catalog.goals).sort();
  if (keys.length === 0) throw new RuleError("PICK_UNKNOWN", "no chart behaviors");
  return keys[Math.floor(rng.next() * keys.length)];
}
```

In `src/services/populate.ts`, add `rollChartBehavior` to the existing import from `../generate/faction.js`. Immediately above `export function seedCampaign`, add:

```ts
function outlineBehavior(
  provided: string | undefined,
  fill: FillMode,
  seed: number,
  index: number,
): string {
  if (provided != null && provided !== "") return provided;
  if (fill !== "missing") throw new RuleError("FILL_INCOMPLETE", "behavior required");
  return rollChartBehavior(loadCatalog(), mulberry32(seed + 17000 + index));
}
```

`FillMode`, `RuleError`, `loadCatalog`, and `mulberry32` are already imported in that file.

Change the faction loop header from `for (const fac of input.outline?.factions ?? [])` to:

```ts
for (const [factionIndex, fac] of (input.outline?.factions ?? []).entries()) {
```

Keep the power resolution that follows. Replace the `createFaction` `behavior` argument:

```ts
behavior: fac.behavior ?? "self_absorbed_survivor",
```

with a resolved value:

```ts
const behavior = outlineBehavior(fac.behavior, fill, seed, factionIndex);
const res = createFaction(db, {
  campaignId,
  name: fac.name,
  power,
  behavior,
  homePlaceId: fac.homePlaceKey ? placeIds.get(fac.homePlaceKey) : undefined,
  fill,
  seed: seed + factionIds.size,
});
```

Leave `seed: seed + factionIds.size`, the court call's `seed: seed + 100 + factionIds.size`, and the interest `mulberry32(seed + 999)` as they are. Leave the place-scope line `place.scope ?? (fill === "require" ? undefined : "village")` as it is. Do not change `src/mcp/register.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/seed-faction-behavior.test.ts`

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add test/services/seed-faction-behavior.test.ts src/generate/faction.ts src/services/populate.ts
git commit -m "fix: roll seed faction behavior only when fill is missing"
```

---

### Task 2: Drop the behavior gap note and state the fill rule

**Files:**
- Modify: `docs/design/overview.md` (Generation and setup bullet that names `self_absorbed_survivor`)
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` (the sentence under the behavior table)

**Interfaces:**
- Consumes: the seed contract from Task 1.
- Produces: the overview bullet and the director paragraph below. No new exports.

- [ ] **Step 1: Replace the overview gap bullet**

In `docs/design/overview.md`, replace:

```md
- `seed_campaign` defaults an omitted place scope to `village` and an omitted behavior to `self_absorbed_survivor`. Intent: place scope is always required, and behavior is required unless the caller opts into random generation.
```

with:

```md
- `seed_campaign` defaults an omitted place scope to `village`. Intent: place scope is always required.
```

Leave the free-text `behavior` / `PICK_UNKNOWN` gap, the invalid `courtType` gap, and the `create_faction` ignores `fill` gap in place.

- [ ] **Step 2: Replace the director sentence**

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace:

```md
Free text is not a behavior. Leave `behavior` out only if the user asked for it to be random.
```

with:

```md
Free text is not a behavior. Leave `behavior` out only when the user asked for a random chart behavior. With `fill` omitted or `missing`, that omission rolls one of `despotic_tyrant`, `self_absorbed_survivor`, `scheming_manipulator`, or `martial_conqueror`. The roll never picks `directed`. `fill: require` and `fill: blank` reject an omitted `behavior`.
```

Do not add a link to `docs/` or to this plan.

- [ ] **Step 3: Run the suite**

Run: `npm test`

Expected: PASS. `test/services/seed-faction-behavior.test.ts` passes, and `test/services/remove-campaign.test.ts` still passes with its omitted behaviors under `fill: "missing"`.

- [ ] **Step 4: Commit**

```bash
git add docs/design/overview.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: drop the seed behavior gap and state the fill rule"
```

---

## Self-review notes

Spec coverage: omission-under-missing rolls (Task 1 tests for seed 42, omitted fill, seed 1 pair, empty string, seeds 1–24). Explicit wins, including `directed` and a mixed outline (Task 1). `require` and `blank` fail closed with `behavior required` and an empty `campaigns` table (Task 1). `require` plus an explicit key stores it (Task 1). Catalog, MCP schema, place scope, and `create_faction` are untouched (Global Constraints and Task 1 Step 3). Overview and director copy (Task 2). No documentation-text test (Global Constraints).

Pinned rolls for sorted keys and `mulberry32(seed + 17000 + index)`: seed 1 index 0 `self_absorbed_survivor`, seed 1 index 1 `scheming_manipulator`, seed 42 index 0 `martial_conqueror`.
