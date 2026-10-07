# Cult formation gates and harshness pricing

> Status: design for issue #102. Not implemented on this branch. Living docs to update at implementation time: [`docs/design/glossary.md`](../../../docs/design/glossary.md), [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

`form_cult` accepts a level 1 hero, accepts free divinity, prices every unrecognized harshness string as overwhelming Problems and as nominal income, and prices an adopted cult's holy laws from the Power 1 die. `set_theology` stores an omitted harshness as `nominal`, which deletes holy laws, and it has no way to edit an intrinsic Problem's text.

Issue #102 already decided the product shape:

- `form_cult` refuses free divinity unless the call passes an explicit override the rules allow.
- Incense of Faith and level 2 are required.
- Harshness keys that are mispriced or unrecognized are corrected.
- A `set_theology` edit of harshness or intrinsic text must not silently reset other theology state.
- The Power 1 end state already landed. This issue does not collapse a cult or clear its faction link.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec: where Incense of Faith is stored, which argument is the free-divinity override, and what "does not silently reset" means for an omitted field.

## Approaches

**A. Store Incense of Faith as a Word label. Reuse `gmOverride` on `form_cult`. Keep an omitted theology field. Recommended.**

`heroes.words` is already a JSON array of strings, written by `create_hero`. `form_cult` requires level 2 or higher and the exact string `Incense of Faith` in that array. Free divinity is refused unless this call passes `gmOverride: true`, the same flag `set_divinity` already uses for a divinity exception. That flag does not waive level or the Word. An omitted `harshness` on `set_theology` leaves the column as stored. An omitted feature sentence leaves features as stored. Intrinsic text changes only the Problems named in the call.

**B. Treat level 2 as Incense of Faith, with no stored label.**

The issue names both gates. A level 2 hero who never took the Word would still form a cult. Rejected.

**C. Add a `gifts` column, or a per-call `incenseOfFaith: true` attestation.**

A new column needs a migration and a writer the hero row does not have. A per-call flag is not a property of the hero: every caller can set it, and the next call cannot see it. Rejected.

**D. Require a prior `set_divinity` before `form_cult` will leave free divinity.**

The issue says the override is on the `form_cult` call. `set_divinity` to `cult` does not require `gmOverride` today, and this spec does not change that tool. Rejected.

## Shape

### Where the rules live

Gates and theology edits live in `formCult` and `setTheology` in `src/services/populate.ts`. Harshness parsing and the four price formulas live in `src/rules/cults.ts`. `advanceMonth` in `src/services/turn.ts` and `cultIncome` in `src/queries/detail.ts` call that parser when they price a cult.

The MCP handlers stay pass-throughs. Their input schemas use the same four harshness keys, and `form_cult` gains optional `gmOverride`. `set_theology` gains optional `intrinsicTexts`.

`createHero`, `setDivinity`, `createFaction`, `applyCollapseIfNeeded`, and the Power 1 or less branch of `setTheology` stay as they are.

### Harshness prices

The only keys are `nominal`, `sharp`, `grueling`, and `overwhelming`.

| Key | Intrinsic points | Extra Dominion per month |
| --- | --- | --- |
| `nominal` | 0 | 0 |
| `sharp` | `ceil(dieMax / 4)` | 1 |
| `grueling` | `dieMax / 2` | 2 |
| `overwhelming` | `ceil(dieMax * 3 / 4)` | 3 |

`dieMax` is `DIE_BY_POWER` for the cult faction's current Power. A new cult is still created at Power 1, so its die is 6. An adopted faction uses the Power already on that row.

`parseHarshness` returns one of the four keys or throws `RuleError("PICK_UNKNOWN", "unknown harshness")`. `cultBudget` and the cult branch of `monthlyDominion` both call it. The fallthrough that prices any other string as overwhelming Problems, and the fallthrough that pays it 0 extra Dominion, both go away. Free divinity and `divinity: none` do not parse harshness. Their grants stay `1 + floor(level / 3)` and `0`.

A null harshness column on read counts as `nominal`. A non-null unrecognized string throws `PICK_UNKNOWN` from `advanceMonth` and from `cult_income`. The month advance rolls back. `cult_income` returns that error in the tool envelope.

### `form_cult` gates

Checks run in this order, before any faction write. A failure leaves the hero and every faction row as they were.

| Order | Situation | Code | Message |
| --- | --- | --- | --- |
| 1 | `acknowledged` is not true | `FILL_INCOMPLETE` | `acknowledged worshippers required` |
| 2 | Unknown campaign | `CAMPAIGN_NOT_FOUND` | `campaign ${campaignId} not found` |
| 3 | Hero missing from that campaign | `ENTITY_NOT_FOUND` | `hero not found` |
| 4 | `level < 2` | `LEVEL_TOO_LOW` | `cult requires level 2` |
| 5 | Parsed `words` does not contain the exact string `Incense of Faith` | `GIFT_REQUIRED` | `Incense of Faith required` |
| 6 | `divinity` is `free` and `gmOverride` is not `true` | `FREE_DIVINITY` | `gmOverride required to leave free divinity` |
| 7 | `harshness` is present and not one of the four keys | `PICK_UNKNOWN` | `unknown harshness` |
| 8 | `adoptFactionId` is present and no faction has that id in this campaign | `ENTITY_NOT_FOUND` | `faction not found` |

`gmOverride: true` bypasses only row 6. Level and Incense of Faith still apply. `divinity: none` and `divinity: cult` do not need the flag.

`words` is the JSON text in `heroes.words`. Invalid JSON, or a value that is not an array, fails row 5. The match is case-sensitive. `create_hero` remains the writer of that array. This spec adds no tool to edit Words later.

Omitted `harshness` on `form_cult` stores `nominal`, including when adopting. That is the formation choice. It is a different rule from `set_theology`.

After the checks, the call still creates a Power 1 forged faction or adopts the named one, sets `cult = 1`, `patron_hero_id`, and the harshness key, inserts the caller's feature, and sets the hero's `divinity` to `cult` and `cult_faction_id` to that faction.

Holy-law points come from `cultBudget` at that faction's Power. When the faction has no intrinsic Problem and the budget is greater than 0, insert one intrinsic Problem whose text is `featureText` and whose points equal the budget. When intrinsic Problems already exist, rescale their points to the budget and leave their texts. Non-intrinsic Problems stay. A new cult still receives whatever `createFaction` rolls before this insert. Removing that roll is out of scope.

### `set_theology` edits

`ensureInternalTurnSlot` still runs first. A cult that has already taken `set_theology`, `build_strength`, or `enact_change` on the open turn throws `INTERNAL_BUDGET` / `internal action already taken` and changes nothing.

The branch `faction.power <= 1` stays the end already shipped. It still ignores `harshness` and `featureText`. It also ignores `intrinsicTexts`. It still returns `{ ended: true, factionId, giftTexts, factIds }`. It does not parse harshness, so an unrecognized key on a Power 1 cult still ends the faction.

On Power greater than 1 the call still costs 1 Power and clamps cohesion to the new Power. It does not change `divinity` or `cult_faction_id`. It does not delete the faction.

| Argument | When omitted | When sent |
| --- | --- | --- |
| `harshness` | Column stays as stored, including null. Point rescale uses that stored key, or `nominal` when it is null. | Must be one of the four keys or the call throws `PICK_UNKNOWN` / `unknown harshness` and writes nothing. The column becomes that key. Points rescale to the budget at the new Power. |
| `featureText` | No feature row changes. An empty string is omitted. | The feature with the lowest `id` on this faction gets that text. Other features stay. Feature parts stay. No feature is inserted when the faction has none. |
| `intrinsicTexts` | No Problem text changes. | Each entry is `{ problemId, text }`. |

`intrinsicTexts` rules, applied only on Power greater than 1:

- A repeated `problemId` throws `FILL_INCOMPLETE` / `duplicate intrinsic problem` before the Power write.
- A `problemId` that is missing, belongs to another faction, or is not intrinsic throws `ENTITY_NOT_FOUND` / `intrinsic problem not found` before the Power write.
- After the point rescale, a named Problem that the new budget deleted throws `FILL_INCOMPLETE` / `intrinsic problem removed by the new budget`. The transaction rolls back, so Power, harshness, texts, and the internal action stay as they were.
- A named Problem that survives is updated to the new text. Its points are whatever the rescale left. Other Problem texts stay.

Point rescale is the existing rule: the intrinsic total matches the budget at the new Power and the harshness used above. A budget of 0 deletes intrinsic Problems. That is the price of the key the caller stored or just sent. Non-intrinsic Problems are not rescaled. When the budget grows from zero and no intrinsic Problem exists, the existing rescale inserts one Problem whose text is the first cultural catalog row.

An empty `intrinsicTexts` array changes no text.

### Tool descriptions

`form_cult` in `src/mcp/register.ts`:

`Bind a hero of level 2 or higher whose Words include Incense of Faith to a cult faction. Free divinity requires gmOverride.`

`harshness` becomes `z.enum(["nominal", "sharp", "grueling", "overwhelming"]).optional()`. Add `gmOverride: z.boolean().optional()`.

`set_theology`:

`Change cult theology. Costs 1 Power and the internal action. Omitted harshness is kept. A Power 1 cult stops being a faction.`

`harshness` uses the same enum. Add:

```ts
intrinsicTexts: z.array(z.object({ problemId: z.string(), text: z.string() })).optional()
```

`cult_income` catches `RuleError` and returns `{ ok: false, error: { code, message, details } }`. Any other throw still uses `unexpectedErrorEnvelope`.

## Docs and play copy

In `docs/design/glossary.md`, add this sentence at the end of the **Cult** section:

```markdown
A hero forms a cult through `form_cult` at level 2 or higher when their Words include `Incense of Faith`. Free divinity forms a cult only when that call passes `gmOverride`.
```

In `docs/design/overview.md`, replace the two cult gap bullets with:

```markdown
- `form_cult` adds a rolled feature and a rolled non-intrinsic problem on a new cult.
```

In `docs/design/current-engine.md`, add this paragraph after the existing Cult theology paragraph:

```markdown
`form_cult` requires level 2, the Word `Incense of Faith`, and `acknowledged: true`. Free divinity also requires `gmOverride: true`. Omitted harshness on that call stores `nominal`. The four harshness keys price intrinsic Problems from the cult's Power die and price cult Dominion as Power plus 0, 1, 2, or 3. Any other harshness string is refused. On Power greater than 1, `set_theology` keeps an omitted harshness, keeps an omitted feature sentence, and changes intrinsic Problem text only for the ids in `intrinsicTexts`.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `form_cult` and `set_theology` bullets with:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher and their Words must include `Incense of Faith`. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. Harsher cults carry more intrinsic problems and pay more Dominion each month. An unrecognized harshness is refused.
- `set_theology`: changes a cult's harshness, feature text, or the text of intrinsic problems (`intrinsicTexts`). It costs the cult 1 Power and its internal action for the turn. Omitting `harshness` keeps the stored harshness and its laws. A Power 1 cult stops being a faction: divinity stays `cult`, the hero's faction link is cleared, and the leftover worshipers and cult gift remain without paying cult Dominion. That end ignores harshness, feature text, and intrinsic texts.
```

Leave `user/skills/gdnr-player/references/gdnr-play.md` unchanged. Leave `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md` and `docs/superpowers/specs/2026-10-04-power-1-cult-ends-design.md` unchanged.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/rules/contest.test.ts` calls `parseHarshness`, `cultBudget`, and `monthlyDominion`. The four keys keep the prices in the table above, including `nominal` at 0. `Grueling`, `cruel`, and `""` throw `PICK_UNKNOWN` / `unknown harshness` from `parseHarshness` and from `cultBudget`. A cult `monthlyDominion` with those strings throws the same way. Free divinity at level 2 still grants 1 even when the harshness argument is an unrecognized string. `divinity: none` still grants 0.

`test/services/form-cult.test.ts` opens an in-memory database and calls `formCult`.

- Level 1, Words include `Incense of Faith`, `acknowledged: true`: `LEVEL_TOO_LOW` / `cult requires level 2`. No faction row. Divinity stays `none`.
- Level 2, Words are `["Sun"]`: `GIFT_REQUIRED` / `Incense of Faith required`. No faction row.
- Level 2, `words` text is not JSON: `GIFT_REQUIRED` / `Incense of Faith required`. No faction row.
- Level 2, Words include `Incense of Faith`, `divinity: free`, no `gmOverride`: `FREE_DIVINITY` / `gmOverride required to leave free divinity`. Divinity stays `free`. No faction row.
- The same hero with `gmOverride: true` and level 1 still returns `LEVEL_TOO_LOW`.
- The same hero with `gmOverride: true`, level 2, and Words `["Sun"]` still returns `GIFT_REQUIRED`.
- Level 2, Words `["Sun", "Incense of Faith"]`, `divinity: free`, `gmOverride: true`, `harshness: "grueling"`: `ok: true`. Divinity becomes `cult`, `cult_faction_id` is the new faction, harshness is `grueling`, and the intrinsic Problem points sum to 3 with text equal to `featureText`.
- Level 2, the Word, `divinity: none`, harshness omitted: harshness stored is `nominal`, and the intrinsic point sum is 0.
- `harshness: "cruel"`: `PICK_UNKNOWN` / `unknown harshness`. No faction row. Divinity unchanged.
- Adopt a Power 3 faction that has no intrinsic Problem, `harshness: "sharp"`: the intrinsic Problem has 3 points. A pre-existing non-intrinsic Problem remains.
- Adopt a Power 3 faction that already has an intrinsic Problem of 1 point and text `Old law`, `harshness: "sharp"`: that row still reads `Old law` and now has 3 points. No second intrinsic Problem is inserted.
- `adoptFactionId` for a missing faction: `ENTITY_NOT_FOUND` / `faction not found`. The hero is unchanged.
- `acknowledged` omitted: `FILL_INCOMPLETE` / `acknowledged worshippers required`, including when level is 1.

`test/services/cult-theology.test.ts` calls `setTheology`.

- Power 3, harshness `grueling`, one intrinsic Problem `Law` at 5 points, one non-intrinsic Problem, one feature `Gift`. Call with no harshness, no feature text, and no intrinsic texts. Power becomes 2, cohesion becomes 2, harshness stays `grueling`, the intrinsic text stays `Law` and its points become 4, the non-intrinsic Problem stays, the feature stays, divinity stays `cult`, and `cult_faction_id` stays set.
- The same cult, `intrinsicTexts` naming that Problem with text `New law`. Harshness stays `grueling`. The Problem text becomes `New law`. The feature text stays `Gift`.
- Two features. `featureText: "Rewritten"` updates the feature with the lower id. The other feature text stays.
- `harshness: "nominal"` deletes the intrinsic Problem and leaves the non-intrinsic Problem and the feature text.
- `harshness: "cruel"` on Power 2: `PICK_UNKNOWN` / `unknown harshness`. Power stays 2. No `set_theology` action remains.
- `intrinsicTexts` with a non-intrinsic id, or an id from another faction: `ENTITY_NOT_FOUND` / `intrinsic problem not found`. Power stays.
- Two entries with the same `problemId`: `FILL_INCOMPLETE` / `duplicate intrinsic problem`. Power stays.
- Power 2, harshness `sharp`, one intrinsic Problem, call with `harshness: "nominal"` and `intrinsicTexts` naming that Problem: `FILL_INCOMPLETE` / `intrinsic problem removed by the new budget`. Power stays 2, harshness stays `sharp`, and the Problem text stays.
- Power 1 with `harshness: "cruel"` and `intrinsicTexts`: still `{ ended: true, ... }`. The faction row is gone. Divinity stays `cult`. `cult_faction_id` is null.
- A faction with `cult` 0 still returns `ENTITY_NOT_FOUND` / `cult faction not found`.

`test/services/cult-harshness-income.test.ts`:

- A linked cult stored as `harshness = 'grueling'` at Power 1: `cultIncome` reports grant 3, and `advanceMonthForCampaign` adds 3 Dominion.
- The same cult stored as `harshness = 'cruel'`: `cultIncome` throws `PICK_UNKNOWN` / `unknown harshness`. `advanceMonthForCampaign` returns that error and leaves `month` at 1 and Dominion unchanged.
- `setPower` on a cult whose harshness is `cruel` returns `PICK_UNKNOWN` / `unknown harshness` and leaves Power unchanged.

No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

## Out of scope

- A Power 1 cult stopping being a faction. That branch stays as shipped.
- Collapse on Trouble, or collapse when cohesion reaches 0.
- Removing the feature and the non-intrinsic Problem that `createFaction` rolls onto a new cult.
- Binding `home_place_id` to a village.
- A separate holy-law sentence on `form_cult`. The first intrinsic Problem uses `featureText`.
- Requiring `gmOverride` on `set_divinity` or `create_hero`, or refusing `divinity: cult` below level 2 on those tools.
- A tool that edits Words after `create_hero`.
- Rewriting `feature_parts` when `featureText` changes.
- A third faction status, or storing Power 0.

## Global constraints

- `form_cult` returns `LEVEL_TOO_LOW` / `cult requires level 2` when `heroes.level < 2`.
- `form_cult` returns `GIFT_REQUIRED` / `Incense of Faith required` unless the parsed `words` array contains the exact string `Incense of Faith`.
- `form_cult` returns `FREE_DIVINITY` / `gmOverride required to leave free divinity` when divinity is `free` and `gmOverride` is not `true`.
- `gmOverride: true` does not bypass level or Incense of Faith.
- Harshness keys are `nominal`, `sharp`, `grueling`, and `overwhelming`. Any other non-null string is `PICK_UNKNOWN` / `unknown harshness`.
- A null harshness column on read counts as `nominal`. Omitted `harshness` on `form_cult` is stored as `nominal`.
- Omitted `harshness` on `set_theology` does not write the harshness column.
- On Power less than or equal to 1, `setTheology` ends the faction and ignores `harshness`, `featureText`, and `intrinsicTexts`.
- This change does not set `status` to `collapsed`, does not write cohesion to 0 for a theology edit, and does not insert `type` `faction_collapsed`.
- Intrinsic points are 0, `ceil(dieMax / 4)`, `dieMax / 2`, and `ceil(dieMax * 3 / 4)` for `nominal`, `sharp`, `grueling`, and `overwhelming`. Cult Dominion extra is 0, 1, 2, and 3 for those keys. `dieMax` is the die for the faction's Power.
- Gate order on `form_cult` is acknowledged, campaign, hero, level, Incense of Faith, free divinity, harshness, adopted faction.
