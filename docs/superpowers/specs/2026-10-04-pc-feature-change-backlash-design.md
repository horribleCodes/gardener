# PC feature change applies backlash once

> Status: design for issue #104. Not implemented on this branch. Living engine docs to update at implementation time: [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md).

## Purpose

A PC Feature change plants one backlash Problem, and only when `commit_resources` creates the Feature.

Issue #104 already decided the product shape:

- The Feature plus backlash inserted by `commit_resources` is the only backlash path for that change.
- A later `apply_outcome` must not add that backlash again.
- Player-facing text must not tell the player to apply it a second time.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec.

Today `commitResources` in `src/services/change.ts` inserts the Feature and one 1-point Problem when coverage, deeds, and challenges are all met, `kind` is `feature`, the change has a faction, and `feature_id` is still null. It stores both ids on the change and sets `status` to `active`. A second `commit_resources` does not insert again, because `feature_id` is set. `applyOutcome` with `addFeatureText` does not look at the change. It inserts another Feature and another 1-point Problem. Play copy then tells the caller to run `apply_outcome` when the change lands, so the same change is applied twice.

## Approaches

**A. `apply_outcome` accepts an optional `changeId` and refuses to add a Feature for that change. Recommended.**

`addFeatureText` without `changeId` stays the adventure override: one new Feature and one backlash Problem, for a structure that is not a change project. `addFeatureText` with `changeId` inserts nothing. A feature change that already has `feature_id` returns `CHANGE_ALREADY_LANDED`. Any other identified change returns `CHANGE_NOT_READY`. The guard lives in `applyOutcome`, before either insert. Play copy stops telling the caller to land the change with `apply_outcome`.

**B. Stop inserting backlash from every `apply_outcome` `addFeatureText`.**

A concrete act that creates a structure would no longer plant backlash. That drops the adventure-override rule and the existing test that a lone `addFeatureText` inserts the catalog backlash row. Issue #104 limits the duplicate to the same change. Rejected.

**C. Treat matching Feature text as the same change, with no new argument.**

`apply_outcome` would skip the insert when `addFeatureText` equals a Feature this faction already gained from a change. A reworded call would still double. A second structure that happens to use the same words would be blocked. Rejected.

## Shape

### Where the guard lives

`applyOutcome` in `src/services/change.ts`, inside the existing transaction, in the `addFeatureText` branch, before `insertFeatureFromText` and `insertBacklashProblem`.

The guard is a service rule. It does not move into `src/rules/` and it does not move into `src/mcp/register.ts`. The MCP handler stays `dbTool((a) => applyOutcome(db, a))`.

`commitResources` keeps its current insert. It still runs only when all of these hold:

- covered influence plus Dominion spent is at least the quote total
- `deeds_done >= deeds_required`
- `challenges_done >= challenges_required`
- `kind === "feature"`
- `faction_id` is set
- `feature_id` is null

`recordDeed`, `recordChallengeOutcome`, faction `enact_change`, and `resolveWithdrawal` stay as they are.

### What `changeId` means

`changeId` is optional on `apply_outcome`. It is read only when `addFeatureText` is also set. Remove, remove-part, and reduce keep their current order and do not read `changeId`. If `removeFeatureId` is set, that branch still returns before the add branch, even when `changeId` and `addFeatureText` are also present.

`requireCampaign` still runs first. An unknown `campaignId` is `CAMPAIGN_NOT_FOUND` and does not reach the guard.

When `addFeatureText` and `changeId` are both set, load that change and then:

| Situation | Code | Message | Details |
| --- | --- | --- | --- |
| No such row, or `campaign_id` differs, or `faction_id` differs (including null) | `ENTITY_NOT_FOUND` | `change ${changeId} not found` | `{}` |
| `kind` is not `feature` | `CHANGE_NOT_READY` | `change is not a feature change` | `{ changeId }` |
| `kind` is `feature` and `feature_id` is set | `CHANGE_ALREADY_LANDED` | `feature change already landed` | `{ featureId, backlashProblemId }` |
| `kind` is `feature` and `feature_id` is null | `CHANGE_NOT_READY` | `feature change lands in commit_resources` | `{ changeId }` |

`featureId` and `backlashProblemId` are the change row’s columns. `backlashProblemId` is whatever is stored, including null.

Each of those throws is a `RuleError` before any insert. The transaction rolls back. Feature rows, feature parts, and problem rows stay as they were. The change row stays as it was.

`addFeatureText` without `changeId` is unchanged: insert one Feature from that text and one 1-point backlash Problem (`backlash`, or `catalog.backlash[0]`), and return `{ featureId, backlashProblemId }`.

### What still plants a problem

| Call | Problem |
| --- | --- |
| `commit_resources` landing a feature change | One 1-point backlash. The only backlash for that change. |
| `apply_outcome` `addFeatureText` with no `changeId` | One 1-point backlash for that new structure. Not the change’s backlash. |
| `apply_outcome` `addFeatureText` with `changeId` | None. |
| A second `commit_resources` after `feature_id` is set | None. |
| Faction `enact_change` success | Unchanged. Its own 1-point problem. Not a second PC backlash. |
| `resolve_withdrawal` `leave_fragile` | Unchanged. A 1-point problem on a decaying change. Not this path. |

### Tool descriptions

`commit_resources` description becomes: `Commit influence or wealth to a change. When a feature change's coverage, deeds, and challenges are met, this call adds the Feature and one backlash Problem.`

`apply_outcome` description becomes: `Apply a scripted adventure outcome. addFeatureText without changeId adds one Feature and one backlash Problem. addFeatureText with changeId adds neither: CHANGE_ALREADY_LANDED if that feature change already landed, CHANGE_NOT_READY if it has not landed or is not a feature change, ENTITY_NOT_FOUND if that change is not on this faction in this campaign.`

Add `changeId: z.string().optional()` to the `apply_outcome` input schema. No other argument changes. `commit_resources` still returns `{ status, covered }`.

## Docs and play copy

Remove this known-gap bullet from `docs/design/overview.md`:

```markdown
- A PC feature change lands inside `commit_resources`, so a later `apply_outcome` for the same change adds the feature and its backlash twice.
```

Leave the other bullets in that section, including Dominion funding, wealth conversion, and deed activation.

In `docs/design/current-engine.md`, add `CHANGE_ALREADY_LANDED` to the common error-code list, next to `CHANGE_NOT_READY`.

In `user/skills/gdnr-player/references/gdnr-play.md`, replace the `apply_outcome` bullet under single concrete acts with:

```markdown
  - `apply_outcome` changes a faction with no dice: `removeFeatureId` when what a feature depended on is gone, `removeFeaturePartId` for one part of it, `reduceProblemId` with `reduceBy` to shrink a problem that is not intrinsic, or `addFeatureText` for a new structure that is not a change project. That new structure also adds a 1-point backlash problem (`backlash`, or the next catalog row). Passing `changeId` with `addFeatureText` does not add a Feature or a backlash. A feature change that already landed returns `CHANGE_ALREADY_LANDED`. A feature change that has not landed, or a change that is not a feature change, returns `CHANGE_NOT_READY`. An unknown change id returns `ENTITY_NOT_FOUND`.
```

Add these rows to the error table, directly under the `FILL_INCOMPLETE` row:

```markdown
| `CHANGE_ALREADY_LANDED` | This feature change already has its Feature and backlash. `commit_resources` recorded them. |
| `CHANGE_NOT_READY` | The call does not fit the change. `apply_outcome` was asked to add the Feature for a change that has not landed, or for a change that is not a feature change. The same code already covers a withdrawal that is not decaying and a deed when none remain. |
```

Replace steps 4 and 5 of the sprawling-ambition procedure with:

```markdown
  4. If the GM sets deed or challenge quotas on `quote_change` / `begin_change` (including explicit zero), record them with `record_deed`, `create_challenge`, and `record_challenge_outcome`. Omitted quotas are 0; the quote does not invent a mighty deed. Recording a deed or a challenge does not itself add the Feature. When the quotas are met, call `commit_resources` again.
  5. When `commit_resources` returns `active` for a feature change, that call has already added the Feature and its one backlash Problem. Do not call `apply_outcome` to add that Feature or that Problem again.
```

Leave the sentence that a Feature added by Influence or Dominion plants one backlash Problem. It does not name `apply_outcome`.

Play copy stays inside `user/` and does not link outside `user/`.

`user/skills/gdnr-player/SKILL.md` and `user/skills/gdnr-director/` do not describe this landing. Leave them.

The glossary sentence about removing a Feature with `apply_outcome` is a different rule. Leave it.

Do not edit historical specs or plans under `docs/superpowers/` except this design and its implementation plan.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

`test/services/feature-change-backlash.test.ts` opens an in-memory database and calls `beginChange`, `commitResources`, and `applyOutcome`.

- A plausible village feature change, paid with 1 Influence and a caller backlash string, becomes `active` with one Feature and one Problem whose text is that string.
- A second `commit_resources` of 0 Influence on that change leaves the Feature count and the Problem count unchanged.
- `apply_outcome` with that `changeId` and `addFeatureText` returns `CHANGE_ALREADY_LANDED` / `feature change already landed`, with `details.featureId` and `details.backlashProblemId` equal to the change row. Counts stay unchanged.
- The same change with `deedsRequired: 1`, after one `commit_resources`, has no Feature and no backlash. `apply_outcome` with its `changeId` returns `CHANGE_NOT_READY` / `feature change lands in commit_resources` and inserts nothing.
- A `kind: "fact"` change returns `CHANGE_NOT_READY` / `change is not a feature change` and inserts nothing.
- A change id on another faction, a change that belongs to another campaign, and an unknown change id each return `ENTITY_NOT_FOUND` / `change ${id} not found` and insert nothing.
- `addFeatureText` with no `changeId` still inserts one Feature and one catalog backlash Problem.
- `removeFeatureId` still removes that Feature when `changeId` and `addFeatureText` are also sent. The landed change’s Feature and backlash stay.

`test/mcp/apply-outcome-change.test.ts` lists tools through an in-memory MCP client. `apply_outcome`’s input schema has an optional `changeId` property, and `changeId` is not required. This is a schema check, not a check of description text.

The existing `test/services/kistelek.test.ts` case `applyOutcome addFeatureText inserts catalog backlash problem` stays and must still pass.

No test reads `docs/` or `user/` and asserts on that file’s text.

## Out of scope

- Dominion funding of changes. Hero Dominion still is not spent by `commit_resources`.
- Wealth-to-Influence conversion.
- Making `record_deed` or `record_challenge_outcome` re-check activation. A further `commit_resources` remains how a feature change lands after those quotas are met.
- The `commit_resources` return value. It stays `{ status, covered }`.
- Faction `enact_change` backlash, and the `leave_fragile` problem on withdrawal.
- Which catalog row backlash uses when the caller omits `backlash`. It stays the first row.
- Guessing that an `addFeatureText` without `changeId` was meant to repeat a change.

## Global constraints

- For a PC feature change, the only backlash insert is the one in `commitResources` when that call creates the Feature.
- `applyOutcome` reads `changeId` only in the `addFeatureText` branch, and only when `changeId` is set. That branch then inserts nothing.
- `CHANGE_ALREADY_LANDED` message is `feature change already landed`. Details are `{ featureId, backlashProblemId }` from the change row.
- A feature change with `feature_id` null returns `RuleError("CHANGE_NOT_READY", "feature change lands in commit_resources", { changeId })`.
- A change whose `kind` is not `feature` returns `RuleError("CHANGE_NOT_READY", "change is not a feature change", { changeId })`.
- A missing change, a change in another campaign, or a change whose `faction_id` is not the call’s `factionId` returns `RuleError("ENTITY_NOT_FOUND", "change ${changeId} not found")`.
- `addFeatureText` with no `changeId` still inserts one Feature and one backlash Problem.
- Remove, remove-part, and reduce do not read `changeId`. Their current order stays.
- The check throws before any insert in that branch. The transaction rolls back.
- Do not put this rule in `src/mcp/register.ts`. The handler stays a pass-through. The tool schema gains optional `changeId`, and the two tool descriptions change as specified.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.
