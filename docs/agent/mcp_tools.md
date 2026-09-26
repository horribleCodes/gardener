# Gardener MCP tool index

Compact list of registered tools. One line each. For play cadence, read [mcp_guide.md](./mcp_guide.md). For seeding, read [mcp_setup.md](./mcp_setup.md).

<!-- tools:begin -->

### Campaign & places

- `create_campaign` — Create an empty campaign.
- `seed_campaign` — Create a campaign from an outline; may write starting interest edges.
- `create_place` — Create a place.
- `advance_month` — Close an open turn if needed and advance the calendar.

### Actors

- `create_faction` — Create a faction; does not create interest edges.
- `create_court` — Generate and persist a court; type must be a catalog key.
- `create_character` — Create a character.
- `create_hero` — Create a player hero.
- `fit_blank` — Name blank court or character rows.
- `form_cult` — Bind a hero to a cult faction.
- `set_theology` — Change cult theology at the cost of power.
- `set_divinity` — Set a hero divinity track.
- `set_power` — GM set faction power.
- `record_shatter` — Record a collapsed faction outcome.

### Facts & setpieces

- `create_fact` — Record a fact; does not create interest edges.
- `ensure_setpiece` — Idempotent setpiece ensure.
- `create_challenge` — Attach a challenge card to a change.
- `record_deed` — Record a mighty deed toward a change.
- `record_challenge_outcome` — Record a challenge card outcome.
- `apply_outcome` — Apply a scripted adventure outcome.

### PC changes (Influence / Dominion)

- `quote_change` — Quote the dominion and influence cost for a proposed change.
- `begin_change` — Open a PC-owned change project.
- `commit_resources` — Commit influence or wealth to a change.
- `withdraw_influence` — Withdraw committed influence from a change.
- `assess_withdrawal` — Preview withdrawal risks.
- `resolve_withdrawal` — Resolve a decaying change.
- `expand_change` — Expand an active change scope or magnitude.
- `create_champion` — Spend dominion to create a champion.
- `sway_court` — Record court favor or control.

### Faction turn

- `open_parallel_turn` — Open a parallel agent turn and freeze unit views.
- `get_unit_view` — Frozen privy snapshot for one acting unit.
- `submit_unit_plan` — Queue or replace a unit plan for the open turn.
- `submit_reaction` — Resume apply after a defender choice.
- `apply_write_queue` — Apply queued plans in shuffled unit order.
- `run_faction_turn` — Run a mechanical faction turn.
- `faction_action` — Take one faction action on the open turn (extend_interest is an action kind, not its own tool).
- `resolve_attack` — Resolve a pending defender choice; one battle, not a war declaration.
- `spend_interest` — Spend interest to modify a contest.

### Query

- `get_world_brief` — GM world summary.
- `get_faction` — Full faction sheet.
- `get_court` — Court detail.
- `list_hooks` — List narrative hooks.
- `list_rumors` — Rumor lines from the latest closed turn.
- `interest_map` — Interest edges for a campaign.
- `decision_makers` — Who must agree for a court to act.
- `cult_income` — Monthly dominion grants.
- `relevant_features` — Features relevant to a domain contest.
- `explain_roll` — Explain a stored roll.

<!-- tools:end -->

## Resources

JSON snapshots for narration context. They do not write interest edges.

- `world://campaigns/{campaignId}/brief` — Campaign brief
- `world://campaigns/{campaignId}/factions/{factionId}` — Faction
- `world://campaigns/{campaignId}/courts/{courtId}` — Court
- `world://campaigns/{campaignId}/turns/latest` — Latest turn rumors and actions
- `world://campaigns/{campaignId}/hooks` — Hook list
- `world://tables/{path}` — Generator catalog subtree

## Prompts

JSON-only narration helpers (“narrate only what appears in this JSON”). They do not create interests or fix missing mechanical relationships.

- `gm-briefing` — GM briefing from live JSON only
- `faction-turn-narration` — Narrate the latest faction turn from JSON
