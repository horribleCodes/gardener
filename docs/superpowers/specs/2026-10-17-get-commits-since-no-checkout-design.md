# Log origin/main without checkout

> Status: design for issue #130. The script behavior is already on `main` as of `c81770f` ([#40](https://github.com/horribleCodes/gardener/pull/40), merged 2026-09-28). This spec records the check that closes the issue. No living design docs change.

## Purpose

`.cursor/scripts/get-commits-since.sh` must fetch `origin main` and log `<SHA>..origin/main` without running `git checkout`, so a project-check run never leaves the worktree on a detached HEAD.

The requirement is [#35](https://github.com/horribleCodes/gardener/issues/35) decision **D36** ([living comment](https://github.com/horribleCodes/gardener/issues/35#issuecomment-5854916970)). Issue #130 already decided the shape:

- The script fetches `origin main` and logs `<SHA>..origin/main`. It never runs `git checkout`.
- `.cursor/prompts/project-check.md` keeps calling the script as it does today.
- Close #130 as completed by #40 once that check is confirmed.
- Also remove any matching "not implemented yet", gap, or deferred-feature notes that described the detached-HEAD behavior. None remain on `main`.

There is no **Open questions** section on the issue.

## Approaches

**A. Confirm the shipped script and close. Recommended.**

`c81770f` already replaced `git fetch origin` plus `git checkout origin/main` plus `$SHA..main` with `git fetch origin main` and `$SHA..origin/main`. The Python formatter is unchanged. Implementation on this branch is a confirmation pass: if the script still matches that shape and no gap notes remain, do not edit product files.

**B. Touch the script again so this issue "owns" a diff.**

Rejected. A no-op rewrite is out of scope and would fight the issue's "main already matches" statement.

**C. Add an automated test of the shell script.**

Rejected. The issue's acceptance is a checkout-stability check plus a gap-note sweep. It forbids other changes to the project-check procedure or the script's output format. Do not add a unit test that reads a documentation or prompt file.

## Shape

### Script

The only file that implements D36 is `.cursor/scripts/get-commits-since.sh`. Required sequence:

1. `git fetch origin main` (stdout and stderr discarded).
2. Read `$1` as `SHA`.
3. `git -c color.ui=never log --no-merges --reverse --format='%x1e%h%x1f%s%x1f%B' "$SHA..origin/main"` piped into the existing Python formatter.

Forbidden: any `git checkout`, `git switch`, or other command that moves `HEAD`. The range is `origin/main`, not `main`, so a local `main` that lags the fetch is not the log tip.

The formatter (PR-body begin/end markers, `\x1e` / `\x1f` split, `---`, subject-plus-inner-body) stays exactly as it is on `main`. This spec does not change output.

### Caller

`.cursor/prompts/project-check.md` step 4 stays:

```markdown
4. Read commits since the last commit with `./.cursor/scripts/get-commits-since.sh <SHA>`.
```

Do not add a warning, a "leaves the checkout alone" note, or any other project-check wording unless a remaining sentence still describes detached HEAD as a current gap. On `main` at `732bf2a` that prompt only names the script; it does not claim the old checkout behavior.

### Gap notes

Search docs and prompts for leftover claims that the script still checks out `origin/main` or still detaches `HEAD`. Remove only those matching notes. Do not delete unrelated "Not implemented yet" lines (for example the catalog-folder note in `docs/design/glossary.md`).

On `main` at `732bf2a` there are no matching notes.

### If `main` drifted

If the implementer finds `git checkout` (or `$SHA..main` without `origin/`) in the script, restore the sequence in **Script** above. Do not change the formatter. Then re-run the acceptance check.

## Out of scope

- Any other edit to the project-check procedure.
- Changing the script's output format, fetch flags beyond `origin main`, or color/`--no-merges`/`--reverse` settings.
- Living design docs, play copy, `AGENTS.md`, or MCP/engine code.
- A second pull request. Implementation continues on this spec branch.

## Verification

After implementation (or after confirming no product edit is needed):

- `rg -n 'checkout|git switch' .cursor/scripts/get-commits-since.sh` prints nothing.
- The log range in that file is `"$SHA..origin/main"`.
- On a named branch, `git rev-parse --abbrev-ref HEAD` is the same before and after `./.cursor/scripts/get-commits-since.sh <SHA>`.
- The script prints the commits in `<SHA>..origin/main` (empty output is fine when the range is empty).
- No remaining doc or prompt describes detached HEAD or `git checkout origin/main` as a current gap for this script.
