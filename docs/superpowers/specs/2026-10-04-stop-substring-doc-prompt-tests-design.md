# Stop substring tests of docs and prompts

> Status: design for issue #79. Not implemented on this branch. No living design docs change.

## Purpose

Implementations that edit documentation or prompts must stop adding unit tests that pin those files by substring or regular-expression match. One such test is already in the tree. Prompt files that write later plans and implementations must say not to add another.

Issue #79 already decided the shape:

- Remove existing unit tests that check documentation or prompt text for substring matches.
- Update prompt files so future implementation runs do not write that style of test.

Issue #79 has no **Open questions** section. The boundary calls below are the ones the issue left implicit.

## Approaches

1. **Delete the one matching test and forbid the pattern in the spec and implement prompts (chosen).** Remove `test/docs/glossary-play-strain-sheet.test.ts`. Add one **Do not** bullet to `.cursor/prompts/spec.md` and one to `.cursor/prompts/implement.md`. Those two prompts are what cause a later run to schedule the test (the plan) and to write it (the implementation). Historical files under `docs/superpowers/` stay frozen.

2. **Replace the assertions with a full-file snapshot.** Rejected. That is still a unit test of documentation and prompt text, and any wording edit fails the suite. The issue says remove these tests.

3. **Keep the test and only update the prompts.** Rejected. The issue says remove the existing tests.

## What counts

A unit test is this kind of test when it reads a documentation file or a prompt file and asserts on that file's text.

- A documentation file is `AGENTS.md`, `README.md`, or markdown under `docs/`.
- A prompt file is markdown under `.cursor/prompts/`, `.cursor/skills/`, or `user/`.
- A match is `toContain`, `toMatch`, `includes`, or the same check under another name, including a negative match (`not.toContain`, `not.toMatch`).

`test/docs/glossary-play-strain-sheet.test.ts` is the only test that does this. It reads `docs/design/glossary.md`, `user/skills/gdnr-player/references/gdnr-play.md`, and `user/skills/gdnr-director/references/gdnr-direct.md`, then matches headings and phrases. Delete that file. Do not add a replacement that reads those files, including an exact `toBe` or a snapshot of their text.

These stay:

- `test/scripts/start-spec-pass.test.ts`. It asserts on the string `specPassPrompt()` returns and on the webhook body the script posts. That string is a function return value, not a file read. Its `toContain` checks stay.
- `toContain` and `toMatch` on tool names, SQL, error messages, and domain JSON.
- Already-merged plans under `docs/superpowers/plans/`. They are history. Do not edit them to delete the old string-guard steps. Vitest does not run them.

Shell `rg` inside a finished plan is not a unit test. This issue does not add or remove those steps. A new plan must not turn an `rg` of a documentation or prompt file into a committed test.

## Prompt edits

Both bullets use the same definition, so a spec run and an implement run do not need this design open to apply it.

### `.cursor/prompts/spec.md`

Add this bullet to **Do not**, immediately after "Write product code or tests.":

```markdown
- Plan a unit test that reads a documentation file or a prompt file and asserts on that file's text. A documentation file is `AGENTS.md`, `README.md`, or markdown under `docs/`. A prompt file is markdown under `.cursor/prompts/`, `.cursor/skills/`, or `user/`. Substring and regular-expression matches (`toContain`, `toMatch`, `includes`, and the same check under another name) are this kind of test, including negative matches. Do not schedule a string guard, an exact-text assertion, or a snapshot of that file. This overrides the writing-plans skill for that subject. A test of a function return value is not this kind of test.
```

### `.cursor/prompts/implement.md`

Add this bullet at the end of **Do not**:

```markdown
- Add a unit test that reads a documentation file or a prompt file and asserts on that file's text. A documentation file is `AGENTS.md`, `README.md`, or markdown under `docs/`. A prompt file is markdown under `.cursor/prompts/`, `.cursor/skills/`, or `user/`. Substring and regular-expression matches (`toContain`, `toMatch`, `includes`, and the same check under another name) are this kind of test, including negative matches. Do not replace a deleted test of that kind with another assertion on the same file text, including an exact-text assertion or a snapshot. A test of a function return value is not this kind of test.
```

No other prompt file changes. Intake, triage, review, and project-check do not write these tests. `.cursor/skills/spec/SKILL.md` only points at `.cursor/prompts/spec.md`.

## Out of scope

- Wording changes to living design docs, play copy, or `AGENTS.md`, except the two prompt bullets above.
- Rewriting `test/scripts/start-spec-pass.test.ts`.
- Editing historical specs or plans.
- New unit tests of any kind. The deletion is verified by the file being gone and `npm test` still passing.

## Verification

After implementation:

- `test/docs/glossary-play-strain-sheet.test.ts` is gone, and `test/docs/` is not recreated.
- `npm test` exits 0 and does not load that file.
- The two **Do not** bullets above are the only edits under `.cursor/prompts/`.
