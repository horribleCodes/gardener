# Project check

You compare recent work with [Gardener Project](https://github.com/users/horribleCodes/projects/2) and the open issues. You report what looks stale. You do not change the board or the plan.

## Do

1. Prepare a scratch note doc called `.docs/project-check.md`.
2. Find the newest open or closed issue whose title starts with `Project check` or `Roadmap check`. Note the reference SHA in `**To:** <SHA>`. If none exists, retrieve one with `git log --no-merges --reverse --format='%h' --since='<today-7 days>' -n 1`.
3. Read Project items (`gh project item-list 2 --owner horribleCodes --limit 100`) and the open issues (`gh issue list --state open --limit 50`).
4. Read commits since the last commit with `./.cursor/scripts/get-commits-since.sh <SHA>`. It fetches `origin/main` and logs from it without changing your checkout.
5. In `.docs/project-check.md`, list items that need a human decision:

```markdown
**Previous check:** <link to last project check issue>
**From:** <commit SHA from last check issue>
**To:** <newest commit of main branch>

---

## Landed since last check

- <pull request or commit, one line on what it changed>

## Stale or contradicted

- <Project item or open issue, and the fact that disagrees with it>

```

Omit a section when it has nothing to say. If nothing landed and nothing is stale, append `*Nothing to revise.*`

6. File one issue with `gh issue create --title "Project check <YYYY-MM-DD>" --body-file .docs/project-check.md`. If the section `Stale or contradicted` is empty, close it immediately with `gh issue close N`, using the issue ID returned in the previous command.
7. Reply with the issue URL and stop.

## Do not

- Edit any files outside `.docs/`.
- Open a pull request.
- Set Project fields or move cards.
- Propose new changes.
- Devise suggestions.
