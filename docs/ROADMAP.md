# Gardener roadmap

v1 (the Godbound strain server in `docs/superpowers/plans/2026-09-21-godbound-faction-mcp.md`) is implemented. The next shape is `docs/superpowers/specs/2026-09-23-agnostic-world-system-design.md`: one actor model, a `strain` or `assets` profile, and presets that only flip flags and catalogs.

The project is still in its early phases. Changes do not need to consider legacy systems, old files, or old call shapes. Backwards compatibility only matters at the end of the module wave (after item 18). Until then, replace the current shape instead of carrying it forward.

Scores are 1–5. **Criticality** is how wrong the current server is if the item waits. **Complexity** is build size. **Impact** is how much play it unlocks. **Gates** names the later work that cannot start cleanly before it.

The five items from `TODO.md` (4, 5, 19, 24, 25) are host and agent work. They sit beside the rules waves at the points below. The 24 Sep 2026 playtest (`docs/reviews/2026-09-24-init-campaign.md`) is the evidence for the instruction file and for keeping a direct interest-edge write when the tool list shrinks.

## Names

**Table** means a database table. **Chart** means a generation list, the kind of array in `docs/superpowers/specs/generator-catalog.json`. A chart entry is a string, or a dictionary that may carry an optional weight. A roll picks one entry. Do not call a chart a table.

A **chart catalog** is a folder of charts. Folder names and file names tell the server which files to load. A campaign may adopt a module’s chart catalog as-is or modify it.

A **module** declares the database tables it needs, a chart catalog, actions, interactions, generation config, instructions, dependencies, and its own version. The campaign file is created with only the tables of the modules chosen for it. The first implementation sets that list when the campaign is created and does not change it afterward. Adding, removing, or updating a module during play is a later feature. Exactly one included module owns the turn. The others must not also spend the action or count income.

The v1 final review (`.workspaces/initial-design/.superpowers/sdd/final-review.md`) is stale and stops mid-sentence on setpieces. Its critical findings — the server not starting, trusted unit plans, attacks that auto-win, collapse never firing, and a second generated court crashing on draft ids — are fixed in the current tree, along with per-unit savepoints, directed factions idling, domain-based contests, the missing faction actions, the influence ledger, and `run_faction_turn` going through the parallel queue. They are not on this roadmap.

## Now: close the strain contract

These are small, and later waves sit on the first one.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 1 | Versioned schema migrations, plus a stored schema version the server checks on open. A file newer than this server, or older than the oldest migration it can apply, is refused with a compatibility error before any read or write. `CREATE TABLE IF NOT EXISTS` does not add columns to an existing file and does not record a version. | 4 | 3 | 3 | Every new table: flags, calamities, assets, the change log |
| 2 | Setpieces that point at what they created, and challenges that are not forced onto a change. `setpieces` has no link columns. `challenges.change_id` is `NOT NULL`, so the free-floating card in the v1 spec cannot exist. `ensure_setpiece` always inserts the first entry of the challenge chart. | 3 | 2 | 2 | Reliable hooks and generation |
| 3 | Willing Remove Interest. `parseUnitPlan` rejects `willing` on every plan, including the action that uses consent to skip the roll. | 2 | 1 | 2 | — |

## Now: host fixes the playtest already needs

These do not wait on the strain items. They also do not block them.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 4 | Committed MCP config with no machine-absolute paths. The server resolves the database from its install directory (`./data/campaign.sqlite` is already the default when `GARDENER_WORLD_DB` is unset). Project `mcp.json` sets neither that variable nor an absolute `cwd`. | 2 | 2 | 2 | Campaign directories |
| 5 | A short agent instruction file for the tools that exist today. It states the interest natures (`alliance`, `rivalry`, `trade`, `marriage`, `spies`, `aid`, `tribute`); that `seed_campaign` writes the starting interest edges; that `create_faction` leaves interests empty; that `extend_interest` is a contest inside a turn; and that the open database file is the campaign in play. On 24 Sep 2026 the agent stored a war as facts because those limits lived only in source. Module instructions (item 17) and the prompt split (item 26) replace this file. | 4 | 2 | 4 | Prompt split |

Item 5 is a current-surface card, written while the Godbound tools are still the whole server. It will be rewritten. Waiting for the tool list to freeze leaves the next playtest with the same gap.

## Next: campaign profile on the strain engine

The agnostic spec’s implementation note: flags and the `ashes` and `cities` presets before any asset turn. `godbound` is the current server, expressed as a preset, not as the universal default.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 6 | Campaign flags and the `godbound` preset: `profile`, `projectBase`, `opposition`, `wards`, `heldChanges`, `capabilityGate`, `reachUnit`. Existing campaigns keep today’s Godbound numbers. | 5 | 3 | 5 | Ashes, cities, assets, reach |
| 7 | Place adjacency. A neighbor edge, with `reachUnit` choosing place, miles, or hex. | 3 | 3 | 4 | Asset Move, cities zoom, regional events |
| 8 | `ashes` preset: strain, `projectBase: scale`, `opposition: largest`, wards off, held changes off. | 3 | 2 | 4 | — |
| 9 | `cities` preset: casts, zoom as a generation order, six-fact seeds. The turn stays idle until the caller gives an actor stats. | 3 | 3 | 3 | — |
| 10 | One calamity per place (symptom, source, stake, mitigation, block, resolution). A tag, not a second turn. | 2 | 2 | 3 | Sixteen Sorrows prompts |
| 11 | Background actors: a sentence, no ratings, one visible event a turn. Retire on death, departure, or leaving the campaign. | 2 | 2 | 3 | `worlds` color; playable with strain alone |

## Then: the asset profile

A second rules module. Do not rewrite features into hit points. Stars and Worlds presets turn this on; they do not run beside strain on the same action.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 12 | Force, Cunning, Wealth, treasure income, and upkeep. Worlds hit-point sum. One rounding. | 3 | 4 | 5 | The rest of this wave |
| 13 | Located assets and bases: attack, move, repair, create, hide, sell, use ability. One action type per actor; every legal asset may perform it. | 4 | 5 | 5 | Goals that name assets |
| 14 | Portable goals, experience, and the mechanical tags (`concealed` through `ruler`). | 3 | 3 | 4 | — |
| 15 | Capability gate, off by default. The ladder is setting data. | 2 | 2 | 2 | Chart catalogs |

## Then: modules

This wave starts once both turns exist. Chart catalogs come first, then the manifest that ships them. The manifest replaces the preset enum. Item 1’s file version remains the check for a database this server cannot open. Each module version is checked the same way at creation. Live edits still wait on the change log, which is the next wave.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 16 | Chart catalog folders. Folder and file names select the charts. Entries are strings or dictionaries with an optional weight. Roll results stay readable. The v1 file `src/tables/catalog.json` remains the default chart catalog until it is split into that folder. | 3 | 3 | 4 | Module host; skills that author charts |
| 17 | Modules chosen at campaign creation. Each module brings its database tables, a chart catalog the campaign may adopt or modify, actions, interactions, generation config, instructions, dependencies, and a version. The file contains only those tables. A newer module than this server, or a missing dependency, is refused before the file is created. | 2 | 4 | 4 | Live module edits, campaign directories, the tool grouping |
| 18 | Add, remove, and update modules on a campaign that already has play. | 1 | 4 | 3 | — |

## Then: campaign directories

v1 already stores many campaign rows in one SQLite file, and its design left “more than one database file per process” out of scope. A second world today means a second MCP entry or an edit to the absolute database path. Separate worlds should be separate directories once a campaign also holds an adopted chart catalog and module instructions.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 19 | One process, many campaign directories. Each directory is one world: its database, the chart catalog it adopted or edited, and its instructions. The caller picks a directory by argument. Opens still go through item 1’s version check. | 3 | 3 | 4 | CLI, browser GUI |

This can start as soon as items 1, 4, and 17 are done. It does not wait for the change log or the asset turn beyond what item 17 already required.

## After the turn is trustworthy: memory and export

The old roadmap’s audit, notes, export, and fork items. Forking without a log replays guesses.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 20 | Append-only change log of state writes, separate from the rumor events that already exist. | 3 | 3 | 4 | Fork, rewind, export, live module edits |
| 21 | Notes attached to an entity or a log row. | 2 | 2 | 3 | — |
| 22 | Fork a campaign and rewind to a logged point. | 4 | 4 | 4 | — |
| 23 | Export by query to a human-readable file and a machine file. | 2 | 3 | 3 | Retell and export skills |

## Then: a smaller tool surface

`src/mcp/register.ts` registers on the order of forty tools. The 24 Sep playtest still could not write an interest edge with a chosen nature: `seed_campaign` rolls nature, and `extend_interest` is a contest. A shorter catalog that still cannot record `rivalry`, `trade`, or `spies` does not fix that session. Grouping waits until module actions exist, so the groups are the lasting shape and later module actions join them.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 24 | Fewer MCP tools that still cover the writes, including a direct interest edge with an explicit nature. Reads and setup share grouped calls. Module actions, including ones added in item 18, use that grouped shape. | 3 | 3 | 4 | Prompts, CLI, play skills |
| 25 | A CLI for the same operations. It selects a campaign directory (item 19) and exposes the grouped commands (item 24). The browser GUI’s terminal runs this CLI. | 2 | 3 | 3 | Browser GUI |

## Last: agents

Useful once the grouped tool surface exists. The early instruction file (item 5) carries play until then. The Laya server waits until prompts match the tools.

| # | Item | Crit | Cmplx | Impact | Gates |
| --- | --- | --- | --- | --- | --- |
| 26 | Short system prompts per tool cluster (generate, turn, change, query). These replace the instruction file from item 5. | 2 | 2 | 3 | Laya routing |
| 27 | Cursor skills: campaign generation, chart authoring, play as character / faction / god, retelling, export, impersonation. | 2 | 3 | 3 | — |
| 28 | A Laya-first server that calls an inference endpoint only for the steps the prompts cannot decide. | 2 | 4 | 2 | — |
| 29 | A local browser GUI: invoke MCP tools, a terminal for the CLI, and a browser for the campaign directory’s config files and database tables. It binds to the directory from item 19. It does not replace the stdio server. | 2 | 4 | 4 | — |

## Left parked

Named in the agnostic spec and intentionally unscheduled: individual asset stat blocks, `pricing: venture`, FacCreds and silver economies, homeworld relocation, mergers, mass combat, heat and turf, and Words as anything other than color on the held-change module v1 already runs. Add a pack or a flag when a campaign needs that noun. Do not add a procedure for it first.

## Order

1 → 2 → 3. Items 4 and 5 start immediately, in parallel with those three. Then 6 → 7 → 8 and 9 (ashes and cities can proceed in either order after 7) → 10 → 11, then 12 → 13 → 14 → 15 → 16 → 17. Item 19 starts once 1, 4, and 17 are done. Item 18 waits on 17 and on 20, so it finishes after the change log. Then 20 → 22, with 21 and 23 any time after 20. Then 24 → 25. Then 26 → 27, item 28 after 26, and item 29 after 25.
