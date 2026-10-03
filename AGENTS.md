# Gardener

Gardener is a local stateful MCP implementing a virtual world.

## Architecture

- domain rules are authoritative
- services coordinate domain operations and persistence
- store opens, migrates, and locks the SQLite file; services and queries run SQL through that connection
- MCP layer adapts services to MCP
- user-facing play instructions live under `user/`; files there must not link or cite anything outside `user/`, because skills ship without the rest of the repo (repeat the information instead)
- development skills and prompts live under `.cursor/skills` and `.cursor/prompts`
- finished MCP reviews live under `test/reviews`; playtest scripts under `test/play-scripts`
- living design framing and naming live under `docs/design/` (for example `overview.md`, `glossary.md`)

## Documentation

`docs/superpowers/` is **historical**: dated plans and specs for past changes, not maintained after merge. Do not treat it as the current design source of truth. Prefer `docs/design/` and the codebase; link to superpowers only for deep historical context.

## Work tracking

Live placement and scores are on [Gardener Project](https://github.com/users/horribleCodes/projects/2) (user project #2), not in markdown. Current fields:

- **Status** — single-select: Inbox, Ready, In progress, In review, Done, Parked
- **Priority** — single-select: P0–P2
- **Size** — single-select 1–5; field id `PVTSSF_lAHOAHY62c4Bkk6czhjiILw`
- **Impact** — single-select 1–5
- **Wave** — text (free string); field id `PVTF_lAHOAHY62c4Bkk6czhjkDnI`. Not a Project option list. Cards may still show milestone-style strings as values.

Repo labels `Criticality: n`, `Complexity: n`, and `Impact: n` are retired. Do not apply them. Do not set Project fields unless the user asks and the token allows it.

## Never

- put game rules in MCP handlers
- modify SQLite through ad-hoc SQL in MCP handlers
- treat user-facing skill instructions as development instructions
- add a tool without corresponding tests

## Runtime assets

Any runtime asset imported using `new URL(..., import.meta.url)` must be explicitly copied into `dist`.

`tsc` does not emit them. Today that means `src/store/schema.sql` and `src/tables/catalog.json`, copied by `scripts/copy-assets.mjs` during `npm run build`.

## Tests and the server

`npm test` does not need a running server or a `./data` folder. Tests open in-memory or temp-directory databases; the one `npm start` smoke test sets `GARDENER_WORLD_DB` to a temp path, never the default `./data/campaign.sqlite`. The MCP client owns the stdio process; do not start `npm start` or `node dist/server.js` yourself when wiring a client.

## Pull requests

When a PR comes from a known GitHub issue, link that issue in the body (`Closes` / `Fixes` when it completes the issue; `Related to` / `Implements` otherwise). See `.cursor/prompts/implement.md` and `.cursor/prompts/spec.md`.

Implementing a spec continues on the spec draft: check out that PR's branch, push implementation there, and mark it ready. Do not open a second implementation PR from `main`.
