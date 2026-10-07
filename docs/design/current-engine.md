# Current engine

How the running server is shaped: storage, the MCP surface, determinism, and the turn model. Update this page whenever a change alters one of these. Places where the code still misses living intent are listed in the overview under [Known engine gaps](./overview.md#known-engine-gaps).

## Campaigns and the database file

A campaign is a row in `campaigns` plus every row keyed to it. The campaign row stores `preset` and the seven flags `profile`, `projectBase`, `opposition`, `wards`, `heldChanges`, `capabilityGate`, and `reachUnit`. `create_campaign` and `seed_campaign` default to the `godbound` preset. `get_world_brief` returns those flags in camelCase. One SQLite file can hold any number of campaigns; `create_campaign` and `seed_campaign` each add a row to the file that is open. Every tool call names its `campaignId`.

An outline place on `seed_campaign` requires `scope`: `village`, `city`, `region`, `nation`, or `realm`. Omitting it fails the call. `fill` does not supply a scope. The server does not default an omitted scope to `village` and does not roll one.

`remove-campaign` takes a `campaignId` and deletes that campaign row and every row associated with it. Other campaigns in the same file stay. The SQLite file is not deleted.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GARDENER_WORLD_DB` | `./data/campaign.sqlite` | The SQLite file this server process opens. |
| `GARDENER_LOCK_TIMEOUT_MS` | `10000` | How long a write waits for the lock before failing with `WRITE_LOCKED`. |

A relative path, including the default, resolves against the working directory of the process that launched the MCP server, which is usually the MCP client's. Use an absolute path when the file must stay in one place. The server creates the file but not its folder, so the folder must exist.

There is no tool that lists campaigns. The `campaignId` exists only in the reply from `seed_campaign` or `create_campaign`, and a lost id cannot be recovered through any current tool. A list tool is tracked on the Project.

## Identifiers

New row ids minted by the server are 8 lowercase hex characters from `newId()`. A stored id is an opaque string: a full UUID from an older file, or a caller-chosen id, still addresses its row. The server does not rewrite existing ids and does not reject a longer id. Eight hex characters are about 32 bits. A duplicate inside one table surfaces as a SQLite constraint error; the generator does not retry.

## Schema versioning

The file's SQLite `user_version` is its schema version.

## MCP surface

- **Resources:** `world://campaigns/{campaignId}/brief`, `…/factions/{factionId}`, `…/courts/{courtId}`, `…/turns/latest`, `…/hooks`, and `world://tables/{path}` (a subtree of the chart catalog).
- **Prompts:** `gm-briefing` and `faction-turn-narration`. Both are read-only and ask the model to narrate only what the embedded JSON says.

Every tool returns one envelope:

```json
{ "ok": true, "data": {}, "rolls": [], "advisories": [], "derived": {} }
{ "ok": false, "error": { "code": "…", "message": "…", "details": {} } }
```

- `rolls` holds only the rolls this call made.
- `advisories` are warnings that did not fail the call, such as a court size clamped into range.
- `derived` is the slice most relevant to the mutation. For a faction it is `trouble`, `collapseMargin` (die maximum minus Trouble; at 0 or below the faction collapses), and `status`. For a change it is its status, scope, and magnitude.

Common error codes: `CAMPAIGN_NOT_FOUND`, `ENTITY_NOT_FOUND`, `FILL_INCOMPLETE`, `PICK_UNKNOWN`, `TURN_ALREADY_OPEN`, `WRITE_LOCKED`, `UNKNOWN_TO_UNIT`, `QUEUE_CLOSED`, `QUEUE_NOT_EMPTY`, `NOT_PENDING`, `INTERNAL_BUDGET`, `EXTERNAL_BUDGET`, `DUPLICATE_EXTERNAL_TARGET`, `INTEREST_CAP`, `INTEREST_NATURE_MISMATCH`, `INTEREST_ALREADY_SPENT`, `MODIFIER_EXCEEDS_DIE`, `NO_USABLE_FEATURE`, `COLLAPSED_FACTION`, `COHESION_AT_CAP`, `INSUFFICIENT_DOMINION`, `INSUFFICIENT_INFLUENCE`, `INSUFFICIENT_WEALTH`, `CHANGE_NOT_READY`, `CHANGE_ALREADY_LANDED`, `NOTHING_TO_SOLVE`, `INTRINSIC_PROBLEM`, `MAGNITUDE_REJECTED`, and `NAME_TAKEN`.

## Determinism

Each campaign stores an `rng_seed` (the caller's `rngSeed` on `create_campaign`, otherwise random) and a `roll_counter`. A roll uses `rng_seed + roll_counter` and then increments the counter inside the same transaction, so the same calls in the same order give the same results. A create call that accepts `seed` uses it for that call's rolls only. Every roll is stored; `explain_roll` with a `rollId` returns its faces, kept value, bonus, total, target, and culprit.

## Turns, units, and the write queue

A campaign has at most one open turn.

- **Units.** An acting unit is a faction, court, character, or hero. Active NPC factions act by default. Courts, characters, and heroes act only when flagged to act on their own.
- **Control.** Today `control` is `npc` or `player`. A `player` faction is steered by the user and never automated. The intended model has four values: `player` (the only non-NPC value; the player dictates behavior), `chart` (goal charts roll the action), `agent` (a dedicated faction agent decides), and `GM` (the campaign-running agent decides, with adventure interest). Control may change between turns. An NPC faction should always carry a non-`directed` behavior; a `directed` faction idles unless it is given a plan.
- **Frozen views.** `open_parallel_turn` shuffles the acting units and stores one snapshot per unit. `get_unit_view` returns that snapshot: what one acting unit knows during the open turn, not a general read. Getting the same knowledge-filtered view for any unit outside the open turn's acting set is tracked on the Project.
- **Write queue.** `submit_unit_plan` queues or replaces a unit's plan. `apply_write_queue` applies plans in the shuffled order under the write lock, pauses when a player-controlled defender must choose, and `submit_reaction` resumes it. `run_faction_turn` is open, mechanical plans for units without one, and apply in one call.
- **Budgets.** One plan is one faction's actions for the turn: at most one internal action and up to Power external actions, at most one external action per target. `max_interest` may extend up to Power times.
- **Plan errors.** A caller-supplied plan that names an id absent from that unit's frozen view fails with `UNKNOWN_TO_UNIT` and is not queued. A failed replacement leaves the queued plan in place. `run_faction_turn` returns that error and does not apply the queue. A mechanical plan for a unit with no queued plan still becomes `idle` when it would name an id outside the view. `faction_action` does not use the frozen view.
- **`faction_action`.** Takes one action now. It opens a turn if none is open and enforces the same budgets. It accepts forced rolls, `defenderChoice`, and `willing` as declared director overrides. If that faction already has a plan queued on the open turn, the call returns `PLAN_ALREADY_QUEUED` and leaves that plan queued.
- **`advance_month`.** Moves the calendar and grants monthly Dominion. It may close an open turn that has nothing queued, such as a turn left open by `faction_action`. A queued plan or reaction on that turn returns `QUEUE_NOT_EMPTY` and leaves the turn open. Discarding queued work, if it is ever needed, would be a separate explicit action.
- **Lock.** Writes take a lock file beside the database (`<db path>.lock`); in-memory databases use an in-process mutex. A stale lock (older than 30 seconds, holder not running) is cleared. Intent is that every mutation takes the lock.

## Cult theology

`set_theology` costs the cult 1 Power and its internal action. A Power 1 cult stops being a faction: the faction row is removed, the hero's divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain as public facts, and they do not pay cult Dominion. This is not a collapse.

## Visibility and rumors

Facts carry `visibility`: `public` (visible with their subject), `local` (visible to units at the fact's place), `privileged` (the owner plus holders of `alliance`, `aid`, or any `spies`), or `hidden` (the owner plus spies at or above their own die maximum in points). A unit's rumors are the events it took part in plus public events at places it knows. `list_rumors` writes template sentences from the actions actually resolved in the latest turn, naming the real culprit of a failed check.
