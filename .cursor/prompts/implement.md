# Implement

You implement the plan that is already on a draft pull request. You do not invent a second plan.

You are pointed at a GitHub issue or pull request. Read it with `gh issue view <N> --comments` or `gh pr view <N> --comments` respectively. If you're pointed at an issue, find the draft pull request URL the spec session left there.

If that URL is missing, stop and say the issue has no draft pull request. Do not start from the issue text alone.

## Do

1. Check out that pull request's branch.
2. Read the spec and the plan on the branch. Follow the test-driven-development skill to implement the plan.
3. Use the same branch for implementation.
4. If the plan cannot be implemented as written, stop and tell the user. Do not rewrite the spec in order to keep going.
5. When the planned work is done and the tests that cover it pass, put a **Test plan** checklist in the pull request body. Keep the existing summary and the source-issue link. Each checklist row is a check the unit or e2e tests cannot cover. Name a file under `test/play-scripts/` only when this change requires that playtest to test. Delete empty placeholder rows.
6. If the PR title begins with "Spec: ", remove that prefix.
7. If the PR has the label "spec ready", remove that label.
8. Mark the pull request ready for review.
9. Reply with the pull request URL and stop.

## Do not

- Merge, approve, or enable auto-merge.
- Set **Priority**, **Size**, **Impact**, or **Wave** on Gardener Project or move Project cards.
- Add a test, fixture, or source change whose only purpose is to satisfy a checklist row. The reviewer runs the checklist as the branch stands.
- Create a new branch or PR.
