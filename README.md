# Gardener

A local MCP for tracking and running a world for an RPG setting.
It stores campaign worlds in SQLite, fills omitted court and faction fields from `src/tables/catalog.json`, runs faction turns, and quotes Influence and Dominion.

Stdio server named `gardener`. There is no HTTP port. Requires Node.js 22 or newer.

## Install

Clone this repository, then install and build. Do not start the server; the MCP client launches it.

```bash
npm install
npm run build
mkdir -p data
```

The server opens one SQLite file, `./data/campaign.sqlite` by default (created on first use; the folder must exist). A relative path resolves against the directory the MCP client launches the server from, so from another project set `GARDENER_WORLD_DB` to an absolute path. One file can hold several campaigns.

### Play

Agents that run or set up a world should start from [user/README.md](./user/README.md).

### Cursor

If this repo is the workspace, project config is already in `.cursor/mcp.json`. Reload MCP servers after the build.

To use Gardener from another Cursor project, add this to `~/.cursor/mcp.json` or that project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gardener": {
      "command": "node",
      "args": ["/absolute/path/to/gardener/dist/server.js"]
    }
  }
}
```

### Claude Desktop

Use the same `mcpServers` block in `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`).

## Work tracking

Live placement, waves, and scores (**Priority**, **Complexity**, **Impact**, **Wave / horizon**) are on [Gardener Project](https://github.com/users/horribleCodes/projects/2). Repo issues carry type and pipeline labels; they are not the board.
