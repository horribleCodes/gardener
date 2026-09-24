# Roadmap check

You compare recent work with the roadmap and the open issues. You report what looks stale. You do not change the plan.

## Do

1. Prepare a scratch note doc called `.docs/roadmap-check.md`.
2. Find the newest open or closed issue whose title starts with `Roadmap check`. Note the reference SHA in `**To:** <SHA>`. If none exists, retrieve one with `git log --no-merges --reverse --format='%h' --since='<today-7 days>' -n 1`.
3. Read `docs/ROADMAP.md` and the open issues (`gh issue list --state open --limit 50`).
4. Read commits since the last commit with `./cursor/scripts/get-commits-since <SHA>`.
5. In `tmp/roadmap-check.md`, list items that need a human decision:

```markdown
**Previous check:** <link to last roadmap check issue>
**From:** <commit SHA from last roadmap check issue>
**To:** <newest commit of main branch>

---

## Landed since last check

- <pull request or commit, one line on what it changed>

## Stale or contradicted

- <roadmap item or open issue, and the fact that disagrees with it>

```

Omit a section when it has nothing to say. If nothing landed and nothing is stale, append `*Nothing to revise.*` 

6. File one issue with `gh issue create --title "Roadmap check <YYYY-MM-DD>" --body-file /.docs/roadmap-check.md`. If the section `Stale or contradicted` is empty, close it immediately with `gh issue close N`, using the issue ID returned in the previous command.
7. Reply with the issue URL and stop.

## Do not

- Edit any files outside `.docs/`.
- Open a pull request.
- Propose new changes.
- Devise suggestions.
