# New Cult Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new cult from `form_cult` is Power 1 with only the chosen Feature and only the intrinsic holy laws its harshness prices.

**Architecture:** `createFaction` accepts `problemCount: 0` so a forged cult starts empty. `formCult` inserts `featureText` as the Feature and `lawText` as the intrinsic Problem when the budget requires it. Adopt keeps existing sheet rows.

**Tech Stack:** TypeScript, better-sqlite3, vitest, zod. Node >= 22.

## Global Constraints

- A new cult from `form_cult` is Power 1, has exactly one Feature, and that Feature's text is `featureText`.
- A new cult has no non-intrinsic Problems.
- Intrinsic point totals on a new cult are 0, 2, 3, and 5 for `nominal`, `sharp`, `grueling`, and `overwhelming`.
- When those points are greater than 0 and the faction has no intrinsic Problem, `form_cult` inserts one intrinsic Problem whose text is `lawText`.
- `form_cult` returns `FILL_INCOMPLETE` / `holy law required` when that insert would happen and `lawText` is omitted or `""`.
- `form_cult` does not write `featureText` onto a Problem.
- `adoptFactionId` keeps existing Features and Problems, adds the chosen Feature, and adds or rescales intrinsic Problems as above.
- `createFaction` inserts no Problems when `problemCount` is `0`. Omitted `problemCount` still rolls Problems.
- Implementation continues on this pull request's branch. Do not branch from `main` and do not open a second pull request.
- No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

---

### Task 1: Skip rolled Features and Problems on a new cult and store `lawText`

**Files:**
- Modify: `src/services/populate.ts` (`createFaction` input and problem loop; `formCult` input, `createFaction` call, law insert)
- Modify: `src/mcp/register.ts` (the `form_cult` tool)
- Modify: `test/services/form-cult.test.ts`

**Interfaces:**
- Consumes: `createFaction`, `insertFeatureFromText`, `cultBudget`, `parseHarshness`, `rescaleIntrinsic`, `DIE_BY_POWER`, `newId`, `nextProblemPosition`.
- Produces: `createFaction` input gains `problemCount?: number`. `formCult` input gains `lawText?: string`. Successful return stays `{ factionId: string }`. Missing law on a new intrinsic insert is `FILL_INCOMPLETE` / `holy law required`.

- [ ] **Step 1: Write the failing test**

In `test/services/form-cult.test.ts`, replace the `"gmOverride lets free divinity found a grueling cult"` test with:

```ts
test("gmOverride lets free divinity found a grueling cult", () => {
  const db = world();
  hero(db, { id: "h1", level: 2, divinity: "free" });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Winter must never return",
    lawText: "The frost is a sin",
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
  expect(db.prepare("SELECT text FROM features WHERE faction_id = ?").all(factionId)).toEqual([
    { text: "Winter must never return" },
  ]);
  expect(db.prepare(
    "SELECT text, points, intrinsic FROM problems WHERE faction_id = ?",
  ).all(factionId)).toEqual([
    { text: "The frost is a sin", points: 3, intrinsic: 1 },
  ]);
});
```

Replace the `"omitted harshness stores nominal and no intrinsic points"` test with:

```ts
test("omitted harshness stores nominal and no problems", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1", heroId: "h1", featureText: "Quiet faith", acknowledged: true,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factionId = result.data.factionId;
  expect(db.prepare("SELECT harshness, power FROM factions WHERE id = ?").get(factionId)).toEqual({
    harshness: "nominal",
    power: 1,
  });
  expect(db.prepare("SELECT text FROM features WHERE faction_id = ?").all(factionId)).toEqual([
    { text: "Quiet faith" },
  ]);
  expect(db.prepare("SELECT COUNT(*) AS n FROM problems WHERE faction_id = ?").get(factionId)).toEqual({
    n: 0,
  });
});
```

Replace the `"an adopted Power 3 cult prices sharp laws from the d10"` test with:

```ts
test("an adopted Power 3 cult prices sharp laws from the d10", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  faction(db, { id: "f1", power: 3 });
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, aimed_at_faction_id)
     VALUES ('old-feat', 'f1', 'Old mill', 'economic', 'native', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('old', 'f1', 'Street debt', 2, 'economic', 0, 0, 0, 0)`,
  ).run();
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    lawText: "Pay the tithe in winter",
    acknowledged: true,
    adoptFactionId: "f1",
    harshness: "sharp",
  });
  expect(result).toEqual({ ok: true, data: { factionId: "f1" } });
  expect(db.prepare("SELECT id, text FROM features WHERE faction_id = 'f1' ORDER BY id").all()).toEqual([
    { id: "old-feat", text: "Old mill" },
    { id: expect.any(String), text: "The tithe" },
  ]);
  expect(db.prepare(
    "SELECT text, points FROM problems WHERE faction_id = 'f1' AND intrinsic = 1",
  ).get()).toEqual({ text: "Pay the tithe in winter", points: 3 });
  expect(db.prepare("SELECT text, points FROM problems WHERE id = 'old'").get()).toEqual({
    text: "Street debt",
    points: 2,
  });
});
```

Add these tests after `"acknowledged is still required before the level gate"`:

```ts
test("a new cult without a holy law is refused when harshness prices one", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "Winter must never return",
    acknowledged: true,
    harshness: "grueling",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "holy law required", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({ divinity: "none" });
});

test("new cult composition matches each harshness budget", () => {
  const cases = [
    { harshness: "nominal" as const, points: 0 },
    { harshness: "sharp" as const, points: 2 },
    { harshness: "grueling" as const, points: 3 },
    { harshness: "overwhelming" as const, points: 5 },
  ];
  for (const row of cases) {
    const db = world();
    hero(db, { id: "h1", level: 2 });
    const result = formCult(db, {
      campaignId: "c1",
      heroId: "h1",
      featureText: "Chosen gift",
      lawText: "Keep the vigil",
      acknowledged: true,
      harshness: row.harshness,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const factionId = result.data.factionId;
    expect(db.prepare("SELECT power FROM factions WHERE id = ?").get(factionId)).toEqual({ power: 1 });
    expect(db.prepare("SELECT text FROM features WHERE faction_id = ?").all(factionId)).toEqual([
      { text: "Chosen gift" },
    ]);
    const problems = db
      .prepare("SELECT text, points, intrinsic FROM problems WHERE faction_id = ?")
      .all(factionId) as { text: string; points: number; intrinsic: number }[];
    if (row.points === 0) {
      expect(problems).toEqual([]);
    } else {
      expect(problems).toEqual([{ text: "Keep the vigil", points: row.points, intrinsic: 1 }]);
      expect(problems[0].text).not.toBe("Chosen gift");
    }
  }
});
```

Leave `"adopting keeps an existing holy-law sentence and rescales its points"` as it is (no `lawText`). Leave the gate-failure tests as they are.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: FAIL. The grueling success case still stores `featureText` on the intrinsic Problem and still has a rolled Feature or a rolled non-intrinsic Problem. The missing-`lawText` case currently succeeds.

- [ ] **Step 3: Write the minimal implementation**

In `createFaction`, add `problemCount?: number` to the input type. Replace the problem-generation loop with:

```ts
      if (input.problemCount !== 0) {
        const problems = generateProblems(budget, rng, catalog);
        for (let i = 0; i < problems.length; i++) {
          const p = problems[i];
          db.prepare(
            `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
             VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`,
          ).run(newId(), factionId, p.text, p.points, p.domain, i);
        }
      }
```

Keep loading `catalog` before the feature loop; if `problemCount === 0`, still load the catalog for features when `featureCount` is not 0.

Add `lawText?: string` to the `formCult` input type.

In `formCult`, after `const harshness = ...`, replace the faction create/adopt block through the intrinsic insert with:

```ts
      let factionId = input.adoptFactionId;
      if (!factionId) {
        const budget = cultBudget(parseHarshness(harshness), DIE_BY_POWER[1]);
        if (budget > 0 && !input.lawText) {
          throw new RuleError("FILL_INCOMPLETE", "holy law required");
        }
        const created = createFaction(db, {
          campaignId: input.campaignId,
          name: input.name ?? "Cult",
          power: 1,
          behavior: "directed",
          origin: "forged",
          featureCount: 0,
          problemCount: 0,
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
        if (!input.lawText) {
          throw new RuleError("FILL_INCOMPLETE", "holy law required");
        }
        db.prepare(
          `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
           VALUES (?, ?, ?, ?, 'cultural', 1, 0, 0, ?)`,
        ).run(newId(), factionId, input.lawText, budget, nextProblemPosition(db, factionId));
      }
      rescaleIntrinsic(db, factionId, stored.power, harshness);
```

Keep the hero update and `return { factionId }` as they are.

In `src/mcp/register.ts`, replace the `form_cult` description and add `lawText`:

```ts
      description:
        "Bind a hero of level 2 or higher to a cult faction. A new cult is Power 1 with the chosen Feature and only the holy laws its harshness requires. lawText is required when those laws are inserted. Free divinity requires gmOverride.",
      inputSchema: {
        campaignId: z.string(),
        heroId: z.string(),
        featureText: z.string(),
        lawText: z.string().optional(),
        harshness: z.enum(["nominal", "sharp", "grueling", "overwhelming"]).optional(),
        acknowledged: z.boolean().optional(),
        adoptFactionId: z.string().optional(),
        name: z.string().optional(),
        gmOverride: z.boolean().optional(),
      },
```

The handler stays `dbTool((a) => formCult(db, a))`. Do not add `problemCount` to `create_faction`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/populate.ts src/mcp/register.ts test/services/form-cult.test.ts
git commit -m "form_cult forges a Power 1 cult with chosen Feature and holy laws"
```

---

### Task 2: Update living docs and director copy

**Files:**
- Modify: `docs/design/glossary.md` (Cult section)
- Modify: `docs/design/overview.md` (Cults gap)
- Modify: `docs/design/current-engine.md` (Cult theology)
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` (the `form_cult` bullet)

**Interfaces:**
- Consumes: the sentences in the spec's Docs and play copy section.
- Produces: those four edits and no new test.

- [ ] **Step 1: Update the four files**

At the end of the **Cult** section in `docs/design/glossary.md`, add:

```markdown
A new cult is Power 1. Its only Feature is the sentence passed to `form_cult`. Its only Problems are the intrinsic holy laws that harshness prices; `nominal` has none. Those laws use `lawText`, not the Feature sentence.
```

In `docs/design/overview.md`, delete:

```markdown
- `form_cult` adds a rolled feature and a rolled non-intrinsic problem on a new cult.
```

If **Cults** then has no remaining bullets, delete the **Cults** heading as well.

In `docs/design/current-engine.md`, add this paragraph after the existing `form_cult` paragraph under Cult theology:

```markdown
A new cult is created at Power 1 with no rolled Feature and no rolled Problems. `form_cult` then inserts the caller's Feature. When harshness prices intrinsic points, it inserts one intrinsic Problem whose text is `lawText`. `nominal` inserts none. Adopting a faction keeps its Features and Problems and still adds that Feature and, when it has no holy law yet, that intrinsic Problem.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `form_cult` bullet with:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. A new cult is Power 1 with only the chosen Feature (`featureText`) and only the intrinsic holy laws that harshness prices. Those laws take `lawText`, which is required when the budget is greater than 0 and the faction has no intrinsic Problem yet. `nominal` has no holy law. An adopted faction keeps its Features and Problems and still receives the chosen Feature and, if it has no holy law yet, that law. An unrecognized harshness is refused.
```

Do not edit `user/skills/gdnr-player/references/gdnr-play.md`. Do not edit historical specs under `docs/superpowers/specs/`. Do not add a test that reads these files.

- [ ] **Step 2: Commit**

```bash
git add docs/design/glossary.md docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "Document new cult Feature and holy-law composition"
```

---

## Self-review

Spec coverage:

- New-cult Power 1, one Feature, no rolled Problem: Task 1 via `featureCount: 0` and `problemCount: 0`.
- Four harshness budgets and `lawText` not equal to `featureText`: Task 1 parameterized test.
- Missing `lawText` when a law is required: Task 1.
- Adopt keeps existing Features and Problems and adds the Feature plus a new or rescaled law: Task 1.
- Living docs and director copy: Task 2. The overview gap about rolled composition is deleted.

Placeholder scan: every task names the files, the error code, the Power 1 point totals, and the code to write.

Type consistency: `lawText`, `problemCount`, `FILL_INCOMPLETE` / `holy law required`, and `{ factionId }` are the same in every task.

## Execution handoff

Implementation is a later session on this draft pull request. Check out this branch. Do not branch from `main`. Do not open a second pull request.
