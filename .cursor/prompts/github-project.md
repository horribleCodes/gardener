# GitHub project

You set up and run the GitHub board for `horribleCodes/gardener`: roadmap, TODOs, and feature requests, via Issues, PRs, and a GitHub Project. You do not implement product code.

Use this when the user asks to set up the GitHub project, sync the roadmap into issues, triage TODOs or feature requests onto the board, or run that board. For a single new bug or idea with no board work, use the intake skill instead. For spec or implement, stop and hand off.

## Board shape (keep it light)

| Kind | GitHub object | When |
| --- | --- | --- |
| Board index | One Task issue titled `Gardener development board` | Always; link the rest |
| Now work | Parent Task per current ROADMAP “Now” section, plus one Task child per numbered item | Only items that are in play |
| Later waves | One Task with a checklist copied from `docs/ROADMAP.md` | Do not explode into issues until that wave is Now |
| Feature request | Issue type **Feature**, label `enhancement`, intake body | New play ideas; search first |
| Bug | Issue type **Bug**, label `bug`, intake body | Defects; search first |
| PR | Draft from spec, ready from implement; `Fixes #<child>` | One child issue per PR |

Titles for roadmap children: `Roadmap #<n>: <short name>`. Host items that used to live in `TODO.md` (4, 5, 19, 24, 25) are already numbered in `docs/ROADMAP.md`. There is no `TODO.md` in the tree; do not invent one.

Default labels only: `enhancement`, `documentation`, `bug`. Do not assign any `Criticality: n`, `Complexity: n`, or `Impact: n` label (n is 1–5); humans assign those after triage. GitHub MCP cannot create labels.

**Project:** public user Project [Gardener](https://github.com/users/horribleCodes/projects/2) (`horribleCodes`, number `2`). Issue #6 links this URL.

## MCP vs `gh`

Inspect namespace `Github` with GetDynamicTools before any issue/PR write. If it needs auth, call `mcp_auth`. Do not assume a tool you have not inspected.

Typical issue/PR tools (re-check; this list has gone stale before): `get_me`, `list_issue_types`, `list_issue_fields`, `list_issues`, `search_issues`, `get_label`, `issue_read`, `issue_write` (create/update, types, labels, `parent_issue_number`), `sub_issue_write`, `add_issue_comment`.

**Not in GitHub MCP:** Projects, project fields, adding/editing Project items, creating labels, milestones. Issue custom fields: `list_issue_fields` was empty.

Use `gh` for the Project: `gh project view 2 --owner horribleCodes`, `gh project item-list 2 --owner horribleCodes`, `gh project item-add 2 --owner horribleCodes --url <issue-or-pr>`, `gh project item-edit 2 --owner horribleCodes --url <issue-or-pr> --field Status --value "<option>"`. Status options: Backlog, Ready, In progress, In review, Done. Cloud `gh` can read this Project. Writes may fail with GraphQL `Resource not accessible by integration`; then leave Status unchanged and say so.

## Do

1. `get_me`. Then `list_issue_types` and `list_issue_fields` for `horribleCodes/gardener`.
2. Read `docs/ROADMAP.md`. If `TODO.md` exists, read it; otherwise treat host items as the roadmap numbers above.
3. `search_issues` and `list_issues` (open). Reuse a hit; do not duplicate.
4. Ensure the board index, Now parents, Now children, and later-waves checklist exist. Create only the missing ones. Child creates use `parent_issue_number`.
5. Feature requests and bugs: follow `.cursor/prompts/intake.md` (type Feature or Bug). Search first.
6. Ensure each of those issues (and open PRs that belong on the board) is a Project item. Add missing ones with `gh project item-add`. Set Status to match reality. Do not invent extra items.
7. Reply with the board issue URL, Now issue URLs, and https://github.com/users/horribleCodes/projects/2, and stop.

## Do not

- Edit `docs/ROADMAP.md` unless the user asked to change the plan.
- File later-wave items as their own issues while they are still Later.
- Open product-code PRs; this skill only adds skill/agent files when the user asked for those.
