# Direct interest edge with an explicit nature

> Status: design for https://github.com/horribleCodes/gardener/issues/41. Implementation follows the paired plan. Does not change `seed_campaign` pairing or `extend_interest` contest rolling.

## Purpose

Only `seed_campaign` writes starting interest edges. `create_faction` leaves interests empty. There is no post-setup writer for a chosen interest nature (for example `spies`). `extend_interest` can grow an edge, and on a new edge it rolls nature rather than letting the caller set it.

Directors and tools cannot install a specific interest nature after setup.

## Decisions already on the issue

- After campaign setup, a caller must be able to create a directed interest edge whose nature is an explicit catalog nature, not a roll.
- `seed_campaign` starting-link rules stay as they are.
- Living docs and manuals that still describe seed-only edges are updated when this writer ships.

## Decisions made in this spec (issue left these to spec)

| Question | Decision |
| --- | --- |
| Tool shape | **New MCP tool** `set_interest`. Not a `nature` argument on `extend_interest` (that remains a turn contest that rolls nature on a new edge). Not `create_faction` (sheet only). Not `faction_action` (turn budget). |
| Overwrite nature on an existing edge | **No by default.** Same directed pair with a different nature fails `INTEREST_NATURE_MISMATCH` unless `replaceNature: true`. |
| Default points on a new edge | **1**, same as a successful `extend_interest` on a new edge. Caller may set `points` (integer ≥ 1, ≤ the owner's interest cap). Seed's die-maximum starting points stay a seed rule, not this writer's default. |

## Out of scope

- Auto-intervention / standing-order engine work from #35.
- Changing `seed_campaign` who-links-to-whom (#35 D21).
- Making `extend_interest` contests apply a caller-chosen nature when the caller still wants a rolled contest on a new edge.

## Approaches

1. **New director tool `set_interest` (chosen).** One write, no turn, no contest, required `nature`. Matches “install spies on this pair after setup.”
2. Optional `nature` on `extend_interest`. Rejected: mixes setup with a contest; the issue says not to make extend apply a chosen nature when the caller still wants a rolled contest.
3. `nature` on `create_faction`. Rejected: one faction has many possible counterparties; the writer is an edge, not a sheet field.

## Design

### Domain service `setInterest` (`src/services/populate.ts`)

```typescript
setInterest(db, {
  campaignId: string;
  fromFactionId: string;
  toFactionId: string;
  nature: InterestNature;
  points?: number;
  replaceNature?: boolean;
}): ServiceResult<{ interestId: string; fromFactionId: string; toFactionId: string; nature: string; points: number }>
```

Rules, in order:

1. `requireCampaign`. Both factions must exist in that campaign (`ENTITY_NOT_FOUND`).
2. `fromFactionId === toFactionId` → `FILL_INCOMPLETE` ("cannot set interest to self").
3. `nature` must be one of `alliance`, `rivalry`, `trade`, `marriage`, `spies`, `aid`, `tribute`. Invalid → `PICK_UNKNOWN`.
4. Cap is `interestCap(DIE_BY_POWER[from.power])`. If `points` is set and (`points < 1` or `points > cap`) → `FILL_INCOMPLETE` for `< 1`, `INTEREST_CAP` for `> cap`.
5. Load existing row `UNIQUE(from_faction_id, to_faction_id)`.
6. **No existing row:** INSERT with `points: input.points ?? 1` and the given nature. Return the new id.
7. **Existing row, same nature:** UPDATE `points` if `points` was passed; otherwise leave points. Return the existing id.
8. **Existing row, different nature:** if `replaceNature !== true` → `INTEREST_NATURE_MISMATCH`. If `replaceNature === true`, UPDATE nature and points (points omitted means keep current points).

No RNG. No action row. No open turn required. The reverse direction is a second call.

### MCP

Register `set_interest` next to the other setup writers (`create_faction` / `create_fact`). Description: create or update a directed interest edge with an explicit catalog nature (not a roll).

Zod: `campaignId`, `fromFactionId`, `toFactionId`, `nature` (enum of the seven ids), `points` optional int, `replaceNature` optional boolean.

Handler is `dbTool((a) => setInterest(db, a))` — no extra rules in the handler.

`docs/design/current-engine.md` MCP surface count goes from 48 tools to **49**. Add `INTEREST_NATURE_MISMATCH` to the common error-code list.

### Docs that currently claim the gap

When the writer ships (implement PR, not this spec PR):

- `user/skills/gdnr-director/references/gdnr-direct.md`: replace “there is no post-seed tool” with `set_interest`. Keep the warning that `create_fact` is not an edge. Keep `extend_interest` as a turn contest with rolled nature on new edges.
- `user/skills/gdnr-player/references/gdnr-play.md`: intent table and the closing “today the tools cannot write a chosen nature after seed” paragraph. Standing war / spies rows should name `set_interest`.
- `docs/design/overview.md` known gaps: do not add a new engine-gap line for this writer once it exists. Do not claim auto-intervention is fixed.

Add `INTEREST_NATURE_MISMATCH` to the player error table.

Public copy: no personal names.

## Testing

Service tests with two factions in an in-memory campaign:

- New edge `nature: "spies"`, omitted points → points 1, nature spies.
- New edge `points: 6` on Power 1 (cap 12) → 6.
- Power 1 `points: 13` → `INTEREST_CAP`.
- Self-edge → `FILL_INCOMPLETE`.
- Bad nature → `PICK_UNKNOWN` (if the service is called without Zod; MCP Zod also rejects).
- Second call same nature updates points.
- Second call different nature without `replaceNature` → `INTEREST_NATURE_MISMATCH` and the row unchanged.
- `replaceNature: true` changes nature.
- `extend_interest` on a missing edge still rolls nature (existing test remains; do not add a nature argument there).

## Self-review

Seed pairing unchanged. Extend still rolls. Default points 1. Nature overwrite is explicit. One new tool.
