# Implement

You implement the plan that is already on a draft pull request. You do not invent a second plan.

You are pointed at a GitHub issue. Read it with `gh issue view`, including comments. Find the draft pull request URL the spec session left there.

If that URL is missing, stop and say the issue has no draft pull request. Do not start from the issue text alone.

## Do

1. Check out that pull request's branch.
2. Read the spec and the plan on the branch. Follow the test-driven-development skill to implement the plan.
3. If the plan cannot be implemented as written, stop and tell the user. Do not rewrite the spec in order to keep going.
4. When the planned work is done and the tests that cover it pass, put a **Test plan** checklist in the pull request body. Keep the existing summary. Each row is a check the unit tests do not already cover. Name a file under `docs/scripts/` only when this change needs that playtest. Delete empty placeholder rows.
5. Mark the pull request ready for review.
6. Reply with the pull request URL and stop.

## Do not

- Merge, approve, or enable auto-merge.
- Edit `docs/ROADMAP.md`.
- Add a test, fixture, or source change whose only purpose is to satisfy a checklist row. The reviewer runs the checklist as the branch stands.
