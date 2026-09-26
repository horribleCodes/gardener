# Gardener MCP

Gardener is a local MCP that simulates a world for TRPG or exploration at a broad level.

## Campaign scope

- One open SQLite file is **one campaign**. Set `GARDENER_WORLD_DB` or use the default `./data/campaign.sqlite`.
- Every tool on that MCP process shares the same file. Reuse `campaignId` from `seed_campaign` or `create_campaign`. Do not start a second campaign in the same file unless the user asks.

Install and client wiring live in [AGENTS.md](../../AGENTS.md) and [README.md](../../README.md). Do not start the server yourself; the MCP client launches it on stdin/stdout.

## Manuals

Read these before calling Gardener tools for world work:

| Manual | When to read |
| --- | --- |
| [mcp_setup.md](./mcp_setup.md) | Before generating or expanding a world |
| [mcp_guide.md](./mcp_guide.md) | While running a campaign: month cadence and intent → tools |
| [mcp_tools.md](./mcp_tools.md) | When choosing a specific tool, resource, or prompt |

Wars, trade ties, and spy rings belong on **interest edges**. Setup writes those edges; `create_fact` prose alone does not.
