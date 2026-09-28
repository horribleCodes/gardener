# Design glossary

Canonical names for Gardener design and implementation work. Use these words consistently in code, docs, and issues so database tables are not confused with generation lists.

## Actor

An **actor** is a group that takes a turn: any group the campaign intends to move, such as a faction, an enclave, a ruling court, a gang, or a cult. Today factions are the actors that act mechanically.

Code uses `actor_type` and `actor_id` on `actions` for any acting unit (faction, court, character, or hero), and a court's `actors` are its members. Neither is the glossary's actor. A single person is a **character**.

## Background actor

A **background actor** (target) is a group sketched in a sentence of holdings and motives, with no ratings, capital, or assets. It gets one visible event per turn instead of a full action.

## Calamity

A **calamity** (target) is a place-bound trouble, one per place. It is not a faction and does not take a turn; clearing it is an adventure or a project.

## Campaign

A **campaign** is one world state: a row in `campaigns` plus everything keyed to it. It tracks the setting, its components, player characters, and time. A database file can hold several campaigns.

## Cast

A **cast** (target) is a cluster of people who must deal with each other, such as a court, a parish, or a corp office. It is not an actor unless it is also given a profile. Today's courts are casts.

## Character

A **character** is a single named person, usually an NPC: a court member, a faction figure, or a local.

## Chart

A **chart** is a generation list: an array of strings, or of dictionaries that may include an optional `weight`. A roll picks one entry. Do not call a chart a table.

Today every chart rolls uniformly; `weight` is not read yet.

## Chart catalog

A **chart catalog** is a folder of charts. Folder and file names tell the server which files to load. A campaign may adopt a module’s chart catalog as-is or modify it.

Not implemented yet. Today there is one catalog file, `src/tables/catalog.json`.

## Fact

A **fact** is a basic truth about a subject in the world. Facts are never used in calculations by the rules layer, but defines the subject beyond its mechanical properties. They can be immutable characteristics, but also elements that could change over time.

## Hero

A **hero** is a player character: a row in `heroes` with level, Words, Influence, Dominion, wealth, and divinity.

A user may take any role: an individual, a small group, or a faction. Today those are different entity types. A faction the user steers is a faction with `control: player`, not a hero.

## Module

A **module** declares the database tables it needs, a chart catalog, actions, interactions, generation config, instructions, dependencies, and its own version. The campaign database is created with only the tables of the modules chosen for it.

Note that this feature is yet to be implemented. The first implementation fixes that module set when the campaign is created and does not change it afterward. Adding, removing, or updating a module during play is a later feature.

## Table

A **table** is a database table (SQLite schema row storage).

Legacy code still uses `tables` for charts (`src/tables/`, `world://tables/{path}`, the `catalog-table` resource). Do not copy that into new writing.

## Aliases

The agnostic target names some v1 terms differently. They mean the same thing:

| Target term | v1 term |
| --- | --- |
| capital | Dominion |
| attention | Influence |
| scale | Power |
| edged | magical |

## Further reading

Precedence: code is current behavior, [`docs/design/`](./) is living intent, and `docs/superpowers/` is history. The [overview](./overview.md) explains how gaps between code and intent are handled, and [current-engine.md](./current-engine.md) describes the running server. For naming only, this glossary is authoritative.
