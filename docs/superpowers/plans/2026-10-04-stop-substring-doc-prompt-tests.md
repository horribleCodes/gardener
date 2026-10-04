# Stop substring tests of docs and prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the unit test that substring-matches glossary and play copy, and tell later spec and implement runs not to add that kind of test.

**Architecture:** Delete `test/docs/glossary-play-strain-sheet.test.ts` with no replacement. Add one **Do not** bullet to `.cursor/prompts/spec.md` and one to `.cursor/prompts/implement.md`. No product code, no living design docs, no new tests.

**Tech Stack:** Vitest 5 (`npm test` / `npx vitest run`), Markdown prompts.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-stop-substring-doc-prompt-tests-design.md`. If this plan disagrees with that file, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/79
- You are already on the spec pull request branch. Do not create another branch. Do not open another pull request.
- Delete `test/docs/glossary-play-strain-sheet.test.ts` only. Do not edit `test/scripts/start-spec-pass.test.ts` or any other test.
- Do not add a unit test, string guard, exact-text assertion, or snapshot of a documentation or prompt file.
- A documentation file is `AGENTS.md`, `README.md`, or markdown under `docs/`. A prompt file is markdown under `.cursor/prompts/`, `.cursor/skills/`, or `user/`.
- Do not edit living design docs, play copy, `AGENTS.md`, `README.md`, or historical files already under `docs/superpowers/` other than following this plan's two prompt edits.
- Prompt bullets are copied verbatim from the spec. Do not paraphrase them.
- Package manager: npm. Full suite: `npm test`.

---

## File map

- Delete: `test/docs/glossary-play-strain-sheet.test.ts` — the only unit test that reads glossary and play copy and matches substrings.
- Modify: `.cursor/prompts/spec.md` — **Do not** bullet so later plans do not schedule that kind of test.
- Modify: `.cursor/prompts/implement.md` — **Do not** bullet so later implementations do not write that kind of test.

---

### Task 1: Delete the glossary and play substring test

**Files:**
- Delete: `test/docs/glossary-play-strain-sheet.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: that path absent. Vitest include stays `test/**/*.test.ts` in `vitest.config.ts`. No other file imports the deleted test.

- [ ] **Step 1: Confirm the inventory**

Run:

```bash
rg -n "readFileSync|readFile\\(" test --glob '*.ts'
```

Expected: the only documentation or prompt paths are these three, all in `test/docs/glossary-play-strain-sheet.test.ts`:

- `docs/design/glossary.md`
- `user/skills/gdnr-player/references/gdnr-play.md`
- `user/skills/gdnr-director/references/gdnr-direct.md`

If another test file reads a documentation or prompt file, stop. Do not delete that other file. The spec's inventory is then wrong. A `readFileSync` of something that is not a documentation or prompt file is not this test; leave it and continue.

- [ ] **Step 2: Delete the file**

```bash
git rm test/docs/glossary-play-strain-sheet.test.ts
```

Do not add a file under `test/docs/`. Do not add an assertion on those three paths anywhere else.

- [ ] **Step 3: Run the suite**

```bash
npm test
```

Expected: exit code 0. The reporter does not list `glossary-play-strain-sheet`.

- [ ] **Step 4: Commit**

`git rm` already stages the deletion. Confirm `git status` shows only that deletion, then:

```bash
git commit -m "test: drop substring checks of glossary and play copy"
```

---

### Task 2: Forbid the pattern in the spec and implement prompts

**Files:**
- Modify: `.cursor/prompts/spec.md`
- Modify: `.cursor/prompts/implement.md`

**Interfaces:**
- Consumes: Task 1 left the suite green without the deleted test.
- Produces: the two **Do not** bullets below, and no new test file.

- [ ] **Step 1: Replace the spec prompt's Do not list**

In `.cursor/prompts/spec.md`, replace the whole `## Do not` list with:

```markdown
## Do not

- Write product code or tests.
- Plan a unit test that reads a documentation file or a prompt file and asserts on that file's text. A documentation file is `AGENTS.md`, `README.md`, or markdown under `docs/`. A prompt file is markdown under `.cursor/prompts/`, `.cursor/skills/`, or `user/`. Substring and regular-expression matches (`toContain`, `toMatch`, `includes`, and the same check under another name) are this kind of test, including negative matches. Do not schedule a string guard, an exact-text assertion, or a snapshot of that file. This overrides the writing-plans skill for that subject. A test of a function return value is not this kind of test.
- Mark the pull request ready.
- Merge.
- Add a different label to the new PR.
- Set **Priority**, **Size**, **Impact**, or **Wave** on Gardener Project or move Project cards.
- Follow a skill step that commits the spec onto the default branch. The draft pull request is the only landing place.
- Tell the implementer to branch from `main` or open a second pull request.
```

Leave the rest of `.cursor/prompts/spec.md` unchanged.

- [ ] **Step 2: Replace the implement prompt's Do not list**

In `.cursor/prompts/implement.md`, replace the whole `## Do not` list with:

```markdown
## Do not

- Open a new pull request (`gh pr create` or any equivalent). The spec PR is the only PR for this work.
- Create a new branch, including from `main` or `origin/main`.
- Merge, approve, or enable auto-merge.
- Set **Priority**, **Size**, **Impact**, or **Wave** on Gardener Project or move Project cards.
- Add a test, fixture, or source change whose only purpose is to satisfy a checklist row. The reviewer runs the checklist as the branch stands.
- Add a unit test that reads a documentation file or a prompt file and asserts on that file's text. A documentation file is `AGENTS.md`, `README.md`, or markdown under `docs/`. A prompt file is markdown under `.cursor/prompts/`, `.cursor/skills/`, or `user/`. Substring and regular-expression matches (`toContain`, `toMatch`, `includes`, and the same check under another name) are this kind of test, including negative matches. Do not replace a deleted test of that kind with another assertion on the same file text, including an exact-text assertion or a snapshot. A test of a function return value is not this kind of test.
```

Leave the rest of `.cursor/prompts/implement.md` unchanged. Do not add a test that reads either prompt.

- [ ] **Step 3: Check the diff**

```bash
git diff -- .cursor/prompts/spec.md .cursor/prompts/implement.md
```

Expected: each file gains exactly one bullet, matching the lists above. No other hunks.

```bash
npm test
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add .cursor/prompts/spec.md .cursor/prompts/implement.md
git commit -m "prompt: forbid substring tests of docs and prompts"
```
