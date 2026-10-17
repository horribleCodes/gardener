# Log origin/main without checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm `.cursor/scripts/get-commits-since.sh` logs `<SHA>..origin/main` without moving `HEAD`, restore that sequence only if it drifted, and remove leftover gap notes so #130 can close as already done in #40.

**Architecture:** D36 is a host script, not engine rules. The shipped sequence is fetch `origin main`, then `git log` the remote-tracking range. No checkout. Project-check keeps calling the same path. This plan is a confirmation pass unless the script or a gap note has drifted.

**Tech Stack:** Bash, git, `rg`, the existing Python formatter inside the script.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-17-get-commits-since-no-checkout-design.md`. If this plan disagrees with that file, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/130
- You are already on the spec pull request branch. Do not create another branch. Do not open another pull request.
- Do not write a unit test that reads a documentation or prompt file and asserts on that file's text.
- Do not change the script's output format or the project-check procedure.
- Do not edit living design docs, play copy, `AGENTS.md`, or MCP/engine code unless a matching gap note must be removed.
- Do not invent a product diff if the confirmation already holds.

---

## File map

- Confirm (edit only if drifted): `.cursor/scripts/get-commits-since.sh` — fetch `origin main`, log `$SHA..origin/main`, never checkout.
- Caller (do not edit unless it still describes detached HEAD as a gap): `.cursor/prompts/project-check.md`.
- Do not create test files.

---

### Task 1: Confirm the script leaves HEAD on the current branch

**Files:**
- Read: `.cursor/scripts/get-commits-since.sh`

**Interfaces:**
- Consumes: the spec's required sequence (fetch `origin main`, log `"$SHA..origin/main"`, no checkout).
- Produces: a pass/fail for Task 2. Pass means the file already matches and HEAD did not move.

- [ ] **Step 1: Inventory the script**

Run:

```bash
rg -n 'checkout|git switch|origin/main|git fetch|git log' .cursor/scripts/get-commits-since.sh
```

Expected on an un-drifted tree:

- one `git fetch origin main`
- one log range `"$SHA..origin/main"`
- no `checkout` and no `git switch`

If `checkout` or `git switch` is present, or the range is `"$SHA..main"` without `origin/`, Task 1 fails and Task 2 restores the file. If the inventory already matches, continue to Step 2 and skip Task 2's edit.

- [ ] **Step 2: Record HEAD, run the script, compare HEAD**

From a named branch (this spec branch is fine):

```bash
BEFORE=$(git rev-parse --abbrev-ref HEAD)
BASE=$(git merge-base HEAD origin/main)
./.cursor/scripts/get-commits-since.sh "$BASE"
AFTER=$(git rev-parse --abbrev-ref HEAD)
printf 'before=%s after=%s\n' "$BEFORE" "$AFTER"
```

Expected:

- `before` equals `after` and is not `HEAD`.
- The script exits 0.
- Output is the commits in `$BASE..origin/main` using the existing formatter (empty output is correct when that range is empty).
- `git status --short` is unchanged except for ignored files.

If HEAD moved, Task 1 fails and Task 2 restores the script. If HEAD is unchanged and Step 1 matched, Task 1 passes.

- [ ] **Step 3: Do not commit in this task**

This task only reads and runs. A commit happens in Task 2 only when the script was restored, or in Task 3 only when a gap note was removed.

---

### Task 2: Restore the script only if Task 1 failed

**Files:**
- Modify: `.cursor/scripts/get-commits-since.sh` (only when Task 1 failed)

**Interfaces:**
- Consumes: Task 1 fail (checkout, `git switch`, or `$SHA..main` without `origin/`, or HEAD moved).
- Produces: the file contents below. Formatter unchanged.

Skip every step in this task when Task 1 passed.

- [ ] **Step 1: Write the required script**

Replace `.cursor/scripts/get-commits-since.sh` with exactly:

```bash
#!/bin/bash

git fetch origin main > /dev/null 2>&1

SHA=$1

git -c color.ui=never log --no-merges --reverse --format='%x1e%h%x1f%s%x1f%B' "$SHA..origin/main" | python3 -c '
import sys
begin = "<!-- CURSOR_AGENT_PR_BODY_BEGIN -->"
end = "<!-- CURSOR_AGENT_PR_BODY_END -->"
chunks = [c for c in sys.stdin.read().split("\x1e") if c.strip("\n")]
out = []
for c in chunks:
    h, s, body = c.split("\x1f", 2)
    body = body.strip("\n")
    if begin in body and end in body:
        inner = body.split(begin, 1)[1].split(end, 1)[0].strip("\n")
        msg = s.strip("\n") + "\n" + inner
    else:
        msg = body
    out.append(h.strip("\n") + "\n\n" + msg)
print("\n---\n".join(out))
'
```

Keep the file executable (`chmod +x .cursor/scripts/get-commits-since.sh` if the bit was lost).

- [ ] **Step 2: Re-run the Task 1 checks**

```bash
rg -n 'checkout|git switch' .cursor/scripts/get-commits-since.sh
BEFORE=$(git rev-parse --abbrev-ref HEAD)
BASE=$(git merge-base HEAD origin/main)
./.cursor/scripts/get-commits-since.sh "$BASE"
AFTER=$(git rev-parse --abbrev-ref HEAD)
printf 'before=%s after=%s\n' "$BEFORE" "$AFTER"
```

Expected: `rg` prints nothing. `before` equals `after` and is not `HEAD`.

- [ ] **Step 3: Commit**

```bash
git add .cursor/scripts/get-commits-since.sh
git commit -m "fix: log origin/main without checking it out"
```

---

### Task 3: Remove leftover detached-HEAD gap notes

**Files:**
- Search: `.cursor/`, `docs/`, `AGENTS.md`, `README.md`, `user/`
- Modify: only a file that still describes this script's detached-HEAD or `git checkout origin/main` behavior as a current gap

**Interfaces:**
- Consumes: Task 1 pass, or Task 2 restored script.
- Produces: no remaining matching gap note. Unrelated "Not implemented yet" lines stay.

- [ ] **Step 1: Search**

Run:

```bash
rg -n -i 'get-commits-since|detached HEAD|checkout origin/main' .cursor docs AGENTS.md README.md user --glob '!docs/superpowers/**'
```

Treat a hit as in-scope only when it claims the script still checks out `origin/main` or still leaves a detached HEAD. The project-check line that only invokes `./.cursor/scripts/get-commits-since.sh <SHA>` is not a gap. `docs/design/glossary.md` "Not implemented yet" for the catalog folder is not this issue.

On an un-drifted tree the only hit is that project-check invoke. Then skip Step 2 and Step 3.

- [ ] **Step 2: Delete matching gap sentences**

If Step 1 found an in-scope sentence, delete that sentence or clause only. Do not add a replacement "the script no longer detaches HEAD" note. Do not rewrite the rest of the file.

- [ ] **Step 3: Commit only when a file changed**

```bash
git add <only-the-files-you-edited>
git commit -m "docs: drop detached-HEAD gap notes for get-commits-since"
```

If no file changed, do not commit.

---

### Task 4: Stop when confirmation holds

**Files:**
- None when Tasks 1–3 made no product edit.

**Interfaces:**
- Consumes: Task 1 pass and Task 3 found no in-scope gap notes (the expected `main` state as of `c81770f` / #40).
- Produces: this spec branch unchanged beyond the spec and plan already committed.

- [ ] **Step 1: Confirm there is no leftover product diff**

```bash
git diff --stat origin/main -- . ':(exclude)docs/superpowers/**'
```

Expected when confirmation holds: empty. The only commits on this branch stay the spec and plan. Do not edit the script, prompts, or living docs to manufacture a diff.

- [ ] **Step 2: Do not open another pull request**

Leave the work on this spec branch. Implementation of this plan is finished when the verification in the spec holds.
