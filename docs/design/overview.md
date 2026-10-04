# Design overview

Living design framing for Gardener. Work tracking and sequencing live on [Gardener Project](https://github.com/users/horribleCodes/projects/2) and in issues—not in a markdown roadmap. Board fields: **Status** (Inbox, Ready, In progress, In review, Done, Parked), **Priority** (P0–P2), **Size** (1–5), **Impact** (1–5), and **Wave** (free-text string; not a fixed Project option list).

## Sources of truth

- **Code** is current behavior.
- **`docs/design/`** is living intent: this page, the [glossary](./glossary.md), [current-engine.md](./current-engine.md), and decisions promoted from issues.
- **`docs/superpowers/`** is history: dated specs and plans. They are not maintained after merge, although a status banner may point to a successor.

When code misses living intent, the gap is engine work: it is listed under [Known engine gaps](#known-engine-gaps) and tracked on the Project. Do not rewrite living intent to match a gap.

## What runs today

The server implements the Godbound **strain** profile: monthly faction turns, influence, world-changes, and related MCP tools. That shape was specified in [godbound-faction-mcp-design.md](../superpowers/specs/2026-09-21-godbound-faction-mcp-design.md) (historical spec) and then changed by [strain-contract.md](../superpowers/plans/2026-09-23-strain-contract.md) (historical plan): schema-version checks on open, setpiece links, challenges that can exist without a change, and willing Remove Interest.

Storage, the MCP surface, determinism, and the turn model as they run now are in [current-engine.md](./current-engine.md).

## Invariants

These hold for every profile and module:

- The server never calls a language model. The caller supplies narration and proper nouns.
- Derived numbers (Trouble, the action die, collapse margin, caps, and costs) are computed by the server and are never accepted as writes.
- Every roll is stored and can be explained.
- Facts are never invented. A fact exists because a caller stated it or a rule produced it.
- Caller text wins. Generation fills only fields the caller left out.

## Where the design is going

The target is a setting-neutral **agnostic world system**: one actor model, campaign profiles (`strain` or `assets`), and presets that flip flags and catalogs rather than hard-coding one game. The fullest description is the [agnostic-world-system-design.md](../superpowers/specs/2026-09-23-agnostic-world-system-design.md) snapshot, which is not maintained. Target decisions move into `docs/design/` as they are adopted.

At a high level:

- **Profile 1: Strain** — cohesion, trouble, projects, and the turn v1 already runs. v1 runs it with Godbound flag values only. Ashes-style communities still need a named preset that is not shipped.
- **Profile 2: Assets** — Force, Cunning, Wealth, located assets, and goals; a second rules module, not hit points pasted onto strain features.

What v1 already is, in agnostic flags:

| Flag | v1 (`godbound` preset) | Target `ashes` preset |
| --- | --- | --- |
| `profile` | `strain` | `strain` |
| `projectBase` | `scope` ladder for hero changes; faction changes use the ladder indexed by Power | `scale` |
| `opposition` | `stack` | `largest` |
| `wards` | on, as mundus wards | off |
| `heldChanges` | on, as Influence | off |

Cults, Words, champions, and free divinity are present in v1 and belong to the `godbound` preset. Campaigns store these seven flags plus `preset`. `create_campaign` and `seed_campaign` default to `godbound`; other named presets are not shipped. Cost and turn code still uses the godbound formulas until follow-on cards read the stored flags.

## How to change the codebase

The project is still in early phases. Until modules chosen at campaign creation and live module edits both exist, prefer replacing the current shape over carrying legacy call shapes or file layouts. Backwards compatibility matters once live module edits and multi-campaign directories are in play—not for every intermediate refactor.

Domain rules stay authoritative in `src/`; services coordinate persistence; the store opens, migrates, and locks the database; the MCP layer adapts tools. Play-facing instructions belong under [`user/`](../../user/).

## Known engine gaps

Code that does not yet do what living intent says. Each is tracked as engine work on the Project.

**Interest and contests**

- Interest natures never auto-intervene: no faction spends interest unless a plan's standing order or `spend_interest` does.
- Standing orders fire only inside the planning faction's own attack or extend, only before the roll, and never cost Dominion. Intent: during any contest the target is in, with after-roll orders costing Dominion.
- `spend_interest` after a roll only relabels the outcome. Intent: the modifier applies to the stored roll before comparison, and the result follows.
- When both sides have a feature, a contest adds the rolling feature's stored origin (+1 `improbable`, +2 `impossible`) and the caller's `attackerBonus` or `defenderBonus` (an integer 0 or higher). Domain mismatch does not set marginality. No play tool yet writes a non-native feature origin.

**Turns and plans**

- One plan applies as one action. Intent: one internal plus up to Power external actions.
- `open_parallel_turn` without `missing` idles every NPC faction that has no plan. Intent: they run their goal strategy.
- A plan naming an id outside the unit's view is dropped silently, and a `player` faction's entry in `run_faction_turn` `actions` is dropped silently. Both must fail loudly.
- `advance_month` abandons queued plans and reactions when it closes a turn. It must fail while anything is queued.
- After `faction_action`, `run_faction_turn` with `resume: true` automates nobody.
- `open_parallel_turn` with `unitIds` keeps the caller's order and treats every id as a faction.
- Only `npc` and `player` control exist; `chart`, `agent`, and `GM` do not.
- No tool marks a court, character, or hero as acting on its own, and non-faction units only record placeholder actions.
- A free-text `behavior` is accepted and then strands the turn open with `PICK_UNKNOWN`. Intent: the five behavior keys, checked at the tool boundary.
- `glorify` never writes its vanity fact.
- Aid ignores a target PC change.
- Only open, submit, apply, and reaction take the write lock. Intent: every mutation.
- The `unit-turn` prompt and the `world://campaigns/{id}/units/{unitId}/view` resource are not registered.
- `get_unit_view` works only for units in the open turn. A knowledge-filtered view of any unit is wanted.

**Changes, Influence, and Dominion**

- A PC feature change lands inside `commit_resources`, so a later `apply_outcome` for the same change adds the feature and its backlash twice.
- Hero Dominion cannot be spent on changes; only `create_champion` debits it.
- `wealthSpent` debits the hero's Influence pool instead of adding coverage bought with wealth.
- `record_deed` and `record_challenge_outcome` do not re-check activation; a further commit is needed.
- `commit_resources` returns only status and coverage, not the withdrawal assessment preview.
- `begin_change` cannot store resisters or deed and challenge overrides, and `quote_change` ignores place wards.
- Ward key holders cannot be set.

**Cults**

- `form_cult` adds a rolled feature and problem, prices intrinsic problems from Power 1, has no free-divinity guard, and misprices unknown harshness text.
- `set_theology` resets an omitted harshness to `nominal` and cannot edit intrinsic texts.

**Generation and setup**

- `seed_campaign` defaults an omitted behavior to `self_absorbed_survivor`. Intent: behavior is required unless the caller opts into random generation.
- An invalid `courtType` in `seed_campaign` drops the court silently.
- `create_faction` ignores `fill`.
- `ensure_setpiece` always uses "Local figure" for a character and supports a fact only with `fill: blank`.
- Generated problems never carry the resistance or external marks that goal strategies look for.
- `create_challenge` without `seed` always rolls the same text, and backlash always uses the first catalog row.
- No tool exposes generation `pick`.
- `create_character` with `courtId` does not add a court membership.
- Charts roll uniformly; optional `weight` is not read. The chart catalog is one file, and code still says `tables`.

**Visibility and errors**

- Build strength, attack, extend interest, and aid events default to `public`; enact change, restore cohesion, and remove interest record no event; `create_fact` cannot set the place a `local` fact needs.
- Rumors cover only faction actions and read "because unknown" for successful checks.
- Every unexpected error is reported as `ENTITY_NOT_FOUND`.
- There is no tool to list campaigns.
