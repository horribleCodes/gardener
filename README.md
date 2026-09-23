# Gardener

A local MCP designed for tracking and running a world for an RPG setting.
It stores one campaign world, fills omitted court and faction fields from `src/tables/catalog.json`, runs faction turns, and quotes Influence and Dominion.

## How to run

```bash
npm install
npm test
mkdir -p data
GODBOUND_WORLD_DB=./data/campaign.sqlite npm start
```

The process speaks MCP on stdin and stdout. Point a client at that command. There is no HTTP port.
See [AGENTS.md](AGEMTS.md) for more information.

## Roadmap

Check [ROADMAP.md](./docs/ROADMAP.md) for upcoming features.
