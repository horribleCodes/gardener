# Installing the Godbound world MCP

Local stdio MCP named `godbound-world`. It stores one campaign in SQLite. There is no HTTP port.

Requires Node.js 22 or newer.

## Install

From this repository:

```bash
npm install
mkdir -p data
```

`npm start` builds TypeScript, then runs `node dist/server.js`. The process speaks MCP on stdin and stdout. The database path is `GODBOUND_WORLD_DB`, defaulting to `./data/campaign.sqlite` relative to the working directory. The file is created on first use.

## Cursor

Add a server entry in `.cursor/mcp.json` (project) or the user MCP config. Use the absolute path to this repo, and an absolute database path so the file does not depend on the client’s working directory.

```json
{
  "mcpServers": {
    "godbound-world": {
      "command": "npm",
      "args": ["start"],
      "cwd": "/absolute/path/to/gardener",
      "env": {
        "GODBOUND_WORLD_DB": "/absolute/path/to/gardener/data/campaign.sqlite"
      }
    }
  }
}
```

Reload MCP servers after saving. One database file is one campaign world.

## Check

```bash
npm test
GODBOUND_WORLD_DB=./data/campaign.sqlite npm start
```

`npm start` waits on stdin. A client that connects over stdio is the readiness check. `npm test` does not need a running server.
