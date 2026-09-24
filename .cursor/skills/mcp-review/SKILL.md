---
name: mcp-review
description: >-
  Runs a live MCP review. Records each user request, tool call, decision,
  gap in MCP or skill instructions, failed attempt, and tool error, then
  writes a concise review when the user asks to end it. Use when the user
  starts an MCP review, playtest, or tool-usage review, while that review
  is in progress, or when they ask to end the review.
---

# MCP review

Record how an agent uses the project MCP. Do the user's task. Do not edit server source, tool schemas, or skill files to fill a gap. Record the gap.

Scratch notes live in `.docs/mcp-review-notes-<id>.md` (gitignored). Create the ID using `openssl rand -hex 8`. The finished review is `docs/reviews/YYYY-MM-DD-<review-theme>.md`, same directory and date pattern as [docs/reviews/2026-09-24-init-campaign.md](../../../docs/reviews/2026-09-24-init-campaign.md).

## Start

On the first turn of a review, if the scratch file is missing, create it with this skeleton and tell the user that notes are recording and that they can ask to end the review:

```markdown
# Scratch

- Commit:
- Agent:
- Theme:

## Log
```

Fill **Commit** with `git rev-parse --short HEAD` and **Agent** with the model name. Set **Theme** from the user's subject, as a short hyphenated slug. If they did not name one, pick one from the first request and correct it later if the subject shifts.

If the scratch file already exists, continue it. Do not start a second review.

## During the review

After every user message and after every tool call, append to `## Log` before the reply. One bullet per event. Include:

- The user request, in their words.
- Each tool call, in order: tool name, arguments that matter, and result in one line.
- Why that tool was chosen.
- Whether the MCP tool description or an associated skill was enough to choose it. If not, what was missing and where you looked instead (source, catalog, spec).
- Attempts that did not achieve the request, and why.
- Tool errors: code, message, and the arguments that produced them.
- A change that would have made the MCP sufficient.
- A change that would have made a skill file or tool description sufficient.

Keep bullets short. The scratch file is the source of truth if the conversation is compacted.

## End

When the user asks to end the review, stop the task and write the finished file.

1. Read the scratch file and [docs/reviews/2026-09-24-init-campaign.md](../../../docs/reviews/2026-09-24-init-campaign.md).
2. Write `docs/reviews/YYYY-MM-DD-<review-theme>.md`. Use today's date. Use the scratch theme as the slug.
3. Compress the log into the sections below. Drop repeated discovery. Keep every user request, every MCP call in order, every failure, and every error.
4. Delete `.docs/mcp-review-notes.md`.
5. Reply with the path of the finished review.

```markdown
# <Theme>

## Settings

- **Commit:** <short hash>
- **Agent:** <model name>

## User requests

1. <request, in the user's words>

## MCP calls

These are the MCP calls, in the order they ran.

> **User request 1**

1. **tool_name** — <one line: what it did and the result>

## How I reached that conclusion

<Why those tools, and where the MCP or skills were not enough.>

## What I tried that did not work

| Attempt | Why it failed |
|---|---|
| <attempt> | <reason> |

## Errors

<Tool name, error code, message, and the arguments that mattered. Write "None." if there were no errors.>

## What could change in the MCP

- <specific tool, field, or missing operation>

## What could change in skill files and tool descriptions

- <fact the agent had to learn outside the MCP and skills>
```

Omit an empty "did not work" table only when nothing failed. Write "None." under **Errors** when every call succeeded.
