# Seed outline factions require behavior unless random is opted in

> Status: design for [issue #82](https://github.com/horribleCodes/gardener/issues/82). Not implemented on this branch. Implementation follows the paired plan on this same branch.

## Purpose

`seed_campaign` stores `self_absorbed_survivor` whenever an outline faction omits `behavior`. That constant is a silent default. Living intent (issue #35, D23, recorded in `docs/design/overview.md`) is that outline `behavior` is required unless the caller opts into random generation.

This change removes that constant and implements the opt-in roll. Place scope stays on its current village default; that default is issue #81.

## Current behavior

`seedCampaign` in `src/services/populate.ts` resolves each outline faction with:

```ts
behavior: fac.behavior ?? "self_absorbed_survivor",
```

`fill` is ignored for this field. Omission under `require`, `missing`, `blank`, and an omitted `fill` all store `self_absorbed_survivor`. The campaign seed does not affect the stored behavior.

The MCP schema already leaves `outline.factions[].behavior` optional (`z.string().optional()` in `src/mcp/register.ts`). `create_faction` is a different tool: its schema requires `behavior`, and its service ignores `fill`.

`defaultFill` in `src/generate/fill.ts` treats an omitted `fill` as `missing`. The director manual already tells the caller to pass a behavior key, and to leave `behavior` out only when the user asked for it to be random. The engine does not roll.

The behavior catalog is `goals` in `src/tables/catalog.json`. Its keys are `despotic_tyrant`, `self_absorbed_survivor`, `scheming_manipulator`, and `martial_conqueror`. `directed` is a stored behavior and is absent from `goals`.

Known engine gap today (`docs/design/overview.md`, Generation and setup):

> `seed_campaign` defaults an omitted place scope to `village` and an omitted behavior to `self_absorbed_survivor`. Intent: place scope is always required, and behavior is required unless the caller opts into random generation.

A separate gap stays in force and is out of scope here: a free-text `behavior` is accepted and later strands a turn with `PICK_UNKNOWN`.

## Approaches

1. **Omission under `fill: "missing"` is the opt-in (chosen).** An explicit `behavior` is stored as given. An omitted `behavior` with `fill` omitted or `missing` rolls one chart behavior from `goals`. `fill: "require"` and `fill: "blank"` reject an omission with `FILL_INCOMPLETE` and roll the seed transaction back. This matches the published director rule (leave the field out only when the user asked for random) and the invariant that generation fills only fields the caller left out. Default `fill` is already `missing`, so leaving `behavior` out is the opt-in. Passing `require` or `blank` is how a caller demands an explicit key.

2. **A new `randomBehavior: true` flag, and omission always fails.** Rejected. The director manual already defines omission as the opt-in, and `fill` already means “generate what I left out.” A second switch would split one idea across two fields.

3. **Sentinel `behavior: "random"`.** Rejected. `random` is not a behavior key. The separate free-text gap wants unknown strings rejected at the boundary, and a sentinel would have to be special-cased forever.

## Decisions

- Remove the silent `self_absorbed_survivor` default. That string remains a valid explicit behavior.
- Opt-in is omission of `behavior` while `fill` is `missing`. An omitted `fill` is `missing`.
- `fill: "require"` and `fill: "blank"` with an omitted `behavior` fail. `blank` leaves name placeholders; it does not invent a chart behavior. The faction column is `NOT NULL`, so there is no blank behavior to store.
- Empty string is omission. Any other string, including free text and `directed`, is explicit and is stored unchanged. This change does not validate the five keys.
- The roll chooses uniformly among `Object.keys(catalog.goals)` sorted lexicographically. Today that is `despotic_tyrant`, `martial_conqueror`, `scheming_manipulator`, `self_absorbed_survivor`. `directed` is never rolled.
- The roll is deterministic from the campaign `seed` and the faction’s index in `outline.factions` (zero-based). It uses `mulberry32(seed + 17000 + index)` and does not consume the RNG that `createFaction` uses for features and problems (`seed + factionIds.size`) or the court and interest offsets (`seed + 100 + …`, `seed + 999`).
- Each outline faction is resolved on its own. One faction may pass `behavior` while the next omits it. The index is the outline index, including factions that passed an explicit behavior.
- Failure throws `RuleError("FILL_INCOMPLETE", "behavior required")` inside the existing `seedCampaign` transaction, so the campaign, its places, and any earlier factions in that call are not committed.
- The rule lives in the service. `src/mcp/register.ts` stays as it is. `behavior` stays optional on the seed schema so a caller can omit it.
- The behavior catalog file is not edited.
- Place-scope handling in `seedCampaign` is not edited. The overview gap bullet keeps the place-scope sentence and drops the behavior sentence.
- `create_faction` is not edited.

## Design

### Generation helper

`src/generate/faction.ts` exports:

```ts
export function rollChartBehavior(catalog: Catalog, rng: Rng): string
```

It sorts `Object.keys(catalog.goals)`. If that list is empty it throws `RuleError("PICK_UNKNOWN", "no chart behaviors")`. Otherwise it returns `keys[Math.floor(rng.next() * keys.length)]`.

### Service

Inside the outline faction loop in `seedCampaign`, replace `fac.behavior ?? "self_absorbed_survivor"` with a resolver:

```ts
function outlineBehavior(
  provided: string | undefined,
  fill: FillMode,
  seed: number,
  index: number,
): string {
  if (provided != null && provided !== "") return provided;
  if (fill !== "missing") throw new RuleError("FILL_INCOMPLETE", "behavior required");
  return rollChartBehavior(loadCatalog(), mulberry32(seed + 17000 + index));
}
```

`fill` here is the value already produced by `defaultFill(input.fill)` before the loop. The loop index comes from `.entries()` on `input.outline?.factions ?? []`. Existing feature, court, and interest seed offsets stay on `factionIds.size` and the current constants.

`createFaction` still receives a concrete `behavior` string. Its signature stays `behavior: string`.

### MCP

No schema change. A call that omits `behavior` still passes Zod. The service accepts it or returns `FILL_INCOMPLETE`.

### Docs and prompts

`docs/design/overview.md`, Generation and setup, becomes only the place-scope gap:

```md
- `seed_campaign` defaults an omitted place scope to `village`. Intent: place scope is always required.
```

`user/skills/gdnr-director/references/gdnr-direct.md` replaces the single sentence under the behavior table:

```md
Free text is not a behavior. Leave `behavior` out only when the user asked for a random chart behavior. With `fill` omitted or `missing`, that omission rolls one of `despotic_tyrant`, `self_absorbed_survivor`, `scheming_manipulator`, or `martial_conqueror`. The roll never picks `directed`. `fill: require` and `fill: blank` reject an omitted `behavior`.
```

That file must not link outside `user/`. `docs/design/current-engine.md` does not describe the survivor default, so it stays as it is. Historical files under `docs/superpowers/` stay as they are, other than this design and its plan. `create_faction` copy that says the tool requires `behavior` stays.

No unit test reads `docs/` or `user/` and asserts on that file’s text.

### Tests

`test/services/seed-faction-behavior.test.ts` calls `seedCampaign` on `openDb(":memory:")` and reads `factions.behavior`.

Pinned rolls, sorted `goals` keys, salt `17000`:

| seed | outline index | rolled behavior |
| --- | --- | --- |
| 1 | 0 | `self_absorbed_survivor` |
| 1 | 1 | `scheming_manipulator` |
| 42 | 0 | `martial_conqueror` |

Cases:

- `fill: "missing"`, seed `42`, one faction, `behavior` omitted → `martial_conqueror`.
- `fill` omitted, same outline and seed → `martial_conqueror`.
- `fill: "missing"`, seed `1`, two factions, both omitted → index 0 `self_absorbed_survivor`, index 1 `scheming_manipulator`.
- `fill: "missing"`, seed `42`, explicit `despotic_tyrant` → `despotic_tyrant` (the roll would have been `martial_conqueror`).
- `fill: "missing"`, explicit `directed` → `directed`.
- `fill: "missing"`, seed `1`, first faction explicit `despotic_tyrant`, second omitted → second is `scheming_manipulator` (index 1, not “the first omission”).
- `fill: "missing"`, seed `42`, `behavior: ""` → `martial_conqueror`.
- `fill: "require"`, `behavior` omitted → `{ ok: false, error.code: "FILL_INCOMPLETE", error.message: "behavior required" }` and `COUNT(*)` from `campaigns` is 0.
- `fill: "blank"`, `behavior` omitted → the same error and the same empty `campaigns` table.
- `fill: "require"`, explicit `despotic_tyrant` → that behavior is stored.
- Seeds `1` through `24`, one omitted faction, `fill: "missing"` → each stored behavior is one of the four chart keys.

`test/services/remove-campaign.test.ts` seeds with `fill: "missing"` and omits `behavior`. It asserts deletion, not the behavior string. It keeps passing because omission under `missing` now rolls instead of failing. Do not edit it to pin behaviors.

## Out of scope

- Place seed scope, including the village default (issue #81).
- Editing `src/tables/catalog.json` or the goal charts.
- Rejecting free-text `behavior` at the tool boundary.
- `create_faction` fill handling, and rolling behavior on that tool.
- Power defaults, interest linking, and invalid `courtType`.
- Migrating factions already stored as `self_absorbed_survivor`.
