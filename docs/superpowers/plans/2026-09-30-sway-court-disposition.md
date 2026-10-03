# Invert sway_court implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sway_court` write disposition and a fact by default; create the 2-point usurper Problem only when `createProblem` is true on `control`.

**Architecture:** Domain rule stays in `swayCourt` (`src/services/populate.ts`). MCP forwards `createProblem`. Play copy stops teaching automatic strife on control.

**Tech Stack:** TypeScript, Vitest, better-sqlite3.

## Global Constraints

- Design: `docs/superpowers/specs/2026-09-30-sway-court-disposition-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/53
- Do not change `apply_outcome` court-crushing.
- No game rules in the MCP handler beyond forwarding args.
- Public copy: no personal names.

---

### Task 1: Failing tests for default vs opt-in

**Files:**
- Modify: `test/services/task11-review.test.ts`

**Interfaces:**
- Consumes: `swayCourt`
- Produces: tests that fail against today's automatic Problem on control

- [ ] **Step 1: Replace the control test and add the opt-in test**

Replace `swayCourt control on ruling court sets contested_control and disposition` with:

```typescript
test("swayCourt control writes disposition and a fact without a Problem", () => {
  const db = courtDb();
  const result = swayCourt(db, {
    campaignId: "c1",
    courtId: "court1",
    targetType: "faction",
    targetId: "f1",
    mode: "control",
  });
  expect(result.ok).toBe(true);
  const faction = db.prepare("SELECT contested_control FROM factions WHERE id = 'f1'").get() as {
    contested_control: number;
  };
  expect(faction.contested_control).toBe(0);
  const disposition = db
    .prepare("SELECT disposition FROM court_dispositions WHERE court_id = 'court1'")
    .get() as { disposition: string };
  expect(disposition.disposition).toBe("control");
  const facts = db
    .prepare("SELECT statement FROM facts WHERE subject = 'court' AND subject_id = 'court1'")
    .all() as { statement: string }[];
  expect(facts).toHaveLength(1);
  expect(facts[0].statement).toBe("The named target now holds control of this court.");
  const problems = db.prepare("SELECT id FROM problems WHERE faction_id = 'f1'").all();
  expect(problems).toHaveLength(0);
});

test("swayCourt control with createProblem inserts the usurper Problem", () => {
  const db = courtDb();
  const result = swayCourt(db, {
    campaignId: "c1",
    courtId: "court1",
    targetType: "faction",
    targetId: "f1",
    mode: "control",
    createProblem: true,
  });
  expect(result.ok).toBe(true);
  const faction = db.prepare("SELECT contested_control FROM factions WHERE id = 'f1'").get() as {
    contested_control: number;
  };
  expect(faction.contested_control).toBe(1);
  const problems = db
    .prepare("SELECT text, points, domain FROM problems WHERE faction_id = 'f1'")
    .all() as { text: string; points: number; domain: string }[];
  expect(problems).toEqual([
    {
      text: "Usurpers and restorationists are moving against the new hand on the court.",
      points: 2,
      domain: "cultural",
    },
  ]);
});
```

Keep `swayCourt favor upserts disposition and writes a fact`.

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run test/services/task11-review.test.ts
```

Expected: FAIL — control currently sets `contested_control` and writes no fact.

- [ ] **Step 3: Commit**

```bash
git add test/services/task11-review.test.ts
git commit -m "test: swayCourt default control is disposition-only"
```

---

### Task 2: Implement swayCourt invert

**Files:**
- Modify: `src/services/populate.ts` (`swayCourt`)
- Modify: `src/mcp/register.ts` (`sway_court`)

**Interfaces:**
- Consumes: `createProblem?: boolean`
- Produces: default fact+disposition; Problem only on opt-in control

- [ ] **Step 1: Extend the input type** with `createProblem?: boolean`.

- [ ] **Step 2: Always insert a fact**

Move the fact insert out of the `favor`-only branch. Choose statement:

```typescript
const defaultControlStatement = "The named target now holds control of this court.";
const statement =
  input.statement ??
  (input.mode === "favor" ? loadCatalog().minorRelationship[0].text : defaultControlStatement);
```

Insert the court fact as favor already does. Always upsert disposition.

- [ ] **Step 3: Gate the Problem**

Replace `if (input.mode === "control" && court.rules_faction_id && !input.prepared)` with:

```typescript
if (input.mode === "control" && input.createProblem && court.rules_faction_id) {
  // existing contested_control update + USURPER_TEXT insert
}
```

Do not read `prepared` for this rule. Leave `prepared` on the MCP schema.

- [ ] **Step 4: MCP**

`sway_court` description: `"Record court favor or control as disposition and a fact; create a strife Problem only when createProblem is true on control"`.

Add `createProblem: z.boolean().optional()` to `inputSchema`. Existing `dbTool((a) => swayCourt(db, a))` is enough.

- [ ] **Step 5: Run tests**

```bash
npx vitest run test/services/task11-review.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/populate.ts src/mcp/register.ts
git commit -m "fix: sway_court is disposition-only unless createProblem"
```

---

### Task 3: Play copy

**Files:**
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`

- [ ] **Step 1: Replace the control bullet**

Under `sway_court` records how the heroes moved the court, use:

```markdown
- `favor` writes a fact about the court's disposition. Pass a `statement` that says what the court now favors.
- `control` writes disposition and a fact that the target holds the court. It does not add a Problem by default. Pass `createProblem: true` when the GM wants the 2-point usurper/strife Problem on the faction the court rules (and `contested_control`).
```

Delete the “Unless `prepared` is set…” sentence.

- [ ] **Step 2: Commit**

```bash
git add user/skills/gdnr-player/references/gdnr-play.md
git commit -m "docs: play copy for optional sway_court strife Problem"
```

---

## Self-review

- Default path and opt-in path both tested.
- Crushing courts not touched.
- `prepared` leftover, not inverted into a second create flag.
