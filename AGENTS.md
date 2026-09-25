# Installing the Gardener world MCP

Follow [README.md](./README.md). This file is the instruct path for an agent told to install Gardener.

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
5. One database file is one campaign (`./data/campaign.sqlite` by default).

`npm test` is for developing this repo and does not need a running server.

## Play a campaign

Before calling Gardener MCP tools for world setup or play, read [docs/agent/current-mcp-tools.md](./docs/agent/current-mcp-tools.md). Wars, trade ties, and spy rings belong on **interest edges**, not in `create_fact` prose alone—the instruction file documents what each tool actually writes today.
