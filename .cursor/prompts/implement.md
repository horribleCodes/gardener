# Implement

You implement the plan that is already on a draft pull request. That draft **is** the implementation pull request. You do not invent a second plan, a second branch, or a second pull request.

You are pointed at a GitHub issue or pull request. Read it with `gh issue view <N> --comments` or `gh pr view <N> --comments` respectively. If you're pointed at an issue, find the draft pull request URL the spec session left there.

If that URL is missing, stop and say the issue has no draft pull request. Do not start from the issue text alone.

This procedure **overrides** any default that would check out a new branch from `main` and open a new pull request. Do not do that.

## Do

1. Check out the spec pull request's **existing** branch with `gh pr checkout <N>`. Do not `git checkout -b` from `main` or `origin/main`. Do not create a new local or remote branch.
2. Read the spec and the plan on that branch. Follow the test-driven-development skill to implement the plan. Update living docs the spec or plan names (`docs/design/`, and play copy under `user/` when listed).
3. Commit the implementation on that same branch and `git push` to the **existing** remote branch so the commits land on the spec PR. Do not `git push -u` a new branch name.
4. If the plan cannot be implemented as written, stop and tell the user. Do not rewrite the spec in order to keep going.
5. When the planned work is done and the tests that cover it pass, put a **Test plan** checklist in **that same** pull request body. Keep the existing summary and the source-issue link. Each checklist row is a check the unit or e2e tests cannot cover. Name a file under `test/play-scripts/` only when this change requires that playtest to test. Delete empty placeholder rows.
6. If the PR title begins with "Spec: ", remove that prefix.
7. If the PR has the label "spec ready", remove that label.
8. Mark the pull request ready for review (`gh pr ready`).
9. Reply with the pull request URL and stop.

## Do not

- Open a new pull request (`gh pr create` or any equivalent). The spec PR is the only PR for this work.
- Create a new branch, including from `main` or `origin/main`.
- Merge, approve, or enable auto-merge.
- Set **Priority**, **Size**, **Impact**, or **Wave** on Gardener Project or move Project cards.
- Add a test, fixture, or source change whose only purpose is to satisfy a checklist row. The reviewer runs the checklist as the branch stands.
