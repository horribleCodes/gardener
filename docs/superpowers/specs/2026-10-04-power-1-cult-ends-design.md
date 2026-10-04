# Power 1 cult stops being a faction

> Status: design for issue #98. Not implemented on this branch. Living docs to update at implementation time: [`docs/design/glossary.md`](../../../docs/design/glossary.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

`set_theology` always costs the cult 1 Power and its internal action. A Power 1 cult is not refused, and Power is not stored as 0. It stops being a faction.

Issue #98 already decided the product shape:

- This is not a collapse. Do not set status `collapsed`, do not zero cohesion, and do not record a `faction_collapsed` event for this.
- Drop the hero's faction link. Leave divinity unchanged: still a god with a faith, not free divinity, and the choice is not cleared.
- Leftover worshipers and the cult gift remain. They are not a faction, and they do not pay cult Dominion.
- Monthly Dominion still pays while divinity is cult and `cult_faction_id` is set, so that link has to be cleared or income continues. Do not add a third faction status for this.
- The director prompt currently says a Power 1 cult collapses. Correct that. Living glossary and current-engine do not describe this end; say only this ruling there.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec: how a row stops being a faction when status cannot change, and where the gift and the worshipers live after the faction row is gone.

## Approaches

**A. Delete the faction row. Keep the gift and the worshipers as public facts, and clear the hero link. Recommended.**

`setTheology` in `src/services/populate.ts` already spends the internal action before the Power check. On Power 1 or less, copy each feature sentence and one worshiper sentence into `facts`, null the soft links that would keep the id acting as a faction, delete the sheet rows foreign keys require, then delete the faction. Divinity stays `cult`. `cult_faction_id` becomes null, so `advanceMonth` no longer pays cult Dominion. Status is never written. Cohesion is never written. No `faction_collapsed` event is inserted. Faction status stays only `active` or `collapsed`.

**B. Keep the row and set `collapsed`, but skip cohesion 0 and skip the event.**

The row is still a faction with status `collapsed`. That is the collapse the issue forbids. `record_shatter` and `COLLAPSED_FACTION` would treat it as a collapsed faction. Rejected.

**C. Keep an `active` row at Power 0, or add a status such as `ended`.**

Power is not stored as 0, and the issue forbids a third faction status. An `active` Power 1 row with the hero link cleared is still a faction: it still appears on the brief and can still take a turn. Rejected.

## Shape

### Where the rule lives

`setTheology` in `src/services/populate.ts`, inside the existing transaction, in the branch that today runs when `faction.power <= 1`.

`ensureInternalTurnSlot` stays as it is and still runs first. A cult that has already taken `set_theology`, `build_strength`, or `enact_change` on the open turn throws `RuleError("INTERNAL_BUDGET", "internal action already taken")` and changes nothing. If no turn is open, that helper still opens one, inserts this call's `set_theology` action with outcome `success`, and leaves the turn open.

The MCP handler stays a pass-through. `advanceMonth`, `cultIncome`, `setDivinity`, `applyCollapseIfNeeded`, and `formCult` stay as they are.

The Power greater than 1 path stays as it is: Power drops by 1, cohesion is clamped to the new Power, omitted harshness is still stored as `nominal`, and a supplied `featureText` still rewrites the first feature. That harshness default is the known gap in `docs/design/overview.md`. This spec does not change it.

### Power 1 or less

The condition stays `faction.power <= 1`. A stored Power of 1 is the play case. A stored Power below 1, which `set_power` refuses, also ends the faction instead of writing Power 0 or a negative Power.

`harshness` and `featureText` on this call are ignored. The gift that remains is the feature text already stored, not the caller's new sentence. The call does not update `status`, `cohesion`, `power`, `divinity`, or `harshness`.

The return replaces `{ collapsed: true }`:

```ts
{
  ended: true,
  factionId: string, // the removed faction id
  giftTexts: string[], // feature texts, id ascending
  factIds: string[] // gift facts in that order, then the worshiper fact
}
```

`collapsed` is not a field on this return. The Power greater than 1 return stays `{ power, cohesion }`.

### What remains

Worshipers are not a table. `form_cult` only requires the caller to acknowledge them. Characters whose `faction_id` is this cult are the people the sheet actually stores.

Before the faction row is deleted:

1. Load `features` for this faction `ORDER BY id ASC`. `giftTexts` is those `text` values. Feature parts are sheet structure; the gift that remains is the feature sentence.
2. Choose a fact subject. If `patron_hero_id` is a hero in this campaign, subject is `hero` and `subject_id` is that hero. Otherwise, if `home_place_id` is a place in this campaign, subject is `place` and `subject_id` is that place. Otherwise write no facts. `giftTexts` is still returned.
3. When a subject exists, insert one public `explicit` fact per gift text. `statement` is the feature text unchanged. Then insert one more public `explicit` fact whose statement is exactly `Worshipers remain, and they are not a faction.` `factIds` lists the gift facts first, then that worshiper fact.
4. Set `characters.faction_id` to null where it equals this faction. The character rows stay.

`facts.subject` has no check constraint. `create_fact` is not extended to accept `hero`. Public facts are already included in a unit view whatever the subject is, so the gift and the worshipers stay readable there.

### What stops being a faction

Still inside the same transaction, after the facts:

| Table | Write |
| --- | --- |
| `heroes` | `cult_faction_id = NULL` wherever it equals this faction. `divinity` is not in the update. |
| `courts` | `rules_faction_id = NULL` wherever it equals this faction. The court row stays. |
| `changes` | `faction_id = NULL` wherever it equals this faction. `feature_id` and `backlash_problem_id` become null when they point at this faction's features or problems. The change row stays. |
| `features` | `aimed_at_faction_id = NULL` on any feature aimed at this faction, including other factions' features. Those other features stay. |
| `feature_parts` | Delete parts of this faction's features. |
| `problems` | Delete this faction's problems. |
| `interests` | Delete edges where either side is this faction. |
| `features` | Delete this faction's features. |
| `factions` | Delete this row. |

Delete parts, problems, and interests before features, and features before the faction. Foreign keys are on.

Faction Dominion on the deleted row is not added to the hero. The hero's Influence, Dominion, Words, and level stay as they were.

These rows are left in place: the new `set_theology` action (its `actor_id` is the removed faction id), any `write_queue` row for that id, and any frozen unit view. This call does not discard a queued plan. A later apply that still names the removed id will not find a faction. No new error code is added for that.

No `events` row is inserted. In particular, no `faction_collapsed` row.

### Income

`advanceMonth` pays cult Dominion only when `divinity` is `cult` and `cult_faction_id` is set and that faction row still exists. Clearing `cult_faction_id` is what stops the pay. Do not edit that condition, and do not edit `cultIncome`. After this call, `cultIncome` reports grant 0 for that hero because the link is null, while `divinity` is still `cult`.

`setDivinity` is unchanged. This call does not set divinity to `free` or `none`. After the link is cleared, the existing guard that requires `gmOverride` to leave a cult no longer sees a `cult_faction_id`. That is the current guard, not a new lock.

### Tool description

The `set_theology` description in `src/mcp/register.ts` becomes:

`Change cult theology. Costs 1 Power and the internal action. A Power 1 cult stops being a faction.`

The input schema is unchanged.

## Docs and play copy

In `docs/design/glossary.md`, insert this section after **Chart catalog** and before **Fact**:

```markdown
## Cult

A **cult** is a faction bound to a hero whose divinity is `cult`. `set_theology` costs that cult 1 Power and its internal action. At Power 1 the cult stops being a faction: the faction row is removed, divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain, and they do not pay cult Dominion. This is not a collapse.
```

In `docs/design/current-engine.md`, insert this section after **Turns, units, and the write queue** and before **Visibility and rumors**:

```markdown
## Cult theology

`set_theology` costs the cult 1 Power and its internal action. A Power 1 cult stops being a faction: the faction row is removed, the hero's divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain as public facts, and they do not pay cult Dominion. This is not a collapse.
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `set_theology` bullet with:

```markdown
- `set_theology`: changes a cult's harshness or feature text. It costs the cult 1 Power and its internal action for the turn. A Power 1 cult stops being a faction: divinity stays `cult`, the hero's faction link is cleared, and the leftover worshipers and cult gift remain without paying cult Dominion.
```

Leave the `form_cult` bullet as it is, including its spelling of worshippers. The fact sentence uses the issue's spelling, `worshipers`.

`user/skills/gdnr-player/references/gdnr-play.md` does not say a Power 1 cult collapses. Leave it.

Leave the cult gap bullets in `docs/design/overview.md`. They are about `form_cult` pricing and about `set_theology` resetting an omitted harshness. They are not this ruling.

Do not edit `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md` or its plan. That file states the old collapse and is historical.

No file under `.cursor/prompts/` or `.cursor/skills/` states this rule. Leave them.

Play copy stays inside `user/` and does not link outside `user/`.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/services/set-theology-end.test.ts` opens an in-memory database and calls `setTheology`.

- A Power 1 cult with two features, a character, a court, a change, an interest from another faction, a feature aimed at the cult, faction Dominion 4, and a queued plan returns `{ ended: true, factionId, giftTexts, factIds }`. The faction, its features, parts, problems, and interests are gone. No faction row has status `collapsed`. No `faction_collapsed` event exists. No faction has Power 0. The hero's divinity is `cult`, `cult_faction_id` is null, and Dominion is still 0. Gift facts are public, subject `hero`, statements equal to the feature texts in id order, then the worshiper sentence. The character, court, and change remain, with the faction pointers null. The other faction and its feature remain, with `aimed_at_faction_id` null. The queued plan stays `queued`. A `set_theology` action with outcome `success` exists for the removed id.
- The same call with no patron and a home place writes those facts with subject `place`.
- The same call with no patron and no home place still returns `ended: true` and the gift texts, with `factIds` empty, and deletes the faction.
- A Power 1 cult with a patron and no features still ends. `giftTexts` is empty, and the only fact is the worshiper sentence on that hero.
- A Power 1 cult that already has `build_strength` on the open turn returns `INTERNAL_BUDGET` / `internal action already taken`. The faction, the link, and divinity stay. No fact is inserted.
- A faction with `cult` 0 returns `ENTITY_NOT_FOUND` / `cult faction not found` and stays `active`.
- A Power 2 cult passed `harshness: "sharp"` and a new feature text becomes Power 1, cohesion 1, harshness `sharp`, with that feature text, the hero link intact, no new fact, and no `faction_collapsed` event.
- After a Power 1 cult ends, `advanceMonth` adds 0 Dominion for that hero and `cultIncome` reports grant 0. A second hero whose cult is still Power 1 and `nominal` gains 1 Dominion, and `cultIncome` reports grant 1.

No test reads `docs/` or `user/` and asserts on that file's text.

## Out of scope

- Collapse when Trouble reaches the action die, and collapse when cohesion reaches 0.
- Treating `docs/superpowers` as living truth. The 2026-09-21 faction spec states the old collapse and is not edited.
- Cult formation gates and harshness pricing, including the overview gap that an omitted harshness becomes `nominal` and that intrinsic texts cannot be edited.
- A third faction status, or storing Power 0.
- A new event type for this end.
- Moving the faction's Dominion onto the hero.
- Changing `setDivinity`, `advanceMonth`, or `cultIncome`.
- Discarding or rejecting a queued plan for the removed faction.
- Extending `create_fact` to accept subject `hero`.

## Global constraints

- On Power 1 or less, `setTheology` deletes the faction. It does not set `status` to `collapsed`, does not write `cohesion`, does not write `power`, and does not insert `type` `faction_collapsed`.
- Hero `divinity` stays `cult`. Every `cult_faction_id` that pointed at the removed faction becomes null.
- The worshiper fact statement is exactly `Worshipers remain, and they are not a faction.` Each gift fact statement is that feature's `text`, features ordered by `id` ascending.
- Fact subject is `hero` when `patron_hero_id` is a hero in the campaign, otherwise `place` when `home_place_id` is a place in the campaign, otherwise no facts are written.
- The return on this path is `{ ended: true, factionId, giftTexts, factIds }` and has no `collapsed` field.
- `INTERNAL_BUDGET` / `internal action already taken` still aborts before any of these writes.
- The Power greater than 1 path is unchanged.
- Faction status values stay `active` and `collapsed` only. No schema change.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.
