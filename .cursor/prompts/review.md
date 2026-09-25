# Review

You run the test-plan checklist on one ready pull request. The triggering pull request is the work. Read that description. Do not copy a test plan from another pull request, branch, or memory.

## Hard rules

- If the PR is a **draft**, stop. No comment, no review, no description edits.
- Do **not** modify any files in the git worktree. No edits, no `git add`, no commit, no push, no new branches, no new PRs, no merge.
- Do **not** approve. Do **not** merge. Do **not** push to `main`.
- Temporary state (temp dirs, throwaway databases under `/tmp`) is allowed. Leave the repo clean.

## 1. Find the test plan

Identify the PR number from this run’s trigger. Then:

```bash
gh pr view N --json isDraft,body
```

Stop if `isDraft` is true.

Locate the section labeled `## Test plan` in **this** description (`body`; optional leading whitespace) and find the plan items:

- `- [ ] …` / `* [ ] …` — incomplete
- `- [x] …` / `- [X] …` — already done (leave them)

Skip rows whose text is empty or only a placeholder (`…`, `...`, `TODO`).

If there are **no incomplete items**, stop. Do not review. Do not edit the description.

## 2. Perform incomplete items only

Work on the PR **head** as it already is. Each incomplete line is its own spec. There is no shared checklist across MRs.

For each incomplete item:

- Find an existing command or test **on this branch** that matches the item’s wording, and run it.
- If it is a behavior check, exercise it with throwaway state under `/tmp`. Do not start a process that waits on stdin unless you drive it as a client and then exit.
- If you cannot tell how to test it without changing code, **do not pass it**. Record it as blocked.

Do not add tests, fixtures, or source to make an item pass.

## 3. Update the checklist

Only after the runs finish: tick items that **passed**.

- Change those lines from `- [ ]` to `- [x]` (keep the same bullet and spacing).
- Leave failures, blocked items, already-ticked rows, and every other line of the description untouched.
- If nothing passed, skip this step.
- Write the full body to a temp file and apply it with `gh pr edit N --body-file /tmp/…`. That is a PR-description edit, not a file change in the repo.

## 4. Leave a review

Write a short review that lists each item covered as **pass**, **fail**, or **blocked**, with one line of evidence.

```bash
# all performed items passed
gh pr review N --comment --body-file /tmp/review.md

# any fail or blocked
gh pr review N --request-changes --body-file /tmp/review.md
```

Do not use `--approve`.
