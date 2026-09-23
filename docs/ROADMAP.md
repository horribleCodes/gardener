# Gardener roadmap

Replaces the earlier stretch-goal list. v1 (the Godbound strain server in `docs/superpowers/plans/2026-09-21-godbound-faction-mcp.md`) is implemented. The next shape is `docs/superpowers/specs/2026-09-23-agnostic-world-system-design.md`: one actor model, a `strain` or `assets` profile, and presets that only flip flags and catalogs.

The project is still in its early phases. Changes do not need to consider legacy systems, old files, or old call shapes. Backwards compatibility only matters at the end of the module wave (after item 16). Until then, replace the current shape instead of carrying it forward.

Scores are 1–5. **Criticality** is how wrong the current server is if the item waits. **Complexity** is build size. **Impact** is how much play it unlocks. **Gates** names the later work that cannot start cleanly before it.

## Names

**Table** means a database table. **Chart** means a generation list, the kind of array in `docs/superpowers/specs/generator-catalog.json`. A chart entry is a string, or a dictionary that may carry an optional weight. A roll picks one entry. Do not call a chart a table.

A **chart catalog** is a folder of charts. Folder names and file names tell the server which files to load. A campaign may adopt a module’s chart catalog as-is or modify it.

A **module** declares the database tables it needs, a chart catalog, actions, interactions, generation config, instructions, dependencies, and its own version. The campaign file is created with only the tables of the modules chosen for it. The first implementation sets that list when the campaign is created and does not change it afterward. Adding, removing, or updating a module during play is a later feature. Exactly one included module owns the turn. The others must not also spend the action or count income.

The v1 final review (`.superpowers/sdd/final-review.md`) is stale and stops mid-sentence on setpieces. Its critical findings — the server not starting, trusted unit plans, attacks that auto-win, collapse never firing, and a second generated court crashing on draft ids — are fixed in the current tree, along with per-unit savepoints, directed factions idling, domain-based contests, the missing faction actions, the influence ledger, and `run_faction_turn` going through the parallel queue. They are not on this roadmap.

## Now: close the strain contract

These are small, and later waves sit on the first one.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 1 | Versioned schema migrations, plus a stored schema version the server checks on open. A file newer than this server, or older than the oldest migration it can apply, is refused with a compatibility error before any read or write. `CREATE TABLE IF NOT EXISTS` does not add columns to an existing file and does not record a version. | 4 | 3 | 3 | Every new table: flags, calamities, assets, the change log |
| 2 | Setpieces that point at what they created, and challenges that are not forced onto a change. `setpieces` has no link columns. `challenges.change_id` is `NOT NULL`, so the free-floating card in the v1 spec cannot exist. `ensure_setpiece` always inserts the first entry of the challenge chart. | 3 | 2 | 2 | Reliable hooks and generation |
| 3 | Willing Remove Interest. `parseUnitPlan` rejects `willing` on every plan, including the action that uses consent to skip the roll. | 2 | 1 | 2 | — |

## Next: campaign profile on the strain engine

The agnostic spec’s implementation note: flags and the `ashes` and `cities` presets before any asset turn. `godbound` is the current server, expressed as a preset, not as the universal default.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 4 | Campaign flags and the `godbound` preset: `profile`, `projectBase`, `opposition`, `wards`, `heldChanges`, `capabilityGate`, `reachUnit`. Existing campaigns keep today’s Godbound numbers. | 5 | 3 | 5 | Ashes, cities, assets, reach |
| 5 | Place adjacency. A neighbor edge, with `reachUnit` choosing place, miles, or hex. | 3 | 3 | 4 | Asset Move, cities zoom, regional events |
| 6 | `ashes` preset: strain, `projectBase: scale`, `opposition: largest`, wards off, held changes off. | 3 | 2 | 4 | — |
| 7 | `cities` preset: casts, zoom as a generation order, six-fact seeds. The turn stays idle until the caller gives an actor stats. | 3 | 3 | 3 | — |
| 8 | One calamity per place (symptom, source, stake, mitigation, block, resolution). A tag, not a second turn. | 2 | 2 | 3 | Sixteen Sorrows prompts |
| 9 | Background actors: a sentence, no ratings, one visible event a turn. Retire on death, departure, or leaving the campaign. | 2 | 2 | 3 | `worlds` color; playable with strain alone |

## Then: the asset profile

A second rules module. Do not rewrite features into hit points. Stars and Worlds presets turn this on; they do not run beside strain on the same action.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 10 | Force, Cunning, Wealth, treasure income, and upkeep. Worlds hit-point sum. One rounding. | 3 | 4 | 5 | The rest of this wave |
| 11 | Located assets and bases: attack, move, repair, create, hide, sell, use ability. One action type per actor; every legal asset may perform it. | 4 | 5 | 5 | Goals that name assets |
| 12 | Portable goals, experience, and the mechanical tags (`concealed` through `ruler`). | 3 | 3 | 4 | — |
| 13 | Capability gate, off by default. The ladder is setting data. | 2 | 2 | 2 | Chart catalogs |

## Then: modules

This wave starts once both turns exist. Chart catalogs come first, then the manifest that ships them. The manifest replaces the preset enum. Item 1’s file version remains the check for a database this server cannot open. Each module version is checked the same way at creation. Live edits still wait on the change log, which is the next wave.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 14 | Chart catalog folders. Folder and file names select the charts. Entries are strings or dictionaries with an optional weight. Roll results stay readable. The v1 file `src/tables/catalog.json` remains the default chart catalog until it is split into that folder. | 3 | 3 | 4 | Module host; skills that author charts |
| 15 | Modules chosen at campaign creation. Each module brings its database tables, a chart catalog the campaign may adopt or modify, actions, interactions, generation config, instructions, dependencies, and a version. The file contains only those tables. A newer module than this server, or a missing dependency, is refused before the file is created. | 2 | 4 | 4 | Live module edits |
| 16 | Add, remove, and update modules on a campaign that already has play. | 1 | 4 | 3 | — |

## After the turn is trustworthy: memory and export

The old roadmap’s audit, notes, export, and fork items. Forking without a log replays guesses.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 17 | Append-only change log of state writes, separate from the rumor events that already exist. | 3 | 3 | 4 | Fork, rewind, export, live module edits |
| 18 | Notes attached to an entity or a log row. | 2 | 2 | 3 | — |
| 19 | Fork a campaign and rewind to a logged point. | 4 | 4 | 4 | — |
| 20 | Export by query to a human-readable file and a machine file. | 2 | 3 | 3 | Retell and export skills |

## Last: agents

Useful once the tool surface stops moving. The Laya server waits until prompts match the tools.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 21 | Short system prompts per tool cluster (generate, turn, change, query). | 2 | 2 | 3 | Laya routing |
| 22 | Cursor skills: campaign generation, chart authoring, play as character / faction / god, retelling, export, impersonation. | 2 | 3 | 3 | — |
| 23 | A Laya-first server that calls an inference endpoint only for the steps the prompts cannot decide. | 2 | 4 | 2 | — |
| 24 | A local browser GUI: invoke MCP tools, a terminal for CLI commands, and a browser for the campaign’s config files and database tables. It binds to the campaign directory. It does not replace the stdio server. | 2 | 4 | 4 | — |

## Left parked

Named in the agnostic spec and intentionally unscheduled: individual asset stat blocks, `pricing: venture`, FacCreds and silver economies, homeworld relocation, mergers, mass combat, heat and turf, and Words as anything other than color on the held-change module v1 already runs. Add a pack or a flag when a campaign needs that noun. Do not add a procedure for it first.

## Order

1 → 2 → 3, then 4 → 5 → 6 and 7 (ashes and cities can proceed in either order after 5) → 8 → 9, then 10 → 11 → 12 → 13 → 14 → 15. Item 16 waits on 15 and on 17, so it finishes after the change log. Then 17 → 19, with 18 and 20 any time after 17. Item 24 can start any time; chart catalogs and modules give it more files to show. Then 21 → 22, and 23 after 21.
