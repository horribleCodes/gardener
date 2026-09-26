# Gardener

Gardener is a local stateful MCP implementing a virtual world.

## Architecture

- domain rules are authoritative
- services coordinate domain operations and persistence
- store owns SQLite access
- MCP layer adapts services to MCP
- user-facing play instructions live under `user/`
- development skills and prompts live under `.cursor/skills` and `.cursor/prompts`
- finished MCP reviews live under `test/reviews`; playtest scripts under `test/play-scripts`

## Never

- put game rules in MCP handlers
- modify SQLite through ad-hoc SQL in MCP handlers
- treat user-facing skill instructions as development instructions
- add a tool without corresponding tests

## Runtime assets

Any runtime asset imported using `new URL(..., import.meta.url)` must be explicitly copied into `dist`.

`tsc` does not emit them. Today that means `src/store/schema.sql` and `src/tables/catalog.json`, copied by `scripts/copy-assets.mjs` during `npm run build`.

## Tests and the server

`npm test` does not need a running server. The MCP client owns the stdio process; do not start `npm start` or `node dist/server.js` yourself when wiring a client.
