# Setting up a Gardener world

## Prefer `seed_campaign`

Pass an outline with places and factions. The call returns `campaignId` and `seed` only.

Keep the `campaignId` and tell the user what it is. No tool lists campaigns, so a lost id cannot be recovered.

### Places

Each place: `key`, `name`, `scope` (`village`, `city`, `region`, `nation`, `realm`), optional `parentKey`, optional `cultureId`.

Always pass `scope`. Choose it from the fiction; never leave it to a default or to a roll.

## Facts

A **fact** is a basic truth about a subject in the world. Facts are never used in calculations by the rules layer, but defines the subject beyond its mechanical properties. They can be immutable characteristics, but also elements that could change over time.

### Examples

- **Place:**
  - "Strong sandstorms"
  - "Long nights"
- **Faction:**
  - "Sickly population"
  - "Cursed by a witch"
- **Character:**
  - "Captain of royal guard"
  - "Trusts no-one"
- **Court:**
  - "Value magical ability"
  - "Uniformly dressed in yellow"

### Factions

Each faction: `key`, `name`, `behavior`, optional `homePlaceKey`, optional `power` (1–5), optional `courtType`, optional `neighborKeys`.

`behavior` decides how an NPC faction chooses its goal each month. Pass one of these keys:

| `behavior` | Tends to |
| --- | --- |
| `despotic_tyrant` | Glorify itself, defeat rivals, crush resistance, expand its reach. |
| `self_absorbed_survivor` | Turtle: stockpile, fix its own problems, strike back only when hit. |
| `scheming_manipulator` | Build interest, attack covertly, act through proxies, grow hidden features. |
| `martial_conqueror` | Beat weaker neighbors, arm against the strongest, strip rivals' military. |
| `directed` | Never choose for itself; it acts only on plans the caller gives. Not for NPC factions. |

Free text is not a behavior. Leave `behavior` out only if the user asked for it to be random.

An explicit `power` always wins. Without one, Power follows the home place's scope (village 1, city 2, region 3, nation 4, realm 5), or 1 with no home.

There is **no** nature field on outline factions. Interest nature is rolled when edges are linked. Culture `nameLists` go on `create_campaign`, not on the seed outline.

### Interest linking

`linkInterests` defaults on when there are at least two factions.

A pair is linked if any of these holds:

- both homes have the same `parentKey`, which includes two top-level homes with no parent and two factions sharing one home;
- one home is the other's parent;
- either lists the other in `neighborKeys`.

With exactly two factions, they always link while `linkInterests` is on. With more than two, every other pair is skipped. A faction without `homePlaceKey` links only through `neighborKeys` or the two-faction rule.

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

- Caller text always wins. Generation fills only the fields you left out.
- Facts are never invented. A fact exists only because you stated it or a rule produced it.
- `blank` leaves unnamed placeholders, such as a court with no names. Name them later with `fit_blank`.
- Generated names come from the campaign's culture `nameLists`.

## After seed

1. Call `get_world_brief` and `interest_map` as sanity checks.
2. Recover place ids from `get_world_brief` (court `placeId`) or `get_faction` (`home_place_id`) before parenting `create_place`. `seed_campaign` does not return place ids.

## Adding entities after seed

| Tool | What it writes |
| --- | --- |
| `create_campaign` | An empty campaign, with optional `rngSeed` and culture `nameLists`. Optional `preset` (only `godbound`) and optional `flags` overlays. Fill it with the tools below. |
| `create_place` | A place under an optional parent. `wards` (ratings) is the only way to put mundus wards on a place. |
| `create_faction` | Faction sheet only. Features and problems are **rolled**; you cannot request “military” or “spy” features by name. **`interestsOut` / `interestsIn` stay empty.** `control: player` marks a faction the user steers. |
| `create_court` | Court on a place; `type` must be a catalog key. |
| `create_character` | An NPC. `courtId` makes it a member of that court; `factionId` ties it to a faction. |
| `create_hero` | A player hero with level, Words, Influence, Dominion, wealth, and `divinity` (`none`, `free`, or `cult`). |
| `create_fact` | Prose fact. **Does not** create interest edges. `visibility` is `public`, `local`, `privileged`, or `hidden`. |
| `set_interest` | Directed edge `fromFactionId` → `toFactionId` with required catalog `nature`. Default `points` is 1. Does not roll. Existing different nature fails unless `replaceNature: true`. |

`behavior` on a faction does not create interest rows.

### Other director tools

- `fit_blank`: names blank court or character rows left by `fill: blank`.
- `ensure_setpiece`: makes sure a court, challenge, character, fact, or problem face exists for a scene. Calling it again with the same `key` returns the same row.
- `form_cult`: binds a hero with `divinity: cult` to a cult faction, new or adopted (`adoptFactionId`). It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; harsher cults carry more intrinsic problems and pay more Dominion each month.
- `set_theology`: changes a cult's harshness or feature text. It costs the cult 1 Power and its internal action for the turn; a Power 1 cult collapses instead.
- `set_divinity`: switches a hero's divinity. The choice is normally fixed, so this needs `gmOverride: true`.
- `set_power`: sets a faction's Power (1–5) by fiat.
- `expand_change`: grows an active change. The same scope and magnitude costs nothing; a larger one pays the difference.
- `create_champion`: spends a flat 8 Dominion from a hero to create a champion of a given level (`loyal` halves the effective level).
- `record_shatter`: records how an already collapsed faction ended.

## Director overrides

`faction_action` accepts `forcedRoll`, `forcedAttackerRoll`, `forcedDefenderRoll`, `defenderChoice`, and `willing`. With `willing: true`, `extend_interest` succeeds with no contest. On a new edge the nature is still **rolled**, not chosen, so `willing` grows an existing edge but cannot pick a nature.

Use these only as a declared director act, never silently for a player's faction. Unit plans cannot carry them.

On `attack` and `extend_interest`, `marginal`, `attackerEdge`, and `defenderEdge` state the contest. A unit plan may carry them. Omit them and the contest is one die per side with no scale, quality, or supernatural bonus. Different domains do not set `marginal`. Stored size, quality, and magical marks are unread. A feature's stored `origin` still adds +1 (`improbable`) or +2 (`impossible`) when both sides have a feature. No setup tool writes a non-native feature origin.

## When the user wants a chosen interest nature

Call `set_interest` with `fromFactionId`, `toFactionId`, and a catalog `nature`. Default `points` is 1. It does not roll and does not need an open turn. A second call with a different nature fails unless `replaceNature: true`.

`create_fact` is not an edge. Use it for narrative color **only**, and warn that goals and turn logic keyed on interests will not see it.

Do **not** silently store mechanical claims only in facts when the user expected mechanics.

## What not to use for setup

- `extend_interest` — a faction action on a turn (`faction_action` opens one if needed). Adds one point on success, or with no contest under `willing: true`. If the edge is new, nature is **rolled**, starting at one point. Not a setup shortcut for “declare war.”
- `resolve_attack` — finishes a pending defender choice on an attack already in progress. It is not a battle by itself, and not a standing war relationship.
- `spend_interest` — spends points **already** on an edge during a contest.
