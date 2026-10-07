# Cult Formation Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `form_cult` enforces level 2, Incense of Faith, and the free-divinity override, and harshness keys price Problems and cult Dominion.

**Architecture:** `parseHarshness` in `src/rules/cults.ts` is the only reader of a harshness string. `formCult` checks gates before it writes. `setTheology` on Power greater than 1 keeps omitted fields and edits intrinsic text by id. The Power 1 or less branch stays the end already shipped.

**Tech Stack:** TypeScript, better-sqlite3, vitest, zod. Node >= 22.

## Global Constraints

- `form_cult` returns `LEVEL_TOO_LOW` / `cult requires level 2` when `heroes.level < 2`.
- `form_cult` returns `GIFT_REQUIRED` / `Incense of Faith required` unless the parsed `words` array contains the exact string `Incense of Faith`.
- `form_cult` returns `FREE_DIVINITY` / `gmOverride required to leave free divinity` when divinity is `free` and `gmOverride` is not `true`.
- `gmOverride: true` does not bypass level or Incense of Faith.
- Harshness keys are `nominal`, `sharp`, `grueling`, and `overwhelming`. Any other non-null string is `PICK_UNKNOWN` / `unknown harshness`.
- A null harshness column on read counts as `nominal`. Omitted `harshness` on `form_cult` is stored as `nominal`.
- Omitted `harshness` on `set_theology` does not write the harshness column.
- On Power less than or equal to 1, `setTheology` ends the faction and ignores `harshness`, `featureText`, and `intrinsicTexts`.
- This change does not set `status` to `collapsed`, does not write cohesion to 0 for a theology edit, and does not insert `type` `faction_collapsed`.
- Intrinsic points are 0, `ceil(dieMax / 4)`, `dieMax / 2`, and `ceil(dieMax * 3 / 4)` for `nominal`, `sharp`, `grueling`, and `overwhelming`. Cult Dominion extra is 0, 1, 2, and 3 for those keys. `dieMax` is the die for the faction's Power.
- Gate order on `form_cult` is acknowledged, campaign, hero, level, Incense of Faith, free divinity, harshness, adopted faction.
- Implementation continues on this pull request's branch. Do not branch from `main` and do not open a second pull request.
- No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

---

### Task 1: Reject unrecognized harshness in the price functions

**Files:**
- Modify: `src/rules/cults.ts`
- Modify: `test/rules/contest.test.ts`

**Interfaces:**
- Consumes: `Harshness` and `RuleError` from `src/domain/types.ts`.
- Produces: `parseHarshness(value: string): Harshness`. Throws `RuleError("PICK_UNKNOWN", "unknown harshness")` for any other string. `cultBudget` and the cult branch of `monthlyDominion` call it. Free divinity and `none` do not.

- [ ] **Step 1: Write the failing test**

In `test/rules/contest.test.ts`, change the cult import to:

```ts
import { cultBudget, monthlyDominion, parseHarshness } from "../../src/rules/cults.js";
```

Add this test after the existing `"cult budgets and incomes"` test:

```ts
test("unrecognized harshness is refused and the four keys keep their prices", () => {
  expect(cultBudget("nominal", 20)).toBe(0);
  expect(cultBudget("sharp", 8)).toBe(2);
  expect(cultBudget("sharp", 10)).toBe(3);
  expect(cultBudget("grueling", 8)).toBe(4);
  expect(cultBudget("grueling", 10)).toBe(5);
  expect(cultBudget("overwhelming", 8)).toBe(6);
  expect(cultBudget("overwhelming", 10)).toBe(8);
  expect(monthlyDominion({ kind: "cult", power: 1, harshness: "grueling", level: 2 })).toBe(3);
  expect(monthlyDominion({ kind: "cult", power: 3, harshness: "sharp", level: 2 })).toBe(4);
  expect(monthlyDominion({ kind: "free", power: 1, harshness: "cruel" as never, level: 2 })).toBe(1);
  expect(monthlyDominion({ kind: "none", power: 1, harshness: "cruel" as never, level: 9 })).toBe(0);
  for (const value of ["cruel", "Grueling", ""]) {
    expect(() => parseHarshness(value)).toThrow(RuleError);
    try {
      parseHarshness(value);
    } catch (error) {
      expect((error as RuleError).code).toBe("PICK_UNKNOWN");
      expect((error as RuleError).message).toBe("unknown harshness");
    }
    expect(() => cultBudget(value as never, 6)).toThrow(RuleError);
    expect(() => monthlyDominion({
      kind: "cult", power: 1, harshness: value as never, level: 2,
    })).toThrow(RuleError);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/rules/contest.test.ts`

Expected: FAIL. `parseHarshness` is not exported from `src/rules/cults.ts`.

- [ ] **Step 3: Write the minimal implementation**

Replace `src/rules/cults.ts` with:

```ts
import { RuleError, type Harshness } from "../domain/types.js";

export function parseHarshness(value: string): Harshness {
  if (
    value === "nominal" ||
    value === "sharp" ||
    value === "grueling" ||
    value === "overwhelming"
  ) {
    return value;
  }
  throw new RuleError("PICK_UNKNOWN", "unknown harshness");
}

export function cultBudget(harshness: Harshness, dieMax: number): number {
  const key = parseHarshness(harshness);
  if (key === "nominal") return 0;
  if (key === "sharp") return Math.ceil(dieMax / 4);
  if (key === "grueling") return dieMax / 2;
  return Math.ceil((dieMax * 3) / 4);
}

export function monthlyDominion(input: {
  kind: "cult" | "free" | "none"; power: number; harshness: Harshness; level: number;
}): number {
  if (input.kind === "none") return 0;
  if (input.kind === "free") return 1 + Math.floor(input.level / 3);
  const key = parseHarshness(input.harshness);
  const extra = key === "sharp" ? 1 : key === "grueling" ? 2 : key === "overwhelming" ? 3 : 0;
  return input.power + extra;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/rules/contest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/cults.ts test/rules/contest.test.ts
git commit -m "Reject unrecognized cult harshness"
```

---

### Task 2: Gate `form_cult`

**Files:**
- Modify: `src/services/populate.ts` (`formCult`, and the `cultBudget` import)
- Modify: `src/mcp/register.ts` (the `form_cult` tool)
- Create: `test/services/form-cult.test.ts`

**Interfaces:**
- Consumes: `parseHarshness` and `cultBudget` from `src/rules/cults.ts`. `createFaction`, `insertFeatureFromText`, `nextProblemPosition`, `rescaleIntrinsic`, `DIE_BY_POWER`, `newId`.
- Produces: `formCult` input gains `gmOverride?: boolean`. Successful return stays `{ factionId: string }`. Failures use the codes in the spec's gate table.

- [ ] **Step 1: Write the failing test**

Create `test/services/form-cult.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { formCult } from "../../src/services/populate.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function hero(
  db: Database.Database,
  row: { id: string; level: number; divinity?: string; words?: unknown },
): void {
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, 'c1', ?, ?, ?, 0, 0, 0, ?)`,
  ).run(row.id, row.id, row.level, JSON.stringify(row.words ?? ["Incense of Faith"]), row.divinity ?? "none");
}

function faction(
  db: Database.Database,
  row: { id: string; power: number; harshness?: string | null },
): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness
     ) VALUES (?, 'c1', ?, ?, ?, 0, 'existing', 'directed', 'npc', 0, 'active', 0, 0, ?)`,
  ).run(row.id, row.id, row.power, row.power, row.harshness ?? null);
}

function intrinsic(db: Database.Database, id: string, factionId: string, text: string, points: number): void {
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, 0)`,
  ).run(id, factionId, text, points);
}

test("level 1 cannot form a cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 1 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "The law", acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "LEVEL_TOO_LOW", message: "cult requires level 2", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("a level 2 hero without Incense of Faith cannot form a cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, words: ["Sun"] });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "The law", acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "GIFT_REQUIRED", message: "Incense of Faith required", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
});

test("words that are not JSON fail the gift gate", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, words: ["Incense of Faith"] });
  db.prepare("UPDATE heroes SET words = ? WHERE id = 'h1'").run("not-json");
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "The law", acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "GIFT_REQUIRED", message: "Incense of Faith required", details: {} },
  });
});

test("free divinity cannot form a cult without gmOverride", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, divinity: "free" });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Open worship", acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FREE_DIVINITY", message: "gmOverride required to leave free divinity", details: {} },
  });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "free",
    cult_faction_id: null,
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
});

test("gmOverride does not bypass level or the Word", () => {
  const db = world();
  hero(db, { id: "h1", level: 1, divinity: "free" });
  expect(formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Law", acknowledged: true, gmOverride: true,
  })).toEqual({
    ok: false,
    error: { code: "LEVEL_TOO_LOW", message: "cult requires level 2", details: {} },
  });
  hero(db, { id: "h2", level: 2, divinity: "free", words: ["Sun"] });
  expect(formCult(db, {
    campaignId: "c1", heroId: "h2", featureText: "Law", acknowledged: true, gmOverride: true,
  })).toEqual({
    ok: false,
    error: { code: "GIFT_REQUIRED", message: "Incense of Faith required", details: {} },
  });
});

test("gmOverride lets free divinity found a grueling cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, divinity: "free", words: ["Sun", "Incense of Faith"] });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Winter must never return",
    acknowledged: true,
    gmOverride: true,
    harshness: "grueling",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factionId = result.data.factionId;
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: factionId,
  });
  expect(db.prepare("SELECT harshness, power FROM factions WHERE id = ?").get(factionId)).toEqual({
    harshness: "grueling",
    power: 1,
  });
  expect(db.prepare(
    "SELECT text, points FROM problems WHERE faction_id = ? AND intrinsic = 1",
  ).get(factionId)).toEqual({ text: "Winter must never return", points: 3 });
});

test("omitted harshness stores nominal and no intrinsic points", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Quiet faith", acknowledged: true,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(db.prepare("SELECT harshness FROM factions WHERE id = ?").get(result.data.factionId)).toEqual({
    harshness: "nominal",
  });
  expect(db.prepare(
    "SELECT COALESCE(SUM(points), 0) AS points FROM problems WHERE faction_id = ? AND intrinsic = 1",
  ).get(result.data.factionId)).toEqual({ points: 0 });
});

test("an unrecognized harshness forms nothing", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Law", acknowledged: true, harshness: "cruel",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("an adopted Power 3 cult prices sharp laws from the d10", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  faction(db, { id: "f1", power: 3 });
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('old', 'f1', 'Street debt', 2, 'economic', 0, 0, 0, 0)`,
  ).run();
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
    harshness: "sharp",
  });
  expect(result).toEqual({ ok: true, data: { factionId: "f1" } });
  expect(db.prepare(
    "SELECT text, points FROM problems WHERE faction_id = 'f1' AND intrinsic = 1",
  ).get()).toEqual({ text: "The tithe", points: 3 });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'old'").get()).toEqual({
    text: "Street debt",
    points: 2,
  });
});

test("adopting keeps an existing holy-law sentence and rescales its points", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  faction(db, { id: "f1", power: 3 });
  intrinsic(db, "law1", "f1", "Old law", 1);
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
    harshness: "sharp",
  });
  expect(result.ok).toBe(true);
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "Old law",
    points: 3,
  });
  expect(db.prepare(
    "SELECT COUNT(*) AS n FROM problems WHERE faction_id = 'f1' AND intrinsic = 1",
  ).get()).toEqual({ n: 1 });
});

test("a missing adopted faction is refused", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Law",
    acknowledged: true,
    adoptFactionId: "missing",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "faction not found", details: {} },
  });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "none",
    cult_faction_id: null,
  });
});

test("acknowledged is still required before the level gate", () => {
  const db = world();
  hero(db, { id: "h1", level: 1 });
  expect(formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Law",
  })).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "acknowledged worshippers required", details: {} },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/services/form-cult.test.ts`

Expected: FAIL. Level 1 returns `ok: true` (or a later assertion fails) because `formCult` does not check level yet.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/populate.ts`, change the cult import to:

```ts
import { cultBudget, parseHarshness } from "../rules/cults.js";
```

Replace `formCult` with:

```ts
export function formCult(
  db: Database.Database,
  input: {
    campaignId: string;
    heroId: string;
    featureText: string;
    harshness?: string;
    acknowledged?: boolean;
    adoptFactionId?: string;
    name?: string;
    gmOverride?: boolean;
  },
): ServiceResult<{ factionId: string }> {
  return wrapRule(() =>
    withTransaction(db, () => {
      if (!input.acknowledged) {
        throw new RuleError("FILL_INCOMPLETE", "acknowledged worshippers required");
      }
      requireCampaign(db, input.campaignId);
      const gb = db
        .prepare("SELECT id, divinity, level, words FROM heroes WHERE id = ? AND campaign_id = ?")
        .get(input.heroId, input.campaignId) as
        | { id: string; divinity: string; level: number; words: string }
        | undefined;
      if (!gb) throw new RuleError("ENTITY_NOT_FOUND", "hero not found");
      if (gb.level < 2) throw new RuleError("LEVEL_TOO_LOW", "cult requires level 2");
      if (!heroHasIncense(gb.words)) {
        throw new RuleError("GIFT_REQUIRED", "Incense of Faith required");
      }
      if (gb.divinity === "free" && input.gmOverride !== true) {
        throw new RuleError("FREE_DIVINITY", "gmOverride required to leave free divinity");
      }
      const harshness = input.harshness === undefined ? "nominal" : parseHarshness(input.harshness);

      let factionId = input.adoptFactionId;
      if (!factionId) {
        const created = createFaction(db, {
          campaignId: input.campaignId,
          name: input.name ?? "Cult",
          power: 1,
          behavior: "directed",
          origin: "forged",
        });
        if (!created.ok) throw new RuleError(created.error.code, created.error.message);
        factionId = created.data.factionId;
      } else {
        const adopted = db
          .prepare("SELECT id FROM factions WHERE id = ? AND campaign_id = ?")
          .get(factionId, input.campaignId) as { id: string } | undefined;
        if (!adopted) throw new RuleError("ENTITY_NOT_FOUND", "faction not found");
      }
      db.prepare(
        "UPDATE factions SET cult = 1, patron_hero_id = ?, harshness = ? WHERE id = ?",
      ).run(input.heroId, harshness, factionId);

      insertFeatureFromText(db, factionId, input.featureText);

      const stored = db
        .prepare("SELECT power FROM factions WHERE id = ?")
        .get(factionId) as { power: Power };
      const budget = cultBudget(parseHarshness(harshness), DIE_BY_POWER[stored.power]);
      const existingIntrinsic = db
        .prepare("SELECT COUNT(*) AS n FROM problems WHERE faction_id = ? AND intrinsic = 1")
        .get(factionId) as { n: number };
      if (existingIntrinsic.n === 0 && budget > 0) {
        db.prepare(
          `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
           VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, ?)`,
        ).run(newId(), factionId, input.featureText, budget, nextProblemPosition(db, factionId));
      }
      rescaleIntrinsic(db, factionId, stored.power, harshness);

      db.prepare("UPDATE heroes SET divinity = 'cult', cult_faction_id = ? WHERE id = ?").run(
        factionId,
        input.heroId,
      );
      return { factionId };
    }),
  );
}

function heroHasIncense(wordsJson: string): boolean {
  try {
    const parsed = JSON.parse(wordsJson) as unknown;
    return Array.isArray(parsed) && parsed.includes("Incense of Faith");
  } catch {
    return false;
  }
}
```

`heroHasIncense` sits directly under `formCult`. Leave `rescaleIntrinsic` where it is.

In `src/mcp/register.ts`, replace the `form_cult` registration's description and schema fields `harshness` and the following lines with:

```ts
      description:
        "Bind a hero of level 2 or higher whose Words include Incense of Faith to a cult faction. Free divinity requires gmOverride.",
      inputSchema: {
        campaignId: z.string(),
        heroId: z.string(),
        featureText: z.string(),
        harshness: z.enum(["nominal", "sharp", "grueling", "overwhelming"]).optional(),
        acknowledged: z.boolean().optional(),
        adoptFactionId: z.string().optional(),
        name: z.string().optional(),
        gmOverride: z.boolean().optional(),
      },
```

The handler stays `dbTool((a) => formCult(db, a))`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/services/form-cult.test.ts test/services/set-theology-end.test.ts`

Expected: PASS. The Power 1 end tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/populate.ts src/mcp/register.ts test/services/form-cult.test.ts
git commit -m "Gate form_cult on level, Incense of Faith, and free divinity"
```

---

### Task 3: Keep omitted theology and edit intrinsic text

**Files:**
- Modify: `src/services/populate.ts` (`setTheology` input, the faction `SELECT`, and the Power greater than 1 tail)
- Modify: `src/mcp/register.ts` (the `set_theology` tool)
- Create: `test/services/cult-theology.test.ts`

**Interfaces:**
- Consumes: `parseHarshness` from `src/rules/cults.ts`. `rescaleIntrinsic` in the same file.
- Produces: `setTheology` input gains `intrinsicTexts?: { problemId: string; text: string }[]`. Power greater than 1 still returns `{ power, cohesion }`. Power less than or equal to 1 still returns `{ ended: true, factionId, giftTexts, factIds }`.

- [ ] **Step 1: Write the failing test**

Create `test/services/cult-theology.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { setTheology } from "../../src/services/populate.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function hero(db: Database.Database, id: string, cultFactionId: string): void {
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity, cult_faction_id)
     VALUES (?, 'c1', ?, 2, '[]', 0, 0, 0, 'cult', ?)`,
  ).run(id, id, cultFactionId);
}

function faction(
  db: Database.Database,
  row: { id: string; power: number; harshness?: string | null; cult?: number },
): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness, patron_hero_id
     ) VALUES (?, 'c1', ?, ?, ?, 0, 'forged', 'directed', 'npc', 0, 'active', 0, ?, ?, ?)`,
  ).run(row.id, row.id, row.power, row.power, row.cult ?? 1, row.harshness === undefined ? "nominal" : row.harshness, "h1");
}

function feature(db: Database.Database, id: string, factionId: string, text: string): void {
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, aimed_at_faction_id)
     VALUES (?, ?, ?, 'other', 'native', NULL)`,
  ).run(id, factionId, text);
}

function problem(
  db: Database.Database,
  row: { id: string; factionId: string; text: string; points: number; intrinsic: number; position: number },
): void {
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES (?, ?, ?, ?, 'cultural', ?, 0, 0, ?)`,
  ).run(row.id, row.factionId, row.text, row.points, row.intrinsic, row.position);
}

test("omitted harshness keeps grueling laws while Power drops", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "grueling" });
  feature(db, "feat1", "f1", "Gift");
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 5, intrinsic: 1, position: 0 });
  problem(db, { id: "street", factionId: "f1", text: "Street debt", points: 2, intrinsic: 0, position: 1 });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({ ok: true, data: { power: 2, cohesion: 2 } });
  expect(db.prepare("SELECT power, cohesion, harshness, status FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 2,
    cohesion: 2,
    harshness: "grueling",
    status: "active",
  });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "Law",
    points: 4,
  });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'street'").get()).toEqual({
    text: "Street debt",
    points: 2,
  });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "Gift" });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
});

test("an intrinsic text edit keeps harshness and the feature", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "grueling" });
  feature(db, "feat1", "f1", "Gift");
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 5, intrinsic: 1, position: 0 });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [{ problemId: "law1", text: "New law" }],
  });
  expect(result).toEqual({ ok: true, data: { power: 2, cohesion: 2 } });
  expect(db.prepare("SELECT harshness FROM factions WHERE id = 'f1'").get()).toEqual({ harshness: "grueling" });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "New law",
    points: 4,
  });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "Gift" });
});

test("feature text updates the lowest feature id only", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "nominal" });
  feature(db, "a-feat", "f1", "First");
  feature(db, "b-feat", "f1", "Second");
  const result = setTheology(db, {
    campaignId: "c1", cultFactionId: "f1", featureText: "Rewritten",
  });
  expect(result.ok).toBe(true);
  expect(db.prepare("SELECT text FROM features WHERE id = 'a-feat'").get()).toEqual({ text: "Rewritten" });
  expect(db.prepare("SELECT text FROM features WHERE id = 'b-feat'").get()).toEqual({ text: "Second" });
});

test("nominal harshness deletes holy laws and leaves other problems", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 3, harshness: "grueling" });
  feature(db, "feat1", "f1", "Gift");
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 5, intrinsic: 1, position: 0 });
  problem(db, { id: "street", factionId: "f1", text: "Street debt", points: 2, intrinsic: 0, position: 1 });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1", harshness: "nominal" });
  expect(result.ok).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM problems WHERE id = 'law1'").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT text FROM problems WHERE id = 'street'").get()).toEqual({ text: "Street debt" });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "Gift" });
});

test("unrecognized harshness rolls back the theology edit", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1", harshness: "cruel" });
  expect(result).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT power, harshness FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 2,
    harshness: "sharp",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM actions WHERE type = 'set_theology'").get()).toEqual({ n: 0 });
});

test("a text edit must name an intrinsic problem of this cult", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  faction(db, { id: "f2", power: 2, harshness: "sharp" });
  problem(db, { id: "street", factionId: "f1", text: "Street debt", points: 2, intrinsic: 0, position: 0 });
  problem(db, { id: "other", factionId: "f2", text: "Other law", points: 2, intrinsic: 1, position: 0 });
  expect(setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [{ problemId: "street", text: "Nope" }],
  })).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "intrinsic problem not found", details: {} },
  });
  expect(setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [{ problemId: "other", text: "Nope" }],
  })).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "intrinsic problem not found", details: {} },
  });
  expect(db.prepare("SELECT power FROM factions WHERE id = 'f1'").get()).toEqual({ power: 2 });
});

test("a repeated intrinsic id is refused", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 2, intrinsic: 1, position: 0 });
  expect(setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    intrinsicTexts: [
      { problemId: "law1", text: "One" },
      { problemId: "law1", text: "Two" },
    ],
  })).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "duplicate intrinsic problem", details: {} },
  });
  expect(db.prepare("SELECT text FROM problems WHERE id = 'law1'").get()).toEqual({ text: "Law" });
  expect(db.prepare("SELECT power FROM factions WHERE id = 'f1'").get()).toEqual({ power: 2 });
});

test("a text edit that the new budget would delete changes nothing", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, harshness: "sharp" });
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 2, intrinsic: 1, position: 0 });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    harshness: "nominal",
    intrinsicTexts: [{ problemId: "law1", text: "Gone" }],
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "intrinsic problem removed by the new budget", details: {} },
  });
  expect(db.prepare("SELECT power, harshness FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 2,
    harshness: "sharp",
  });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'law1'").get()).toEqual({
    text: "Law",
    points: 2,
  });
});

test("a Power 1 cult still ends when harshness is unrecognized", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, harshness: "nominal" });
  problem(db, { id: "law1", factionId: "f1", text: "Law", points: 1, intrinsic: 1, position: 0 });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    harshness: "cruel",
    intrinsicTexts: [{ problemId: "law1", text: "Ignored" }],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.ended).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions WHERE id = 'f1'").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: null,
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'faction_collapsed'").get()).toEqual({ n: 0 });
});

test("a faction that is not a cult is left alone", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, cult: 0 });
  expect(setTheology(db, { campaignId: "c1", cultFactionId: "f1" })).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "cult faction not found", details: {} },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/services/cult-theology.test.ts`

Expected: FAIL. The omitted-harshness call stores `nominal` and deletes the intrinsic Problem.

- [ ] **Step 3: Write the minimal implementation**

In `setTheology`, add `harshness` to the faction `SELECT` and to the row type:

```ts
          `SELECT id, power, cohesion, cult, harshness, patron_hero_id, home_place_id
           FROM factions WHERE id = ? AND campaign_id = ?`,
```

```ts
            harshness: string | null;
```

Add `intrinsicTexts` to the input type:

```ts
    intrinsicTexts?: { problemId: string; text: string }[];
```

Leave `ensureInternalTurnSlot` and the entire `if (faction.power <= 1)` branch unchanged.

Replace the Power greater than 1 tail, from `const newPower` through `return { power: newPower, cohesion: newCohesion }`, with:

```ts
      if (input.harshness !== undefined) parseHarshness(input.harshness);
      const harshnessForBudget = input.harshness === undefined
        ? (faction.harshness ?? "nominal")
        : input.harshness;
      assertIntrinsicEdits(db, faction.id, input.intrinsicTexts);

      const newPower = (faction.power - 1) as Power;
      const newCohesion = Math.min(faction.cohesion, newPower);
      if (input.harshness === undefined) {
        db.prepare("UPDATE factions SET power = ?, cohesion = ? WHERE id = ?").run(
          newPower,
          newCohesion,
          faction.id,
        );
      } else {
        db.prepare("UPDATE factions SET power = ?, cohesion = ?, harshness = ? WHERE id = ?").run(
          newPower,
          newCohesion,
          input.harshness,
          faction.id,
        );
      }
      rescaleIntrinsic(db, faction.id, newPower, harshnessForBudget);
      if (input.featureText) {
        const feat = db
          .prepare("SELECT id FROM features WHERE faction_id = ? ORDER BY id ASC LIMIT 1")
          .get(faction.id) as { id: string } | undefined;
        if (feat) {
          db.prepare("UPDATE features SET text = ? WHERE id = ?").run(input.featureText, feat.id);
        }
      }
      writeIntrinsicTexts(db, faction.id, input.intrinsicTexts);
      return { power: newPower, cohesion: newCohesion };
```

Add these two functions next to `heroHasIncense`:

```ts
function assertIntrinsicEdits(
  db: Database.Database,
  factionId: string,
  edits: { problemId: string; text: string }[] | undefined,
): void {
  if (!edits || edits.length === 0) return;
  const seen = new Set<string>();
  for (const edit of edits) {
    if (seen.has(edit.problemId)) {
      throw new RuleError("FILL_INCOMPLETE", "duplicate intrinsic problem");
    }
    seen.add(edit.problemId);
    const row = db
      .prepare("SELECT id, intrinsic FROM problems WHERE id = ? AND faction_id = ?")
      .get(edit.problemId, factionId) as { id: string; intrinsic: number } | undefined;
    if (!row || row.intrinsic !== 1) {
      throw new RuleError("ENTITY_NOT_FOUND", "intrinsic problem not found");
    }
  }
}

function writeIntrinsicTexts(
  db: Database.Database,
  factionId: string,
  edits: { problemId: string; text: string }[] | undefined,
): void {
  if (!edits || edits.length === 0) return;
  for (const edit of edits) {
    const row = db
      .prepare("SELECT id, intrinsic FROM problems WHERE id = ? AND faction_id = ?")
      .get(edit.problemId, factionId) as { id: string; intrinsic: number } | undefined;
    if (!row || row.intrinsic !== 1) {
      throw new RuleError("FILL_INCOMPLETE", "intrinsic problem removed by the new budget");
    }
    db.prepare("UPDATE problems SET text = ? WHERE id = ?").run(edit.text, edit.problemId);
  }
}
```

`parseHarshness` is already imported from Task 2.

In `src/mcp/register.ts`, replace the `set_theology` description and add the enum plus `intrinsicTexts`:

```ts
      description:
        "Change cult theology. Costs 1 Power and the internal action. Omitted harshness is kept. A Power 1 cult stops being a faction.",
      inputSchema: {
        campaignId: z.string(),
        cultFactionId: z.string(),
        harshness: z.enum(["nominal", "sharp", "grueling", "overwhelming"]).optional(),
        featureText: z.string().optional(),
        intrinsicTexts: z.array(z.object({ problemId: z.string(), text: z.string() })).optional(),
      },
```

The handler stays `dbTool((a) => setTheology(db, a))`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/services/cult-theology.test.ts test/services/set-theology-end.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/populate.ts src/mcp/register.ts test/services/cult-theology.test.ts
git commit -m "Keep omitted theology when editing a cult"
```

---

### Task 4: Price stored cult harshness on income and `set_power`

**Files:**
- Modify: `src/services/turn.ts` (the cult grant inside `advanceMonth`)
- Modify: `src/queries/detail.ts` (`cultIncome`)
- Modify: `src/mcp/register.ts` (the `cult_income` handler)
- Create: `test/services/cult-harshness-income.test.ts`

**Interfaces:**
- Consumes: `parseHarshness` and `monthlyDominion` from `src/rules/cults.ts`. `cultBudget` already throws from Task 1, so `setPower`'s existing `rescaleIntrinsic` call refuses a bad stored key with no new branch in `setPower`.
- Produces: no new export. `cultIncome` throws `RuleError`. `advanceMonthForCampaign` returns that error from `wrapRule`. `cult_income` puts it on the tool envelope.

- [ ] **Step 1: Write the failing test**

Create `test/services/cult-harshness-income.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { RuleError } from "../../src/domain/types.js";
import { openDb } from "../../src/store/db.js";
import { setPower } from "../../src/services/populate.js";
import { advanceMonthForCampaign } from "../../src/services/turn.js";
import { cultIncome } from "../../src/queries/detail.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function linkedCult(db: Database.Database, harshness: string): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness, patron_hero_id
     ) VALUES ('f1', 'c1', 'f1', 1, 1, 0, 'forged', 'directed', 'npc', 0, 'active', 0, 1, ?, 'h1')`,
  ).run(harshness);
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity, cult_faction_id)
     VALUES ('h1', 'c1', 'h1', 2, '[]', 0, 0, 0, 'cult', 'f1')`,
  ).run();
}

test("grueling cult income is Power plus 2", () => {
  const db = world();
  linkedCult(db, "grueling");
  expect(cultIncome(db, "c1")).toEqual([
    { heroId: "h1", name: "h1", divinity: "cult", grant: 3 },
  ]);
  const advanced = advanceMonthForCampaign(db, "c1");
  expect(advanced).toEqual({ ok: true, data: { month: 2 } });
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get()).toEqual({ dominion: 3 });
});

test("a stored unrecognized harshness refuses income and the month", () => {
  const db = world();
  linkedCult(db, "cruel");
  expect(() => cultIncome(db, "c1")).toThrow(RuleError);
  try {
    cultIncome(db, "c1");
  } catch (error) {
    expect((error as RuleError).code).toBe("PICK_UNKNOWN");
    expect((error as RuleError).message).toBe("unknown harshness");
  }
  expect(advanceMonthForCampaign(db, "c1")).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT month FROM campaigns WHERE id = 'c1'").get()).toEqual({ month: 1 });
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get()).toEqual({ dominion: 0 });
});

test("set_power refuses a cult whose harshness is unrecognized", () => {
  const db = world();
  linkedCult(db, "cruel");
  expect(setPower(db, { campaignId: "c1", factionId: "f1", power: 2 })).toEqual({
    ok: false,
    error: { code: "PICK_UNKNOWN", message: "unknown harshness", details: {} },
  });
  expect(db.prepare("SELECT power FROM factions WHERE id = 'f1'").get()).toEqual({ power: 1 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/services/cult-harshness-income.test.ts`

Expected: FAIL. `cultIncome` returns grant `1` for `grueling` only if the cast still works — grueling already prices as +2 in `monthlyDominion`, so the grueling case may pass. The `cruel` case returns grant `1` (unknown falls through to 0 extra, Power 1) instead of throwing. That assertion fails.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/turn.ts`, import `parseHarshness`:

```ts
import { monthlyDominion, parseHarshness } from "../rules/cults.js";
```

Remove the `Harshness` type import if nothing else in the file uses it. Replace the cult `monthlyDominion` call's harshness field:

```ts
          harshness: parseHarshness(cult.harshness ?? "nominal"),
```

In `src/queries/detail.ts`, change the cult import to:

```ts
import { monthlyDominion, parseHarshness } from "../rules/cults.js";
```

Remove `import type { Harshness }` if `cultIncome` was its only use. Replace the cult grant's harshness field:

```ts
          harshness: parseHarshness(g.harshness ?? "nominal"),
```

In `src/mcp/register.ts`, replace the `cult_income` handler with:

```ts
    async (a) => {
      try {
        return mcpToolResult(toEnvelope({ ok: true, data: cultIncome(db, a.campaignId as string) }));
      } catch (error) {
        if (error instanceof RuleError) {
          return mcpToolResult({
            ok: false,
            error: { code: error.code, message: error.message, details: error.details },
          });
        }
        return mcpToolResult(unexpectedErrorEnvelope(error));
      }
    },
```

Do not add a branch to `setPower`. `rescaleIntrinsic` already calls `cultBudget`, which calls `parseHarshness`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/services/cult-harshness-income.test.ts test/services/turn.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/turn.ts src/queries/detail.ts src/mcp/register.ts test/services/cult-harshness-income.test.ts
git commit -m "Price cult income from the four harshness keys"
```

---

### Task 5: Update living docs and director copy

**Files:**
- Modify: `docs/design/glossary.md` (Cult section)
- Modify: `docs/design/overview.md` (Cults gap bullets)
- Modify: `docs/design/current-engine.md` (Cult theology)
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` (the `form_cult` and `set_theology` bullets)

**Interfaces:**
- Consumes: the sentences in the spec's Docs and play copy section.
- Produces: those four edits and no new test.

- [ ] **Step 1: Update the four files**

At the end of the **Cult** section in `docs/design/glossary.md`, add:

```markdown
A hero forms a cult through `form_cult` at level 2 or higher when their Words include `Incense of Faith`. Free divinity forms a cult only when that call passes `gmOverride`.
```

In `docs/design/overview.md`, replace the two cult gap bullets with:

```markdown
- `form_cult` adds a rolled feature and a rolled non-intrinsic problem on a new cult.
```

In `docs/design/current-engine.md`, add this paragraph after the existing Cult theology paragraph:

```markdown
`form_cult` requires level 2, the Word `Incense of Faith`, and `acknowledged: true`. Free divinity also requires `gmOverride: true`. Omitted harshness on that call stores `nominal`. The four harshness keys price intrinsic Problems from the cult's Power die and price cult Dominion as Power plus 0, 1, 2, or 3. Any other harshness string is refused. On Power greater than 1, `set_theology` keeps an omitted harshness, keeps an omitted feature sentence, and changes intrinsic Problem text only for the ids in `intrinsicTexts`.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `form_cult` and `set_theology` bullets with:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher and their Words must include `Incense of Faith`. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. Harsher cults carry more intrinsic problems and pay more Dominion each month. An unrecognized harshness is refused.
- `set_theology`: changes a cult's harshness, feature text, or the text of intrinsic problems (`intrinsicTexts`). It costs the cult 1 Power and its internal action for the turn. Omitting `harshness` keeps the stored harshness and its laws. A Power 1 cult stops being a faction: divinity stays `cult`, the hero's faction link is cleared, and the leftover worshipers and cult gift remain without paying cult Dominion. That end ignores harshness, feature text, and intrinsic texts.
```

Do not edit `user/skills/gdnr-player/references/gdnr-play.md`. Do not edit `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md` or `docs/superpowers/specs/2026-10-04-power-1-cult-ends-design.md`. Do not add a test that reads these files.

- [ ] **Step 2: Commit**

```bash
git add docs/design/glossary.md docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "Document cult formation gates and harshness pricing"
```

---

## Self-review

Spec coverage:

- Free divinity without the override is Task 2. `gmOverride` does not bypass level or the Word there.
- Incense of Faith and level 2 are Task 2, including invalid JSON and the acknowledged-first order.
- The four price formulas and unrecognized keys are Task 1. Adopted Power 3 sharp laws use the d10 in Task 2. Income and `set_power` use the same parser in Task 4.
- Omitted harshness, intrinsic text edits, and the rollback when a named law would be deleted are Task 3. The Power 1 end stays, including an unrecognized key on that path.
- Living docs and director copy are Task 5. The rolled feature on a new cult stays a gap in `overview.md`.

Placeholder scan: every task names the files, the error codes, the prices, and the code to write. No step defers a formula, a message, or a file.

Type consistency: `parseHarshness`, `LEVEL_TOO_LOW`, `GIFT_REQUIRED`, `FREE_DIVINITY`, `intrinsicTexts`, and the four harshness strings are the same in every task. `formCult` still returns `{ factionId }`. Power greater than 1 `setTheology` still returns `{ power, cohesion }`. The end return stays `{ ended, factionId, giftTexts, factIds }`.

## Execution handoff

Implementation is a later session on this draft pull request. Check out this branch. Do not branch from `main`. Do not open a second pull request.
