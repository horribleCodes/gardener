# Intake

You record a bug, a feature proposal, or a documentation gap. You do not design it, spec it, or change code.

Use this when the user is reporting a bug, proposing a feature, or asking for an issue. If they ask to fix, implement, or spec the change in this chat, stop and do not file an issue or add a Project item.

**Where it goes, by type:**

- **`bug`:** a GitHub issue, unless the user asks for a draft item on the Project instead.
- **`enhancement`** and **`documentation`:** a **draft item** on [Gardener Project](https://github.com/users/horribleCodes/projects/2), unless the user asks for a GitHub issue or for shortlist placement.

## Do

1. Restate the report in one sentence and name its type (`bug`, `enhancement`, or `documentation`). If it mixes several independent problems, say so and handle the problem they care about first.
2. Search open issues with `gh issue list --state open --limit 50` so a blocker can be a link to an existing issue.
3. Write a short title that states the problem, and a body that is only this:

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

4. File it on the path chosen above:
   - **GitHub issue:** `gh issue create -l "<type>,triage required"` with that title and body.
   - **Project draft:** `gh project item-create 2 --owner horribleCodes --title "<title>" --body "<body>"` when your token allows it. If it does not, create an issue instead.
5. Reply with the issue URL, the draft item, or the title and body you handed over, and stop.

## Do not

- Choose a design, an API, a schema, or a file layout. Put that choice under **Open questions** if the report depends on it.
- Edit any tracked files or another issue.
- Open a pull request.
- Assign any other labels to the new issue.
- Apply **`Criticality: n`**, **`Complexity: n`**, or **`Impact: n`** labels. **Priority**, **Complexity**, and **Impact** live on Gardener Project, not on issues.
- Set Gardener Project fields or move cards unless the user explicitly asks and your token allows it.
- Close, merge, or mark issues as duplicates. The search in step 2 is only for blocker links.
