# Faction creation & progression

## Settings

- **Commit:** 35054c4
- **Agent:** Grok 4.7
- **Script:** [faction-creation-progression](../play-scripts/faction-creation-progression.md)

## User requests

1. "/mcp-review Follow @test/play-scripts/faction-creation-progression.md"
2. "Create a new campaign with at least 2 factions."
3. "Pick two factions, A and B. Add two additional factions, C and D. C: In conflict with A. Name it after an animal. D: A mercantile faction. Secretly supplies both A and C with weapons."
4. "Set up the following: B used spies to learn that D is supplying both sides with weapons. B is now threatening D to reveal this to A to win favor."
5. "Advance the campaign by 4 months."
6. "Report what has happened since the campaign started."

## MCP calls

These are the MCP calls, in the order they ran.

> **User request 2**

1. **seed_campaign** — fill `missing`, place and faction names omitted. Failed: `-32602` required `name`, `outline.places[0].name`, and both faction names.
2. **seed_campaign** — campaign "Campaign", place "Home" (scope omitted), factions "A" and "B", behavior and power omitted. Created `9adb9772-90d2-4d2c-b330-73d48a0d4bae`, seed `3023085582`.
3. **get_world_brief** — month 1. A `012a1cdc-a8c4-455a-b9a1-e1c7a7b96b5e` and B `9b93fecf-0e66-486a-bcd5-2b30ebff7e12`, both Power 1, Trouble 2, cohesion 1, collapse margin 4. No courts.
4. **interest_map** — A↔B rivalry, 6 points each way.

> **User request 3**

5. **get_faction** — A is `self_absorbed_survivor` at home `0a240a72-cd6b-4e17-b883-0b5290942bfa`.
6. **create_faction** — name "Wolf", power and behavior omitted. Failed: `-32602` required `power` and `behavior`.
7. **create_faction** — Wolf, Power 1, `self_absorbed_survivor`, same home. Created `71b42c1d-12a6-4984-bfd1-541eff2543ab`.
8. **create_faction** — "D", same power, behavior, and home. Created `d91fafbd-5e0e-4af3-ae72-917e90acac58`.
9. **set_interest** — Wolf→A rivalry, 1 point.
10. **set_interest** — A→Wolf rivalry, 1 point.
11. **set_interest** — D→A trade, 1 point.
12. **set_interest** — D→Wolf trade, 1 point.
13. **create_court** — business court for D at the shared home. Created `073b4501-11a6-4374-b8e9-686f4e24388e`.
14. **create_fact** — hidden fact on D: secretly supplies A and Wolf with weapons. Created `3983ae73-7963-4d27-80c4-7588b59f57a5`.

> **User request 4**

15. **set_interest** — B→D spies, 6 points.
16. **create_fact** — hidden fact on D: B is threatening to reveal the supply to A in exchange for favor. Created `56a3e60e-5983-4e02-bb73-75d5f7565f4a`.

> **User request 5**

17. **run_faction_turn** — `advanceMonth: true`. Order D, A, B, Wolf. No action list. Rumors for this month were not read.
18. **run_faction_turn** — `advanceMonth: true`. Order B, D, A, Wolf.
19. **list_rumors** — B enact_change failed (unknown); D build_strength failed (tedious custom); A build_strength failed (people angry about a change); Wolf enact_change succeeded (unknown).
20. **run_faction_turn** — `advanceMonth: true`. Order B, A, Wolf, D.
21. **list_rumors** — B enact_change failed (unknown); A attacked Wolf and lost; Wolf enact_change succeeded (unknown); D attacked B and won.
22. **run_faction_turn** — `advanceMonth: true`. Order A, B, Wolf, D.
23. **list_rumors** — A build_strength succeeded; B, Wolf, and D failed to build strength (embezzling noble, people angry about a change, tedious custom).

> **User request 6**

24. **get_world_brief** — month 5. A and B Trouble 3, margin 3. Wolf and D Trouble 2, margin 4. All cohesion 1. One business court.
25. **interest_map** — same edges as setup. Nothing grew or was spent.
26. **get_faction** — A gained "Mercenaries loyal to the ruler's coin" and "People who lost by the change are angry and organizing". Dominion 1.
27. **get_faction** — B has a religious-service feature, a 2-point religious problem, and a 1-point embezzling problem. Dominion 0. Spies on D still 6.
28. **get_faction** — Wolf has custom-confidence and mercenaries features, plus reluctant-elite and change-backlash problems. Dominion 0.
29. **get_faction** — D has the exiles feature and a 2-point tedious-custom problem. Dominion 0. Facts are not on the sheet.
30. **list_hooks** — eight problems. No challenges, decaying changes, blank courts, court consequences, or near-collapse.

## How I reached that conclusion

The director manual prefers `seed_campaign` for a new campaign and `set_interest` for a chosen nature. Conflict became rivalry both ways. Selling weapons to both sides became trade from D, with a hidden fact for the secrecy, because an edge has no secrecy field. "Mercantile" became a `business` court because the manual says that adjective is not a court type. Spy points were set to 6, B's die maximum, after the player manual's spy table did not say when a hidden fact is visible.

`advance_month` only moves the calendar. Four `run_faction_turn` calls with `advanceMonth: true` were used so the later report would have events. `list_rumors` was called after each later turn because its description says it returns the latest closed turn only.

## What I tried that did not work

| Attempt | Why it failed |
|---|---|
| Seed a campaign and two factions with names omitted, so the MCP would generate them | `seed_campaign` requires the campaign name, the place name, and each faction name |
| Create Wolf with power and behavior omitted | `create_faction` requires both; seed would have defaulted them |
| Report the first of the four months | `list_rumors` had already been replaced by the second month |

## Errors

- **seed_campaign** — `-32602` Input validation error: Required at `name`, `outline.places[0].name`, `outline.factions[0].name`, `outline.factions[1].name`. Arguments: `fill: missing`, place key `home`, faction keys `a` and `b`, no names.
- **create_faction** — `-32602` Input validation error: Required at `power`, Required at `behavior`. Arguments: campaign `9adb9772-90d2-4d2c-b330-73d48a0d4bae`, name `Wolf`, `fill: missing`.

## What could change in the MCP

- `seed_campaign` and `create_faction` could generate a campaign name, place name, and faction name when `fill` is `missing` or `blank`. `fit_blank` only names courts and characters.
- `create_faction` could omit `power` and `behavior` the way seed does (scope-based power, default behavior).
- An interest edge has no way to say the tie is a secret weapons supply. Trade plus a hidden fact was the split.
- Nothing records a blackmail threat or a pending reveal. The threat is a fact, and turn goals do not see facts.
- `run_faction_turn` returns the faction order and no actions, rolls, or losses.
- `list_rumors` keeps only the latest closed turn, so a multi-month report has to query between every turn.
- `get_faction` does not include facts, so the supply and the threat cannot be confirmed from the faction sheet.

## What could change in skill files and tool descriptions

- The player manual's spy table says 1 point reveals features and problems, and die-max spies reveal the ruling court. A hidden fact on a faction is visible to a spy only at points greater than or equal to the viewer's die maximum. That rule is in `src/rules/knowledge.ts`, not in the manual or the `set_interest` description.
- `advance_month`'s description does not say that the calendar moves without faction actions. The player manual lists the tools separately and does not say that "advance N months" means N `run_faction_turn` calls with `advanceMonth`.
- `list_rumors` says it is the latest closed turn. The play manual does not say to call it after every month or the earlier months are gone.
- The director manual says generation fills omitted fields. It does not say faction, place, and campaign names are never generated, or that `create_faction` still requires `power` and `behavior` when the caller wanted them rolled.
