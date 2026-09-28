# Installing the Gardener world MCP

Requires Node.js 22 or newer. Stdio server; no HTTP port.

1. Clone this repository if it is not already the workspace.
2. From the repo root:

```bash
npm install
npm run build
mkdir -p data
```

3. Do not run `npm start` or `node dist/server.js`. The MCP client starts the process on stdin/stdout.
4. Point the client at `node` + `dist/server.js`:
   - This repo as the Cursor workspace: `.cursor/mcp.json` is already committed. Reload MCP servers.
   - Another Cursor project: add a `gardener` entry to `~/.cursor/mcp.json` or that project's `.cursor/mcp.json`, with `args` set to this clone's `dist/server.js`.
   - Claude Desktop: the same `mcpServers` block in `claude_desktop_config.json`.
5. The server opens `./data/campaign.sqlite` by default, relative to the directory the MCP client launches it from. From another project, set `GARDENER_WORLD_DB` in the client entry's `env` to an absolute path, and make sure its folder exists. One file can hold several campaigns; keep each `campaignId`, because no tool lists them.

## Play a campaign

To set up or change a campaign, read [skills/gdnr-director/SKILL.md](../skills/gdnr-director/SKILL.md).
Before calling Gardener MCP tools for world setup or play, read [skills/gdnr-player/SKILL.md](../skills/gdnr-player/SKILL.md).
