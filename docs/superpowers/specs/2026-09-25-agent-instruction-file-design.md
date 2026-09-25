# Agent instruction file (roadmap item 5)

> Status: design for a host/agent deliverable. Does not change MCP tools or rules code. Replaced later by module instructions (roadmap item 17) and per-cluster MCP prompts (item 26).

## Purpose

Give agents enough context to use the **current** Gardener MCP without reading TypeScript, the generator catalog, or the long Godbound design spec. The 24 Sep 2026 playtest (`docs/reviews/2026-09-24-init-campaign.md`) showed the gap: the agent recorded an open war, a two-sided arms dealer, and a spy blackmail plot as **facts** because nothing in the tool catalog explained that those relationships belong on **interest edges**, and no tool writes those edges after `seed_campaign`.

This file is a **current-surface card**. It documents what exists today, including limits that are not bugs but missing tools (roadmap item 24).

## Audience and discovery

| Consumer | How they find it |
| --- | --- |
| Cursor / Cloud Agent in this repo | `AGENTS.md` adds a **Play** section: before calling Gardener MCP tools for campaign work, read `docs/agent/current-mcp-tools.md`. Install steps stay unchanged. |
| Human GM | `README.md` links to the same path under a short **Play** heading. |
| Other MCP clients | Same markdown path in the clone; no server change required for v1 of this item. |

Do **not** duplicate install steps from `AGENTS.md` / `README.md` inside the instruction file. Do **not** embed rulebook prose or catalog tables.

## File to ship

**Path:** `docs/agent/current-mcp-tools.md`

**Tone:** Imperative, short sections, tables where they save words. Target roughly 150–250 lines (shorter than the playtest review’s bullet list plus a tool index).

**Header (required):**

- One sentence: this documents the Godbound-strain tool surface as of the commit that last updated the file.
- Explicit **sunset**: module instructions and MCP prompt clusters replace this file; do not treat it as permanent API docs.

## Required content

Content below is **normative** for the instruction file. Wording may vary; omissions are not allowed.

### 1. Campaign scope

- One open SQLite file is one campaign (`GARDENER_WORLD_DB` or default `./data/campaign.sqlite`).
- All tools on that process share the same file. Reuse `campaignId` from `seed_campaign` / `create_campaign`; do not start a second campaign in the same file unless the user asks.
- `get_world_brief` and `interest_map` are the usual sanity checks after setup.

### 2. Interest natures and fiction

State that natures are exactly these seven strings (both directions use the same set):

`alliance`, `rivalry`, `trade`, `marriage`, `spies`, `aid`, `tribute`.

Include a small mapping table for common player language (from the playtest):

| Player intent | Nature | Notes |
| --- | --- | --- |
| Open war, hostility | `rivalry` | No separate “war” flag in the database |
| Secret agents, blackmail, exposure | `spies` | Directed edge matters |
| Merchant ties, selling to both sides | `trade` | |
| (other rows) | (catalog id) | One line each for alliance, marriage, aid, tribute |

State that **`rivalry` and `spies` on an incoming edge** are what make a faction auto-intervene to harm a target during turn resolution (high level; no turn algorithm dump).

### 3. Interest edges (shape, not setup API)

- Each direction is its own row: `from` → `to`, `points`, `nature`.
- Starting points for a new edge are usually one die maximum from the owner faction’s Power (1→4, 2→6, 3→8, 4→10, 5→12).
- Cap is twice that die maximum per direction.
- No self-edges.

### 4. Who writes interests today

| Phase | Tool | Behavior |
| --- | --- | --- |
| Campaign seed | `seed_campaign` | Creates bidirectional interest rows when `linkInterests` is true (default when ≥2 factions). Links a pair if they share a parent place in the outline **or** either lists the other in `neighborKeys`. **Nature is rolled** from the catalog; outline factions have **no** nature field on the MCP schema. |
| After seed | `create_faction` | Creates the faction sheet only. **`interestsOut` / `interestsIn` stay empty.** `behavior` and `create_fact` do **not** create interest rows. |
| During play | `faction_action` → `extend_interest` | Domain **contest** on an open turn. Adds one point on success; if the edge is new, nature is **rolled**, starting at one point. Not a setup shortcut for “declare war.” |
| During play | `attack` | Resolves a battle against a target faction; **not** a standing war relationship. |
| Read | `interest_map` | Read-only graph. |
| Spend | `spend_interest` | Modifies a contest using points **already** on an edge. |

**Critical agent rule:** If the user wants new factions linked by specific natures after seeding, the MCP **cannot** do that today. Say so plainly. Prose facts are optional color; they **do not** substitute for missing edges. Roadmap item 24 adds a direct writer.

### 5. Setup pitfalls (from playtest)

Cover at least these, in brief:

- **Court `type`** on `create_court` must be a catalog key (e.g. `business`, `bureaucratic`, `community`), not a free-text adjective like “mercantile.”
- **`create_faction` features and problems are rolled**; the call cannot request “military” or “spy” features by name.
- **`seed_campaign` does not return place ids**; recover them via `get_world_brief` (court `placeId`) or `get_faction` (`home_place_id`) when parenting `create_place`.
- **`fill` modes** (`require`, `missing`, `blank`) apply across generation tools; default is `missing`.

### 6. Compact tool map

A grouped index of **all** tools registered in `src/mcp/register.ts` at implement time, one line each: name plus half-sentence role. Suggested groups (adjust only if the register layout changes):

1. **Campaign & places** — `create_campaign`, `seed_campaign`, `create_place`, `advance_month`
2. **Actors** — `create_faction`, `create_court`, `create_character`, `create_hero`, `fit_blank`, `form_cult`, `set_theology`, `set_divinity`, `set_power`, `record_shatter`
3. **Facts & setpieces** — `create_fact`, `ensure_setpiece`, `create_challenge`, `record_deed`, `record_challenge_outcome`, `apply_outcome`
4. **PC changes** — `quote_change`, `begin_change`, `commit_resources`, `withdraw_influence`, `assess_withdrawal`, `resolve_withdrawal`, `expand_change`, `create_champion`, `sway_court`
5. **Faction turn** — `open_parallel_turn`, `get_unit_view`, `submit_unit_plan`, `submit_reaction`, `apply_write_queue`, `run_faction_turn`, `faction_action`, `resolve_attack`, `spend_interest`
6. **Query** — `get_world_brief`, `get_faction`, `get_court`, `list_hooks`, `list_rumors`, `interest_map`, `decision_makers`, `cult_income`, `relevant_features`, `explain_roll`

MCP **resources** (`world://…`) and **prompts** (`gm-briefing`, `faction-turn-narration`) get one sentence: JSON-only narration helpers, not substitutes for the interest rules above.

### 7. What agents should do when blocked

When the user asks for relationships the tools cannot write:

1. Explain the missing capability (no post-seed interest edge with chosen nature).
2. Offer **honest** alternatives: adjust the `seed_campaign` outline before seeding (neighbors only; nature still rolled), or accept narrative `create_fact` with explicit warning that mechanics will not see it, or wait for item 24.
3. Do **not** silently store mechanical claims only in facts.

## Out of scope (this item)

- New MCP tools, schema changes, or richer tool descriptions in `register.ts` (item 24 and ongoing hygiene).
- Cursor skills for play (item 27).
- MCP `registerPrompt` clusters (item 26).
- Module-packaged instructions (item 17).
- Rewriting `docs/ROADMAP.md`.

## Acceptance criteria

1. `docs/agent/current-mcp-tools.md` exists and satisfies sections 1–7.
2. `AGENTS.md` points play agents at that file without conflating install and play.
3. `README.md` links to the file for humans.
4. Tool index matches `src/mcp/register.ts` tool names (implementer verifies with ripgrep or a small test script listed in the plan).
5. A reader who only has the instruction file can explain why the 24 Sep playtest stored war in facts and what would have been needed for mechanical `rivalry` / `trade` / `spies` edges.

## References

- Roadmap item 5 — `docs/ROADMAP.md`
- Playtest evidence — `docs/reviews/2026-09-24-init-campaign.md`
- Interest rules detail — `docs/superpowers/specs/2026-09-23-agnostic-world-system-design.md` (strain profile); instruction file stays shorter
- GitHub issue — https://github.com/horribleCodes/gardener/issues/15
