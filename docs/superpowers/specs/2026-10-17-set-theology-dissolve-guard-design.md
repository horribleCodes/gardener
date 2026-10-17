# `set_theology` dissolve guard

> Status: design for issue #131. Not implemented on this branch. Living docs to update at implementation time: [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md), [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md).

## Purpose

`set_theology` on a Power 1 cult dissolves the faction immediately. An agent can do that by accident. The 2026-10-16 hero-cult playtest raised Power with `set_power` first to avoid it. Director copy currently tells the agent to keep the player aware.

Issue #131 already decided the product shape:

- On a Power 1 cult, `set_theology` without `acknowledgeDissolve: true` fails with a dedicated code (the issue's example is `DISSOLVES_CULT`) and writes nothing. It spends no Power and does not use the internal action.
- The error message says the cult will stop being a faction, and that holy laws are normally set at `form_cult`.
- With `acknowledgeDissolve: true`, the dissolve runs as it does today. That is the Godbound book outcome (1 Power and the cult's turn), not an error.
- On Power greater than 1, `acknowledgeDissolve` is not needed and does not change the result.
- The flag is a product safety step. The tool description carries the warning, so the skills need no caveat.
- Remove the “only with the player aware of the consequences” caveat from `gdnr-direct.md`, and any other matching gap notes, in the same change.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec: the exact code and message, when the check runs relative to the internal-action slot, and how `false` and Power 0 are treated.

## Approaches

**A. Optional `acknowledgeDissolve` on `setTheology`, checked before the internal slot. Recommended.**

Same pattern as `gmOverride` and `form_cult`'s `acknowledged`: one boolean on the existing writer. The MCP schema gains the optional flag. The service throws before `ensureInternalTurnSlot`. The dissolve branch itself does not change.

**B. A second confirm tool.**

Rejected. The issue names the flag on `set_theology`. A second tool would still need skill text.

**C. Refuse every Power 1 theology change.**

Rejected. The issue keeps the book dissolve when the caller acknowledges it.

## Shape

### Where the rules live

The guard lives in `setTheology` in `src/services/populate.ts`, after the cult row is loaded and before `ensureInternalTurnSlot`. The MCP handler stays a pass-through. `src/mcp/register.ts` adds optional `acknowledgeDissolve` and updates the `set_theology` description. The dissolve writes (facts, nulling links, deleting the faction) stay as they are.

### Check order

Existing lookups stay first: unknown campaign is `CAMPAIGN_NOT_FOUND`; a missing row or `cult = 0` is `ENTITY_NOT_FOUND` / `cult faction not found`. Those do not inspect the flag.

Then, when `faction.power <= 1` (the same bound the dissolve branch already uses) and `acknowledgeDissolve` is not `true`:

| Situation | Code | Message |
| --- | --- | --- |
| Power 1 or less, flag omitted, `false`, or any value other than `true` | `DISSOLVES_CULT` | `the cult will stop being a faction; holy laws are normally set at form_cult` |

That throw happens inside the transaction before `ensureInternalTurnSlot`. The transaction rolls back. There is no `set_theology` action, no opened turn, no fact, no Power change, and `cult_faction_id` stays.

`acknowledgeDissolve: true` is required. Omitted and `false` are the same refusal.

When the flag is `true` and Power is 1 or less, `ensureInternalTurnSlot` still runs first among the writes. A spent internal action is still `INTERNAL_BUDGET` / `internal action already taken` and the cult stays. A successful call still dissolves exactly as today, still ignores `harshness`, `featureText`, and `intrinsicTexts`, and still returns `{ ended: true, factionId, giftTexts, factIds }`.

When Power is greater than 1, the flag is ignored. Omitted, `false`, and `true` all take the existing Power-drop path.

### Tool description

`set_theology` in `src/mcp/register.ts`:

`Change cult theology. Costs 1 Power and the internal action. Omitted harshness is kept. On Power 1, acknowledgeDissolve must be true or the call is refused with DISSOLVES_CULT; with that flag the cult stops being a faction.`

Add `acknowledgeDissolve: z.boolean().optional()`. The handler stays `dbTool((a) => setTheology(db, a))`.

## Docs and play copy

In `docs/design/current-engine.md`, replace the first Cult theology paragraph with:

```markdown
`set_theology` costs the cult 1 Power and its internal action. A Power 1 cult stops being a faction only when the call passes `acknowledgeDissolve: true`: the faction row is removed, the hero's divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain as public facts, and they do not pay cult Dominion. This is not a collapse. Without that flag the call returns `DISSOLVES_CULT`, writes nothing, and does not use the internal action. On Power greater than 1 the flag is ignored.
```

Add `DISSOLVES_CULT` to the common error codes list on that page.

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `set_theology` bullet with:

```markdown
- `set_theology`: changes a cult's harshness, feature text, or the text of intrinsic problems (`intrinsicTexts`). It costs the cult 1 Power and its internal action for the turn. Omitting `harshness` keeps the stored harshness and its laws. A Power 1 cult stops being a faction: divinity stays `cult`, the hero's faction link is cleared, and the leftover worshipers and cult gift remain without paying cult Dominion. That end ignores harshness, feature text, and intrinsic texts.
```

That restores the dissolve outcome and drops “should only be done with the player aware of the consequences.” Do not teach `acknowledgeDissolve` in the skill. The tool description is the warning.

In `user/skills/gdnr-player/references/gdnr-play.md`, add this row to the error table, directly under the `FILL_INCOMPLETE` row:

```markdown
| `DISSOLVES_CULT` | A Power 1 cult would stop being a faction. Pass `acknowledgeDissolve: true` on `set_theology` only when that end is intended. Holy laws are normally set at `form_cult`. |
```

Do not add a known-engine-gap bullet. Do not edit historical files under `docs/superpowers/` except this design and its plan. Do not link from `user/` to files outside `user/`. No other living doc or prompt currently carries the player-aware caveat.

## Tests

`test/services/set-theology-end.test.ts` calls `setTheology`. Existing Power 1 success cases and the spent-internal-action case pass `acknowledgeDissolve: true` so they keep today's dissolve and `INTERNAL_BUDGET` behavior.

New cases, one rule per test:

- A Power 1 cult without `acknowledgeDissolve` returns `DISSOLVES_CULT` / `the cult will stop being a faction; holy laws are normally set at form_cult`. The faction, its Features and Problems, hero `cult_faction_id` and divinity, facts, and the internal turn slot are unchanged (no `set_theology` action, no extra turn if none was open).
- A Power 1 cult with `acknowledgeDissolve: false` is the same refusal and the same unchanged state.
- A Power 1 cult with `acknowledgeDissolve: true` still dissolves as the existing success tests already cover.
- A Power 2 cult with the flag omitted still drops 1 Power and stays a faction, as today.
- A Power 2 cult with `acknowledgeDissolve: true` is the same Power drop.

`test/services/cult-theology.test.ts`: the Power 1 unrecognized-harshness end also passes `acknowledgeDissolve: true`.

No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

## Out of scope

- The text-only authoring edit tool (wording fixes with no Power cost or action).
- Changing what the dissolve itself does.
- `form_cult`, `set_power`, collapse, and cult Dominion math.

## Implementation notes

- MCP handlers stay pass-throughs. No ad-hoc SQL in `register.ts`. Domain rules stay in `setTheology`.
- Implementation continues on this pull request's branch. Do not branch from `main` and do not open a second pull request.
