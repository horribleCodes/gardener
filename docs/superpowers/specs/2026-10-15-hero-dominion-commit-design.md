# Hero Dominion funds changes through commit_resources

> Status: draft for issue #100. Living engine docs: [`docs/design/overview.md`](../../../docs/design/overview.md). Play copy: [`user/skills/gdnr-player/references/gdnr-play.md`](../../../../user/skills/gdnr-player/references/gdnr-play.md). Director copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md).

## Purpose

Hero Dominion can pay for a PC change through `commit_resources`, not only through `create_champion`.

Issue #100 already decided the product shape:

- `commit_resources` accepts hero Dominion against eligible change costs.
- Full coverage and partial coverage follow the existing Influence and Dominion enforcement rules.
- Mixed Influence and Dominion keep the existing withdrawal order and accounting.
- Wealth must already convert into coverage instead of debiting Influence. That fix is on `main`.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec.

Today `commitResources` in `src/services/change.ts` loads only the hero's Influence and Wealth. Coverage is `coveredOnChange`: `changes.dominion_spent` plus the sum of `change_commitments.influence`. Nothing in this function increments `dominion_spent` or decrements `heroes.dominion`. The only hero Dominion debit in the tree is `createChampion` in `src/services/populate.ts`, a flat 8. Faction Aid and `expandChange` can raise `dominion_spent` from a **faction** pool, not from the hero.

A hero with Influence 3 and Dominion 8 who calls `commit_resources` with `influence: 3` on a village-scope impossible fact (quote total 4) therefore stays `pending` at `covered` 3, and the Dominion pool is untouched. Play copy already says coverage is Dominion spent plus Influence committed. The engine does not do that for hero Dominion.

## Approaches

**A. Optional `dominionSpent` on `commit_resources`, written onto `changes.dominion_spent`. Recommended.**

The call names how much hero Dominion this offer spends. The service decrements `heroes.dominion` and increments `changes.dominion_spent` by that amount. `coveredOnChange` already treats `dominion_spent` as spent coverage that `withdrawInfluence` does not return. Influence, Wealth conversion, feature landing, and decaying recovery stay on the paths they have today. The MCP handler stays `dbTool((a) => commitResources(db, a))`. This is the column the original change model already uses for mixed coverage.

**B. Store Dominion per hero on `change_commitments`.**

A new column would record who spent the Dominion so a later withdraw could target it. Dominion is spent, not committed. `withdraw_influence` returns Influence only. The original accounting is one `dominion_spent` total on the change. Rejected.

**C. Reuse `expand_change`'s `dominion` argument and debit the linked faction.**

`expandChange` already spends faction Dominion onto `dominion_spent`. Issue #100 is hero Dominion on `commit_resources`. Paying from the faction would let a hero without Dominion fund a change from a faction stockpile, and would still leave `create_champion` as the only hero debit. Rejected.

## Shape

### Eligible cost

An eligible cost is the quote total of a PC-owned change that `commitResources` already accepts: `quoteForChangeRow` / `quote.total`. Hero Dominion pays that total the same way committed Influence does, including impossible and vast magnitudes.

Not this change:

- `create_champion` stays a flat 8 Dominion and does not go through `commit_resources`.
- Faction Aid still adds faction Dominion to a plausible or improbable PC change through the existing Aid path.
- `expand_change` still pays a grown quote from Influence and **faction** Dominion. Growing a change with hero Dominion is not this issue.

`begin_change` with `kind: champion` still uses the quote formula, not 8. That mismatch stays out of scope.

### Where the rule lives

`commitResources` in `src/services/change.ts`, inside the existing transaction, after the current unpaid-offer checks and before coverage is read.

The rule is a service rule. It does not move into `src/rules/` and it does not move into an MCP handler body. `coveredOnChange` stays `dominionSpent + sum(change_commitments.influence)`. `withdrawInfluence` stays as it is: it returns that hero's commitment `influence` and leaves `changes.dominion_spent` and `wealth_spent` alone.

`commitResources` gains one optional argument: `dominionSpent?: number`. Omitted and `0` spend no Dominion.

The MCP tool `commit_resources` adds the same optional integer. The handler stays `dbTool((a) => commitResources(db, a))`. The return value stays `{ status, covered }`. The withdrawal assessment preview remains a known gap and is not added here.

### What one paid offer does

Load `heroes.dominion` with Influence and Wealth.

`paidDominion` is `input.dominionSpent ?? 0`.

When `paidDominion` is 0, hero Dominion and `changes.dominion_spent` stay as they were. Influence and Wealth follow the paths they have today.

When `paidDominion` is a positive integer and the hero's Dominion is at least that integer:

| Stored or returned value | Becomes |
| --- | --- |
| Hero Dominion | previous Dominion minus `paidDominion` |
| Hero Influence | previous Influence minus the `influence` argument |
| Hero Wealth | previous Wealth minus `wealthSpent` when that offer is paid |
| `changes.dominion_spent` | previous plus `paidDominion` |
| This hero's `change_commitments.influence` | previous plus `influence` plus the Wealth-bought delta |
| `covered` | `coveredOnChange` after those writes, using the new `dominion_spent` |

Worked calls. Village plausible fact quotes 1. Village impossible fact quotes 4. Deeds and challenges stay 0 unless the caller set quotas.

| Call | Hero start | After | `covered` | Status |
| --- | --- | --- | --- | --- |
| `influence: 0`, `dominionSpent: 4` on village impossible | Influence 3, Dominion 8, Wealth 0 | Influence 3, Dominion 4, `dominion_spent` 4 | 4 | `active` |
| `influence: 0`, `dominionSpent: 2` on village impossible | Influence 3, Dominion 8 | Influence 3, Dominion 6, `dominion_spent` 2 | 2 | `pending` |
| `influence: 2`, `dominionSpent: 2` on village impossible | Influence 3, Dominion 8 | Influence 1, Dominion 6, commitment influence 2, `dominion_spent` 2 | 4 | `active` |
| `influence: 1`, `wealthSpent: 2`, `dominionSpent: 1` on village plausible | Influence 4, Wealth 6, Dominion 8 | Influence 3, Wealth 4, Dominion 7, commitment influence 2, `dominion_spent` 1 | 3 | `active` |
| then `withdraw_influence` on the mixed village-impossible row | Influence 1, Dominion 6, covered 4 | Influence 3, Dominion 6, commitment influence 0, `dominion_spent` 2 | 2 | `decaying` |

A later `commit_resources` that pays the missing 2 as Dominion or Influence returns that decaying change to `active` without refunding the 2 already spent.

Over-coverage is allowed, matching today's Influence path: paying 4 Dominion onto a quote of 1 leaves `covered` 4 and `dominion_spent` 4.

Two heroes may each spend Dominion onto the same `dominion_spent` total. There is no per-hero Dominion column.

A feature change that reaches coverage, deeds, and challenges still inserts the Feature and one backlash Problem inside this same call. Dominion-only coverage is enough. A second call after `feature_id` is set still does not insert again.

### What an unpaid offer does

Checks run in this order, before any write in the transaction. The first matching row is the error returned.

| Situation | Code | Message |
| --- | --- | --- |
| `influence < 0` | `INSUFFICIENT_INFLUENCE` | `cannot commit negative influence` |
| `wealthSpent < 0` | `INSUFFICIENT_WEALTH` | `cannot commit negative wealth` |
| `dominionSpent < 0` | `INSUFFICIENT_DOMINION` | `cannot commit negative dominion` |
| `wealthSpent` greater than the hero's Wealth | `INSUFFICIENT_WEALTH` | `not enough wealth to commit` |
| hero Influence less than the `influence` argument | `INSUFFICIENT_INFLUENCE` | `not enough influence to commit` |
| hero Dominion less than `paidDominion` | `INSUFFICIENT_DOMINION` | `not enough dominion to commit` |

Each of those throws a `RuleError` before the Wealth, Influence, Dominion, commitment, and `dominion_spent` writes. Balances and change status stay as they were.

A mixed call that can pay Influence and Wealth but not Dominion still writes nothing.

## Testing

`test/services/hero-dominion-commit.test.ts` opens an in-memory database and calls `beginChange` and `commitResources`.

- Full coverage: village impossible fact, `influence: 0`, `dominionSpent: 4`, hero Influence 3 / Dominion 8. Asserts `covered` 4, status `active`, Influence 3, Dominion 4, `changes.dominion_spent` 4, commitment influence 0.
- Partial coverage: the same quote, `dominionSpent: 2`. Asserts `covered` 2, status `pending`, Dominion 6, `dominion_spent` 2.
- Mixed coverage: `influence: 2`, `dominionSpent: 2` on that quote. Asserts `covered` 4, status `active`, Influence 1, Dominion 6, commitment influence 2, `dominion_spent` 2.
- Mixed withdrawal: after that mixed commit, `withdrawInfluence` returns Influence 2, leaves Dominion 6 and `dominion_spent` 2, sets status `decaying`, and `covered` 2. A follow-up `dominionSpent: 2` with `influence: 0` returns status `active` and `covered` 4 without raising the Influence pool.
- Unpaid offers: `dominionSpent: -1` with `influence: 0` returns `cannot commit negative dominion`. `influence: -1` with `dominionSpent: 5` still returns `cannot commit negative influence`. `dominionSpent: 5` from Dominion 4 returns `not enough dominion to commit`. A call with payable `influence: 1` and `dominionSpent: 5` from Influence 3 / Dominion 4 writes nothing.
- Omitted `dominionSpent` and explicit `0` leave hero Dominion unchanged. The existing Wealth regression (`influence: 1`, `wealthSpent: 2`, Dominion 8) still ends at Dominion 8.
- Feature landing: village plausible feature, `influence: 0`, `dominionSpent: 1`, with `featureText` and `backlash`. Asserts status `active`, one Feature, one Problem, Dominion reduced by 1.

`test/services/wealth-spent.test.ts` stays as it is.

No test reads a documentation file or a prompt file.

## Docs

Delete this bullet from the known engine gaps in `docs/design/overview.md`:

```markdown
- Hero Dominion cannot be spent on changes; only `create_champion` debits it.
```

`docs/design/current-engine.md` does not list `commit_resources` arguments. Leave it as it is.

In `user/skills/gdnr-player/references/gdnr-play.md`, the Influence / Dominion bullets already say Dominion is spent and coverage is Dominion spent plus Influence committed. Add that `commit_resources` spends that Dominion through `dominionSpent`.

In `user/skills/gdnr-director/references/gdnr-direct.md`, next to `create_champion`, say PC change costs take hero Dominion on `commit_resources`, not on `create_champion`.

The `commit_resources` tool description becomes: `Commit influence, wealth, or Dominion to a change. When a feature change's coverage, deeds, and challenges are met, this call adds the Feature and one backlash Problem.`

## Out of scope

- Changing `create_champion`, including the flat 8 and the quote mismatch for `kind: champion`.
- Faction Aid paying Dominion onto a PC change.
- Hero Dominion on `expand_change`.
- Returning the withdrawal assessment preview from `commit_resources`.
- Storing per-hero Dominion on `change_commitments`.
- Refunding Dominion.
- Wealth conversion, which already lands coverage in the commitment `influence` column.
- PC Feature backlash and cult formation / theology.

## Requirements

- `dominionSpent` is the hero Dominion offered on this call. Omitted and `0` spend none.
- `commitResources` decrements `heroes.dominion` by `paidDominion` and increments `changes.dominion_spent` by the same amount when the offer is paid.
- `coveredOnChange` stays dominion spent plus the sum of commitment influence, and uses the updated `dominion_spent`.
- Hero Influence decreases by the `influence` argument only.
- Wealth conversion is unchanged.
- `withdrawInfluence` is unchanged: it returns commitment Influence, does not refund Dominion, and decays the change when coverage falls below the quote.
- Mixed coverage that then withdraws Influence leaves `dominion_spent` in place.
- Paying the remaining cost after decay, with Influence or Dominion, returns the change to `active` without repaying Dominion already spent.
- Full Dominion coverage of the quote, with deeds and challenges met, sets status `active`. Partial Dominion coverage leaves `pending` when the quote is not reached.
- A feature change that lands on Dominion-only coverage still inserts the Feature and one backlash Problem inside `commitResources`.
- `create_champion` is unchanged.
- The MCP handler stays `dbTool((a) => commitResources(db, a))`. The schema adds optional `dominionSpent: z.number().int()`.
- Checks run in this order: negative influence, negative wealth, negative dominion, wealth greater than the hero's Wealth, influence greater than the hero's Influence, dominion greater than the hero's Dominion.
- `dominionSpent < 0` throws `RuleError("INSUFFICIENT_DOMINION", "cannot commit negative dominion")`.
- Hero Dominion less than `paidDominion` throws `RuleError("INSUFFICIENT_DOMINION", "not enough dominion to commit")`.
- Those failures write nothing.
- Delete the known-gap bullet about hero Dominion on changes from `docs/design/overview.md`.
- Play copy names `dominionSpent` on `commit_resources`. Director copy distinguishes that spend from `create_champion`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

## Acceptance

- Hero Dominion can fully fund an eligible change.
- Hero Dominion can partially cover a change together with Influence.
- Mixed withdrawal leaves resource balances and the change outcome consistent: Influence returns, Dominion stays spent, and status follows remaining coverage.
- Tests cover full, partial, and mixed coverage.
