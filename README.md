# Godbound faction world

Design for a local MCP that builds and runs a campaign of courts, facts, and factions.

The server is not implemented yet. The rules, data model, tools, and generator contract are in [the design spec](docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md). The build order is in [the implementation plan](docs/superpowers/plans/2026-09-21-godbound-faction-mcp.md). Table prompts live in [the generator catalog](docs/superpowers/specs/generator-catalog.json).

Those prompts are original short lines with the same die sizes and situation categories as the faction, court, and challenge procedures. They are not a transcription of the rulebook. Ruin layouts are intentionally absent: a “clear a danger” result is an adventure card, not a mapped ruin.

When the plan is built, the process speaks MCP on stdin and stdout:

```bash
npm install
npm test
mkdir -p data
GODBOUND_WORLD_DB=./data/campaign.sqlite npm start
```

Every create tool accepts a complete description. Omitted fields are rolled from the catalog. A blank court keeps its structure and leaves names unset until the table asks for them.

Faction turns are resolved by one agent per faction, court, or other acting unit. Each agent receives only the facts that unit would know. Agents submit plans in parallel. A lock file beside the database, and a write queue, let one apply step commit those plans in turn order.
