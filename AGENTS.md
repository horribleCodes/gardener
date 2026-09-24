# Installing the Godbound world MCP

Local stdio MCP named `godbound-world`. It stores one campaign in SQLite. There is no HTTP port.

Requires Node.js 22 or newer.

## Install

From this repository:

```bash
npm ci
npm run build
mkdir -p data
```

`npm ci` installs locked dependencies. `npm run build` compiles TypeScript and copies schema/catalog assets into `dist/`. `mkdir -p data` prepares the SQLite directory (`GODBOUND_WORLD_DB` defaults to `./data/campaign.sqlite` relative to the working directory; the file is created on first use).

Do not start the MCP server as part of install. It speaks stdio and waits on stdin.

## Start (development and testing only)

Start the server only when a client is attached — Cursor MCP, a playtest, or an end-to-end stdio check. Do not run it as a daemon or boot script.

```bash
GODBOUND_WORLD_DB=./data/campaign.sqlite npm start
```

`npm start` runs `prestart` (`npm run build`) then `node dist/server.js`. The process speaks MCP on stdin and stdout. After a build you can also run `node dist/server.js` directly.

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
```

`npm test` does not need a running server. Do not use `npm start` as an install readiness check: it waits on stdin until a client connects.

## Cursor Cloud specific instructions

Cloud Agent `install` (`.cursor/environment.json`) is the same three commands: `npm ci`, `npm run build`, `mkdir -p data`. It must terminate. Do not set `start` and do not run `npm start` during install or as a boot script.

Start the MCP only for development or testing, when a stdio client is connected.
