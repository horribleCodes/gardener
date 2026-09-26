---
name: gdnr-player
description: >-
  Runs a world state tracker for storytelling or running a TRPG. Uses the Gardener MCP to control a database through a rules layer.
  Use when asked to run a campaign, or simulate a world.
---

# Gardener - Player

Gardener is a local MCP that simulates a world for TRPG or exploration at a broad level.

## Campaign scope

- One open SQLite file is **one campaign**. Set `GARDENER_WORLD_DB` or use the default `./data/campaign.sqlite`.
- Every tool on that MCP process shares the same file. Reuse `campaignId` from `seed_campaign` or `create_campaign`. Do not start a second campaign in the same file unless the user asks.

## Manuals

Read and follow [gdnr-play.md](./references/gdnr-play.md). That file explains play procedure.
