# Hero cult creation

## Settings

- **Commit:** df4a1dc
- **Agent:** Grok 4.6
- **Script:** [hero-cult-creation](../play-scripts/hero-cult-creation.md)

## User requests

1. Run an MCP playtest of Gardener with the hero and the cult (script `test/play-scripts/hero-cult-creation.md`).
2. A level 1 hero tries to form a cult. Expect a refusal, because the gift comes at level 2.
3. At level 2 the hero chooses free divinity. Open worship still cannot form a cult. After a month the hero gains 1 Dominion and there is no cult.
4. The GM allows them to leave that choice. Form a cult with a village of willing worshipers, one chosen Feature, and grueling laws. The holy-law Problems cannot be lessened. Monthly Dominion is Power plus 2.
5. Change the theology. The cult loses 1 Power. Leaving harshness out does not rewrite the laws, and editing an intrinsic Problem fails.
6. Empowering another Godbound is refused. One loyal individual costs 8 Dominion, with stats off half the creator's level, rounded up. Ordinary mortals stop at HD 2 plus half the level, rounded up.
7. Record one heritable Impossible gift as births in this area, and another as a descendant cap. Report which limit stuck.

## MCP calls

These are the MCP calls, in the order they ran.

> **User request 1**

1. **listTools / listResources / listResourceTemplates / listPrompts** — Cursor had no `gardener` MCP namespace. Stdio client against `dist/server.js` with a temp `GARDENER_WORLD_DB` listed 53 tools (including `get_hero`, `list_catalog_tables`), listed catalog table resources, templates `world://campaigns/{campaignId}/…` (including `/heroes/{heroId}`) and `world://tables/{path}`, prompts `gm-briefing` and `faction-turn-narration`.

> **User request 2**

2. **seed_campaign** — name "Hero Cult Playtest", `seed: 21`, `preset: godbound`, village Ash Vale, faction Ash Vale Folk `self_absorbed_survivor`. Created campaign `7e4d569c`.
3. **get_world_brief** — month 1, Folk Power 1 Trouble 2, heroes empty.
4. **interest_map** — empty (one faction).
5. **get_faction** — Folk `48e09241`, `home_place_id` `97543b48`.
6. **create_hero** — Lira level 1, divinity omitted. Created `4bf0ee8c`.
7. **get_hero** — level 1, divinity `none`, dominion 0, no cult.
8. **form_cult** — acknowledged, grueling, law text, home place. Failed `LEVEL_TOO_LOW` "cult requires level 2".

> **User request 3**

9. **create_hero** — Lira level 2, `divinity: free`. Created `98ee1319` (no level-up tool on the first hero).
10. **form_cult** — acknowledged, nominal, open worship. Failed `FREE_DIVINITY` "gmOverride required to leave free divinity".
11. **cult_income** — grant 1 for the free-divinity hero.
12. **advance_month** — month 2.
13. **get_hero** — dominion 1, divinity `free`, `cult_faction_id` null.
14. **get_world_brief** — still only Ash Vale Folk; no cult faction.

> **User request 4**

15. **set_divinity** — `cult` without `gmOverride`. **Succeeded**.
16. **set_divinity** — `cult` with `gmOverride: true`. Succeeded (already `cult`).
17. **form_cult** — grueling, no `acknowledged`. Failed `FILL_INCOMPLETE` "acknowledged worshippers required".
18. **form_cult** — name Ashfire Cult, chosen Feature, grueling law, `acknowledged: true`, `homePlaceId` village. Created `25dce65a`.
19. **get_faction** — Power 1, one Feature (the chosen text), one 3-point **intrinsic** (the law text), `home_place_id` `97543b48`. No extra rolled Feature or non-intrinsic Problem.
20. **get_hero** — divinity `cult`, `cult_faction_id` `25dce65a`.
21. **cult_income** — grant **3** (Power 1 + 2).
22. **apply_outcome** — reduce intrinsic `33f6968c` by 1. Failed `INTRINSIC_PROBLEM`.
23. **advance_month** — month 3. Hero Dominion 4 (1 + 3).

> **User request 5**

24. **set_power** — cult to Power 2 (Power 1 theology would stop being a faction).
25. **set_theology** — `intrinsicTexts` rewrite of the holy-law Problem. **Succeeded**; Power 2 → 1; text changed; 3-point intrinsic remained.
26. **set_theology** — `featureText` only, same month. Failed `INTERNAL_BUDGET`.
27. **advance_month** — month 4. **set_power** to 2 again.
28. **set_theology** — new `featureText`, **harshness omitted**. Succeeded; Power 2 → 1. Intrinsic holy-law Problem **kept** (3 points). Feature text updated. `cult_income` grant still 3.

> **User request 6**

29. **quote_change** — `kind: champion`, village impossible. Quoted 4; not the 8 Dominion flat cost.
30. **create_champion** — level 2, 7 Dominion. Failed `INSUFFICIENT_DOMINION` "champion costs 8 dominion".
31. **advance_month** — month 5. Dominion 10.
32. **create_champion** — level 2, not loyal. **Succeeded**, cost 8, `effectiveLevel` 2, **hitDice 9**. Not refused as another Godbound.
33. **create_hero** — Kael level 2. No tool takes that id as a champion empower target.
34. **advance_month** ×2 — Dominion 8.
35. **create_champion** — `loyal: true`, level 1. Succeeded, cost 8, `effectiveLevel` 1 (half of 2, rounded up), **hitDice 7** (not HD 2 + 1).

> **User request 7**

36. **quote_change** — village impossible `creature_population`. Total 4.
37. **begin_change** — births gift as `featureText`. Pending `a791c5d5`.
38. **begin_change** — descendant cap; extra `limit` / `inheritance` keys. Pending `96964544`; extras not stored (`changes` has no such columns).
39. **create_fact** — `subjectType`. MCP `-32602` (field is `subject`).
40. **create_fact** — births on place `97543b48`. Created `85ccede7`.
41. **create_fact** — descendant cap on the same place. Created `c5cf4c91`.
42. **commit_resources** — 4 Dominion on births. `active`.
43. **commit_resources** — 3 Influence + 1 Dominion on the cap. `active`.
44. **get_world_brief** / **readResource** hero URI / `world://tables` — both changes remain active; hero resource matches `get_hero`; catalog URIs listed, no gifts/cults tables.

## How I reached that conclusion

Director skill: `seed_campaign`, `create_hero`, `form_cult` (`acknowledged`, harshness, law, home place), `set_divinity` (`gmOverride`), `set_theology`, `create_champion`, `set_power`. Player skill: `apply_outcome` cannot shrink intrinsic problems; `advance_month` accrues cult Dominion; `cult_income` is the monthly grant. Tool descriptions named the calls. `get_hero` and the hero resource covered Dominion without SQLite.

`form_cult` description now states level 2 and free-divinity `gmOverride`. `set_divinity` description does not say the track is locked. `create_champion` still does not refuse a creator-level champion or cap mortal HD at 2 + half level. No tool records births vs descendant-cap inheritance.

Power 1 `set_theology` would dissolve the faction, so `set_power` was used before observing a 1-Power loss. There is no hero level-up tool, so step 3 used a second hero.

## What I tried that did not work

| Attempt | Why it failed |
|---|---|
| Cursor MCP `gardener` | Server not in this session; used stdio client instead |
| Level-up the same L1 hero | No tool; created a second L2 hero |
| `set_divinity` without `gmOverride` to prove the choice is fixed | Succeeded |
| `set_theology` in the same month as a prior theology | `INTERNAL_BUDGET` |
| `set_theology` `intrinsicTexts` as a failed edit | Succeeded (text rewrite; points unchanged) |
| `create_champion` at the creator's level as "another Godbound" | Succeeded (HD 9) |
| Extra `limit`/`inheritance` on `begin_change` | Not persisted; nothing to "stick" |
| `create_fact` with `subjectType` | `-32602`; argument is `subject` |
| Mortal HD 2 + half level | Loyal champion returned HD 7 |

## Errors

- **form_cult** — `LEVEL_TOO_LOW` "cult requires level 2". Level 1 hero `4bf0ee8c`.
- **form_cult** — `FREE_DIVINITY` "gmOverride required to leave free divinity". Level 2 `divinity: free`.
- **form_cult** — `FILL_INCOMPLETE` "acknowledged worshippers required". Grueling, no `acknowledged`.
- **apply_outcome** — `INTRINSIC_PROBLEM` "cannot reduce an intrinsic problem". `reduceProblemId` `33f6968c`.
- **set_theology** — `INTERNAL_BUDGET` "internal action already taken".
- **create_champion** — `INSUFFICIENT_DOMINION` "champion costs 8 dominion" at 7 Dominion.
- **create_fact** — MCP `-32602` invalid arguments: `subjectType` is not `subject`.

Expected refusals that returned **ok: true**: `set_divinity` without `gmOverride`; `create_champion` at the creator's level.

## What could change in the MCP

- `set_divinity` should require `gmOverride` once a track is chosen (director skill already says this; the server does not).
- `create_champion` should refuse empowering another Godbound. Loyal stats should use half the creator's level (rounded up) — `effectiveLevel` already did. Mortal HD should stop at 2 + half that level (observed HD 9 / 7).
- Inheritance limits (area births vs descendant cap) need fields and a rule for which limit sticks. `begin_change` `creature_population` and `create_fact` only store prose; both changes can be `active` at once.
- `quote_change` `kind: champion` quotes a change cost (4), which is not `create_champion`'s flat 8.
- A level-up (or set-level) tool would let a script keep one hero across the L1 refusal and the L2 gift.

## What could change in skill files and tool descriptions

- Director `set_divinity` says the choice is normally fixed and needs `gmOverride`; the server accepted the change without it.
- `set_theology` documents `intrinsicTexts`; the play script's "editing an intrinsic Problem fails" only matches `apply_outcome` reduce, not a theology text rewrite. Skills should say which edit is blocked.
- `create_champion` does not describe the Godbound refusal, the 8 Dominion flat cost vs `quote_change`, loyal half-level, or the mortal HD cap.
- No skill mentions heritable Impossible gifts, births-in-area vs descendant cap, or how to see which limit stuck.
- `create_fact` argument is `subject`, not `subjectType`.

## Notes

- Script outcome: **level-2 gate, free-divinity refusal, acknowledged worshippers, single chosen Feature, village home, grueling Power+2 Dominion, intrinsic reduce-block, omitted-harshness keeps laws, theology Power loss, and loyal `effectiveLevel` matched.** Gaps remaining: `set_divinity` without override, creator-level champion, mortal HD cap, and heritable inheritance limits.
- Campaign `7e4d569c` (temp DB). Hero `98ee1319`. Cult `25dce65a` ended Power 1 with a 3-point intrinsic (text rewritten once via `intrinsicTexts`).
- Neither heritable limit stuck: both are facts plus `active` `creature_population` changes with no inheritance mechanic.
