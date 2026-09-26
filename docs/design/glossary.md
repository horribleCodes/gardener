# Design glossary

Canonical names for Gardener design and implementation work. Use these words consistently in code, docs, and issues so database tables are not confused with generation lists.

## Actor

An **actor** is an NPC registered as a unique entity.

## Campaign

A **campaign** is an instance of a world state in the form of a SQLite database. It tracks the setting, its components, player characters and time.

## Chart

A **chart** is a generation list: an array of strings, or of dictionaries that may include an optional `weight`. A roll picks one entry. Do not call a chart a table.

## Chart catalog

A **chart catalog** is a folder of charts. Folder and file names tell the server which files to load. A campaign may adopt a module’s chart catalog as-is or modify it.

## Hero

A **hero** is a single player character or unit representing the player.

## Module

A **module** declares the database tables it needs, a chart catalog, actions, interactions, generation config, instructions, dependencies, and its own version. The campaign database is created with only the tables of the modules chosen for it.

Note that this feature is yet to be implemented. The first implementation fixes that module set when the campaign is created and does not change it afterward. Adding, removing, or updating a module during play is a later feature.

## Table

A **table** is a database table (SQLite schema row storage).

## Further reading

Rule depth and setting-neutral mechanics live in the agnostic world design spec (historical snapshot): [2026-09-23-agnostic-world-system-design.md](../superpowers/specs/2026-09-23-agnostic-world-system-design.md). If a non-historical document or code contradicts the design spec, the newer file wins. For naming only, this glossary is authoritative.
