# How to play a Gardener campaign

## What you are simulating

A few factions (about three to six that matter; a slice of a larger power can be the faction) keep moving while the heroes adventure. Their month is **background**, not a fair war game.

After the dice, describe the result as rumor, news, or something the heroes could notice. Damage is abstract: name which part of the group was hurt and what happened in the fiction.

**Heroic acts override that background.** If the heroes remove the person a Feature names, that Feature is gone with no contest. If they spend Dominion to create a significant structure, the faction gains that Feature. A Feature added by Influence or Dominion also plants a one-point Problem for the backlash.

Narrate only what the tools recorded.

## Faction sheet

The tools show Features, Problems, Cohesion, Power, and Dominion. **Trouble** is not a stored field; it is the sum of Problem points. **Cohesion** starts equal to Power and cannot exceed Power. Contests are **one Feature versus one Feature**: name which Feature each side used.

## Reading the dice

- A faction's action die follows its Power: d6, d8, d10, d12, d20 for Power 1–5.
- **Trouble** is the sum of its Problems' points. A check succeeds only when the roll is **greater than** Trouble.
- On a failure, narrate the failure as the fault of the Problem `get_faction` names for that roll. Do not invent a second mechanic called bands.
- In a contest the higher total wins; a tie goes to the higher Power, then to the defender. A natural 1 on the kept die adds no bonus.
- Marginality is the caller's `marginal` on that contest. `marginal: true` rolls the action die twice and keeps the lower. Different feature domains leave the roll as one die.
- Before the contest, judge each feature against the one opposing it. `attackerBonus` and `defenderBonus` are integers from 0 to 3: add 1 if that feature is vastly larger, add 1 if it is vastly qualitatively superior, and add 1 if it has magical qualities or supernatural powers relevant to the contest. Omit a bonus and that side adds 0.
- When an attack succeeds, the defender picks one loss: 1 cohesion, sacrificing the feature it defended with, or `1 + max(0, attacker Power − defender Power)` problem points. NPC defenders pick whatever keeps them alive (`preserve_existence`). A player-controlled defender pauses the turn until the user chooses.
- A faction **collapses** when Trouble reaches its die maximum or cohesion reaches 0. A collapsed faction refuses actions with `COLLAPSED_FACTION`; queries about it still work.

### Reading a reply

Every reply is `{ ok, data, rolls, advisories, derived }`, or `{ ok: false, error: { code, message, details } }`.

- `advisories` are warnings that did not fail the call. Read them and pass on anything the user should know.
- After a mutation that touches a faction, read `derived.collapseMargin` (die maximum minus Trouble). Warn the user when it is 1 or 2; at 0 or below the faction has collapsed.

| Error | Meaning |
| --- | --- |
| `CAMPAIGN_NOT_FOUND`, `ENTITY_NOT_FOUND` | An id is wrong or belongs to another campaign. |
| `UNKNOWN_TO_UNIT` | A plan names an id that is not in that unit's frozen view. |
| `TURN_ALREADY_OPEN` | Finish or apply the open turn first. |
| `INTERNAL_BUDGET`, `EXTERNAL_BUDGET`, `DUPLICATE_EXTERNAL_TARGET` | The faction has used its actions for this turn, or already acted on that target. |
| `INTEREST_CAP` | The edge is already at twice the owner's die maximum. |
| `INTEREST_NATURE_MISMATCH` | The directed pair already has a different nature. Pass `replaceNature: true` or pick the existing nature. |
| `NO_USABLE_FEATURE` | The acting faction has no feature it can use for this. |
| `COLLAPSED_FACTION` | The faction has collapsed and cannot act. |
| `INSUFFICIENT_DOMINION`, `INSUFFICIENT_INFLUENCE`, `INSUFFICIENT_WEALTH` | Not enough to pay. |
| `NOTHING_TO_SOLVE` | No non-intrinsic problem to shrink, or Trouble is 0. |
| `FILL_INCOMPLETE` | A required field is missing (for example under `fill: require`, or `form_cult` without `acknowledged`). |
| `PICK_UNKNOWN` | A value is not a known chart key (for example a free-text behavior). |
| `WRITE_LOCKED` | Another write held the lock too long. Retry. |

## How a stretch of play moves

### 1. Read before acting

Keep director reads apart from what a character knows.

- **Director reads:** `get_world_brief`, `get_faction`, `interest_map`, `list_hooks`, and `list_rumors`. They show the whole world. Use them to run it, not as in-character knowledge.
- **In-character knowledge:** `get_unit_view`. It is the frozen snapshot of what one acting unit knows during an open turn, and it exists only for the units in that turn. In character, a player knows only what it shows.

Do not invent dice results or mechanical relationships that are not in the data.

A faction sees another faction at all only if they share a home or parent place, it holds interest in that faction, that faction holds non-spy interest in it, or a fact it can see names that faction. What it sees then depends on the interest it holds:

| Interest held | Also sees |
| --- | --- |
| none | name, Power, home, and features that are not covert |
| `rivalry` | military features (covert ones too) and military problems |
| `trade`, `marriage`, `tribute` | cultural and economic problems |
| `alliance`, `aid` | cohesion, Dominion, every feature, and every problem that is not intrinsic |
| `spies` with 1 or more points | the same as `alliance` or `aid` |
| `spies` at or above the spy's own die maximum | also the target's ruling court in full |

Spy interest aimed at a faction never shows up in that faction's own view.

### 2. Resolve what the heroes do this session

- A **single concrete act** (overthrow a monarch, smash a relic, break a foe) is an adventure outcome, not a change project:
  - `apply_outcome` changes a faction with no dice: `removeFeatureId` when what a feature depended on is gone, `removeFeaturePartId` for one part of it, `reduceProblemId` with `reduceBy` to shrink a problem that is not intrinsic, or `addFeatureText` for a new structure. An added feature also adds a 1-point backlash problem (`backlash`, or the next catalog row).
  - `record_deed` counts a mighty deed toward a change that needs one.
  - `record_shatter` records how an **already collapsed** faction ended (`splintered`, `conquered`, `abandoned`, or `other`). It does not collapse a faction and does not undo a collapse.
- How far an adventure should move the world is your judgment. As a guideline, a job can count as faction actions that succeed without a roll: one for a scene, two for a solid favor, three or four for a long or hard job, and it may also yield Dominion to the side it served.
- A **sprawling ambition** (make a town a trade hub, found an order, change a people) is a **change**. Pick scope (`village`, `city`, `region`, `nation`, `realm`) and magnitude (`plausible`, `improbable`, `impossible`, `vast`), then:
  1. `quote_change` — always quote before promising a cost
  2. `begin_change`
  3. `commit_resources`
  4. If the GM sets deed or challenge quotas on `quote_change` / `begin_change` (including explicit zero), record them with `record_deed`, `create_challenge`, and `record_challenge_outcome`. Omitted quotas are 0; the quote does not invent a mighty deed.
  5. `apply_outcome` when the change lands

Mundus wards raise the Influence cost of a change inside them. They do not block an immediate gift or miracle.

### 3. Warn about Influence before they commit

- **Influence** is committed, not spent. It returns to the hero when withdrawn, and the change may then decay.
- **Dominion** is spent. It makes a result last and is never refunded.
- A change moves from `pending` to `active` once its coverage (Dominion spent plus Influence committed) reaches the cost and its deeds and challenges are done. If withdrawing Influence drops coverage below the cost, it becomes `decaying`. Committing the difference again returns it to `active`.

Before an Influence change is committed, say whether it will hold if the hero stops shepherding it.

On withdrawal (`withdraw_influence`, `assess_withdrawal`, `resolve_withdrawal`):

- An opposed group undoes the change over a sensible time.
- New facts the locals cannot maintain slide back toward the old normal (goods and trained people remain; the system that produced them does not).
- Events that already happened stay true, but the hero no longer controls them.

A decaying change is settled with `resolve_withdrawal`:

- `undo`: the change's fact is superseded, and any feature it created is ruined.
- `leave_fragile`: the change stays, with a new 1-point problem.
- `stable`: the change holds on its own and is resolved.

Tell the user that before they spend.

### 4. Courts

Read `decision_makers` before the heroes lean on a court. It says who must agree for the court to act as a body:

| Structure | Who must agree |
| --- | --- |
| autocratic | The leader |
| figurehead | Every hidden controller; the public leader is not enough |
| shared | Everyone who shares authority |
| consensus | Every major actor |
| democratic | A majority of major actors |
| anarchic | Nobody; the court cannot bind itself, so each major actor is approached separately |

`sway_court` records how the heroes moved the court:

- `favor` writes a fact about the court's disposition. Pass a `statement` that says what the court now favors.
- `control` writes disposition and a fact that the target holds the court. It does not add a Problem by default. Pass `createProblem: true` when the GM wants the 2-point usurper/strife Problem on the faction the court rules (and `contested_control`).

Compelling a court by force fits a court with no real protection (a village’s elders). A great court is impractical to simply shove. That coercion rots legitimacy the longer it lasts is fiction for you to narrate, not a mechanic.

Crushing a court outright is `apply_outcome` on the faction it ruled, plus a `create_fact` from the court's destruction consequence (`list_hooks` shows it for courts the heroes have swayed).

### 5. Run the faction month

- **`run_faction_turn`** — each NPC faction picks a goal from its behavior and acts on it.
- **Directed faction** (the user is steering it) — it does not pick for itself:
  1. `open_parallel_turn`
  2. `get_unit_view`
  3. `submit_unit_plan`
  4. `submit_reaction` if a defender must choose
  5. `apply_write_queue`

Plan types: `idle`, `build_strength`, `enact_change`, `attack`, `extend_interest`, `aid`, `restore_cohesion`, `remove_interest`, plus standing orders to help or harm.

Each turn a faction gets at most one internal action and up to its Power in external actions, with at most one external action per target. A faction with `behavior: directed` idles unless it is given a plan, so keep NPC factions on a real behavior.

`faction_action` takes one action for one faction right now. It opens a turn if none is open and counts against the same budgets. Do not use it for a faction that already has a plan queued in the open turn; apply or replace that plan instead.

`resolve_attack` finishes a pending defender choice on an attack already in progress. It is not a separate battle.

### 6. Narrate the closed turn

Use `list_rumors` or the `faction-turn-narration` prompt. `list_hooks` is the next adventure when a faction the heroes care about is in trouble.

### 7. Advance the calendar

`advance_month` moves the calendar. It closes an open turn only when no plan or reaction is still queued; apply the queue or finish the reaction first. Cult Dominion accrues by the month (`cult_income`). Skipping time is how worship piles up; a campaign that never skips stays Dominion-poor. Encourage spending Dominion on changes rather than hoarding it.

## Intent → action

Interest **natures** are exactly these seven strings (both directions use the same set):

`alliance`, `rivalry`, `trade`, `marriage`, `spies`, `aid`, `tribute`

Each **direction** is its own edge: `from` faction → `to` faction, with `points` and `nature`. No self-edges.

**Auto-intervention:** On an **incoming** edge, `rivalry` and `spies` cause the owning faction to auto-intervene to **harm** the target during turn resolution. `alliance` and `aid` auto-intervene to **help**. Other natures do not auto-intervene on their own.


| User intent | What to call |
| --- | --- |
| Standing war, raids, political sabotage | `set_interest` with `nature: rivalry` (`from` → `to` matters). One battle this month: plan or `faction_action` type `attack`, then `resolve_attack` if the defender must choose. `resolve_attack` is not a war declaration. |
| Secret agents, blackmail, exposure | `set_interest` with `nature: spies` (`from` → `to` matters). |
| Selling to both sides, merchant dependence | `trade` edges. |
| Mutual defense or shared councils | `alliance`. |
| Relief, subsidies, advisors | `aid` as a nature, or the `aid` **action** to send help this month. |
| Kinship among elites | `marriage`. |
| Payments, hostages, acknowledged superiority | `tribute`. |
| Grow a tie during a month | `extend_interest` (contest, one point; nature **rolled** if the edge is new). |
| Tilt a contest with points already on an edge | `spend_interest`. |
| Weaken or drop a tie | `remove_interest`: 1 point per action from the acting faction's own outgoing edge. The edge is deleted at 0. |
| Color that mechanics must not see | `create_fact`, and say so plainly. |
| “What do we know?” | In character: `get_unit_view`. As director: the queries above, plus `world://` resources and `gm-briefing`. Those prompts are narration only. |

`attack` and `extend_interest` need `attackerFeatureId`, a feature the acting faction owns. The defender's feature is picked automatically if omitted.

After seed, use `set_interest` for a standing relationship with a chosen catalog nature. `extend_interest` still rolls nature on a brand-new edge during a month. As an alternative, you can use `create_fact` for narrative color **only**, and warn that goals and turn logic keyed on interests will not see it.
Do **not** silently store mechanical claims only in facts when the user expected mechanics.
