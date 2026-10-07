# Hero cult creation

## Settings

- **Commit:** 2c6dd0e
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

1. **listTools / listResourceTemplates / listPrompts** — Cursor had no `gardener` MCP namespace. Stdio client against `dist/server.js` with a temp `GARDENER_WORLD_DB` listed 50 tools, resource templates `world://campaigns/{campaignId}/…` and `world://tables/{path}`, prompts `gm-briefing` and `faction-turn-narration`. `listResources` was empty. `FetchMcpResource` server `gardener` failed: server not found.

> **User request 2**

2. **seed_campaign** — name "Hero Cult Playtest", `seed: 21`, `preset: godbound`, village Ash Vale, faction Ash Vale Folk `self_absorbed_survivor`. Created campaign `81c4ad13`.
3. **get_world_brief** — month 1, Folk Power 1 Trouble 2, no courts, no heroes.
4. **interest_map** — empty (one faction).
5. **create_hero** — Lira level 1, divinity omitted. Created `1fd12693`. Return was only `heroId`.
6. **form_cult** — acknowledged, grueling, feature "Burn the winter from the fields". **Succeeded** (`factionId` `ed1ed1f6`). Expected refusal.
7. **set_divinity** — `cult` without `gmOverride`. Succeeded.
8. **create_hero** — level 1, `divinity: cult`. Succeeded (`5a186644`).
9. **get_faction** — cult Power 1, Trouble 5, `home_place_id` null, rolled legitimacy feature plus the chosen feature, rolled 2-point problem plus 3-point **intrinsic** whose text duplicated the feature (not labeled holy law).
10. **get_unit_view** — hero. Failed: `ENTITY_NOT_FOUND` "no open turn".
11. **remove-campaign** — cleared the polluted campaign so later steps could run.

> **User request 3**

12. **seed_campaign** — same outline, campaign `a48ef90d`.
13. **create_hero** — Lira level 2, `divinity: free`. Created `54f03950`.
14. **form_cult** — acknowledged, nominal, "Open worship of the sun". **Succeeded** (`8a9348c3`). `cult_income` then showed divinity `cult`, grant 1 (same number free divinity would pay at level 2).
15. **advance_month** — month 2. Hero Dominion became 1 (seen only via SQLite; no hero read tool). A cult faction existed.
16. **readResource** `world://tables/{cults,harshness,divinity,words,godbound,gifts,catalog}` — each `PICK_UNKNOWN`.
17. **remove-campaign** — reset again.

> **User request 4**

18. **seed_campaign** — campaign `56afb958`.
19. **create_hero** — Lira level 2, `divinity: free`. Created `a1a2c16d`.
20. **set_divinity** — `cult` without `gmOverride`. **Succeeded** (choice was not locked).
21. **set_divinity** — `cult` with `gmOverride: true`. Succeeded.
22. **form_cult** — grueling, no `acknowledged`. Failed `FILL_INCOMPLETE` "acknowledged worshippers required".
23. **form_cult** — name Ashfire Cult, feature "Winter must never return to the Vale", grueling, `acknowledged: true`. Created `d413fcd5`. Again rolled an extra feature and a non-intrinsic problem; chosen feature present; 3-point intrinsic copies the feature text; `home_place_id` null.
24. **cult_income** — grant **3** (Power 1 + 2). Matches the script.
25. **apply_outcome** — reduce intrinsic `60153310` by 1. Failed `INTRINSIC_PROBLEM`.
26. **apply_outcome** — reduce the rolled non-intrinsic. Succeeded, 1 point left.
27. **faction_action** — `build_strength` on the cult. Failed the check (culprit the intrinsic). Spent the internal action.

> **User request 5**

28. **set_theology** — feature text only, same month. Failed `INTERNAL_BUDGET`.
29. **advance_month** — month 2. Hero Dominion 3.
30. **set_power** — cult to Power 2 (otherwise Power 1 theology would end the faction, and the script wanted to observe a 1-Power loss). Succeeded; intrinsic points moved 3 → 4.
31. **set_theology** — new `featureText`, **harshness omitted**. Succeeded; Power 2 → 1. Intrinsic holy-law problem **deleted**. Rolled feature text replaced by the new sentence; chosen feature remained. `cult_income` grant fell to 1 (nominal extra).
32. **apply_outcome** — reduce former intrinsic id. Failed `ENTITY_NOT_FOUND` "problem not found".

> **User request 6**

33. **quote_change** — `kind: champion`, village impossible. Quoted 4; not the 8 Dominion flat cost.
34. **create_champion** — level 2, 3 Dominion. Failed `INSUFFICIENT_DOMINION` "champion costs 8 dominion".
35. **advance_month** ×5 — Dominion 8.
36. **create_champion** — level 2, not loyal (peer of the creator). **Succeeded**, cost 8, `effectiveLevel` 2, **hitDice 9**. Not refused as "another Godbound".
37. **advance_month** ×8 — Dominion 8 again.
38. **create_champion** — `loyal: true`, level 1. Succeeded, cost 8, `effectiveLevel` 1 (half of 2, rounded up), **hitDice 7** (not HD 2 + 1).
39. **create_hero** — second hero Kael level 2. Succeeded. No tool takes that id as a champion empower target.

> **User request 7**

40. **quote_change** — village impossible `creature_population`. Total 4.
41. **begin_change** — births gift as `featureText`. Pending `fd638546`.
42. **begin_change** — descendant cap; extra `limit` / `inheritance` keys. Pending `37a2f1fb`; extras dropped (changes table has no such columns).
43. **create_fact** — `subjectType`/`subjectId`. MCP `-32602` (field is `subject`).
44. **create_fact** — births on place `970c0e9a`. Created `5059752e`.
45. **create_fact** — descendant cap on the same place. Created `56ec3fcd`.
46. **commit_resources** — 3 Influence on the births change. Still `pending` (quote 4).

## How I reached that conclusion

Director skill: `seed_campaign`, `create_hero`, `form_cult` (`acknowledged`, harshness), `set_divinity` (`gmOverride`), `set_theology`, `create_champion`, `set_power`. Player skill: `apply_outcome` cannot shrink intrinsic problems; `advance_month` accrues cult Dominion; `cult_income` is the monthly grant. Tool descriptions were enough to name those calls, not enough to know level gates, free-divinity refusal, HD caps, or heritable-gift limits.

`form_cult` and `set_divinity` descriptions do not mention level 2 or a lock on free worship. `create_champion` says "Spend dominion to create a champion" and takes `level` + `loyal`; it does not refuse a creator-level champion or cap HD at 2 + half level. No tool or `begin_change` field records births vs descendant-cap inheritance.

There is no `get_hero` (or hero resource). `get_world_brief` omits heroes. `get_unit_view` needs an open turn. Dominion on the hero was confirmed with SQLite after MCP reads failed. Catalog URIs need an already-known table path; guessed cult/gift paths failed.

Campaigns were removed and reseeded after steps 2 and 3 because the expected refusals did not happen and leftover cults would have blocked the later script.

## What I tried that did not work

| Attempt | Why it failed |
|---|---|
| Cursor MCP `gardener` / `FetchMcpResource` | Server not in this session; used Stdio client instead |
| Level 1 `form_cult` | Call succeeded; no level gate |
| Level 2 `divinity: free` then `form_cult` | Call succeeded and flipped divinity to `cult` |
| `get_unit_view` on the hero | `ENTITY_NOT_FOUND` no open turn; no other hero read |
| `world://tables/cults` (and similar) | `PICK_UNKNOWN`; template does not list keys |
| `set_divinity` without `gmOverride` to prove the choice is fixed | Succeeded |
| `set_theology` in the same month as `faction_action` | `INTERNAL_BUDGET` |
| Omit `harshness` on `set_theology` to keep holy laws | Intrinsic problem removed; grant fell to Power+0 |
| Reduce the intrinsic after that | Problem id gone |
| `create_champion` at the creator's level as "another Godbound" | Succeeded (HD 9) |
| Extra `limit`/`inheritance` on `begin_change` | Schema stripped them; nothing to "stick" |
| `create_fact` with `subjectType` | `-32602`; argument is `subject` |
| Commit 3 Influence into a cost-4 Impossible change | Stayed pending; no Dominion spend on `commit_resources` |
| Read hero Dominion from MCP | No tool; SQLite showed the field |

## Errors

- **get_unit_view** — `ENTITY_NOT_FOUND` "no open turn". `unitType: hero`, `unitId` `1fd12693`.
- **form_cult** — `FILL_INCOMPLETE` "acknowledged worshippers required". Grueling, no `acknowledged`.
- **apply_outcome** — `INTRINSIC_PROBLEM` "cannot reduce an intrinsic problem". `reduceProblemId` `60153310`.
- **set_theology** — `INTERNAL_BUDGET` "internal action already taken" after `faction_action`.
- **apply_outcome** — `ENTITY_NOT_FOUND` "problem not found" after theology deleted the intrinsic.
- **create_champion** — `INSUFFICIENT_DOMINION` "champion costs 8 dominion" at 3 Dominion.
- **create_fact** — MCP `-32602` invalid arguments: `subjectType` is not `subject`.
- **readResource** `world://tables/cults` (and other guessed paths) — `PICK_UNKNOWN`.
- **readResource** `world://tables/` — `-32602` resource not found.

Expected refusals that returned **ok: true** (not MCP errors): level 1 `form_cult`; free-divinity `form_cult`; `set_divinity` without `gmOverride`; `create_champion` at the creator's level.

## What could change in the MCP

- `form_cult` should refuse below level 2 and refuse `divinity: free` (open worship).
- `create_hero` / `set_divinity` should refuse `divinity: cult` below level 2. `set_divinity` should require `gmOverride` once a track is chosen.
- `get_hero` (or a `world://…/heroes/{id}` resource) so Dominion, level, divinity, and `cult_faction_id` are readable without an open turn or SQLite.
- `form_cult` should not roll an extra native feature and non-intrinsic problem when the caller already supplied the Feature. Bind `home_place_id` to the worshipers' village. Name intrinsic problems as holy laws, not a copy of the Feature text.
- `set_theology` with omitted `harshness` should keep current laws; it currently drops the intrinsic problem and resets extra Dominion to 0.
- `create_champion` should refuse empowering another Godbound. Loyal stats should use half the creator's level (rounded up). Mortal HD should stop at 2 + half that level. Return should match that math (observed HD 9 / 7).
- Inheritance limits (area births vs descendant cap) need fields and a rule for which limit sticks. `begin_change` `creature_population` and `create_fact` only store prose.
- `commit_resources` cannot spend Dominion; Impossible village cost 4 could not be finished from Influence 3.
- `cult_income` is a projected grant, not the hero's current Dominion.
- Catalog resource should list valid `{path}` values.
- `quote_change` `kind: champion` quotes a change cost (4), which is not `create_champion`'s flat 8.

## What could change in skill files and tool descriptions

- `form_cult` / `create_hero` / `set_divinity` descriptions do not mention the level-2 gift or that free divinity cannot found a cult.
- Director `set_divinity` says the choice is normally fixed and needs `gmOverride`; the server accepted the change without it.
- Director `form_cult` says a village of willing worshippers; the only mechanical field is `acknowledged: true`, and the cult has no home place.
- Director says harsher cults carry more intrinsic problems; the playtest also received a rolled Feature and a non-intrinsic Problem. `set_theology` says it costs 1 Power; it does not say omitted `harshness` clears laws.
- `create_champion` does not describe the Godbound refusal, the 8 Dominion flat cost vs `quote_change`, loyal half-level, or the mortal HD cap.
- No skill mentions heritable Impossible gifts, births-in-area vs descendant cap, or how to see which limit stuck.
- No skill says there is no hero query, or that `get_unit_view` is the only hero read and only during an open turn.
- `world://tables/{path}` does not tell the caller which paths exist.

## Notes

- Script outcome: **gaps on every step that expected a refusal or an inheritance limit**. Grueling Dominion (Power+2), acknowledged worshippers, intrinsic reduce-block, theology Power loss, and loyal `effectiveLevel` matched.
- Final campaign `56afb958` (temp DB). Hero `a1a2c16d`. Cult `d413fcd5` ended Power 1 with no intrinsic laws after omitted-harshness theology.
- Neither heritable limit stuck: both are facts/pending changes with no inheritance mechanic.
