# Current Gardener MCP tools (Godbound strain)

This documents the **Godbound-strain** tool surface as of the commit that last updated this file. It is a **current-surface card**, not permanent API documentation. **Module instructions** (roadmap item 17) and **per-cluster MCP prompts** (item 26) will replace it; do not treat this file as the long-term contract.

Read this before calling Gardener MCP tools for campaign setup or play. Install steps live in `AGENTS.md` and `README.md` only.

---

## 1. Campaign scope

- One open SQLite file is **one campaign**. Set `GARDENER_WORLD_DB` or use the default `./data/campaign.sqlite`.
- Every tool on that MCP process shares the same file. Reuse `campaignId` from `seed_campaign` or `create_campaign`. Do not start a second campaign in the same file unless the user asks.
- After setup, **`get_world_brief`** and **`interest_map`** are the usual sanity checks: factions, courts, places, and whether interest edges exist.

---

## 2. Interest natures and fiction

Interest **natures** are exactly these seven strings (both directions use the same set):

`alliance`, `rivalry`, `trade`, `marriage`, `spies`, `aid`, `tribute`

There is no separate “war” or “at peace” flag in the database. Fiction maps to natures like this:

| Player intent | Nature | Notes |
| --- | --- | --- |
| Open war, raids, political sabotage | `rivalry` | Standing hostility; not a one-off battle |
| Secret agents, blackmail, exposure threats | `spies` | **Directed** edge matters (`from` → `to`) |
| Merchant ties, selling to both sides | `trade` | Mercantile dependence between factions |
| Mutual defense, shared councils | `alliance` | Auto-intervene to **help** when incoming |
| Kinship and marriage among elites | `marriage` | |
| Relief, subsidies, advisors in crisis | `aid` | Auto-intervene to **help** when incoming |
| Payments, hostages, acknowledged superiority | `tribute` | |

**Auto-intervention:** On an **incoming** interest edge, `rivalry` and `spies` cause the owning faction to auto-intervene to **harm** the target during turn resolution. `alliance` and `aid` auto-intervene to **help**. Other natures do not auto-intervene on their own. (This is high-level; do not infer full turn algorithms from this file.)

---

## 3. Interest edges (shape)

- Each **direction** is its own row: `from` faction → `to` faction, with `points` and `nature`.
- Starting points for a new edge are usually one die maximum from the owner faction’s Power: Power 1→4, 2→6, 3→8, 4→10, 5→12.
- Cap per direction is **twice** that die maximum.
- No self-edges (a faction cannot point an interest at itself).

---

## 4. Who writes interests today

| Phase | Tool | Behavior |
| --- | --- | --- |
| Campaign seed | `seed_campaign` | Creates bidirectional interest rows when `linkInterests` is true (default when ≥2 factions). Links a pair if they share a parent place in the outline **or** either lists the other in `neighborKeys`. **Nature is rolled** from the catalog; outline factions have **no** nature field on the MCP schema. |
| After seed | `create_faction` | Creates the faction sheet only. **`interestsOut` / `interestsIn` stay empty.** `behavior` and `create_fact` do **not** create interest rows. |
| During play | `faction_action` → `extend_interest` | Domain **contest** on an open turn. Adds one point on success; if the edge is new, nature is **rolled**, starting at one point. Not a setup shortcut for “declare war.” |
| During play | `resolve_attack` | Resolves a battle against a target faction; **not** a standing war relationship. |
| Read | `interest_map` | Read-only graph. |
| Spend | `spend_interest` | Modifies a contest using points **already** on an edge. |

**Critical agent rule:** If the user wants new factions linked by **specific** natures after seeding, the MCP **cannot** do that today. Say so plainly. Prose facts are optional color; they **do not** substitute for missing edges. Roadmap item 24 will add a direct writer.

### Playtest reminder (24 Sep 2026)

The init-campaign playtest stored an open war, a two-sided arms dealer, and spy blackmail as **`create_fact` prose** because nothing in the tool catalog stated the rules above. Mechanically, that scenario needed **directed** edges such as: Ashbanner ↔ Covenant **`rivalry`**, Syndicate ↔ both belligerents **`trade`**, Rootbound → Syndicate **`spies`**. `extend_interest` would have been wrong for setup (random nature, one point, needs an open turn and winning contest). `resolve_attack` would have been a single battle, not a standing war.

---

## 5. Setup pitfalls

- **Court `type`** on `create_court` must be a catalog key (e.g. `business`, `bureaucratic`, `community`), not a free-text adjective like “mercantile.”
- **`create_faction` features and problems are rolled**; the call cannot request “military” or “spy” features by name.
- **`seed_campaign` does not return place ids**; recover them via `get_world_brief` (court `placeId`) or `get_faction` (`home_place_id`) when parenting `create_place`.
- **`fill` modes** (`require`, `missing`, `blank`) apply across generation tools; default is `missing`.

---

## 6. Compact tool map

Grouped index of tools registered in `src/mcp/register.ts`. One line each.

<!-- tools:begin -->

### Campaign & places

- `create_campaign` — Empty campaign shell and `campaignId`.
- `seed_campaign` — Campaign from outline; may write starting interest edges.
- `create_place` — Add a place under an optional parent.
- `advance_month` — Advance campaign calendar.

### Actors

- `create_faction` — Faction sheet; does not create interests.
- `create_court` — Court on a place; court type must be a catalog key.
- `create_character` — NPC on a court or faction.
- `create_hero` — Player hero (Godbound strain).
- `fit_blank` — Roll or fill a blank character slot.
- `form_cult` — Start a cult tied to a hero.
- `set_theology` — Cult theology from catalog.
- `set_divinity` — Hero divinity from catalog.
- `set_power` — Hero power level.
- `record_shatter` — Record a shatter event on a hero.

### Facts & setpieces

- `create_fact` — Prose fact; **does not** create interest edges.
- `ensure_setpiece` — Ensure a setpiece exists for play.
- `create_challenge` — Structured challenge for a change.
- `record_deed` — Record a completed deed.
- `record_challenge_outcome` — Outcome of a challenge roll.
- `apply_outcome` — Apply a quoted change outcome to the world.

### PC changes (Influence / Dominion)

- `quote_change` — Quote dominion and influence cost for a proposed change.
- `begin_change` — Open a change workflow.
- `commit_resources` — Commit resources to an open change.
- `withdraw_influence` — Start influence withdrawal.
- `assess_withdrawal` — Assess withdrawal state.
- `resolve_withdrawal` — Resolve withdrawal.
- `expand_change` — Expand scope of an open change.
- `create_champion` — Champion for a change contest.
- `sway_court` — Court sway action for a change.

### Faction turn

- `open_parallel_turn` — Open parallel faction turn queue.
- `get_unit_view` — Unit’s view for planning (respects knowledge rules).
- `submit_unit_plan` — Submit a unit’s plan for the open turn.
- `submit_reaction` — Submit a reaction in the queue.
- `apply_write_queue` — Apply queued writes after planning.
- `run_faction_turn` — Run faction turn resolution.
- `faction_action` — Faction action (extend_interest is an action kind, not its own tool).
- `resolve_attack` — Resolve an attack battle (not a war declaration).
- `spend_interest` — Spend points on an existing interest edge in a contest.

### Query

- `get_world_brief` — Campaign overview: month, factions, courts, places.
- `get_faction` — One faction sheet and interests.
- `get_court` — One court detail.
- `list_hooks` — Faction problems and hooks.
- `list_rumors` — Rumor lines for the campaign.
- `interest_map` — Read-only interest graph.
- `decision_makers` — Who can decide for a court or faction.
- `cult_income` — Cult income summary.
- `relevant_features` — Features relevant to a domain contest.
- `explain_roll` — Explain a stored or hypothetical roll.

<!-- tools:end -->

### MCP resources and prompts

**Resources** (`world://campaigns/…`, `world://tables/…`) expose JSON snapshots (brief, faction, court, latest turn, hooks, catalog slices). Use them for narration context, not as a substitute for interest-edge rules above.

**Prompts** `gm-briefing` and `faction-turn-narration` are JSON-only narration helpers (“narrate only what appears in this JSON”). They do not create interests or fix missing mechanical relationships.

---

## 7. When the tools cannot do what the user asked

When the user wants relationships the MCP cannot write (e.g. explicit `rivalry` / `spies` / `trade` between factions added after seed):

1. **Explain** the gap: there is no post-seed tool to create an interest edge with a chosen nature (roadmap item 24).
2. **Offer honest alternatives:**
   - Adjust the `seed_campaign` outline **before** seeding (use `neighborKeys` so pairs link; nature is still **rolled**, not chosen).
   - Use `create_fact` for narrative color **only**, with an explicit warning that goals and turn logic keyed on interests will not see it.
   - Wait for the direct interest writer (item 24).
3. **Do not** silently store mechanical claims only in facts when the user expected mechanics.

---

## References

- Playtest evidence: `docs/reviews/2026-09-24-init-campaign.md`
- Design detail (longer): `docs/superpowers/specs/2026-09-23-agnostic-world-system-design.md`
- Roadmap item 5 / GitHub issue [#15](https://github.com/horribleCodes/gardener/issues/15)
