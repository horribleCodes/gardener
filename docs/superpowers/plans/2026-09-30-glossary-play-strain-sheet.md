# Glossary and play strain-sheet implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Feature, Problem, Trouble, and Cohesion to the living glossary and rewrite player dice copy so catalog-domain mismatch is not taught as automatic marginality.

**Architecture:** Documentation-only. Edit `docs/design/glossary.md` and `user/skills/gdnr-player/references/gdnr-play.md`. Optional Vitest string guard. No `src/` edits.

**Tech Stack:** Markdown, Vitest 2 if the guard test is added.

## Global Constraints

- Design: `docs/superpowers/specs/2026-09-30-glossary-play-strain-sheet-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/51
- Do not change `src/rules/contest.ts` `defaultRelevance` or Contest tool arguments.
- Public copy must contain no personal names.
- Files under `user/` must not link or cite anything outside `user/`.

---

### Task 1: Glossary entries

**Files:**
- Modify: `docs/design/glossary.md`

**Interfaces:**
- Consumes: design spec “Glossary entries (normative wording)”
- Produces: four `##` headings with the locked meanings

- [ ] **Step 1: Insert the four sections in alphabetical order**

Insert **Cohesion** after **Character** and before **Chart**:

```markdown
## Cohesion

**Cohesion** is the group's remaining integrity. It starts equal to Power (scale), never rises above Power, and at 0 the faction collapses. Restoring Cohesion is a paid internal action that needs a usable Feature.
```

Insert **Feature** after **Fact** and before **Hero**:

```markdown
## Feature

A **Feature** is a sentence-long tool on a faction sheet: what the group uses to act, resist, or be targeted. A Feature may have parts; it works until every part is gone.

Optional marks, used only for contest modifiers when they apply: size (`normal` or `vast`), quality (`normal` or `superior`), edged (code: `magical`), and origin (`native`, `improbable`, `impossible`). Those marks are product of the Feature, not a second sheet.

Heroes removing the person or thing a Feature names can delete that Feature with no contest (`apply_outcome`). That is an adventure override, not a turn action.
```

Insert **Problem** after **Module** and before **Table**:

```markdown
## Problem

A **Problem** is a scored affliction on the faction sheet, usually 1 or 2 points. Problems are the only sheet rows whose points sum into Trouble.

Some Problems are marked **intrinsic** in code. That flag is approximately the holy-law Problems concept: they are not shrinkable by the usual solve path (`NOTHING_TO_SOLVE` / `INTRINSIC_PROBLEM`). Not every Problem is intrinsic. Ordinary Problems are the ones a faction can work down.
```

Insert **Trouble** after **Table** and before **Aliases**:

```markdown
## Trouble

**Trouble** is a derived number: the sum of the faction's Problem points. Callers never write it. A roll-over check succeeds only when the roll is greater than Trouble. Trouble at or above the action-die maximum collapses the faction.

On a failed roll-over check, play names a Problem as the reason. Gardener compares the failed face to contiguous **culprit bands** (each Problem covers a band as wide as its points, in stored order) so `get_faction` can show which Problem the face landed in. Culprit bands are that compare implementation. They are not a separate book concept and must not be taught as a third sheet row.
```

Keep the existing **Further reading** paragraph. Do not add personal names.

- [ ] **Step 2: Commit**

```bash
git add docs/design/glossary.md
git commit -m "docs: glossary Feature, Problem, Trouble, Cohesion"
```

---

### Task 2: Player play copy

**Files:**
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`

**Interfaces:**
- Consumes: design spec “Play copy”
- Produces: Faction sheet block; Reading the dice without automatic domain-mismatch marginality

- [ ] **Step 1: Insert Faction sheet before Reading the dice**

Immediately before `## Reading the dice`, add:

```markdown
## Faction sheet

The tools show Features, Problems, Cohesion, Power, and Dominion. **Trouble** is not a stored field; it is the sum of Problem points. **Cohesion** starts equal to Power and cannot exceed Power. Contests are **one Feature versus one Feature**: name which Feature each side used.
```

- [ ] **Step 2: Replace the Reading the dice bullets**

Replace the current list under `## Reading the dice` (from the action-die bullet through the collapse bullet) with:

```markdown
- A faction's action die follows its Power: d6, d8, d10, d12, d20 for Power 1–5.
- **Trouble** is the sum of its Problems' points. A check succeeds only when the roll is **greater than** Trouble.
- On a failure, narrate the failure as the fault of the Problem `get_faction` names for that roll. Do not invent a second mechanic called bands.
- In a contest, one Feature versus one Feature. The higher total wins; a tie goes to the higher Power, then to the defender.
- **Marginality is a GM call** (roll twice, keep the lower). Do not treat catalog domain mismatch as automatically marginal.
- Uneven contest bonus, for the Feature that is rolling, when those marks are set: +1 vast against a Feature that is not, +1 superior against one that is not, +1 edged when the edge matters, +1 if origin is improbable, +2 if impossible. A natural 1 suppresses the uneven bonus.
- When an attack succeeds, the defender picks one loss: 1 cohesion, sacrificing the feature it defended with, or `1 + max(0, attacker Power − defender Power)` problem points. NPC defenders pick whatever keeps them alive (`preserve_existence`). A player-controlled defender pauses the turn until the user chooses.
- A faction **collapses** when Trouble reaches its die maximum or cohesion reaches 0. A collapsed faction refuses actions with `COLLAPSED_FACTION`; queries about it still work.
```

Do not leave the sentence “When the two features are in different domains the roll is marginal”.

Leave `### Reading a reply` and the rest of the file unchanged unless a leftover line still teaches automatic domain mismatch.

- [ ] **Step 3: Confirm director copy**

Read `user/skills/gdnr-director/references/gdnr-direct.md`. If it has no domain-mismatch-as-marginal sentence, leave it. If one exists, rewrite it to the GM-call sentence from Step 2.

Confirm no file under `user/` links outside `user/`.

- [ ] **Step 4: Commit**

```bash
git add user/skills/gdnr-player/references/gdnr-play.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: play copy for Feature, Trouble, Cohesion, marginality"
```

---

### Task 3: Guard test

**Files:**
- Create: `test/docs/glossary-play-strain-sheet.test.ts`

**Interfaces:**
- Consumes: the two markdown files
- Produces: fail if automatic domain-mismatch teaching returns or glossary headings are missing

- [ ] **Step 1: Write the failing test**

```typescript
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const glossary = readFileSync("docs/design/glossary.md", "utf8");
const play = readFileSync("user/skills/gdnr-player/references/gdnr-play.md", "utf8");

test("glossary names Feature, Problem, Trouble, and Cohesion", () => {
  for (const heading of ["## Feature", "## Problem", "## Trouble", "## Cohesion"]) {
    expect(glossary).toContain(heading);
  }
  expect(glossary.toLowerCase()).toContain("holy-law");
  expect(glossary.toLowerCase()).toContain("culprit bands");
  expect(glossary).toMatch(/Not every Problem is intrinsic/i);
});

test("play does not teach domain mismatch as automatic marginality", () => {
  expect(play).toMatch(/Marginality is a GM call/i);
  expect(play).toMatch(/one Feature versus one Feature/i);
  expect(play.toLowerCase()).not.toMatch(
    /different domains the roll is marginal/,
  );
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run test/docs/glossary-play-strain-sheet.test.ts
```

Expected: PASS after Tasks 1–2 (FAIL on the play assertion if Step 2 left the old domain sentence).

- [ ] **Step 3: Commit**

```bash
git add test/docs/glossary-play-strain-sheet.test.ts
git commit -m "test: guard glossary and play strain-sheet copy"
```

---

## Self-review

- Spec coverage: glossary four entries, intrinsic/holy-law, culprit bands, play blurb, no automatic mismatch, no names, contest engine out of scope.
- No placeholders.
- Headings match the files the implementer edits.
