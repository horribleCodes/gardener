# Setting up a Gardener world

Use this before generating or expanding a campaign. For month cadence and play, read [mcp_guide.md](./mcp_guide.md). For the tool index, read [mcp_tools.md](./mcp_tools.md).

## Prefer `seed_campaign`

Pass an outline with places and factions. The call returns `campaignId` and `seed` only.

### Places

Each place: `key`, `name`, optional `scope` (`village`, `city`, `region`, `nation`, `realm`), optional `parentKey`, optional `cultureId`.

### Factions

Each faction: `key`, `name`, optional `homePlaceKey`, optional `power` (1–5), optional `behavior`, optional `courtType`, optional `neighborKeys`.

There is **no** nature field on outline factions. Interest nature is rolled when edges are linked.

### Interest linking

`linkInterests` defaults on when there are at least two factions.

A pair is linked if:

- they share a parent place in the outline, **or**
- either lists the other in `neighborKeys`.

With only two factions, they link even without neighbors. With more than two, pairs that are neither neighbors nor co-located under a parent are skipped.

For each linked pair, both directions get a row. Nature is **rolled** once and applied to both directions. Starting points on each direction are the owner’s power die:

| Power | Starting points | Cap (twice die) |
| --- | --- | --- |
| 1 | 6 | 12 |
| 2 | 8 | 16 |
| 3 | 10 | 20 |
| 4 | 12 | 24 |
| 5 | 20 | 40 |

No self-edges.

### Ruling courts

`rulingCourts: true` adds a court per faction at its home place. `courtType` must be a catalog key:

`aristocratic`, `bureaucratic`, `business`, `community`, `criminal`, `temple`

Not a free-text adjective like “mercantile.”

### Fill modes

`fill` is `require`, `missing`, or `blank`. Default is `missing`. The same modes apply across generation tools (`create_faction`, `create_court`, `create_fact`, and others).

## After seed

1. Call `get_world_brief` and `interest_map` as sanity checks.
2. Recover place ids from `get_world_brief` (court `placeId`) or `get_faction` (`home_place_id`) before parenting `create_place`. `seed_campaign` does not return place ids.

## Adding entities after seed

| Tool | What it writes |
| --- | --- |
| `create_place` | A place under an optional parent. |
| `create_faction` | Faction sheet only. Features and problems are **rolled**; you cannot request “military” or “spy” features by name. **`interestsOut` / `interestsIn` stay empty.** |
| `create_court` | Court on a place; `type` must be a catalog key. |
| `create_character` / `create_hero` | NPC or player hero. |
| `create_fact` | Prose fact. **Does not** create interest edges. |

`behavior` on a faction does not create interest rows.

## When the user wants a chosen interest nature

There is **no** post-seed tool that creates an interest edge with a chosen nature. Say so plainly.

Honest alternatives:

1. Adjust the `seed_campaign` outline **before** seeding (use `neighborKeys` so pairs link). Nature is still **rolled**, not chosen.
2. Use `create_fact` for narrative color **only**, and warn that goals and turn logic keyed on interests will not see it.

Do **not** silently store mechanical claims only in facts when the user expected mechanics.

## What not to use for setup

- `extend_interest` — domain contest on an open turn. Adds one point on success; if the edge is new, nature is **rolled**, starting at one point. Not a setup shortcut for “declare war.”
- `resolve_attack` — one battle. Not a standing war relationship.
- `spend_interest` — spends points **already** on an edge during a contest.
