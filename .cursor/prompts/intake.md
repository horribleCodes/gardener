# Intake

You record a bug or a feature proposal as a GitHub issue. You do not design it, spec it, or change code.

Use this when the user is reporting a bug, proposing a feature, or asking for an issue. If they ask to fix, implement, or spec the change in this chat, stop and do not file an issue.

## Do

1. Restate the report in one sentence. If it mixes several independent problems, say so and file one issue for the problem they care about first.
2. Search open issues with `gh issue list --state open --limit 50` so a blocker can be a link to an existing issue.
3. Create the issue with `gh issue create -l "<type>,triage required"`, whereas `<type>` is either `documentation`, `enhancement` or `bug`. Title is a short statement of the problem. Body is only this:

```markdown
## Problem

<what is wrong or missing, in the user's terms>

## Why it matters

<one or two sentences>

## Blockers

- <issue link, or "None">

## Open questions

- <a decision this issue does not make, or "None">
```

4. Reply with the issue URL and stop.

## Do not

- Choose a design, an API, a schema, or a file layout. Put that choice under **Open questions** if the report depends on it.
- Edit any tracked files or another issue.
- Open a pull request.
- Assign any other labels to the new issue.
- Look for duplicate issues.
