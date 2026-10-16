# New cult composition

> Status: design for issue #118. Not implemented on this branch. Living docs to update at implementation time: [`docs/design/glossary.md`](../../../docs/design/glossary.md), [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

A newly formed cult still receives a rolled Feature and a rolled non-intrinsic Problem from `createFaction`, then the caller's Feature and an intrinsic Problem whose text copies `featureText`.

Issue #118 already decided the product shape:

- When `form_cult` creates a new faction, it creates it at Power 1 with no rolled Feature and no rolled Problems. The only Feature is `featureText`.
- The only Problems are the intrinsic ones that the harshness budget prices. `nominal` adds none.
- Intrinsic Problems are written as holy laws. Their text is not a copy of the Feature text.
- `adoptFactionId` keeps the adopted faction's existing Features and Problems and adds the chosen Feature and the intrinsic Problems, as it does today.
- Engine, `docs/design`, director copy, and tests change together.

There is no **Open questions** section on the issue. The choice below is the one the issue left to this spec: how the holy-law sentence is supplied if it must not be `featureText`.

## Approaches

**A. Caller supplies `lawText` when a new intrinsic Problem will be inserted. Recommended.**

Holy laws are authored doctrine, the same way the Feature is an authored sentence. `form_cult` already takes `featureText`. When the harshness budget is greater than 0 and the faction has no intrinsic Problem yet, the call also takes `lawText` and stores that as the intrinsic Problem. The engine never copies `featureText` onto a Problem. `nominal` needs no law. Adopting a faction that already has an intrinsic Problem still leaves its text and does not require `lawText`.

**B. Roll a cultural catalog Problem and mark it intrinsic.**

That is still a random affliction, not a holy law, and it would reuse the same catalog `createFaction` already rolls for ordinary Problems. Rejected.

**C. Keep copying `featureText` into the intrinsic Problem.**

The issue forbids that. Rejected.

## Shape

### Where the rules live

Composition lives in `formCult` in `src/services/populate.ts`. Skipping the generation roll lives in `createFaction` in the same file: that function already accepts `featureCount`, and it gains optional `problemCount`. `formCult` calls it with both counts set to `0` when it forges a new cult.

Harshness prices stay in `src/rules/cults.ts`. Gates, adopt lookup, `rescaleIntrinsic`, `setTheology`, and the Power 1 end stay as they are.

The MCP handler stays a pass-through. `form_cult` gains optional `lawText`. `create_faction` does not gain `problemCount`; that option is only on the service function.

### New cult

After the existing gates succeed, a call with no `adoptFactionId` still creates a Power 1 forged directed faction named `input.name ?? "Cult"`. The `createFaction` call also passes `featureCount: 0` and `problemCount: 0`. That faction has no Features and no Problems when `formCult` continues.

`formCult` then inserts one Feature from `featureText`, as it does today.

Holy-law points still come from `cultBudget` at Power 1 (`dieMax` 6):

| Key | Intrinsic points |
| --- | --- |
| `nominal` | 0 |
| `sharp` | 2 |
| `grueling` | 3 |
| `overwhelming` | 5 |

When the budget is 0, no Problem is inserted. `lawText` is ignored.

When the budget is greater than 0, insert one intrinsic Problem whose text is `lawText`, whose points equal the budget, domain `cultural`, `intrinsic` 1. Then `rescaleIntrinsic` runs as today and leaves that one Problem at the budget.

`lawText` is missing when it is omitted or an empty string. Missing `lawText` when this insert will happen throws `RuleError("FILL_INCOMPLETE", "holy law required")` before the faction write. The hero and every faction row stay as they were.

The engine does not copy `featureText` onto that Problem. It does not compare `lawText` to `featureText`. It does not roll catalog text for that Problem.

After the inserts, the faction has Power 1, exactly one Feature whose text is `featureText`, and either no Problems (`nominal`) or exactly one intrinsic Problem (`sharp`, `grueling`, `overwhelming`).

### Adopted cult

`adoptFactionId` still requires the faction to exist in the campaign. Existing Features and Problems stay. The call still inserts the Feature from `featureText`. Non-intrinsic Problems stay. When intrinsic Problems already exist, rescale their points to the budget at that faction's Power and leave their texts. `lawText` is ignored on that path.

When the adopted faction has no intrinsic Problem and the budget is greater than 0, insert one intrinsic Problem from `lawText` exactly as on a new cult. Missing `lawText` is the same `FILL_INCOMPLETE` / `holy law required` error, after the adopted faction is found and before any write.

When the adopted faction has no intrinsic Problem and the budget is 0, insert none.

### `createFaction`

`createFaction` input gains `problemCount?: number`. When `problemCount` is `0`, it inserts no Problems. When `problemCount` is omitted, it still rolls `generateProblems` from the pressure budget, as today. `featureCount: 0` already inserts no Features. No other caller changes. The `create_faction` MCP tool is unchanged.

The existing advisory that `featureCount` 0 is outside the usual band still fires inside `createFaction`. `formCult` still returns only `{ factionId }` and drops that advisory.

### Gate order

Existing checks stay in the same order: acknowledged, campaign, hero, level, free divinity, harshness, adopted faction.

Then:

| Order | Situation | Code | Message |
| --- | --- | --- | --- |
| 8 | A new intrinsic Problem will be inserted and `lawText` is omitted or `""` | `FILL_INCOMPLETE` | `holy law required` |

A new intrinsic Problem will be inserted when the budget is greater than 0 and the target faction currently has no intrinsic Problem. For a new cult that is known before `createFaction`. For an adopted cult it is known after the faction row is found. The failure still runs inside the transaction so a new cult is not left behind.

`gmOverride` still bypasses only free divinity. Level still applies.

### Tool description

`form_cult` in `src/mcp/register.ts`:

`Bind a hero of level 2 or higher to a cult faction. A new cult is Power 1 with the chosen Feature and only the holy laws its harshness requires. lawText is required when those laws are inserted. Free divinity requires gmOverride.`

Add `lawText: z.string().optional()`. The handler stays `dbTool((a) => formCult(db, a))`.

## Docs and play copy

In `docs/design/glossary.md`, add this sentence at the end of the **Cult** section:

```markdown
A new cult is Power 1. Its only Feature is the sentence passed to `form_cult`. Its only Problems are the intrinsic holy laws that harshness prices; `nominal` has none. Those laws use `lawText`, not the Feature sentence.
```

In `docs/design/overview.md`, delete this Cults gap bullet and, if it is the only Cults bullet, delete the **Cults** heading too:

```markdown
- `form_cult` adds a rolled feature and a rolled non-intrinsic problem on a new cult.
```

In `docs/design/current-engine.md`, add this paragraph after the existing `form_cult` paragraph under Cult theology:

```markdown
A new cult is created at Power 1 with no rolled Feature and no rolled Problems. `form_cult` then inserts the caller's Feature. When harshness prices intrinsic points, it inserts one intrinsic Problem whose text is `lawText`. `nominal` inserts none. Adopting a faction keeps its Features and Problems and still adds that Feature and, when it has no holy law yet, that intrinsic Problem.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `form_cult` bullet with:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. A new cult is Power 1 with only the chosen Feature (`featureText`) and only the intrinsic holy laws that harshness prices. Those laws take `lawText`, which is required when the budget is greater than 0 and the faction has no intrinsic Problem yet. `nominal` has no holy law. An adopted faction keeps its Features and Problems and still receives the chosen Feature and, if it has no holy law yet, that law. An unrecognized harshness is refused.
```

Leave `user/skills/gdnr-player/references/gdnr-play.md` unchanged. Leave `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md` and `docs/superpowers/specs/2026-10-07-cult-formation-gates-design.md` unchanged.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/services/form-cult.test.ts` already opens an in-memory database and calls `formCult`. Keep the existing gate tests. Change the successful composition assertions as follows.

- Level 2, `divinity: none`, harshness omitted: harshness stored is `nominal`, Feature count is 1 and that text is `featureText`, Problem count is 0.
- Level 2, `gmOverride: true`, `harshness: "grueling"`, `lawText: "The frost is a sin"` and `featureText: "Winter must never return"`: Power 1, one Feature with the Feature text, one Problem, that Problem is intrinsic, points 3, text `The frost is a sin`.
- The same call without `lawText`: `FILL_INCOMPLETE` / `holy law required`. No faction row. Divinity unchanged.
- Each of `sharp`, `grueling`, and `overwhelming` on a new Power 1 cult, with `lawText` set: Feature count 1, Problem count 1, that Problem intrinsic, points 2, 3, and 5 respectively, text equal to `lawText` and not equal to `featureText`. `nominal` still has Problem count 0.
- Adopt a Power 3 faction that has one existing Feature, one non-intrinsic Problem, and no intrinsic Problem, `harshness: "sharp"`, `lawText: "Pay the tithe in winter"`: the old Feature and old Problem remain, the chosen Feature is added, the intrinsic Problem has that law text and 3 points.
- Adopt a Power 3 faction that already has an intrinsic Problem of 1 point and text `Old law`, `harshness: "sharp"`, no `lawText`: that row still reads `Old law` and now has 3 points. No second intrinsic Problem is inserted. The chosen Feature is added. Existing Features stay.
- Gate failures (level, free divinity, unrecognized harshness, missing faction, acknowledged) still write nothing.

No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

## Out of scope

- Locking `set_divinity` and the level-2 choice between free divinity and a cult.
- Authoring and editing cult text after formation, and the `set_theology` dissolve guard.
- Binding `home_place_id` on cults (#119).
- Exposing `problemCount` on the `create_faction` MCP tool.
- Refusing `lawText` that happens to equal `featureText`.
- Splitting the holy-law budget across several intrinsic Problems at formation.
- Changing `rescaleIntrinsic` catalog fallback used when a later Power increase grows a cult that has no intrinsic Problem.

## Global constraints

- A new cult from `form_cult` is Power 1, has exactly one Feature, and that Feature's text is `featureText`.
- A new cult has no non-intrinsic Problems.
- Intrinsic point totals on a new cult are 0, 2, 3, and 5 for `nominal`, `sharp`, `grueling`, and `overwhelming`.
- When those points are greater than 0 and the faction has no intrinsic Problem, `form_cult` inserts one intrinsic Problem whose text is `lawText`.
- `form_cult` returns `FILL_INCOMPLETE` / `holy law required` when that insert would happen and `lawText` is omitted or `""`.
- `form_cult` does not write `featureText` onto a Problem.
- `adoptFactionId` keeps existing Features and Problems, adds the chosen Feature, and adds or rescales intrinsic Problems as above.
- `createFaction` inserts no Problems when `problemCount` is `0`. Omitted `problemCount` still rolls Problems.
- Implementation continues on this pull request's branch. Do not branch from `main` and do not open a second pull request.
- No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.
