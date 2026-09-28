# Gardener dev GUI

Localhost browser for inspecting Gardener MCP tools, resources, and prompts, plus ad hoc SQL against the campaign SQLite file.

This is a developer tool (issue #26). It is not the full roadmap GUI, CLI, campaign-directory UI, or a production server. There is no authentication. Bind address is `127.0.0.1` only.

## Prerequisites

From the repository root:

```bash
npm install
npm run build
```

The GUI always talks to the **built** `dist/server.js` over stdio. Rebuild and restart MCP in the GUI after changing `src/`.

## Run

**Two-process dev (Vite UI + API):**

```bash
npm run gui:dev
```

- UI: `http://127.0.0.1:5173` (proxies `/api` to the backend)
- API: `http://127.0.0.1:3847`

**Single process (built static UI served by the API):**

```bash
npm run gui
```

Open `http://127.0.0.1:3847`.

`gui:dev` uses `concurrently` so both the API (`tsx watch`) and Vite stay running.

## Using it

1. Confirm the database path (default `data/campaign.sqlite` under the repo, or `GARDENER_WORLD_DB` if set when the GUI process started).
2. Click **Save path** while MCP is stopped. Changing the path while connected is rejected; stop first, save, then start.
3. Click **Start MCP**. Status should show `Connected (gardener 0.1.0)`. If start fails with `BUILD_REQUIRED`, run `npm run build` from the repo root.
4. **Tools** — pick a tool, fill primitive fields and/or the JSON args textarea, **Call**. Results show the parsed Gardener envelope when the tool returns JSON text.
5. **Resources** — pick a `world://` template, fill `{params}`, **Read**. Example after `seed_campaign`: `world://campaigns/{campaignId}/brief`.
6. **Prompts** — pick `gm-briefing` or `faction-turn-narration`, set args such as `campaignId`, **Run**.
7. **SQL** — run `SELECT` / `PRAGMA` (table view) or other statements (text/JSON). There is no table explorer in v1. The SQL connection is a separate `better-sqlite3` handle on the same file as MCP; concurrent writes may block briefly.
8. The **traffic log** streams MCP, SQL, and system events (last 500 in memory). Filter All / MCP / SQL / Errors.

Example tool call (`quote_change` works on an empty database):

```json
{
  "scope": "city",
  "magnitude": "improbable",
  "wardRatings": [4]
}
```

## Limits

- One MCP child per GUI process.
- Database explorer, CLI/REPL terminal, grouped tools, campaign directories, auth, and binding to `0.0.0.0` are out of scope.
- `INSERT`/`UPDATE` are allowed but not a supported editing workflow.
- SQL before the database file exists returns `DB_NOT_FOUND` until MCP has created the file (start MCP once) or you point at an existing campaign.
