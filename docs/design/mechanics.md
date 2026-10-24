# Mechanics

Running game rules. Engine shape (storage, the MCP surface, determinism, and the turn model) is in [current-engine.md](./current-engine.md). Update this page whenever a change alters a rule described here. Places where the code still misses living intent are listed in the overview under [Known engine gaps](./overview.md#known-engine-gaps).

## Cult theology

`set_theology` costs the cult 1 Power and its internal action. A Power 1 cult stops being a faction only when the call passes `acknowledgeDissolve: true`: the faction row is removed, the hero's divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain as public facts, and they do not pay cult Dominion. This is not a collapse. Without that flag the call returns `DISSOLVES_CULT`, writes nothing, and does not use the internal action. On Power greater than 1 the flag is ignored.

`form_cult` requires the Apotheosis gift *Receive the Incense of Faith*, gained at level 2, and `acknowledged: true`. Free divinity also requires `gmOverride: true`. Omitted harshness on that call stores `nominal`. The four harshness keys price intrinsic Problems from the cult's Power die and price cult Dominion as Power plus 0, 1, 2, or 3. Any other harshness string is refused. On Power greater than 1, `set_theology` keeps an omitted harshness, keeps an omitted feature sentence, and changes intrinsic Problem text only for the ids in `intrinsicTexts`.

A new cult is created at Power 1 with no rolled Feature and no rolled Problems. `form_cult` requires `behavior` for that create and stores it; it does not roll or default a behavior. Optional `control` is `npc` or `player` and defaults to `npc`. `directed` means the plan comes from outside the tables; `control` says who supplies it. `directed` with `control: player` is stored. `directed` with `control: npc` or with `control` omitted returns `DIRECTED_NPC` and writes nothing. The reply includes the stored `behavior` and `control`. Adopting a faction does not take `behavior` or `control` and does not change that pair. `form_cult` then inserts the caller's Feature. When harshness prices intrinsic points, it inserts one intrinsic Problem whose text is `lawText`. `nominal` inserts none. Adopting a faction keeps its Features and Problems and still adds that Feature and, when it has no holy law yet, that intrinsic Problem.

`form_cult` takes optional `homePlaceId`. It must name a place in the campaign. A new cult stores that place as `home_place_id`. An adopted faction keeps its stored home unless the call passes `homePlaceId`.

## Visibility and rumors

Facts carry `visibility`: `public` (visible with their subject), `local` (visible to units at the fact's place), `privileged` (the owner plus holders of `alliance`, `aid`, or any `spies`), or `hidden` (the owner plus spies at or above their own die maximum in points). A unit's rumors are the events it took part in plus public events at places it knows. `list_rumors` writes template sentences from the actions actually resolved in the latest turn, naming the real culprit of a failed check.
