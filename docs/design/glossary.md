# Design glossary

Canonical names for Gardener design and implementation work. Use these words consistently in code, docs, and issues so database tables are not confused with generation lists.

## Table

A **table** is a database table (SQLite schema row storage).

## Chart

A **chart** is a generation list: an array of strings, or of dictionaries that may include an optional `weight`. A roll picks one entry.

The running server’s default chart file is [`src/tables/catalog.json`](../../src/tables/catalog.json). Do not call a chart a table.

## Chart catalog

A **chart catalog** is a folder of charts. Folder and file names tell the server which files to load. A campaign may adopt a module’s chart catalog as-is or modify it.

## Module

A **module** declares the database tables it needs, a chart catalog, actions, interactions, generation config, instructions, dependencies, and its own version. The campaign database is created with only the tables of the modules chosen for it.

The first implementation fixes that module set when the campaign is created and does not change it afterward. Adding, removing, or updating a module during play is a later feature.

Exactly one included module owns the turn. The others must not also spend the action or count income.

## Further reading

Rule depth and setting-neutral mechanics live in the agnostic world design spec (historical snapshot): [2026-09-23-agnostic-world-system-design.md](../superpowers/specs/2026-09-23-agnostic-world-system-design.md). For naming only, this glossary is authoritative.
