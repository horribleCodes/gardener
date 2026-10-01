# Remove a campaign

> Status: design for https://github.com/horribleCodes/gardener/issues/67. Deletes one campaign and the rows associated with it. Does not add a campaign list, a confirmation step, or skill-file changes.

## Purpose

A campaign file can hold many campaigns, and `create_campaign` / `seed_campaign` only add rows. There is no way to drop one campaign without discarding the file. This card adds one MCP tool that removes a campaign and every row associated with it, and updates the living engine doc so the tool count and the campaign paragraph match.

## Decisions (locked)

- Registered tool name: `remove_campaign`. Input field: `campaignId` (string), the same field every other campaign tool uses.
- The issue wrote the feature name `remove-campaign`. The registered identifier is snake_case, matching `create_campaign` and `seed_campaign`.
- One call deletes. There is no confirm flag, dry run, or second step.
- A missing id fails with `CAMPAIGN_NOT_FOUND` and the message `campaign ${campaignId} not found` (`requireCampaign`). A second call for an id that was just removed fails the same way.
- The SQLite file stays. Other campaigns in that file stay. Schema version stays 3. Foreign keys stay on.
- Skill files under `user/` are unchanged.

## Out of scope

- A tool that lists campaigns, and any change to the sentence that a lost id cannot be recovered.
- Edits under `user/`.
- Deleting or recreating the database file, including when the removed campaign was the last one.
- `ON DELETE CASCADE`, a schema migration, or turning `foreign_keys` off.
- A new error code for a cross-campaign foreign key. That case aborts and rolls back; the existing unexpected-error envelope applies at the MCP boundary.
- Resource or prompt changes. Those reads already hit the database on each call.

## Approaches

1. **Ordered deletes in a service transaction (chosen).** `removeCampaign` in `src/services/removeCampaign.ts` checks the campaign, then deletes child rows before parent rows inside `withTransaction`, with `foreign_keys` left on. The MCP handler only registers the tool and calls the service.
2. **`ON DELETE CASCADE` on every campaign foreign key.** Rejected. SQLite cannot add that action with `ALTER TABLE`, so it would rebuild tables and bump `SCHEMA_VERSION` for a single tool.
3. **`PRAGMA foreign_keys = OFF` and one delete per table.** Rejected. A missed table would leave orphans, and the foreign-key checks that catch a missed table would be off.

Tool name:

1. **`remove_campaign` (chosen).** Same identifier style as the rest of the server.
2. **`remove-campaign`.** Rejected. It would be the only hyphenated tool name.

## Behavior

`removeCampaign(db, campaignId)` returns `ServiceResult<{ campaignId: string }>`.

Success data is `{ campaignId }`. The MCP envelope is the usual one: `rolls` `[]`, `advisories` `[]`, `derived` `{}`.

The delete is one transaction. A failure leaves every campaign, including the one named in the call, as it was.

Rows with a `campaign_id` (or the `campaigns` row itself) are deleted only when that id is the named campaign.

These join tables have no `campaign_id`. A row is deleted when either endpoint belongs to the named campaign. The other endpoint stays when it belongs to a different campaign:

- `interests` (`from_faction_id`, `to_faction_id`)
- `court_memberships` (`court_id`, `character_id`)
- `change_commitments` (`change_id`, `hero_id`)

`actions` are deleted only when their `turn_id` is a turn of the named campaign. `feature_parts` follow that campaign's factions' features. `wards` follow that campaign's places. `unit_views` follow that campaign's turns. `conflicts`, `court_consequences`, `court_dispositions`, and `court_defenses` follow that campaign's courts. `resisters` follow that campaign's changes.

If a surviving campaign's row holds a real foreign key onto a row being removed (an action in another campaign whose `roll_id` points at this campaign's roll is the case the tests cover), the delete statement fails, the transaction rolls back, and `removeCampaign` throws. The service does not catch that error and does not delete the surviving row to make the delete succeed. `runDbTool` already maps a thrown non-`RuleError` to `ENTITY_NOT_FOUND` with `details.unexpected: true`.

An empty campaign (a `campaigns` row and nothing else) deletes successfully.

## Delete order

Foreign keys are immediate. Delete in this order, each statement bound only to the named campaign id:

1. `feature_parts` for features of this campaign's factions
2. `actions` for this campaign's turns
3. `unit_views` for this campaign's turns
4. `write_queue` for this campaign
5. `court_memberships` for this campaign's courts or characters
6. `conflicts` for this campaign's courts
7. `court_consequences` for this campaign's courts
8. `court_dispositions` for this campaign's courts
9. `court_defenses` for this campaign's courts
10. `setpieces` for this campaign
11. `change_commitments` for this campaign's changes or heroes
12. `resisters` for this campaign's changes
13. `challenges` for this campaign
14. `features` for this campaign's factions
15. `problems` for this campaign's factions
16. `interests` for this campaign's factions
17. `wards` for this campaign's places
18. `events` for this campaign
19. `rolls` for this campaign
20. `turns` for this campaign
21. `changes` for this campaign
22. `heroes` for this campaign
23. `facts` for this campaign
24. `characters` for this campaign
25. `courts` for this campaign
26. `factions` for this campaign
27. `places` for this campaign
28. `campaigns` row for this id

That is every table in `src/store/schema.sql`. A new table is out of scope here; the service test lists these table names so a later table fails that test until this delete list is updated.

Columns that point at other rows without a `REFERENCES` clause (`parent_place_id`, `patron_hero_id`, `home_place_id`, and the rest of that kind) do not change this order.

## MCP

Register next to `seed_campaign`:

- Name: `remove_campaign`
- Description: `Remove a campaign and all data associated with it`
- Input: `{ campaignId: z.string() }`
- Handler: `dbTool((a) => removeCampaign(db, a.campaignId))`

No SQL in the handler.

## Living docs

`docs/design/current-engine.md` only.

In **Campaigns and the database file**, after the sentence that every tool call names its `campaignId`, add: `remove_campaign` deletes that campaign and every row associated with it. Other campaigns in the same file stay. The file stays, including when no campaigns remain.

In **MCP surface**, the tool count becomes 49. Resource templates stay 6. Prompts stay 2.

Leave the paragraph that there is no list tool, and that a lost id cannot be recovered, as it is.

`docs/design/glossary.md` and `docs/design/overview.md` do not list tools. They stay as they are. Historical specs under `docs/superpowers/` stay as they are.

## Tests

Service tests in `test/services/remove-campaign.test.ts`, using `openDb(":memory:")`:

- The fixture inserts one row in every schema table for campaign `a`, plus campaign `b` with a place and a faction, plus an interest from a faction of `a` to the faction of `b`.
- Before the delete, each associated count for `a` is greater than 0, and `sqlite_master` table names are exactly the 28 tables in the schema.
- `removeCampaign(db, "missing")` is `{ ok: false, error.code: "CAMPAIGN_NOT_FOUND", error.message: "campaign missing not found" }` and both campaigns remain.
- `removeCampaign(db, "a")` is `{ ok: true, data: { campaignId: "a" } }`. Every associated count for `a` is 0. Campaign `b`, its place, and its faction remain. The cross-campaign interest is gone. `worldBrief` is null for `a` and non-null for `b`. `PRAGMA foreign_key_check` is empty.
- A second `removeCampaign(db, "a")` is `CAMPAIGN_NOT_FOUND`.
- A campaign created with `createCampaign` and no child rows deletes, and a second created campaign remains.
- An action in campaign `b` whose `roll_id` references a roll in campaign `a` makes `removeCampaign(db, "a")` throw. Both campaigns, the roll, and the action remain.

MCP test in `test/mcp.test.ts`, through `buildServer(":memory:")` and an in-memory client:

- `listTools` includes `remove_campaign` with that description.
- Two `create_campaign` calls, then `remove_campaign` on the first, returns the success envelope above.
- `get_world_brief` on the removed id is `CAMPAIGN_NOT_FOUND`. The other campaign's brief succeeds.
- `remove_campaign` on the removed id is `CAMPAIGN_NOT_FOUND` with message `campaign ${campaignId} not found`.

## Self-review

The tool removes one campaign's rows and leaves the file and any other campaign. The name is `remove_campaign`. Missing ids use the existing not-found error. Join rows that touch the removed campaign go away; a real foreign key from a survivor aborts the transaction. Skill files, the list-tool gap, and the schema version are unchanged.
