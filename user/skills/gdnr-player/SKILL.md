---
name: gdnr-player
description: >-
  Runs a world state tracker for storytelling or running a TRPG. Uses the Gardener MCP to control a database through a rules layer.
  Use when asked to run a campaign, or simulate a world.
---

# Gardener - Player

Gardener is a local MCP that simulates a world for TRPG or exploration at a broad level.

## Campaign scope

- One file can hold several campaigns, and every tool call names a `campaignId`. Keep the `campaignId` from `seed_campaign` or `create_campaign`: no tool lists campaigns, so a lost id cannot be recovered. Do not start a new campaign unless the user asks.
- In character, a player knows only what `get_unit_view` shows. `get_world_brief`, `get_faction`, and `interest_map` are director reads.

## Manuals

Read and follow [gdnr-play.md](./references/gdnr-play.md). That file explains play procedure.
