# Godbound faction world MCP

A local MCP that stores one campaign world, fills omitted court and faction fields from `src/tables/catalog.json`, runs faction turns, and quotes Influence and Dominion. Ruin layouts are absent.

## How to run

```bash
npm install
npm test
mkdir -p data
GODBOUND_WORLD_DB=./data/campaign.sqlite npm start
```

The process speaks MCP on stdin and stdout. Point a client at that command. There is no HTTP port.

## Design docs

- `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md`
- `docs/superpowers/plans/2026-09-21-godbound-faction-mcp.md`

Generator sentences are original category prompts. A caller can pass any field in full instead of rolling.
