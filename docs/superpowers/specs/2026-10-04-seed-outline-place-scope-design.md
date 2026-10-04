# Require scope on seed outline places

> Status: design for issue #81. Not implemented on this branch. Living engine docs to update at implementation time: [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md).

## Purpose

`seed_campaign` still stores `village` when an outline place omits `scope`, except when `fill` is `require`. Living intent, recorded as issue #35 decision D23 and restated on issue #81, is that every outline place has a caller-chosen scope.

Issue #81 already decided the product shape:

- `scope` is always required when seeding outline places.
- There is no silent village default.
- Scope is never randomly generated.
- In the same change, remove the matching gap note from living docs. Play prompts that already state the rule stay as they are.
- Faction seed behavior is a separate issue.
- The place scope values themselves do not change.

Issue #81 has no **Open questions** section. The boundary calls below are the ones the issue left implicit.

## Approaches

**A. Require `scope` in `seedCampaign` and on the `seed_campaign` tool schema. Recommended.**

The service rejects a missing scope for every fill mode, including an omitted `fill`, with the error it already uses when `fill` is `require`: `FILL_INCOMPLETE`, message `place scope required`. The tool schema marks `scope` required with the existing enum, the same way `create_place` already does. A tool call that omits `scope` fails input validation and the handler does not run. Nothing rolls a scope.

**B. Service check only, schema left optional.**

Direct callers would fail, and a tool caller would get a domain envelope after the handler started. `key` and `name` are already required on the schema, so an optional `scope` would keep teaching agents that the field can be left out. Rejected.

**C. Roll a scope when `fill` is `missing`.**

That replaces the village constant with a catalog pick. Issue #81 says scope is never randomly generated. Rejected.

## Shape

### Service

`seedCampaign` in `src/services/populate.ts` walks `input.outline?.places ?? []`. For each place:

1. If `place.scope` is missing (`undefined`, `null`, or `""`), throw `RuleError("FILL_INCOMPLETE", "place scope required")`.
2. Pass that scope to `createPlace`. Do not substitute `"village"`. Do not read `fill` for this field. Do not call `pickOrRoll` or the campaign RNG.

`fill` stays on the call. Factions and ruling courts still use it. The place loop stops using this expression:

```ts
const scope = place.scope ?? (fill === "require" ? undefined : "village");
```

The input type keeps `scope?: Scope` so a missing field is representable and the check can run. `create_place` is unchanged: its service argument is already required, and its tool field is already `scopeZ`.

An outline with no places, or an omitted `outline`, still creates a campaign. Scope is required on each place that is present, not on the campaign.

The check runs inside the existing `withTransaction`. A throw rolls the transaction back, `wrapRule` returns `{ ok: false }`, and the database has no campaign row from that call. A later place in the same array with a missing scope rolls back places earlier in that call too.

`places.scope` stays `TEXT NOT NULL`. `SCHEMA_VERSION` stays 4. No migration.

### Tool schema

In `src/mcp/register.ts`, the `seed_campaign` place object changes `scope: scopeZ.optional()` to `scope: scopeZ`.

`scopeZ` stays `z.enum(["village", "city", "region", "nation", "realm"])`.

Listed through MCP, each place item’s JSON Schema `required` array is `["key", "name", "scope"]`. The enum on `scope` stays those five strings. Top-level `required` stays `["name"]`. Faction items stay required `["key", "name"]` only.

A tool call that omits `scope` returns `isError: true` and this text, for index `0`:

```text
MCP error -32602: Input validation error: Invalid arguments for tool seed_campaign: Required at outline.places[0].scope
```

The index is the outline array index. A value outside the enum fails the same way `create_place` already does, with `Invalid enum value. Expected 'village' | 'city' | 'region' | 'nation' | 'realm', received '<value>' at outline.places[0].scope` inside the same `-32602` validation prefix. The handler does not run, so the service error is not the tool-facing error for a schema failure.

The service error remains the contract for `seedCampaign` callers (tests and any future non-MCP caller).

### Stored scope

The row’s `scope` is the string the caller passed. `village` remains a legal value when the caller sends it. `city`, `region`, `nation`, and `realm` are stored as sent. `fill: "blank"` does not clear scope. `fill: "missing"` does not invent one. Two different `seed` values with the same scope argument store that same scope.

### Faction seeding, unchanged

These lines in the faction loop stay as they are:

```ts
const scope = place?.scope ?? "village";
// ...
power = power ?? 1;
behavior: fac.behavior ?? "self_absorbed_survivor",
```

That `"village"` is the stand-in used only when an omitted faction `power` is derived from `homePlaceKey`. It does not write a place. A home place that was just seeded has a scope, so the stand-in applies when the home key is absent from the outline, and the power is then 1. An omitted `behavior` remains `self_absorbed_survivor`. A city home with omitted `power` remains power 2. Do not require `behavior` on the tool schema.

## Out of scope

- Faction seed behavior: the behavior default, power-from-home, and the `"village"` stand-in in that power lookup.
- Adding, removing, or renaming scope values. `hamlet` and any other string outside the five stay illegal at the tool boundary.
- A second enum check inside `seedCampaign` or `createPlace`. Presence is the service rule; the enum is the tool schema, as it already is for `create_place`.
- `create_place`, parent-key resolution, cultures, wards, interest linking, and ruling courts.
- Requiring a non-empty `places` array.
- `SCHEMA_VERSION` and the `places` table.
- The dev GUI schema skeleton. A required enum’s first value (`village`) may appear in a generated form. That form is filling a required field for the operator to edit. It is not `seed_campaign` defaulting an omitted scope.
- Historical files under `docs/superpowers/` other than this design and its plan, and finished reviews under `test/reviews/`.
- Play copy under `user/`. `user/skills/gdnr-director/references/gdnr-direct.md` already says: “Always pass `scope`. Choose it from the fiction; never leave it to a default or to a roll.” That sentence is the play rule, not a deferred-feature note. Leave the file unchanged.

## Docs at implementation time

Update living design only.

- [`docs/design/overview.md`](../../../docs/design/overview.md), under **Generation and setup**, replace the bullet that currently joins place scope and behavior with this bullet only:

  > - `seed_campaign` defaults an omitted behavior to `self_absorbed_survivor`. Intent: behavior is required unless the caller opts into random generation.

  The place-scope half of that bullet is the gap this change closes. The behavior half stays, because faction seed behavior is a separate issue.

- [`docs/design/current-engine.md`](../../../docs/design/current-engine.md), at the end of the first paragraph of **Campaigns and the database file** (the paragraph that ends with “Every tool call names its `campaignId`.”), add:

  > An outline place on `seed_campaign` requires `scope`: `village`, `city`, `region`, `nation`, or `realm`. Omitting it fails the call. `fill` does not supply a scope. The server does not default an omitted scope to `village` and does not roll one.

- Do not edit `user/skills/**` or `.cursor/prompts/**`.
- Do not add a unit test that reads a documentation file or a prompt file and asserts on that file’s text.

## Testing

`test/services/seed-place-scope.test.ts` calls `seedCampaign` on an in-memory database:

- Omitted `scope` with `fill` of `require`, `missing`, `blank`, and with `fill` omitted: `{ ok: false }`, code `FILL_INCOMPLETE`, message `place scope required`, and `COUNT(*)` from `campaigns` is 0.
- Two places, only the second omitting `scope`: the same error, and both `campaigns` and `places` counts are 0.
- `scope: "city"` is stored as `city`. `scope: "village"` is stored as `village`. `fill: "blank"` with `scope: "city"` stores `city`.
- A faction with a city home and no `power` or `behavior` stores power 2 and behavior `self_absorbed_survivor`.
- A faction whose `homePlaceKey` matches no place stores power 1 and behavior `self_absorbed_survivor`, and the call succeeds.
- An outline with `places: []` succeeds and writes no place rows.

`test/mcp/seed-campaign-scope.test.ts` uses the in-memory MCP client:

- `listTools` reports place items `required: ["key", "name", "scope"]` and the five-value enum. Faction items stay `required: ["key", "name"]`. Top-level `required` stays `["name"]`.
- A place with `key` and `name` and no `scope` returns `isError: true` and the `-32602` text `Required at outline.places[0].scope`.
- A second place missing `scope` reports `outline.places[1].scope`.
- `scope: "hamlet"` returns the invalid-enum `-32602` text.
- `scope: "city"` and `scope: "village"` each return an envelope with `ok: true` and a `campaignId`.
