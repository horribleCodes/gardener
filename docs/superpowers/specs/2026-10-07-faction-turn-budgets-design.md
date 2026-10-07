# Faction turn budgets and spend_interest after-roll

> Status: design for issue #103. Not implemented on this branch. Living engine docs to update at implementation time: [`docs/design/overview.md`](../../../docs/design/overview.md), [`docs/design/current-engine.md`](../../../docs/design/current-engine.md), [`docs/design/glossary.md`](../../../docs/design/glossary.md). Play copy: [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md), [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

A faction's month is one turn. During that turn it may take one internal action, up to Power external actions, at most one of those against the same target faction, and any number of free actions. Spend Interest is a free action, and it is also the reaction other factions are offered when an action spends Dominion or a Trouble or Contest roll is about to be made or has just been made.

Issue #103 has no **Open questions** section. The decisions below are the ones the issue already made. The **Choices made here** section records the readings this spec had to pick so the plan can be implemented without a second design pass.

## Decisions already in the issue

- The action budget is per turn, not a counter stored on the month. Actions are chosen as the turn happens.
- One turn holds every faction's actions for that stored month. A slow faction may sit the month out at the GM's discretion.
- Spend Interest has four uses:
  1. A free action on the open turn, to steal Dominion from another faction.
  2. A reaction, before an action that spends Dominion, to steal Dominion. If the actor cannot pay after the theft, that action fails entirely.
  3. A reaction before a Trouble or Contest roll. One Interest point moves the target's roll by one. Interest only.
  4. A reaction after a Trouble or Contest roll. The same one-for-one move, and one Dominion per Interest point actually spent.
- The spender must have at least one Interest point in the faction they target. One spend per target faction per turn. A different target in the same turn is allowed.
- Stealing transfers only Dominion the target currently has. Extra Interest beyond that stockpile still is spent, and the surplus transfers nothing.
- A raised roll cannot pass the target's die maximum. A lowered roll cannot pass the target's die minimum.
- An action that can be reacted to offers every faction that has Interest in the relevant faction. If one of them spends, every faction that is still eligible is offered again. This repeats until every eligible faction has passed, or none remain.
- A faction with no positive Interest in that target, or that has already spent Interest on that target this turn, is not offered.

## Out of scope

- Advancing the calendar when a player finishes.
- Requiring every faction to take a turn each stored month.
- A second turn in the same month, including a faster "crisis" turn.
- Rewriting standing orders. They still fire only inside the planning faction's own attack or extend, only before comparison, and they still do not cost Dominion. A standing-order spend still inserts `spend_interest` and uses up that spender's once-per-target slot.
- Auto-spending from Interest nature. Natures still never spend on their own.
- Taking the write lock on every mutation. `faction_action` still does not take it.
- `set_theology`'s separate internal-budget check in `src/services/populate.ts`. It stays. `set_theology` does not open an Interest window.

## Choices made here

1. **Neighbor means the external action's target faction.** The existing `DUPLICATE_EXTERNAL_TARGET` rule is that limit. This change does not consult home places or `neighborKeys`.
2. **Die minimum is 1. Die maximum is `DIE_BY_POWER` for the target faction's Power** (`d6`, `d8`, `d10`, `d12`, `d20` for Power 1–5). The clamp applies to the **kept face**, not to the bonus-inclusive total. Origin and GM bonuses are reapplied after the clamp (`bonus` is 0 when kept is 1, otherwise unchanged). `total` may sit above the die maximum because of those bonuses.
3. **Each requested point moves the kept face by one.** `modifier` is a positive integer. `direction` is `raise` or `lower`, required for `before` and `after`.
   - **Before the roll:** the caller commits the full `modifier` in Interest immediately, without seeing the face. When the die is rolled, the face moves by `min(modifier, room to the clamp)`. Points past that room are spent and do not move the face. No Dominion.
   - **After the roll:** only points that move the face are spent. Dominion cost equals that same count. If the face cannot move, the call fails with `MODIFIER_EXCEEDS_DIE` and debits nothing.
4. **The compared number changes, and the outcome follows.** Trouble success uses the kept face (`kept > trouble`, or `kept <= trouble` when the check is inverted). Contest comparison uses the bonus-inclusive totals, then `resolveContest`. A winner change applies or reverses that action's consequences. A sacrificed feature is not restored; cohesion loss and problem damage are.
5. **The crisis choice is rejected.** Opening another turn while this `campaigns.month` already has a turn row fails with `TURN_ALREADY_TAKEN`. The historical "faster in a crisis" extra turn is that failure. `advance_month` is still how the next month's turn becomes legal.
6. **Skip is `faction_action` type `skip`.** It records the slow-faction choice on the open turn and does not open a turn. It is not an internal or external action. A later budgeted action by that faction on this turn fails `FACTION_SKIPPED`. Skip after a budgeted action fails `ALREADY_ACTED`. A second skip fails `FACTION_SKIPPED`. Skip does not block `spend_interest`.
7. **Offers pause interactive play and are passed inside `run_faction_turn`.** `faction_action` and `apply_write_queue` return `PENDING_INTEREST` when at least one faction is eligible. `run_faction_turn` passes every offer and spends nothing unless a standing order already does, so the one-shot mechanical path keeps resolving.
8. **A side that does not roll gets no before/after window.** No defender feature, and `willing: true`, are the current cases. Steal windows still run for Dominion costs.
9. **Free steal** is `spend_interest` with `timing: "steal"` while no steal window is open for that target. It needs an open turn, spends no action slot, and obeys the once-per-target rule. While any Interest window is open, `spend_interest` must match that window's phase and subject.

## Approaches

**A. Interest windows on `write_queue`, executor stays `runAction`. Recommended.**

A new `src/services/interestWindow.ts` writes one `write_queue` row with `kind = 'interest'` and a JSON payload. `faction_action` and `applyFactionPlan` open that row and pause. `pass_interest` and `spend_interest` advance it. When the queue reaches the roll step, the coordinator calls `runAction` with internal kept-face deltas. After the roll, further spends adjust the stored roll and call one follow-through function. `run_faction_turn` passes `interestMode: "pass"` and never pauses. MCP handlers stay adapters.

**B. Caller-managed spends, no pause.**

`spend_interest` would keep working whenever a turn is open, and action tools would not offer anyone. That misses the issue's offer loop and the "before they act" steal. Rejected.

**C. Auto-spend from Interest nature.**

`rivalry` and `spies` would spend on their own. Living intent says natures never do that, and the issue says a faction is offered and may pass. Rejected.

## Shape

### Budget

`assertFactionBudget` lives in `src/services/factionBudget.ts`. `runAction` calls it before doing any work. `beginInterestWindow` calls it before inserting a window, so an action that is already over budget returns the budget error and does not offer anyone. `factionAction` stops keeping its own copy of the count. The helper is its own module so `actions.ts` does not import `turn.ts` (that import would cycle through `runAction`).

| Class | Types | Limit |
| --- | --- | --- |
| Internal | `build_strength`, `enact_change`, `restore_cohesion`, `set_theology` | 1 per faction per turn |
| External | `attack`, `extend_interest`, `aid`, `remove_interest` | up to Power, and one per `target_id` |
| Free | `spend_interest`, `skip`, `idle` | not counted |

An action recorded with `outcome = 'failed'` after a steal still has its real type, so it consumes the slot. `idle` still inserts nothing and consumes nothing.

Errors stay `INTERNAL_BUDGET` / `internal action already taken`, `EXTERNAL_BUDGET` / `external action budget exhausted`, and `DUPLICATE_EXTERNAL_TARGET` / `already acted on target`.

### One turn per stored month

`ensureOpenTurn` (`src/services/util.ts`):

- An open turn for the campaign is returned, as today.
- If none is open and a `turns` row already exists for this `campaign_id` and the current `campaigns.month`, throw `TURN_ALREADY_TAKEN` / `turn already taken this month`.
- Otherwise insert the turn, as today.

`openParallelTurn` keeps `TURN_ALREADY_OPEN` / `a turn is already open` when a turn is open. When none is open and this month already has a turn row, it throws `TURN_ALREADY_TAKEN` with the same message, and it does not insert.

`advance_month` is unchanged. The next month has no turn row, so a new turn is legal.

### Skip

`faction_action` handles `type: "skip"` before `ensureOpenTurn`.

- No open turn: `ENTITY_NOT_FOUND` / `no open turn`. Turns table unchanged.
- Faction missing or in another campaign: `ENTITY_NOT_FOUND` / `faction not in campaign`.
- A `queued` plan for that faction on the open turn: `PLAN_ALREADY_QUEUED` / `plan already queued`.
- An existing internal or external action row for that faction on this turn: `ALREADY_ACTED` / `faction already acted`.
- An existing `skip` row: `FACTION_SKIPPED` / `faction skipped this month`.
- Otherwise insert `actions` (`type = 'skip'`, `actor_type = 'faction'`, `outcome = 'skipped'`) and return `{ skipped: true }`.

A later budgeted `runAction` for that faction throws `FACTION_SKIPPED` / `faction skipped this month`.

### Who is eligible

For a subject faction S on the open turn, eligible spenders are factions F where all of these hold:

- An `interests` row `from_faction_id = F`, `to_faction_id = S`, `points >= 1`.
- F is not S.
- No `actions` row on this turn with `type = 'spend_interest'`, `actor_id = F`, `target_id = S`.

A pass is not that row. Passes live only in the window payload and clear when someone spends.

### Window

One `write_queue` row per open window:

| Column | Value |
| --- | --- |
| `kind` | `interest` |
| `status` | `queued` while the offer is open, `done` when the action has finished or failed |
| `unit_type` | `faction` |
| `unit_id` | the subject faction of the current phase |
| `payload` | JSON below |

```ts
type PhaseStep =
  | { kind: "steal"; subjectFactionId: string }
  | { kind: "before"; subjectFactionId: string }
  | { kind: "roll" }
  | { kind: "after"; subjectFactionId: string }
  | { kind: "resolve" };

type WindowPayload = {
  windowId: string;
  phase: "steal" | "before" | "after";
  subjectFactionId: string;
  actionId: string | null;
  round: number;
  passedFactionIds: string[];
  queue: PhaseStep[];
  cursor: number;
  pendingAction: { campaignId: string; factionId: string; action: FactionAction };
  beforeDeltas: { subjectFactionId: string; delta: number }[];
};
```

Phase order for an action:

1. `steal` on the actor, only when the action has a Dominion cost greater than 0.
2. `before` on each faction that will actually roll, actor first, then the other contest side.
3. `roll`.
4. `after` on those same rolling factions, same order.
5. `resolve`.

Dominion costs, read before the action runs:

| Action | Cost |
| --- | --- |
| `enact_change` | `factionProjectCost(power, magnitude)` |
| `restore_cohesion` | `restoreCohesionCost(power)` |
| `aid` | `amount ?? 1` |
| anything else | no steal step |

Rolling sides:

| Action | Who rolls |
| --- | --- |
| `build_strength`, `enact_change`, `restore_cohesion`, `aid` | the actor |
| `attack`, `extend_interest` | the actor, and the defender only when the defender has a feature |
| `remove_interest` | both sides, unless `willing: true` |
| `idle`, `skip`, `set_theology` | nobody, and no window |

A phase whose eligible list is empty is skipped. If every phase through `roll` is empty, `runAction` runs in the same call and the after phases are considered next. If those are also empty, the call returns the action result and writes no interest row.

`apply_write_queue` returns `{ paused: true, interest: { ... } }` when an interest row is `queued`, and it does not resume later units. It does not put that pause in `defenderUnit`. A queued defender reaction is handled only when no interest row is `queued`.

`run_faction_turn` calls `applyWriteQueue` with `interestMode: "pass"`. That mode marks every eligible faction as passed at each offer, then continues, and returns the action result. It is not an MCP argument.

### Pause and resume

Pending result, from `faction_action`, `apply_write_queue`, `spend_interest`, and `pass_interest`:

```ts
{
  pending: true,
  code: "PENDING_INTEREST",
  windowId: string,
  phase: "steal" | "before" | "after",
  subjectFactionId: string,
  eligibleFactionIds: string[],
  actionId: string | null
}
```

`pass_interest` arguments: `campaignId`, `fromFactionId`, `toFactionId`. `toFactionId` must be the open window's subject, and `fromFactionId` must be eligible and not already in `passedFactionIds` this round. Otherwise `NOT_PENDING` / `no interest window`. A pass appends the id. When every eligible id has passed, the coordinator advances. Otherwise it returns the same pending object with the remaining ids.

`spend_interest` while a window is open must use that window's phase as `timing` and that subject as `toFactionId`. Any other timing or target is `NOT_PENDING` / `no interest window`. A successful spend:

- Inserts `spend_interest` (`outcome = 'success'`) and debits as in the charge rules.
- Clears `passedFactionIds`.
- Recomputes eligible factions. The spender is already ineligible.
- If any remain, increments `round` and returns pending.
- If none remain, advances.

`before` spends add `direction === "raise" ? modifier : -modifier` to `beforeDeltas` for that subject and debit the full `modifier` in Interest now.

`after` spends call `movedKeptFace` on the stored kept face. `spent === 0` throws `MODIFIER_EXCEEDS_DIE` / `roll cannot move past the die` and rolls the transaction back. Otherwise debit `spent` Interest and `spent` Dominion, set `kept`, recompute `bonus` and `total`, and call `followRolledAction`.

`steal` inside a steal window transfers `min(modifier, target.dominion)` and debits the full `modifier` in Interest. The report field is `stolenDominion`. The target's pending-action recheck in today's `spendInterest` goes away; the window's post-steal check replaces it.

Free `steal` (no steal window open, and no other window open) keeps today's transfer math and the once-per-target error `INTEREST_ALREADY_SPENT` / `already spent on target`.

`before` or `after` with no open window is `NOT_PENDING` / `no interest window`. Missing `direction` on those timings is `FILL_INCOMPLETE` / `direction must be raise or lower`. `modifier < 1` is `MODIFIER_EXCEEDS_DIE` / `modifier must be at least 1`.

`spendInterest` no longer calls `interestModifier`. That function stays as it is for its rule test and is not the clamp.

### Roll and follow-through

`RunActionInput` gains an internal `interestDeltas?: Record<string, number>` (faction id to signed kept-face delta). It is not a unit-plan field and not an MCP argument. `faction_action` rejects a caller-supplied `interestDeltas` with `FILL_INCOMPLETE` / `forbidden action field: interestDeltas`.

At roll time the coordinator sums `beforeDeltas` per subject into `interestDeltas` and calls `runAction`. Each rolled face starts as it does today (including forced rolls). The delta is then applied with `movedKeptFace` one point at a time in the delta's direction, so the clamp holds. Contest `total` is recomputed from the new kept face and the existing bonus rule. Trouble success and the culprit band use `kept`, not the raw `natural`.

`runAction` applies before-roll deltas itself, so the first stored outcome already includes them. The `resolve` step does not apply those consequences a second time. `followRolledAction(db, actionId)` runs only after an after-roll spend changes the compared result (contest winner, or trouble success). It reads the stored roll and moves the outcome off whatever `runAction` already wrote. An after-roll spend that does not change the winner or the success bit updates `kept` and `total` only.

If that follow-through leaves a player defender on `PENDING_DEFENDER_CHOICE`, the interest row is set to `done` before that pause is returned. `submit_reaction` is unchanged from there.

Attack, when the winner changes:

| From | To | Effect |
| --- | --- | --- |
| `defender_win` | `attacker_win` | Same as a normal attacker win: NPC `chooseDefense`, or `PENDING_DEFENDER_CHOICE` when the defender is `player` and the attack did not carry `defenderChoice`. |
| `attacker_win` | `defender_win` | Outcome becomes `defender_win`. Cohesion +1 if the stored defense was `cohesion`. Problem points unwound if the stored defense was `problem` (delete the row if this action created it and points hit 0). A `sacrifice` defense stays deleted; the report includes `featureNotRestored: true`. |

The defense actually applied is stored on the roll payload as `defense: "cohesion" | "sacrifice" | "problem"`, plus `problemId` and `createdProblem` when the defense was `problem`.

`extend_interest`: flipping to `attacker_win` adds the point it would have added (still capped, `INTEREST_CAP` if the edge is already at the cap — the flip then does not add a point and the outcome stays `defender_win`). Flipping to `defender_win` removes that one point if this action added it, and deletes the edge at 0.

`remove_interest`: flipping to `attacker_win` removes one point (delete the edge at 0). Flipping to `defender_win` restores that one point on the same nature.

`build_strength`: failure to success grants `ceil(power / 2)` Dominion and sets `dominion_delta`. Success to failure removes that grant and sets `dominion_delta` to 0.

`aid`: the Dominion already left the actor on both success and failure. Flipping to success moves that amount from the actor's already-reduced pool onto the target (the actor does not pay twice). Flipping to failure pulls it back off the target if the target still has it; if the target has less, pull what they have and leave the rest destroyed. Outcome and `dominion_delta` follow.

`restore_cohesion`: the Dominion cost stays spent either way. Success to failure lowers cohesion by 1. Failure to success raises cohesion by 1, and still will not raise it above Power (`COHESION_AT_CAP` stops the raise; the roll's success bit still becomes `success` only when cohesion actually increases — if it cannot, the spend stands and the outcome stays `failure`).

`enact_change`: Dominion cost stays spent either way.

- Create or add-a-part, failure to success: perform the success writes (feature or part, and the backlash problem). Success to failure: delete the feature or part this action added, and remove the backlash point (delete that problem row if it was created here and is back to 0).
- Solve, failure to success: remove one point from the named problem (delete the row at 0). Success to failure: put that point back (reinsert the row if it was deleted, same id, text, domain, and position).
- A failed create that added a culprit point, flipping to success: remove that culprit point, then apply the success writes.

At the start of the `roll` step, before `runAction`: if this action has a Dominion cost and the actor's Dominion is now below it, insert the action with its real type, `outcome = 'failed'`, `dominion_delta = 0`, no roll, and return `{ failed: true, reason: "insufficient dominion" }`. Do not call `runAction`. The stolen Dominion stays stolen. Skip the `after` steps.

### Tools

`spend_interest` schema adds `direction: z.enum(["raise", "lower"]).optional()`. Description: `Spend interest on the open turn. before and after require direction and an open interest window. steal is a free action, or the reaction while a steal window is open for that faction. Returns PENDING_INTEREST when other factions are still eligible.`

New tool `pass_interest`:

- Description: `Pass an open interest offer. When every eligible faction has passed, the action continues.`
- Arguments: `campaignId`, `fromFactionId`, `toFactionId`, all strings.

`faction_action` description appends: `Returns PENDING_INTEREST when another faction may spend interest before the action continues. type skip records a slow faction on the open turn and does not open a turn.`

`apply_write_queue` description appends: `Returns paused with interest when a faction may spend interest. run_faction_turn passes those offers itself.`

Neither new call takes the write lock. That remains the known gap.

### Docs and play copy

Remove these two bullets from **Known engine gaps** in `docs/design/overview.md`:

```markdown
- `spend_interest` after a roll only relabels the outcome. Intent: the modifier applies to the stored roll before comparison, and the result follows.
- One plan applies as one action. Intent: one internal plus up to Power external actions.
```

Leave the standing-order bullet.

In `docs/design/current-engine.md`, add `TURN_ALREADY_TAKEN`, `FACTION_SKIPPED`, and `ALREADY_ACTED` to the common error-code sentence.

Replace the **Budgets** bullet with:

```markdown
- **Budgets.** One turn is one stored month. A second turn in that month returns `TURN_ALREADY_TAKEN`. On that turn each faction gets at most one internal action and up to Power external actions, at most one external action per target faction. `spend_interest` and `skip` do not use those slots. `faction_action` type `skip` records a slow faction and does not open a turn; a later budgeted action by that faction returns `FACTION_SKIPPED`.
```

Replace the `faction_action` bullet's budget sentence with:

```markdown
`faction_action` takes one action now. It opens the month's turn if none exists. If this month's turn is already closed, it returns `TURN_ALREADY_TAKEN`. It returns `PENDING_INTEREST` while another faction may spend Interest. `type: skip` records a slow faction on the open turn and does not open a turn.
```

Add:

```markdown
- **`spend_interest`.** Free steal on the open turn, or a reaction while a window is open. Before a roll, Interest only; after a roll, Interest and the same amount of Dominion. One spend per target faction per turn. The kept face stays inside 1 and that faction's die maximum. The outcome follows the new face. `pass_interest` declines an offer; a spend offers everyone still eligible again.
```

Add a glossary entry, after **Trouble**:

```markdown
## Turn

A **turn** is one stored month of faction actions. The campaign has one turn row for that month. A second turn in the same month fails. Each faction may take one internal action and up to its Power in external actions, at most one external action against a given faction. Spend Interest and a slow-faction skip are free. A skip is recorded on the open turn; it does not open a turn, and that faction takes no budgeted action afterward.
```

In `user/skills/gdnr-player/references/gdnr-play.md`, replace the budget paragraph in section 5 with:

```markdown
Each turn is one month. A second turn in that month returns `TURN_ALREADY_TAKEN`; advance the month before another turn. On the turn, a faction gets at most one internal action and up to its Power in external actions, with at most one external action per target faction. `spend_interest` does not use those slots. `faction_action` type `skip` leaves a slow faction out: it must be called on an open turn, it does not open a turn, and that faction then takes no budgeted action this month. A faction with `behavior: directed` idles unless it is given a plan, so keep NPC factions on a real behavior.

`run_faction_turn` passes every Interest offer and does not spend for those factions. When a faction should be offered the chance, use `faction_action` or `apply_write_queue`. A `PENDING_INTEREST` result names who may spend. Call `spend_interest` or `pass_interest` for each of them. A spend offers the remaining factions again.
```

Replace the `spend_interest` row in the intent table with:

```markdown
| Tilt a roll, or steal Dominion, with points already on an edge | `spend_interest`. `direction` is `raise` or `lower` on a roll. Before the roll costs Interest only. After the roll also costs that much Dominion. `timing: steal` takes Dominion the target actually has. |
```

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `spend_interest` bullet with:

```markdown
- `spend_interest` — spends points already on an edge. `timing: steal` is a free action on the open turn, or the reaction while a steal window is open. `before` and `after` need an open window and `direction` `raise` or `lower`. After the roll, Dominion cost equals the Interest that actually moved the kept face. The face stays inside 1 and the target's die maximum. One spend per target faction per turn. `pass_interest` declines the current offer.
```

Play copy stays inside `user/` and does not link outside `user/`.

Do not edit historical specs or plans under `docs/superpowers/` except this design and its implementation plan.

## Testing

`npm test` covers this. No server and no `./data` campaign file. Tests open in-memory databases, or a temp file when they call a tool that takes the write lock.

`test/services/faction-turn-budget.test.ts`:

- One internal action, then a second internal, returns `INTERNAL_BUDGET`.
- External actions stop at Power and at a repeated target (`EXTERNAL_BUDGET`, `DUPLICATE_EXTERNAL_TARGET`).
- A free `steal` after the external budget is full still succeeds and does not add a budgeted action.
- Closing the month's turn and opening another returns `TURN_ALREADY_TAKEN` from `openParallelTurn` and from `faction_action`, and does not insert a second `turns` row. That is the crisis choice.
- `advance_month` then `faction_action` opens a turn for the new month.
- `skip` with no open turn returns `no open turn` and inserts nothing.
- `skip` on the open turn records `type = 'skip'`. A later `build_strength` returns `FACTION_SKIPPED`. Skip after `build_strength` returns `ALREADY_ACTED`. A `steal` after skip still succeeds.

`test/services/spend-interest-reaction.test.ts`:

- `before` and `after` with no window return `NOT_PENDING`.
- Steal from a target with 0 Dominion spends the Interest, adds 0 Dominion, and reports `stolenDominion: 0`.
- A second spend against the same target returns `INTEREST_ALREADY_SPENT`. A spend against a different target succeeds.
- A faction with no positive edge is not in `eligibleFactionIds`. A faction that already spent is not offered again.
- Two eligible factions: the first passes, the second spends, the first is offered again and can spend. The spender is not in the new eligible list.
- Steal window before `aid`: the actor is left with less Dominion than the aid amount, the aid action is `failed`, no roll row is attached, and the external slot is consumed.
- After-roll `raise` on a lost attack (forced faces, attacker one or two below the defender, equal Power) becomes `attacker_win` and the NPC defender gains a problem. That is the lost attack that becomes a victory.
- After-roll `lower` reduces the attacker's kept face, costs that much Dominion, and a contest the attacker was winning becomes `defender_win` with no new problem. That is the hinder.
- After-roll `raise` on a failed `build_strength` (forced face equal to Trouble) makes `kept` greater than Trouble, outcome `success`, and Dominion increases by `ceil(power / 2)`. That is the roll change.

Update `test/services/turn.test.ts` spends that assumed `before` debits with no window: they expect `NOT_PENDING`. The steal test and the no-open-turn test stay. Do not weaken `test/services/task13-review.test.ts` or `test/store/lock.test.ts`; those attacks and idles have no eligible spender on a side that rolls. If `npm test` shows a new `PENDING_INTEREST` from an older test, pass that window in the test and keep the old assertions.

No test reads `docs/` or `user/` and asserts on that file's text.

## Global constraints

- Error `TURN_ALREADY_TAKEN`, message `turn already taken this month`, details `{}`.
- Error `FACTION_SKIPPED`, message `faction skipped this month`, details `{}`.
- Error `ALREADY_ACTED`, message `faction already acted`, details `{}`.
- Error `NOT_PENDING`, message `no interest window`, details `{}`, when a roll spend or a pass has no matching window.
- Error `MODIFIER_EXCEEDS_DIE`, message `roll cannot move past the die`, details `{}`, when an after-roll spend would not move the kept face. Message `modifier must be at least 1` when `modifier < 1`.
- Error `FILL_INCOMPLETE`, message `direction must be raise or lower`, details `{}`, when `before` or `after` omits `direction`.
- Pending code `PENDING_INTEREST`. Fields: `windowId`, `phase`, `subjectFactionId`, `eligibleFactionIds`, `actionId`.
- Kept face clamps to `1` through `DIE_BY_POWER[target.power]`.
- `run_faction_turn` passes Interest offers. `faction_action` and `apply_write_queue` pause.
- `interestModifier` is unchanged and is not called from `spendInterest`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on this spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.
