# Campaign list resource and `get_campaigns`

> Status: draft for issue #127. Living engine docs: [`docs/design/current-engine.md`](../../../docs/design/current-engine.md), [`docs/design/overview.md`](../../../docs/design/overview.md). Play copy: [`user/docs/install.md`](../../../../user/docs/install.md), [`user/skills/gdnr-player/SKILL.md`](../../../../user/skills/gdnr-player/SKILL.md), [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

A caller who lost a `campaignId` can recover it from the open world database. Today only `seed_campaign` and `create_campaign` replies carry the id, and only the dev GUI lists campaigns (`dev/tools/gui/server/campaigns.ts`, HTTP `GET /api/campaigns`).

Issue #127 asked for a recovery read of every campaign as `id` and `name`, ordered by name (case-insensitive) then id, with an empty file returning an empty list. Living docs and both skills drop the "no tool lists campaigns" gap in the same change. Keeping the `campaignId` can stay as advice.

This spec fits that recovery onto the existing MCP split: the collection is a resource the caller can write without knowing any id, and `get_*` is a thin tool over the same body.

## Approaches

**A. Complete resource `world://campaigns` plus thin `get_campaigns`. Recommended.**

The collection URI is `world://campaigns`, a complete resource like `world://tables`, not a `{campaignId}` template. One query function builds the JSON body. The resource returns that body. `get_campaigns` takes no arguments and puts the same body in the success envelope, the same pairing as `get_hero` / `world://campaigns/{campaignId}/heroes/{heroId}` and `get_world_brief` / `world://campaigns/{campaignId}/brief`. The GUI keeps its own file-opening helper: that path must work when MCP is stopped and when the file or `campaigns` table is missing.

**B. Tool only (`list_campaigns`), no collection resource.**

Rejected. AGENTS.md: a complete collection with nothing left out is a resource; the URI is the query. Issue #127 named `list_campaigns`; the surface here is `get_campaigns` so the tool name matches the other `get_*` reads of `world://` resources. `list_catalog_tables` stays a `list_*` name because it lists catalog URIs, not a `world://` document.

**C. Reuse the GUI `listCampaigns(repoRoot, dbPath)`.**

Rejected. That function opens a second SQLite handle, returns `[]` for a missing file or missing table, and does not go through the store connection the MCP server already holds. MCP handlers must not open the database themselves.

## Shape

### Query

```ts
export type CampaignListRow = { id: string; name: string };

export function getCampaigns(db: Database.Database): { campaigns: CampaignListRow[] }
```

SQL inside `getCampaigns`:

```sql
SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id
```

The function wraps those rows as `{ campaigns }`. It does not check `sqlite_master`. `openDb` already created `campaigns`. A file with no campaign rows returns `{ campaigns: [] }`.

This is the only reader of the campaign list for MCP. The resource and `get_campaigns` both call it. They do not query SQLite themselves. The GUI function `listCampaigns` in `dev/tools/gui/server/campaigns.ts` stays; MCP does not import it, and the GUI does not import the query.

### Resource

| Field | Value |
| --- | --- |
| MCP name | `campaigns` |
| URI | `world://campaigns` (complete resource, same registration style as `catalog-tables` / `world://tables`) |
| Description | `Campaign list JSON` |
| Handler | `async () => jsonResource(getCampaigns(db))` |
| Register | in `src/mcp/register.ts` immediately before `campaign-brief` |
| Body | `{ campaigns: { id: string; name: string }[] }` — the return value of `getCampaigns`, not a tool envelope |
| Empty file | `{ campaigns: [] }` |

`world://campaigns` is not a `ResourceTemplate`. Existing templates `world://campaigns/{campaignId}/…` stay. Do not add a `list` callback that advertises per-campaign URIs. Do not register `world://campaigns/` with a trailing slash.

### Tool

| Field | Value |
| --- | --- |
| MCP name | `get_campaigns` |
| Description | `Campaign list. Same body as world://campaigns.` |
| Input | none (`inputSchema: {}`) |
| Handler | `async () => mcpToolResult(toEnvelope({ ok: true, data: getCampaigns(db) }))` |
| Register | in `src/mcp/register.ts` immediately before `get_world_brief` |
| Success `data` | the same object as the resource body: `{ campaigns: { id: string; name: string }[] }` |
| Success `rolls` / `advisories` / `derived` | empty (`[]` / `[]` / `{}`) |
| Empty file | `{ ok: true, data: { campaigns: [] }, rolls: [], advisories: [], derived: {} }` |

The handler is the same pass-through pattern as `get_hero` and `get_world_brief`: call the shared read, wrap with `toEnvelope`. It is not `dbTool` wrapping a `ServiceResult`. It does not call `readResource`. The call cannot fail with `CAMPAIGN_NOT_FOUND`. Do not take the write lock.

Registered tool count in `test/mcp.test.ts` goes from 53 to 54.

Order of rows inside `campaigns` matches the SQL above. For names that compare equal under `NOCASE`, id breaks the tie, so `alpha`/`a1` then `Alpha`/`a2` then `beta`/`b`.

A campaign created through `create_campaign` in the same process appears in a later `get_campaigns` call and in a later `world://campaigns` read on that server. Parsed resource JSON equals `get_campaigns` `data`.

### Docs and play copy

In `docs/design/current-engine.md`, replace the **Resources** bullet with:

```markdown
- **Resources:** `world://campaigns` (every campaign as `id` and `name`), `world://campaigns/{campaignId}/brief`, `…/factions/{factionId}`, `…/courts/{courtId}`, `…/heroes/{heroId}`, `…/turns/latest`, `…/hooks`, `world://tables` (the valid `{path}` URI list), and `world://tables/{path}` (a subtree of the chart catalog).
```

Replace the gap paragraph (the sentence that there is no list tool and a lost id cannot be recovered) with:

```markdown
`world://campaigns` and `get_campaigns` return every campaign in the open file as `id` and `name`, ordered by name (case-insensitive) then id. An empty file returns an empty list. Callers can still keep the `campaignId` from `seed_campaign` or `create_campaign`.
```

In `docs/design/overview.md`, delete the Known engine gaps bullet `There is no tool to list campaigns.` In **What runs today**, after the sentence that points at `current-engine.md`, add:

```markdown
`world://campaigns` and `get_campaigns` return every campaign in the open file as `id` and `name`.
```

`user/docs/install.md` step 5: keep the default path, `GARDENER_WORLD_DB`, and "keep each `campaignId`". Replace "because no tool lists them" so the step names `get_campaigns` and `world://campaigns` as the recovery read.

`user/skills/gdnr-player/SKILL.md` campaign-scope bullet: keep per-call `campaignId` and "do not start a new campaign unless the user asks". Drop "no tool lists campaigns, so a lost id cannot be recovered". Name `get_campaigns` and `world://campaigns`.

`user/skills/gdnr-director/references/gdnr-direct.md`: keep "Keep the `campaignId` and tell the user what it is." Drop "No tool lists campaigns, so a lost id cannot be recovered." Name `get_campaigns` and `world://campaigns`.

Do not add a test that reads those files or asserts on their text.

## Out of scope

- Dropping per-call `campaignId` or adding an active campaign / `set_campaign`.
- One process serving many campaign directories.
- Campaign fields beyond `id` and `name`.
- Changing the GUI `listCampaigns` helper or `GET /api/campaigns`.
- A `list_campaigns` tool name. The issue used that name; this surface uses `get_campaigns`.
- Advertising each campaign through MCP `list` on the `{campaignId}` templates.

## Requirements

- `getCampaigns(db)` is the only campaign-list reader for MCP. The resource and `get_campaigns` call it.
- SQL runs through the store connection already opened by `buildServer`. No ad-hoc SQL in `register.ts`.
- Resource URI is `world://campaigns`. Resource JSON equals `getCampaigns(db)`.
- Tool success `data` equals that same JSON.
- Returned row fields are exactly `id` and `name`.
- Order is `ORDER BY name COLLATE NOCASE, id`.
- Empty `campaigns` table: resource `{ campaigns: [] }`; tool success with `data.campaigns` equal to `[]`. Not an error.
- Tool takes no arguments.
- Tool description states that the body matches `world://campaigns`.
- MCP handlers stay pass-throughs.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

## Acceptance

- `world://campaigns` and `get_campaigns` return `{ id, name }` for every campaign in the open database, ordered by name (case-insensitive) and then id, from one shared function.
- With no campaigns, both return an empty list.
- Tests, one rule per test, cover: empty DB, several campaigns with ordering, a campaign created by `create_campaign` showing up, and the resource body equaling `get_campaigns` `data`.
- `docs/design/current-engine.md` and `docs/design/overview.md` list the resource and the tool.
- The "no tool lists campaigns" / lost-id-cannot-be-recovered notes are gone from `docs/design/current-engine.md`, `docs/design/overview.md`, `user/docs/install.md`, `user/skills/gdnr-player/SKILL.md`, and `user/skills/gdnr-director/references/gdnr-direct.md`.
