# How to play a Gardener campaign

This manual is for running an already-seeded campaign. For seeding and generation, read [mcp_setup.md](./mcp_setup.md). For a compact tool index, read [mcp_tools.md](./mcp_tools.md).

## What you are simulating

A few factions (about three to six that matter; a slice of a larger power can be the faction) keep moving while the heroes adventure. Their month is **background**, not a fair war game.

After the dice, describe the result as rumor, news, or something the heroes could notice. Damage is abstract: name which part of the group was hurt and what happened in the fiction.

**Heroic acts override that background.** If the heroes remove the person a Feature names, that Feature is gone with no contest. If they spend Dominion to create a significant structure, the faction gains that Feature. A Feature added by Influence or Dominion also plants a one-point Problem for the backlash.

Narrate only what the tools recorded.

## How a stretch of play moves

### 1. Read before acting

Call `get_world_brief`, `interest_map`, `get_faction`, `list_hooks`, and `list_rumors` as needed. Do not invent dice results or mechanical relationships that are not in the data.

### 2. Resolve what the heroes do this session

- A **single concrete act** (overthrow a monarch, smash a relic, shatter a foe) is an adventure outcome: `record_deed`, `apply_outcome`, or `record_shatter`. It is not a change project.
- A **sprawling ambition** (make a town a trade hub, found an order, change a people) is a **change**. Pick scope (`village`, `city`, `region`, `nation`, `realm`) and magnitude (`plausible`, `improbable`, `impossible`, `vast`), then:
  1. `quote_change` — always quote before promising a cost
  2. `begin_change`
  3. `commit_resources`
  4. Attach challenges (`create_challenge`, `record_challenge_outcome`) as needed
  5. `apply_outcome` when the change lands

Mundus wards raise the Influence cost of a change inside them. They do not block an immediate gift or miracle.

### 3. Warn about Influence before they commit

Before an Influence change is committed, say whether it will hold if the hero stops shepherding it.

On withdrawal (`withdraw_influence`, `assess_withdrawal`, `resolve_withdrawal`):

- An opposed group undoes the change over a sensible time.
- New facts the locals cannot maintain slide back toward the old normal (goods and trained people remain; the system that produced them does not).
- Events that already happened stay true, but the hero no longer controls them.

Tell the user that before they spend.

### 4. Courts

Read `decision_makers` and use `sway_court` when the heroes work with the court.

Compelling a court by force fits a court with no real protection (a village’s elders). It costs legitimacy and grows trouble the longer it lasts. A great court is impractical to simply shove.

### 5. Run the faction month

- **`run_faction_turn`** — each NPC faction picks a goal from its behavior and takes one action.
- **Directed faction** (the user is steering it) — it does not pick for itself:
  1. `open_parallel_turn`
  2. `get_unit_view`
  3. `submit_unit_plan`
  4. `submit_reaction` if a defender must choose
  5. `apply_write_queue`

Plan types: `idle`, `build_strength`, `enact_change`, `attack`, `extend_interest`, `aid`, `restore_cohesion`, `remove_interest`, plus standing orders to help or harm.

`faction_action` is the same action on an already open turn.

### 6. Narrate the closed turn

Use `list_rumors` or the `faction-turn-narration` prompt. `list_hooks` is the next adventure when a faction the heroes care about is in trouble.

### 7. Advance the calendar

`advance_month` moves the calendar. Cult Dominion accrues by the month (`cult_income`). Skipping time is how worship piles up; a campaign that never skips stays Dominion-poor. Encourage spending Dominion on changes rather than hoarding it.

## Intent → action

Interest **natures** are exactly these seven strings (both directions use the same set):

`alliance`, `rivalry`, `trade`, `marriage`, `spies`, `aid`, `tribute`

There is no separate “war” or “at peace” flag. Each **direction** is its own edge: `from` faction → `to` faction, with `points` and `nature`. No self-edges.

**Auto-intervention:** On an **incoming** edge, `rivalry` and `spies` cause the owning faction to auto-intervene to **harm** the target during turn resolution. `alliance` and `aid` auto-intervene to **help**. Other natures do not auto-intervene on their own.

How starting edges are written at seed time is in [mcp_setup.md](./mcp_setup.md).

| User intent | What to call |
| --- | --- |
| Standing war, raids, political sabotage | Need a `rivalry` edge (setup / neighbors before seed). One battle this month: plan or `faction_action` type `attack`, then `resolve_attack` if the defender must choose. `resolve_attack` is not a war declaration. |
| Secret agents, blackmail, exposure | Directed `spies` edge (`from` → `to` matters). |
| Selling to both sides, merchant dependence | `trade` edges. |
| Mutual defense or shared councils | `alliance`. |
| Relief, subsidies, advisors | `aid` as a nature, or the `aid` **action** to send help this month. |
| Kinship among elites | `marriage`. |
| Payments, hostages, acknowledged superiority | `tribute`. |
| Grow a tie during a month | `extend_interest` (contest, one point; nature **rolled** if the edge is new). |
| Tilt a contest with points already on an edge | `spend_interest`. |
| Drop a tie | `remove_interest`. |
| Color that mechanics must not see | `create_fact`, and say so plainly. |
| “What do we know?” | Queries above, plus `world://` resources and `gm-briefing`. Those prompts are narration only. |

If the user wants a standing relationship the tools cannot write after seed (chosen nature on a new edge), say so. See [mcp_setup.md](./mcp_setup.md) for honest alternatives. Do not silently store mechanical claims only in facts.

## Player vs Director

The user will interact with the world both as a director and as a player, but these two aren't interchangable. It's important to **distinguish** whether a command or question from a user is intended to represent a player unit within the world or a director outside of it.

**Players** are beholden to the laws of the world. They are limited in location, ability and knowledge of the unit they embody. **Reject** prompts that:

- Require the player to be somewhere they are not
- Have the player do something they are unable to do or lies outside their sphere of influence
- Demand access to information the player hasn't learned yet

**Directors** may change the world directly and do not have a presence in the game. The user will act as one at the start of a new campaign to establish the setting, but may also make demands later to either directly change the world, access information unknown to the player or dictate the behavior of an NPC. Their actions are never restricted.

Use your **own judgement** to determine whether a user is prompting as a player or director. **If it's unclear**, ask the user whether this is intended to be **in or out of character**.
