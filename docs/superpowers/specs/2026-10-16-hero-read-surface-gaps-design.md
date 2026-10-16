# Hero read surface gaps from the hero-cult playtest

> Status: draft for issue #119. Living engine docs: [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md), [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md), [`user/skills/gdnr-player/SKILL.md`](../../../../user/skills/gdnr-player/SKILL.md), [`user/README.md`](../../../../user/README.md).

## Purpose

A caller cannot read a hero or discover catalog table paths without an open turn or SQLite. `form_cult` never sets `home_place_id`. These are product gaps the hero-cult playtest recorded, not book rules.

Issue #119 already decided the product shape:

- Hero reads are an MCP resource template plus a thin `get_hero` tool from one shared read function. Both work with no open turn. Both return id, name, level, divinity, Dominion, `cult_faction_id`, and Words. An unknown id is `ENTITY_NOT_FOUND`.
- `get_world_brief` and `world://campaigns/{campaignId}/brief` list the campaign's heroes with id, name, level, divinity, and Dominion.
- Catalog paths are listed the same way: a resource of the valid `world://tables/{path}` values, plus a thin tool from one shared function. Each listed value reads successfully.
- `form_cult` takes optional `homePlaceId`, which must be a place in the campaign. Adopting a faction keeps its home unless `homePlaceId` is passed. `get_faction` already returns `home_place_id`.
- Tool descriptions and director and player skill copy name these reads and the place argument.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec: the URI scheme, how catalog listing is addressed, and the `form_cult` check order for a missing place.

Today `src/mcp/register.ts` has no `get_hero` and no hero resource. `get_unit_view` needs an open turn. `worldBrief` in `src/queries/rumors.ts` selects factions, courts, and changes. `world://tables/{path}` is registered with `list: undefined`. `formCult` does not take a place and leaves `home_place_id` null. `create_faction` already accepts `homePlaceId`.

## Approaches

**A. Keep the `world://` scheme. List catalog URIs from one walker. Recommended.**

The hero template is `world://campaigns/{campaignId}/heroes/{heroId}`, next to factions and courts. The issue's `gardener://campaign/{campaignId}/hero/{heroId}` is an example, not a second scheme. Catalog discovery is `catalogTableUris()` in `src/tables/catalog.ts`: every dotted path where `catalogRowsAt` returns an array, each written as `world://tables/{path}`. `world://tables` (no `{path}`) is the collection resource. The existing `{path}` template's `list` callback advertises the same URIs. `list_catalog_tables` is the thin tool. `form_cult` gains optional `homePlaceId` and refuses a place that is not in the campaign.

**B. Invent `gardener://` for heroes only.**

Rejected. Every other campaign resource is `world://campaigns/…`.

**C. Require `homePlaceId` on every `form_cult`.**

Rejected. The issue says optional. An omitted value leaves a new cult's home null and leaves an adopted faction's home as stored.

## Shape

### Hero read

`getHero(db, heroId)` lives in `src/queries/detail.ts` next to `getFaction`. It does not require an open turn. It does not read `turns`. Lookup is by `heroes.id` only, matching `getFaction`. The resource URI still includes `campaignId` so a caller who already has both keys can write it.

When the row is missing, the function returns `null`. The MCP tool maps that to `ENTITY_NOT_FOUND` / `hero not found`, the same mapping `get_faction` uses for a missing faction. The hero resource body is that same error object when the function returns `null`:

```json
{ "ok": false, "error": { "code": "ENTITY_NOT_FOUND", "message": "hero not found", "details": {} } }
```

When the row exists, both the tool `data` and the resource JSON are this object and no other hero columns:

| Field | Source |
| --- | --- |
| `id` | `heroes.id` |
| `name` | `heroes.name` |
| `level` | `heroes.level` |
| `divinity` | `heroes.divinity` |
| `dominion` | `heroes.dominion` |
| `cult_faction_id` | `heroes.cult_faction_id` (JSON `null` when the column is null) |
| `words` | `JSON.parse(heroes.words)` when that value is a JSON array; otherwise `[]` |

`get_hero` takes `{ heroId: z.string() }`. Description: `Hero sheet. No open turn required.` Handler is the same null-to-envelope pattern as `get_faction`, not `dbTool` wrapping a `ServiceResult`.

Resource name `campaign-hero`, template `world://campaigns/{campaignId}/heroes/{heroId}`, `{ list: undefined }`. Description: `Hero JSON`. The handler calls `getHero(db, heroId as string)` and `jsonResource`s the object or the error envelope above. It does not compare `campaignId` to the row. That matches `campaign-faction`.

### World brief heroes

`worldBrief` adds a `heroes` array after `factions`. Query:

```sql
SELECT id, name, level, divinity, dominion FROM heroes WHERE campaign_id = ? ORDER BY id ASC
```

Each element is `{ id, name, level, divinity, dominion }`. No Words. No `cult_faction_id`. A campaign with no heroes returns `[]`. `get_world_brief` and `world://campaigns/{campaignId}/brief` keep calling `worldBrief`. A missing campaign still returns `null` from the query and `CAMPAIGN_NOT_FOUND` from the tool.

### Catalog path list

`catalogTableUris(): string[]` walks `loadCatalog()` depth-first, keys in `Object.keys` order. For each own enumerable key, if the value is a non-null object and not an array, recurse with a dotted path. If the value is an array, emit `world://tables/${path}`. Strings, numbers, and other non-objects are skipped, so `version` and `note` are not listed. The function does not call `catalogRowsAt` while walking. Every emitted URI's `{path}` is a path `catalogRowsAt` already accepts.

`list_catalog_tables` takes no arguments. Description: `List valid world://tables/{path} URIs.` It returns `{ uris: catalogTableUris() }` through `toEnvelope({ ok: true, data })`. No database.

Register a complete resource named `catalog-tables` at URI `world://tables` (no path). Description: `Catalog table URI list`. Its body is `{ uris: catalogTableUris() }`.

On the existing `catalog-table` template, replace `list: undefined` with a callback that returns `{ resources: catalogTableUris().map((uri) => ({ uri, name: uri, mimeType: "application/json" })) }`. The read handler stays `catalogRowsAt`.

### `form_cult` home place

`formCult` input gains `homePlaceId?: string`. The MCP schema adds `homePlaceId: z.string().optional()`.

Checks after the current harshness parse and before the create-or-adopt write:

| Order | Situation | Code | Message |
| --- | --- | --- | --- |
| 7 | `homePlaceId` is present and no `places` row has that `id` and this `campaign_id` | `ENTITY_NOT_FOUND` | `place not found` |
| 8 | `adoptFactionId` is present and no faction has that id in this campaign | `ENTITY_NOT_FOUND` | `faction not found` |

Omitted `homePlaceId` skips row 7.

After the faction row exists:

- New cult: pass `homePlaceId` into `createFaction` when it is present. Omitted keeps `home_place_id` null.
- Adopt: `UPDATE factions SET home_place_id = ? WHERE id = ?` only when `homePlaceId` is present. Omitted leaves the stored home, including null.

A failure before the write leaves every faction row and the hero as they were. `getFaction` already selects and returns `home_place_id`. Do not change `createFaction`'s lack of place validation; only `form_cult` refuses an unknown place.

`form_cult` description becomes: `Bind a hero of level 2 or higher to a cult faction. Requires gmOverride for free divinities. Optional homePlaceId must be a place in the campaign.`

## Docs and play copy

In `docs/design/current-engine.md`, replace the **Resources** bullet with:

```markdown
- **Resources:** `world://campaigns/{campaignId}/brief`, `…/factions/{factionId}`, `…/courts/{courtId}`, `…/heroes/{heroId}`, `…/turns/latest`, `…/hooks`, `world://tables` (the valid `{path}` URI list), and `world://tables/{path}` (a subtree of the chart catalog).
```

In the same file, after the Cult theology paragraphs, add:

```markdown
`form_cult` takes optional `homePlaceId`. It must name a place in the campaign. A new cult stores that place as `home_place_id`. An adopted faction keeps its stored home unless the call passes `homePlaceId`.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, after seed step 1, the sanity-check sentence already names `get_world_brief`. Add that the brief includes heroes, and that `get_hero` reads one hero with no open turn. Replace the `form_cult` bullet so it names `homePlaceId`. Add that `list_catalog_tables` and `world://tables` list chart paths a later `world://tables/{path}` read will accept.

Exact director sentences:

After `1. Call get_world_brief and interest_map as sanity checks.`:

```markdown
1. Call `get_world_brief` and `interest_map` as sanity checks. The brief lists each hero's id, name, level, divinity, and Dominion. `get_hero` reads one hero (Words and `cult_faction_id` too) with no open turn.
```

`form_cult` bullet:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. Optional `homePlaceId` must be a place in the campaign; a new cult stores it as home, and an adopted faction keeps its home unless this argument is passed. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. Harsher cults carry more intrinsic problems and pay more Dominion each month. An unrecognized harshness is refused.
```

Add this bullet with the other director tools:

```markdown
- `list_catalog_tables`: lists the `world://tables/{path}` URIs the catalog resource will accept. `world://tables` is the same list.
```

In `user/skills/gdnr-player/references/gdnr-play.md`, the director-reads bullet becomes:

```markdown
- **Director reads:** `get_world_brief`, `get_hero`, `get_faction`, `interest_map`, `list_hooks`, `list_rumors`, and `list_catalog_tables`. They show the whole world, including heroes with no open turn. Use them to run it, not as in-character knowledge.
```

In `user/skills/gdnr-player/SKILL.md` and `user/README.md`, the in-character sentence's director-read list becomes `get_world_brief`, `get_hero`, `get_faction`, and `interest_map`.

Do not edit files outside `user/` from user-facing skill copy. Do not add a catalog gap bullet to `docs/design/overview.md`. Leave historical superpowers docs as they are.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/queries/get-hero.test.ts` opens an in-memory database, inserts a campaign and a hero with Words `["Sun"]`, Dominion 3, divinity `free`, `cult_faction_id` null, and no turn.

- `getHero(db, "h1")` equals `{ id: "h1", name: "Lira", level: 2, divinity: "free", dominion: 3, cult_faction_id: null, words: ["Sun"] }`.
- `getHero(db, "missing")` is `null`.
- `worldBrief` for that campaign includes `heroes: [{ id: "h1", name: "Lira", level: 2, divinity: "free", dominion: 3 }]`.

`test/tables/catalog-uris.test.ts` calls `catalogTableUris` and `catalogRowsAt`.

- The array is non-empty, every value matches `/^world:\/\/tables\/.+/`, and `catalogRowsAt(uri.slice("world://tables/".length))` returns a non-empty array for each.
- `"cults"` and `"godbound"` are not suffixes of any listed URI.
- `world://tables/powerStructure` and `world://tables/backlash` are listed.

`test/services/form-cult.test.ts` adds cases (existing cases stay):

- Level 2, `acknowledged: true`, `homePlaceId` of a village in the campaign: `ok: true` and `getFaction` `home_place_id` is that place id.
- `homePlaceId: "missing"`: `ENTITY_NOT_FOUND` / `place not found`. No faction row. Hero divinity unchanged.
- Adopt a faction whose `home_place_id` is `old`, omit `homePlaceId`: stored home stays `old`.
- Adopt that faction with `homePlaceId` of another place in the campaign: stored home becomes the new id.

`test/mcp.test.ts`: `listTools` length becomes 53 and includes `get_hero` and `list_catalog_tables`. A new test seeds a hero with no turn, calls `get_hero`, asserts the fields above, calls `get_hero` with a missing id and asserts `ENTITY_NOT_FOUND` / `hero not found`, calls `list_catalog_tables`, and `readResource`s `world://tables` plus one listed `{path}` URI that returns rows.

No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

## Out of scope

- Cult composition (#118).
- The GM lock on `set_divinity`.
- Champion, inheritance, and `commit_resources` findings from the same review.
- Validating `homePlaceId` on `create_faction`.
- Listing heroes through `listResources`.
- A general unit view outside an open turn.
- Changing `get_unit_view`.
- Catalog keys that are not arrays (`version`, `note`).

## Requirements

- `getHero` is the only reader of a hero sheet for MCP. The resource and `get_hero` call it.
- `getHero` does not consult turns.
- Missing hero id: `getHero` returns `null`; the tool returns `ENTITY_NOT_FOUND` / `hero not found`.
- Returned hero fields are exactly `id`, `name`, `level`, `divinity`, `dominion`, `cult_faction_id`, `words`.
- `words` is a parsed JSON array of strings, or `[]` when parse fails or the value is not an array.
- Hero resource URI is `world://campaigns/{campaignId}/heroes/{heroId}`.
- `worldBrief.heroes` is `{ id, name, level, divinity, dominion }[]` ordered by id.
- `catalogTableUris` is the only enumerator of catalog table URIs. The collection resource, the `{path}` list callback, and `list_catalog_tables` call it.
- Every listed URI's path succeeds in `catalogRowsAt` and returns a non-empty array.
- `formCult` optional `homePlaceId` must match `places.id` in that campaign or the call returns `ENTITY_NOT_FOUND` / `place not found` and writes nothing.
- Adopted home is unchanged when `homePlaceId` is omitted.
- `get_faction` continues to return `home_place_id`.
- MCP handlers stay pass-throughs. No ad-hoc SQL in `register.ts`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

## Acceptance

- The hero resource and `get_hero` both return the fields above for a hero with no open turn, both come from one shared read function, and both return `ENTITY_NOT_FOUND` for an unknown id.
- `get_world_brief` includes the campaign's heroes.
- Both the catalog list resource and its thin tool return the valid `world://tables/{path}` values from one shared function, and each value reads successfully.
- `form_cult` with `homePlaceId` stores it and `get_faction` shows it. An unknown place is refused.
- Tool descriptions and skill copy are updated, and tests cover each item.
