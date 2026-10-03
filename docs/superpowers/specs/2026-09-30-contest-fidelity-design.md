# Contest fidelity: origin bonuses and GM marginality

> Status: design for [issue #62](https://github.com/horribleCodes/gardener/issues/62). Design and implementation plan only. This pull request does not change the engine.

## Purpose

Contest resolution follows one rule: uneven bonuses are available on every feature-versus-feature contest, the only automatic bonus is the rolling feature's stored `origin`, and marginality is whatever the caller sets for that contest.

## Issue decisions

These are taken from the issue and are not reopened here:

- One feature versus one feature.
- Automatic +1 / +2 comes only from feature `origin` (`improbable` / `impossible`).
- Scale, quality, and magical or supernatural relevance for this contest are explicit caller inputs. Contest resolution does not read them off stored feature tags.
- A kept natural 1 still zeros the bonus.
- Remove `defaultRelevance` domain auto-marginal behavior in `src/rules/contest.ts` and `src/services/actions.ts`.
- Contest resolve paths accept caller `marginal` and qualitative edge inputs.
- Align `relevant_features` and player-facing text with these rules.
- Engine and player-facing text stay one change.
- Rewriting or migrating existing worlds, and broader authoring that would set feature marks at creation time, stay out of scope.

## Success criteria

| Criterion | How we know |
| --- | --- |
| Domain mismatch leaves the roll direct | Two features in different domains, with `marginal` omitted, each keep a single forced die. |
| Origin is the only automatic bonus | An `impossible` feature against another feature scores +2 with no edge object. A `vast` / `superior` / `magical` row with no edge object adds nothing. |
| Qualitative bonuses require caller input | `attackerEdge` / `defenderEdge` add the scale, quality, and supernatural bonuses defined below. |
| Natural 1 zeros the bonus | A forced 1 with origin `impossible` and every edge set stores bonus 0 and total 1. |
| Player-facing text matches | `user/skills/gdnr-player/references/gdnr-play.md` and `user/skills/gdnr-director/references/gdnr-direct.md` state this rule. `relevant_features` reports the origin bonus only. |

## Approaches

**A. Per-side edge facts, domain still scores them (chosen).** The caller states, for each side, whether that feature counts as vast, superior, and supernaturally relevant in this contest. `src/rules/contest.ts` adds the comparative scale and quality bonuses and the one-sided supernatural bonus, then adds origin from the row. Stored `size`, `quality`, and `magical` stay on the row for other rules and are unread here.

**B. Caller passes a finished integer.** The domain would add only origin, and the caller would add 0–3 qualitative points. That moves the +1 rules out of the domain layer.

**C. Opt-in tag reads.** Flags such as `useSize` would turn the old tag comparison back on. Creation paths still write `normal` / `normal` / not magical, so the opt-in would keep scoring 0, and the contest would still be inferring from tags.

## Contest rule

A contest is the feature named by the attacker against the feature named for the defender. Feature selection is unchanged: the attacker must own `attackerFeatureId`; an omitted defender feature is still chosen by `resolveDefenderFeature`. A defender with no usable feature still loses without rolling, and the attacker's uneven bonus is 0.

Each side that rolls uses `featureRoll` as it works today. `marginal: true` rolls the action die twice and keeps the lower. One `marginal` value covers both sides of that contest. Omitted `marginal` is false for both sides, including when the features' domains differ and when a goal strategy attacks with a non-military feature. `defaultRelevance` is deleted.

The kept natural 1 sets the bonus to 0. Any higher kept face adds the bonus below. The higher total wins; a tie goes to the higher Power, then to the defender. `resolveContest` stays as it is.

### Bonus

The bonus applies only when the other side has a feature. It is the sum of:

| Source | Amount |
| --- | --- |
| Rolling feature `origin` is `improbable` | +1 |
| Rolling feature `origin` is `impossible` | +2 |
| Rolling feature `origin` is `native` or any other stored string | +0 |
| This side's `vast` is true and the other side's `vast` is not | +1 |
| This side's `superior` is true and the other side's `superior` is not | +1 |
| This side's `edged` is true | +1 |

Origin is read from the feature row. It does not compare to the opponent's origin: an `impossible` feature still scores +2 against another `impossible` feature. Scale and quality are comparative. Supernatural relevance is one-sided, so both sides score +1 when both set `edged`. That matches the previous magical bonus, with the caller stating the relevance that used to be `magical && magicRelevant`.

Omitted edge objects and omitted fields are false. The maximum on one side is +5: impossible origin, exclusive vast, exclusive superior, and edged.

### Caller shape

On `attack` and `extend_interest`:

```ts
type ContestEdge = {
  vast?: boolean;
  superior?: boolean;
  edged?: boolean;
};

marginal?: boolean;
attackerEdge?: ContestEdge;
defenderEdge?: ContestEdge;
```

`vast` is the scale edge. `superior` is quality. `edged` is magical or supernatural relevance for this contest.

A present `marginal` or edge field that is not a boolean, or an edge value that is not an object, fails with `FILL_INCOMPLETE`. Absent fields mean false. The check lives in the domain module and is called from the action service. MCP handlers keep passing the action object through.

The same fields are legal on a unit plan. They are statements about the contest, so they stay off the forbidden-plan list (`forcedRoll`, `forcedAttackerRoll`, `forcedDefenderRoll`, `defenderChoice`). `extend_interest` with `willing: true` still skips the contest.

`RunActionInput` and `FactionAction` both carry these fields on `attack` and `extend_interest`. The `FactionAction` `extend_interest` variant also records `defenderFeatureId`, which `runExtendInterest` and the unit-plan schema already accept.

Goal planning in `src/services/turn.ts` stops setting `marginal: true` when `military_defeat` uses a non-military feature. Automated attacks omit `marginal` and both edge objects.

### `relevant_features`

The tool still lists a faction's features in the requested domain (`any` still lists every feature). `unevenBonus` is the origin bonus only:

- 0 when `opposingFeatureId` is omitted or matches no row
- the rolling feature's origin amount (0, +1, or +2) when the opposing row exists

Stored size, quality, and magical values are not added. The query does not take edge objects; those differ per feature and belong on the contest. The tool description says the number is the automatic origin bonus.

### Stored rolls

The roll payload stays the current `featureRoll` record plus winner and defender total. The bonus is the number already stored. No breakdown field is added.

### What stays on the feature row

`size`, `quality`, `magical`, and `origin` remain columns. Contest resolution reads `origin` only. Other rules that already read `origin` (for example beyond-local-maintenance) are unchanged. No migration runs. No create, seed, or enact-change path grows a way to write a non-native origin.

## Player-facing text

`user/` files repeat the rule in place. They do not link outside `user/`.

In `user/skills/gdnr-player/references/gdnr-play.md`, replace the contest bullet that treats different domains as marginal with:

- In a contest the higher total wins; a tie goes to the higher Power, then to the defender. A natural 1 on the kept die adds no bonus.
- Marginality is the caller's `marginal` on that contest. `marginal: true` rolls the action die twice and keeps the lower. Different feature domains leave the roll as one die.
- The only automatic bonus is the rolling feature's `origin`: +1 for `improbable`, +2 for `impossible`, and +0 for `native` or any other stored value. It applies when the other side has a feature.
- Scale, quality, and supernatural relevance are `vast`, `superior`, and `edged` on `attackerEdge` and `defenderEdge` for this contest. `vast` and `superior` each add +1 when this side has them and the other side does not. `edged` adds +1 for a side whenever it is true. Stored size, quality, and magical marks are unread.

In `user/skills/gdnr-director/references/gdnr-direct.md`, after the director-override paragraph, add:

On `attack` and `extend_interest`, `marginal`, `attackerEdge`, and `defenderEdge` state the contest. A unit plan may carry them. Omit them and the contest is one die per side with no scale, quality, or supernatural bonus. Different domains do not set `marginal`. Stored size, quality, and magical marks are unread. A feature's stored `origin` still adds +1 (`improbable`) or +2 (`impossible`) when both sides have a feature. No setup tool writes a non-native feature origin.

## Living gap list

Replace the overview bullet that says uneven bonuses are always 0 because no tool sets feature marks with:

- Contest uneven bonuses follow stored feature origin only (+1 `improbable`, +2 `impossible`) when both sides have a feature. Scale, quality, and supernatural edges are per-contest caller input. Domain mismatch does not set marginality. No play tool yet writes a non-native feature origin.

## Out of scope

- Authoring, seeding, or enact-change fields that set feature `origin`, `size`, `quality`, or `magical`.
- Migrating existing world files or rewriting stored ids.
- A per-side marginal flag, an `unusable` relevance, or `FEATURE_NOT_RELEVANT`.
- Changing tie-break, defender feature selection, willing extend, standing-order spends, or interest auto-intervention.
- A stored bonus breakdown.

## Testing

`npm test` covers this. No server and no `./data` campaign file.

- `test/rules/contest.test.ts` replaces the stacked-tag +5 expectation. Origin alone, explicit edges, a missing opponent, and a natural 1 are asserted on `unevenBonus` and `featureRoll`. `defaultRelevance` is gone.
- A service test attacks and extends with forced dice: domain mismatch keeps the forced face; stored vast/superior/magical add nothing; `impossible` adds +2; explicit edges add the table above; a non-boolean edge returns `FILL_INCOMPLETE`. A willing extend with a non-boolean `marginal` returns `FILL_INCOMPLETE` and writes no roll.
- `planFactionAction` for `military_defeat` with only a cultural feature returns an attack without `marginal`.
- `relevant_features` returns origin-only `unevenBonus`.
- A unit plan accepts `attackerEdge` and rejects a non-boolean `vast`.

## Global constraints

- Domain rules stay in `src/rules/`. Services coordinate. MCP handlers do not implement contest math and do not run ad-hoc SQL.
- One feature versus one feature.
- Automatic bonus is feature `origin` only: `improbable` +1, `impossible` +2, anything else +0, and only when the other side has a feature.
- Scale, quality, and supernatural relevance are `vast`, `superior`, and `edged` on `attackerEdge` and `defenderEdge`. Omitted means false. Stored `size`, `quality`, and `magical` are unread by contest resolution.
- `vast` and `superior` are comparative. `edged` scores +1 for that side whenever it is true.
- `marginal` is one boolean for the contest. Omitted means false. Domain mismatch does not set it. Goal planning does not set it.
- A kept natural 1 zeros the bonus.
- A non-boolean `marginal` or edge field fails with `FILL_INCOMPLETE`.
- `relevant_features` `unevenBonus` is the origin bonus against a resolved opposing feature, otherwise 0.
- No schema migration. No new authoring path for feature marks.
- Player-facing sentences live under `user/` and do not link outside `user/`.
- Every new or changed behavior has a test. `npm test` uses in-memory or temp databases.
