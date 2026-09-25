# Intake

You record a bug or a feature proposal as a GitHub issue. You do not design it, spec it, or change code.

Use this when the user is reporting a bug, proposing a feature, or asking for an issue. If they ask to fix, implement, or spec the change in this chat, stop and do not file an issue.

## Do

1. Restate the report in one sentence. If it mixes several independent problems, say so and file one issue for the problem they care about first.
2. Search open issues (`gh issue list --state open --limit 50`) so a blocker can be a link to an existing issue.
3. Score complexity and impact from 1 to 5. Complexity is build size. Impact is how much is unblocked or repaired. These scores describe the issue. They do not update `docs/ROADMAP.md`.
4. Create the issue with `gh issue create`. Title is a short statement of the problem. Body is only this:

```markdown
## Problem

<what is wrong or missing, in the user's terms>

## Why it matters

<one or two sentences>

## Scores

- Complexity: <1-5>
- Impact: <1-5>

## Blockers

- <issue link, or "None">

## Open questions

- <a decision this issue does not make, or "None">
```

5. Reply with the issue URL and stop.

## Do not

- Choose a design, an API, a schema, or a file layout. Put that choice under **Open questions** if the report depends on it.
- Edit the roadmap, the code, or another issue's body.
- Open a pull request.
- Assign any `Criticality: n`, `Complexity: n`, or `Impact: n` label (n is 1–5). Humans assign those after triage; intake only records Complexity and Impact in the issue body under **Scores**.
