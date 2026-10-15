# wealthSpent buys Influence coverage

> Status: draft for issue #101. Living engine gaps: [`docs/design/overview.md`](../../../docs/design/overview.md).

## Purpose

Spending Wealth on a change buys Influence-equivalent coverage. That spend leaves the hero's Influence pool alone.

Issue #101 already decided the product shape:

- Route `wealthSpent` through `influenceFromWealth`.
- Reduce Wealth by the amount spent and add that converted coverage.
- Do not debit the existing Influence pool for that spend.
- The closed probe's inverted finding is the regression case.

There is no **Open questions** section on the issue. The choices below are the ones the issue left to this spec.

Today `commitResources` in `src/services/change.ts` calls `influenceFromWealth(hero.wealth, wealthSpent)`. The second argument is `want`: desired Influence, priced at `want * (want + 1) / 2` Wealth. The influence that call returns is added to the debit of the hero's Influence pool. The commitment row stores the `influence` argument in `change_commitments.influence` and the raw `wealthSpent` argument in `wealth_spent`. `coveredOnChange` sums `dominion_spent` plus commitment `influence`, so the converted points never become coverage.

For a hero with Influence 4 and Wealth 6, `commitResources({ influence: 1, wealthSpent: 2 })` therefore ends at Influence 1, Wealth 3, and covered 1. The Wealth-to-Influence purchase lowered the Influence pool and did not raise coverage. That is the inverted finding the regression reverses.

## Approaches

**A. Pool every `wealthSpent` offer on the change, then convert the total. Recommended.**

`wealthSpent` is Wealth the hero pays into that change's pool. `commitResources` calls `influenceFromWealth(prior + wealthSpent)` with no `want`. `prior` is the sum of `wealth_spent` already stored on the change. The hero's Wealth falls by the full offer. The hero's commitment `influence` grows by the increase in `influenceFromWealth(...).influence`. The hero's Influence pool falls by the `influence` argument only.

A pool of 6 Wealth buys 3 Influence. Three heroes who each pay 1 Wealth hold a pool of 3 and buy 2 Influence between them. Leftover Wealth that cannot buy the next point stays in the pool and counts toward the next offer. This is the conversion in `src/rules/wealth.ts` and the worked case in the 2026-09-21 design: the triangle runs on the pooled total.

**B. Keep passing `wealthSpent` as `want`, and add the returned influence to coverage.**

`wealthSpent: 2` would spend 3 Wealth to buy 2 Influence. The argument would be a desired Influence count under a Wealth-named field. Issue #101 says to reduce Wealth by the amount spent. Rejected.

**C. Convert each offer with a fresh triangle, `influenceFromWealth(wealthSpent)`, and ignore earlier offers.**

Each payment of 1 Wealth would buy 1 Influence. Three heroes paying 1 each would buy 3. The triangle would restart every call. Rejected.

## Shape

### Where the rule lives

`commitResources` in `src/services/change.ts`, inside the existing transaction, in place of the current `wealthSpent` block.

The rule is a service rule. It does not move into `src/rules/wealth.ts` and it does not move into `src/mcp/register.ts`. `influenceFromWealth` stays as it is, including the `want` argument other callers already use. The MCP handler stays `dbTool((a) => commitResources(db, a))`. The `commit_resources` input schema stays as it is.

`coveredOnChange` stays `dominionSpent + sum(change_commitments.influence)`. Bought coverage is stored in that `influence` column, so this sum already includes it. `wealth_spent` is the pool, not a second coverage term.

`withdrawInfluence` stays as it is. It returns the commitment's `influence` column to the hero's Influence pool and leaves `wealth_spent` on the row. Wealth is not refunded. A later offer still converts `influenceFromWealth` on the full pool, so points already returned to the hero are not bought a second time.

Hero Dominion is not read or written here.

### What one paid offer does

`prior` is `COALESCE(SUM(wealth_spent), 0)` on `change_commitments` for this `changeId`, read before this offer is stored.

When `wealthSpent` is omitted or `0`, Wealth, `wealth_spent`, and bought coverage stay as they were. The `influence` argument still follows the path it has today.

When `wealthSpent` is a positive integer and the hero's Wealth is at least that integer:

| Stored or returned value | Becomes |
| --- | --- |
| Hero Wealth | previous Wealth minus `wealthSpent` |
| Hero Influence | previous Influence minus the `influence` argument |
| Hero Dominion | unchanged |
| This hero's `change_commitments.wealth_spent` | previous plus `wealthSpent` |
| This hero's `change_commitments.influence` | previous plus `influence` plus the bought delta |
| Bought delta | `influenceFromWealth(prior + wealthSpent).influence - influenceFromWealth(prior).influence` |
| `covered` | `coveredOnChange` after those writes |

The bought delta is attributed to the hero who paid this offer. Other heroes' commitment rows stay as they were.

Worked calls, each starting from a new change unless a row says the pool continues. `influenceFromWealth` results used here: `(1) → 1`, `(2) → 1`, `(3) → 2`, `(4) → 2`, `(6) → 3`.

| Call | Pool after | Bought delta | Hero Wealth change | Hero Influence change |
| --- | --- | --- | --- | --- |
| `influence: 1`, `wealthSpent: 2`, hero Influence 4, Wealth 6, Dominion 8 | 2 | 1 | 6 → 4 | 4 → 3. Dominion stays 8. `covered` is 2. Commitment `influence` 2, `wealth_spent` 2. |
| `influence: 0`, `wealthSpent: 6`, hero Influence 5, Wealth 6 | 6 | 3 | 6 → 0 | Influence stays 5. `covered` is 3. |
| Three heroes, each `influence: 0`, `wealthSpent: 1`, each Wealth 1 | 1, then 2, then 3 | 1, then 0, then 1 | each 1 → 0 | each Influence stays 0. Final `covered` is 2. Commitment `influence` values are 1, 0, 1. Each `wealth_spent` is 1. |
| `wealthSpent: 4` from Wealth 10 and Influence 5, then `influence: 1`, `wealthSpent: 2` | 4, then 6 | 2, then 1 | 10 → 6 → 4 | Influence stays 5, then 5 → 4. Final commitment `influence` is 4 and `wealth_spent` is 6. |

A village-scope plausible change quotes a total of 1. The regression call covers 2, so that change's status becomes `active` when deeds and challenges are already met. Kind `fact` does not insert a Feature.

### What an unpaid offer does

Checks run in this order, before any write in the transaction. The first matching row is the error returned.

| Situation | Code | Message |
| --- | --- | --- |
| `influence < 0` | `INSUFFICIENT_INFLUENCE` | `cannot commit negative influence` |
| `wealthSpent < 0` | `INSUFFICIENT_WEALTH` | `cannot commit negative wealth` |
| `wealthSpent` greater than the hero's Wealth | `INSUFFICIENT_WEALTH` | `not enough wealth to commit` |
| hero Influence less than the `influence` argument | `INSUFFICIENT_INFLUENCE` | `not enough influence to commit` |

Each of those throws a `RuleError` before the Wealth update, the commitment write, and the Influence update. Hero Wealth, hero Influence, hero Dominion, commitment rows, and change status stay as they were.

An offer the hero can pay always leaves the hero, including Wealth that does not complete the next point. That remainder sits in `wealth_spent` until a later offer completes the point.

### Rows already stored

Existing `change_commitments` rows are not rewritten. The next offer on a change treats the stored `wealth_spent` sum as `prior`.

## Testing

`test/services/wealth-spent.test.ts` opens an in-memory database and calls `beginChange` and `commitResources`.

- The regression call is `influence: 1`, `wealthSpent: 2` on a hero with Influence 4, Wealth 6, and Dominion 8. It asserts Influence 3, Wealth 4, Dominion 8, `covered` 2, status `active`, commitment `influence` 2, and `wealth_spent` 2.
- Three heroes each paying `wealthSpent: 1` assert final `covered` 2, per-hero Wealth 0, per-hero Influence 0, and commitment influence 1, 0, 1.
- One hero with Influence 5 and Wealth 10 who pays `wealthSpent: 4`, then `influence: 1` and `wealthSpent: 2`, asserts the continuing pool: Influence 4, Wealth 4, commitment `influence` 4, `wealth_spent` 6.
- A hero with Wealth 3 who offers 4, a negative `wealthSpent`, and `influence: -1` together with `wealthSpent: 4` each leave Wealth, Influence, and commitments unchanged. The negative `influence` returns `cannot commit negative influence` even though the Wealth offer also exceeds the hero's Wealth. A hero with Influence 0 who commits `influence: 1` beside a payable `wealthSpent` returns `not enough influence to commit` and keeps Wealth 6.
- Two heroes, each starting at Influence 2 and Wealth 6: one commit omits `wealthSpent`, the other passes `wealthSpent: 0`. Each ends at Influence 1 and Wealth 6.

`test/rules/cost.test.ts` already locks `influenceFromWealth`. This change does not add a case there.

No test reads a documentation file or a prompt file.

## Docs

Delete this bullet from the known engine gaps in `docs/design/overview.md`:

```markdown
- `wealthSpent` debits the hero's Influence pool instead of adding coverage bought with wealth.
```

`docs/design/current-engine.md` stays as it is. `user/skills/gdnr-player/references/gdnr-play.md` stays as it is: coverage there is Dominion spent plus Influence committed, and bought coverage is stored as commitment Influence.

## Out of scope

- Letting hero Dominion fund changes. `commitResources` still does not read or write hero Dominion.
- Changing `influenceFromWealth`, including the triangular prices and the `want` argument.
- Refunding Wealth from `withdrawInfluence`, or stopping that function from returning bought Influence that sits in the commitment's `influence` column.
- Rewriting commitment rows that were stored before this fix.
- A new MCP argument, a schema change, or a handler that applies this rule itself.

## Requirements

- `wealthSpent` is the Wealth offered on this call. Omitted and `0` offer no Wealth.
- `commitResources` calls `influenceFromWealth(prior + wealthSpent)` and does not pass `want`.
- `prior` is `COALESCE(SUM(wealth_spent), 0)` on that change before this offer is stored.
- Hero Wealth decreases by `wealthSpent` when the offer is paid.
- The bought delta is `influenceFromWealth(prior + wealthSpent).influence - influenceFromWealth(prior).influence`.
- That delta is added to the paying hero's `change_commitments.influence`, together with the `influence` argument.
- Hero Influence decreases by the `influence` argument only.
- `change_commitments.wealth_spent` increases by `wealthSpent`.
- `coveredOnChange` stays dominion spent plus the sum of commitment influence.
- `influenceFromWealth` is unchanged.
- `commitResources` does not read or write hero Dominion.
- `withdrawInfluence` is unchanged.
- The MCP handler stays `dbTool((a) => commitResources(db, a))`. The `commit_resources` schema is unchanged.
- Checks run in this order: negative influence, negative wealth, wealth greater than the hero's Wealth, influence greater than the hero's Influence.
- `influence < 0` throws `RuleError("INSUFFICIENT_INFLUENCE", "cannot commit negative influence")`.
- `wealthSpent < 0` throws `RuleError("INSUFFICIENT_WEALTH", "cannot commit negative wealth")`.
- `wealthSpent` greater than the hero's Wealth throws `RuleError("INSUFFICIENT_WEALTH", "not enough wealth to commit")`.
- Hero Influence less than the `influence` argument throws `RuleError("INSUFFICIENT_INFLUENCE", "not enough influence to commit")`.
- Those failures write nothing.
- Regression: hero Influence 4, Wealth 6, Dominion 8, `influence: 1`, `wealthSpent: 2` ends at Influence 3, Wealth 4, Dominion 8, `covered` 2, commitment influence 2, `wealth_spent` 2.
- Three heroes each paying `influence: 0` and `wealthSpent: 1` from Wealth 1 end at `covered` 2, commitment influence 1 then 0 then 1, and each Wealth 0.
- A hero with Influence 5 and Wealth 10 who pays `wealthSpent: 4`, then `influence: 1` and `wealthSpent: 2`, ends at Influence 4, Wealth 4, commitment influence 4, `wealth_spent` 6.
- Delete the known-gap bullet about `wealthSpent` debiting the hero's Influence pool from `docs/design/overview.md`.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

## Acceptance

- Spending Wealth reduces Wealth by `wealthSpent`.
- The corresponding Influence-equivalent coverage is added on that hero's commitment and in `covered`.
- The Influence pool changes only by the `influence` argument.
- The regression test is the Influence 4 / Wealth 6 / `influence: 1` / `wealthSpent: 2` call, asserting Influence 3, Wealth 4, and `covered` 2.
