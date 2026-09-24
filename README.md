# Gardener

A local MCP for tracking and running a world for an RPG setting.
It stores one campaign world, fills omitted court and faction fields from `src/tables/catalog.json`, runs faction turns, and quotes Influence and Dominion.

Stdio server named `godbound-world`. There is no HTTP port. Requires Node.js 22 or newer.

## Install

Clone this repository, then install and build. Do not start the server; the MCP client launches it.

```bash
npm install
npm run build
mkdir -p data
```

One SQLite file is one campaign. The default path is `./data/campaign.sqlite` (created on first use). Set `GODBOUND_WORLD_DB` only to use a different file.

### Cursor

If this repo is the workspace, project config is already in `.cursor/mcp.json`. Reload MCP servers after the build.

To use Gardener from another Cursor project, add this to `~/.cursor/mcp.json` or that project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "godbound-world": {
      "command": "node",
      "args": ["/absolute/path/to/gardener/dist/server.js"]
    }
  }
}
```

### Claude Desktop

Use the same `mcpServers` block in `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`).

## Development

This repository is developed with agents in the Gardener Cursor Project. `npm test` does not need a running MCP server.

## Roadmap

See [docs/ROADMAP.md](./docs/ROADMAP.md).
