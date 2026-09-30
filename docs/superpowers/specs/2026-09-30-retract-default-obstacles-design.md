# Retract silent defaultObstacles

> Status: design for https://github.com/horribleCodes/gardener/issues/52. Implementation follows the paired plan. Does not add ward or resister tooling.

## Purpose

Impossible and vast changes still get silent default mighty-deed and challenge quotas from `defaultObstacles` in `src/rules/cost.ts`. Quote and begin invent gates the caller did not choose, so “usually needs a deed” cannot be a GM call.

## Current behavior

`quoteChange` fills `deedsRequired` and `challengesRequired` with `input.deedsRequired ?? defaults.deeds` (same for challenges). `defaultObstacles` currently:

- Petty impossible village: 0 / 0
- `creature_population` at impossible or vast: deeds and challenges equal `SCOPE_COST[scope]`
- Plausible or improbable: 0 deeds; 1 challenge if scope is region/nation/realm
- Otherwise (impossible or vast): 1 deed; 1–6 challenges by scope (vast at least 2)

`beginChange` already accepts `deedsRequired` and `challengesRequired` and passes them into `quoteChange`. The MCP tools do not:

- `quote_change` has no deed/challenge arguments and never forwards them.
- `begin_change` has no deed/challenge arguments, so service-level overrides are unreachable from MCP.

Explicit `0` already wins over defaults because `??` does not treat `0` as missing.

## Decisions (locked)

- Stop `defaultObstacles` from silently assigning mighty deeds or challenge quotas for impossible/vast changes. The same silence rule applies to every magnitude and kind, including `creature_population` and large plausible/improbable scopes: omitted deed and challenge counts default to **0**.
- Default `deedsRequired` and challenge quotas to 0 until the GM or tool arguments set them.
- Extend `quote_change` and `begin_change` so callers can pass deed/challenge overrides, including explicit zero.
- Impossible/vast quote and begin paths must not inject automatic deed or challenge gates.
- Tests cover caller-set “usually needs a deed” behavior rather than a silent default.

## Out of scope

- Ward and resister tooling (separate Later effort).
- Changing Dominion/Influence totals, multipliers, or activation rules.
- Auto-creating challenge rows when a quota is set.

## Approaches

1. **Zero defaults plus MCP overrides (chosen).** Delete the silent table. `quoteChange` uses `input.deedsRequired ?? 0` and `input.challengesRequired ?? 0`. MCP `quote_change` and `begin_change` accept optional non-negative integers. Play copy that implies the quote will invent a deed is corrected in the implement PR.
2. Keep `defaultObstacles` for plausible/improbable only. Rejected: the issue defaults both counters to 0 until the caller sets them.
3. Invert `petty` to be the only zero path. Rejected: petty becomes unnecessary once the default is already 0.

## Design

### Rules (`src/rules/cost.ts`)

Remove `defaultObstacles`. `quoteChange` returns:

```
deedsRequired: input.deedsRequired ?? 0
challengesRequired: input.challengesRequired ?? 0
```

Reject negative integers in the MCP schema (`z.number().int().min(0)`). Domain `quoteChange` may assume the caller already validated; services pass through MCP-validated numbers. If a service is called with a negative, throw `FILL_INCOMPLETE` with message that deeds and challenges cannot be negative. Keep this check in `beginChange` (the write path) so non-MCP callers cannot store a negative quota.

`petty` remains on the quote for other meaning if any; it no longer changes deed/challenge defaults. Do not remove the `petty` argument in this card.

### MCP

`quote_change` input adds optional `deedsRequired` and `challengesRequired` (integers ≥ 0) and forwards them to `quoteChange`.

`begin_change` input adds the same two optional fields and forwards them to `beginChange` (already on the service input).

Omitted means 0. Explicit 0 means 0. Explicit 1 means the GM chose “usually needs a deed.”

### Play copy

`user/skills/gdnr-player/references/gdnr-play.md` step 4 currently says to record the deeds and challenges **the quote requires**. Rewrite that step so the quote does not invent those gates: the caller (GM) sets deeds and challenges on quote/begin when the fiction needs them, including zero. `record_deed` still counts a deed toward a change that has a quota.

Do not mention personal names.

### Tests

- `quoteChange` for impossible realm (and vast city, creature_population vast nation) with omitted counters → `deedsRequired === 0` and `challengesRequired === 0`. Totals (Dominion/Influence) unchanged from current multiplier math.
- `quoteChange` with `deedsRequired: 1`, `challengesRequired: 2` stores those values.
- `quoteChange` with explicit `0` on an impossible change stays 0.
- `beginChange` without overrides persists `deeds_required = 0` and `challenges_required = 0` for an impossible change.
- `beginChange` with `deedsRequired: 1` persists 1.
- Negative `deedsRequired` on `beginChange` → `FILL_INCOMPLETE`.

## Self-review

No remaining silent table. MCP and service agree. Wards/resisters untouched.
