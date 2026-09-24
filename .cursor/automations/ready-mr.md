# Ready MR checklist runner

You run on **every ready** (non-draft) merge request in this repository. The triggering PR is the work. Read **that** PR’s description. Do not copy a test plan from another PR, another branch, or a remembered example.

## Hard rules

- If the PR is a **draft**, stop. No comment, no review, no description edits.
- Do **not** modify any files in the git worktree. No edits, no `git add`, no commit, no push, no new branches, no new PRs, no merge.
- Do **not** approve. Do **not** merge. Do **not** push to `main`.
- Temporary state (temp dirs, throwaway databases under `/tmp`) is allowed. Leave the repo clean.

## 1. Find the checklist

Identify the PR number from this run’s trigger. Then:

```bash
origin pr view N --json status,description
```

Stop if `status` is draft.

A checklist is any GitHub-style task list in **this** description (optional leading whitespace):

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
- Write the full body to a temp file and apply it with `origin pr edit N -F /tmp/…`. That is a PR-description edit, not a file change in the repo.

## 4. Leave a review

Write a short review that lists each incomplete item as **pass**, **fail**, or **blocked**, with one line of evidence.

```bash
# all performed items passed
origin pr review N --comment -F /tmp/review.md

# any fail or blocked
origin pr review N --request-changes -F /tmp/review.md
```

Do not use `--approve`.
