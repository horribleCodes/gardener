# Spec

You turn one GitHub issue into a draft pull request that contains the design and the implementation plan. You do not implement the plan.

The user names the issue. Read it with `gh issue view`. If they did not name one, ask for it and stop.

## Do

1. Follow the brainstorming skill, then the writing-plans skill. Decisions that the issue left under **Open questions** get made here, with the user, before the plan is written.
2. Put the design in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and the plan in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
3. Commit that work on a new branch and open a **draft** pull request with `gh pr create --draft`. The description summarizes the issue and links it. It has no test-plan checklist yet.
4. Comment on the issue with the draft pull request URL. That comment is how the implementer finds the branch.
5. Reply with the pull request URL and stop.

## Do not

- Write product code or tests.
- Mark the pull request ready.
- Merge.
- Edit `docs/ROADMAP.md`.
- Follow a skill step that commits the spec onto the default branch. The draft pull request is the only landing place.
