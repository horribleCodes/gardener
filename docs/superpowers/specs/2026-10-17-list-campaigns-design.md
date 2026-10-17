# List campaigns MCP tool

> Status: draft for issue #127. Living engine docs: [`docs/design/current-engine.md`](../../../docs/design/current-engine.md), [`docs/design/overview.md`](../../../docs/design/overview.md). Play copy: [`user/docs/install.md`](../../../../user/docs/install.md), [`user/skills/gdnr-player/SKILL.md`](../../../../user/skills/gdnr-player/SKILL.md), [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

A caller who lost a `campaignId` can recover it from the open world database. Today only `seed_campaign` and `create_campaign` replies carry the id, and only the dev GUI lists campaigns (`dev/tools/gui/server/campaigns.ts`, HTTP `GET /api/campaigns`).

Issue #127 already decided the product shape. There is no **Open questions** section on the issue.

- One read tool, `list_campaigns`, takes no `campaignId`.
- It returns every campaign in the open world database as `id` and `name`.
- Order is stable: by name (case-insensitive), then id. Same order as the GUI `listCampaigns`.
- An empty database returns an empty list, not an error.
- Living docs, the tool description, and both skills drop the "no tool lists campaigns" gap in the same change. Keeping the `campaignId` can stay as advice.

## Approaches

**A. Query on the open store connection, thin MCP tool. Recommended.**

`listCampaigns(db)` in `src/queries/campaigns.ts` runs one `SELECT` on the already-open `better-sqlite3` connection from `openDb`. `list_campaigns` wraps `{ campaigns: listCampaigns(db) }` in the usual success envelope. No ad-hoc SQL in `register.ts`. The GUI keeps its own file-opening helper: that path must work when MCP is stopped and when the file or `campaigns` table is missing.

**B. Reuse the GUI `listCampaigns(repoRoot, dbPath)`.**

Rejected. That function opens a second SQLite handle, returns `[]` for a missing file or missing table, and does not go through the store connection the MCP server already holds. MCP handlers must not open the database themselves.

**C. Collection resource `world://campaigns` instead of, or in addition to, a tool.**

Rejected for this issue. A URI the caller can write before knowing any id would fit the MCP resource rule for a complete collection, but #127 is one recovery tool. Registering `world://campaigns` next to `world://campaigns/{campaignId}/…` templates is also a separate surface decision. Do not add a campaigns collection resource here.

## Shape

### Query

```ts
export type CampaignListRow = { id: string; name: string };

export function listCampaigns(db: Database.Database): CampaignListRow[]
```

SQL:

```sql
SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id
```

Returns that array. It does not wrap the array. It does not check `sqlite_master`. `openDb` already created `campaigns`. A file with no campaign rows returns `[]`.

This is the only reader of the campaign list for MCP. The tool calls it. The GUI function of the same name in `dev/tools/gui/server/campaigns.ts` stays; MCP does not import it, and the GUI does not import the query.

### Tool

| Field | Value |
| --- | --- |
| MCP name | `list_campaigns` |
| Description | `Campaigns in the open world database as id and name.` |
| Input | none (`inputSchema: {}`) |
| Handler | `async () => mcpToolResult(toEnvelope({ ok: true, data: { campaigns: listCampaigns(db) } }))` |
| Register | in `src/mcp/register.ts` immediately after `remove-campaign` |
| Success `data` | `{ campaigns: { id: string; name: string }[] }` |
| Success `rolls` / `advisories` / `derived` | empty (`[]` / `[]` / `{}`) |
| Empty file | `{ ok: true, data: { campaigns: [] }, rolls: [], advisories: [], derived: {} }` |

The handler is the same pass-through pattern as `list_catalog_tables`, not `dbTool` wrapping a `ServiceResult`. The call cannot fail with `CAMPAIGN_NOT_FOUND`. Do not take the write lock.

Registered tool count in `test/mcp.test.ts` goes from 53 to 54.

Order of rows inside `campaigns` matches the SQL above. For names that compare equal under `NOCASE`, id breaks the tie, so `alpha`/`a1` then `Alpha`/`a2` then `beta`/`b`.

A campaign created through `create_campaign` in the same process appears in a later `list_campaigns` on that server.

### Docs and play copy

Replace the gap paragraph in `docs/design/current-engine.md` (the sentence that there is no list tool and a lost id cannot be recovered) with:

```markdown
`list_campaigns` returns every campaign in the open file as `id` and `name`, ordered by name (case-insensitive) then id. An empty file returns an empty list. Callers can still keep the `campaignId` from `seed_campaign` or `create_campaign`.
```

In `docs/design/overview.md`, delete the Known engine gaps bullet `There is no tool to list campaigns.` In **What runs today**, after the sentence that points at `current-engine.md`, add:

```markdown
`list_campaigns` returns every campaign in the open file as `id` and `name`.
```

`user/docs/install.md` step 5: keep the default path, `GARDENER_WORLD_DB`, and "keep each `campaignId`". Replace "because no tool lists them" so the step names `list_campaigns` as the recovery read.

`user/skills/gdnr-player/SKILL.md` campaign-scope bullet: keep per-call `campaignId` and "do not start a new campaign unless the user asks". Drop "no tool lists campaigns, so a lost id cannot be recovered". Name `list_campaigns`.

`user/skills/gdnr-director/references/gdnr-direct.md`: keep "Keep the `campaignId` and tell the user what it is." Drop "No tool lists campaigns, so a lost id cannot be recovered." Name `list_campaigns`.

Do not add a test that reads those files or asserts on their text.

## Out of scope

- Dropping per-call `campaignId` or adding an active campaign / `set_campaign`.
- One process serving many campaign directories.
- Campaign fields beyond `id` and `name`.
- Changing the GUI `listCampaigns` helper or `GET /api/campaigns`.
- A `world://campaigns` collection resource.

## Requirements

- `listCampaigns(db)` is the only campaign-list reader for MCP. `list_campaigns` calls it.
- SQL runs through the store connection already opened by `buildServer`. No ad-hoc SQL in `register.ts`.
- Returned fields are exactly `id` and `name`.
- Order is `ORDER BY name COLLATE NOCASE, id`.
- Empty `campaigns` table: success with `campaigns: []`, not an error.
- Tool takes no arguments.
- Tool description states that it returns id and name.
- MCP handlers stay pass-throughs.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

## Acceptance

- `list_campaigns` returns `{ id, name }` for every campaign in the open database, ordered by name (case-insensitive) and then id.
- With no campaigns, it returns an empty list.
- Tests, one rule per test, cover: empty DB, several campaigns with ordering, and a campaign created by `create_campaign` showing up.
- `docs/design/current-engine.md` and `docs/design/overview.md` list the tool.
- The "no tool lists campaigns" / lost-id-cannot-be-recovered notes are gone from `docs/design/current-engine.md`, `docs/design/overview.md`, `user/docs/install.md`, `user/skills/gdnr-player/SKILL.md`, and `user/skills/gdnr-director/references/gdnr-direct.md`.
