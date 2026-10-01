# Campaign flags and the godbound preset

> Status: design for https://github.com/horribleCodes/gardener/issues/54. First campaign-profile step. Does not ship ashes, cities, assets, or reach as playable named presets.

## Purpose

Campaign flags and a `godbound` preset do not exist. Today's Godbound numbers are hard-coded. This card adds flags `profile`, `projectBase`, `opposition`, `wards`, `heldChanges`, `capabilityGate`, and `reachUnit`, plus the named `godbound` preset that stores the v1 values already in the living overview.

Ashes, cities, assets, and reach cannot diverge from the current strain snapshot until those flags exist. This card gates those follow-ons; it does not implement them.

## Decisions (locked)

- Add campaign flags and the `godbound` preset for the listed keys.
- Existing campaigns keep today's Godbound numbers.
- This card does not implement other named presets.

## Out of scope

- Shipping ashes, cities, assets, or reach as playable presets.
- Changing numbers on existing campaigns (migrate them onto the `godbound` values they already play with).
- Rewriting `quoteChange` / faction project costs / asset turns to honor non-godbound flag values. Follow-on cards read these stored flags.

## Approaches

1. **Typed columns + named `godbound` preset (chosen).** Persist the seven flags (and a `preset` name) on `campaigns`. `create_campaign` / `seed_campaign` default to `godbound`. Unknown preset names fail. Optional per-flag overrides persist so later cards can flip a value without a second schema. Cost and turn code keep today's formulas in this card.
2. JSON blob `flags`. Rejected: harder to migrate and query; the key set is closed.
3. Named `ashes` preset in the same card. Rejected: issue out of scope.

## Flag values

`godbound` preset (must match the overview v1 column):

| Flag | `godbound` |
| --- | --- |
| `profile` | `strain` |
| `projectBase` | `scope` |
| `opposition` | `stack` |
| `wards` | on |
| `heldChanges` | on |
| `capabilityGate` | off |
| `reachUnit` | `place` |

Allowed values (validation at write):

| Flag | Allowed |
| --- | --- |
| `profile` | `strain`, `assets` |
| `projectBase` | `scope`, `scale` |
| `opposition` | `stack`, `largest` |
| `wards` | boolean |
| `heldChanges` | boolean |
| `capabilityGate` | boolean |
| `reachUnit` | `place`, `miles`, `hex` |

Named presets implemented in this card: **`godbound` only**. `preset: "ashes" | "cities" | "assets" | "stars" | "worlds" | "custom"` → `PICK_UNKNOWN` with a message that only `godbound` is a named preset. Callers who need a non-godbound combination pass `preset: "godbound"` plus `flags` overrides, or omit preset (still godbound) plus `flags` overrides. Do not invent a `custom` preset name in this card.

Storing `profile: "assets"` or `projectBase: "scale"` is allowed as an override. This card does **not** change engine math when those values are stored. Living overview states that only `godbound` is a playable preset until follow-on cards wire the reads.

## Schema

`SCHEMA_VERSION` becomes **3**. `MIN_SCHEMA_VERSION` stays 0.

`campaigns` gains NOT NULL columns with godbound defaults so omitted INSERT lists in tests keep working:

| Column | Type | Default |
| --- | --- | --- |
| `preset` | TEXT | `'godbound'` |
| `profile` | TEXT | `'strain'` |
| `project_base` | TEXT | `'scope'` |
| `opposition` | TEXT | `'stack'` |
| `wards` | INTEGER | `1` |
| `held_changes` | INTEGER | `1` |
| `capability_gate` | INTEGER | `0` |
| `reach_unit` | TEXT | `'place'` |

Booleans are 0/1 like other integer flags in this schema.

Migration (`src/store/db.ts`): when opening a v2 (or older) file, `ALTER TABLE campaigns ADD COLUMN …` for each missing name with the defaults above, then stamp `user_version = 3`. Existing rows therefore keep today's Godbound numbers. Do not rewrite other tables.

Fresh `schema.sql` includes the columns.

## Write API

Shared resolver `resolveCampaignFlags(input)` in `src/services/populate.ts` (or a small `src/rules/campaignFlags.ts` if that keeps populate smaller — prefer a dedicated module `src/domain/campaignFlags.ts` so MCP and services share allowed enums without SQL):

1. Start from `GODBOUND_PRESET`.
2. If `preset` is omitted, treat as `godbound`.
3. If `preset` is not `godbound`, throw `PICK_UNKNOWN`.
4. Overlay `flags` keys when present; unknown keys ignored by Zod (strip) at MCP; invalid values `PICK_UNKNOWN`.
5. Return `{ preset: "godbound", ...seven flags }`. Overlays may change a flag (for example `projectBase: "scale"`) while `preset` stays `godbound`. That is the only named preset this card ships; stored flags are how follow-on cards diverge.

`createCampaign` INSERT writes the resolved columns. Return `{ campaignId, rngSeed, flags }` where `flags` is camelCase matching the seven keys plus `preset`.

`seed_campaign` passes `preset` and `flags` through to `createCampaign`.

MCP `create_campaign` / `seed_campaign` input:

```
preset: z.literal("godbound").optional()
flags: z.object({
  profile: z.enum(["strain", "assets"]).optional(),
  projectBase: z.enum(["scope", "scale"]).optional(),
  opposition: z.enum(["stack", "largest"]).optional(),
  wards: z.boolean().optional(),
  heldChanges: z.boolean().optional(),
  capabilityGate: z.boolean().optional(),
  reachUnit: z.enum(["place", "miles", "hex"]).optional(),
}).optional()
```

If a client sends `preset: "ashes"`, Zod or the resolver fails `PICK_UNKNOWN` — use `z.string().optional()` plus resolver so the error is a RuleError envelope rather than a Zod MCP schema reject, **or** `z.enum(["godbound"]).optional()`. Prefer `z.string().optional()` + `PICK_UNKNOWN` so the envelope matches other catalog misses.

## Read API

`worldBrief` includes:

```
flags: {
  preset, profile, projectBase, opposition,
  wards, heldChanges, capabilityGate, reachUnit
}
```

with booleans as JSON booleans. Missing campaign still returns null.

Helper `loadCampaignFlags(db, campaignId)` used by `worldBrief` and later cards. This card does not call it from `quoteChange`.

## Living docs

`docs/design/overview.md`:

- Replace “Today these values are hard-coded; no flag or preset exists.”
- State that campaigns store these flags, new campaigns default to the `godbound` preset, and other named presets are not shipped.
- Keep the v1 / ashes target table; ashes remains target, not playable.

`docs/design/current-engine.md`: campaign row includes the flags; schema version 3.

Director `create_campaign` row: optional `preset` (only `godbound`) and optional `flags` overlays.

No personal names.

## Tests

- New DB `user_version === 3`; `createCampaign` row matches godbound flags; return payload includes them.
- `worldBrief` includes the same object.
- Overlay `{ projectBase: "scale" }` persists `project_base = 'scale'` without changing `factionProjectCost` in this card.
- `preset: "ashes"` → `PICK_UNKNOWN`.
- Open a v2 file (copy the existing unversioned/v2 fixture pattern in `test/store/schema-version.test.ts`): after `openDb`, version is 3 and the campaign row has godbound defaults. Month and other data unchanged.

## Self-review

Flags exist. Only `godbound` is named. Existing rows keep v1 numbers. Follow-on presets not shipped. Engine math not switched in this card.
