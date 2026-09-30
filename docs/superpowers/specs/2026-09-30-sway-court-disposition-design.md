# Invert sway_court to disposition-only by default

> Status: design for https://github.com/horribleCodes/gardener/issues/53. Implementation follows the paired plan.

## Purpose

`sway_court` automatically creates an usurper or strife Problem on unprepared `control` (and play copy implies that), instead of writing disposition/fact by default. Control and favor should record how the court now sits. Inventing a Problem on every unprepared control outcome over-enforces a GM call.

## Current behavior

`swayCourt` in `src/services/populate.ts`:

- `favor`: upserts `court_dispositions` to `favor` and inserts a court fact (`statement` or the first catalog `minorRelationship` text).
- `control`: upserts disposition to `control`. If the court has `rules_faction_id` and `prepared` is not true, sets `factions.contested_control = 1` and inserts a 2-point cultural Problem with text `Usurpers and restorationists are moving against the new hand on the court.`
- `control` writes no fact.
- MCP `sway_court` already has `prepared?: boolean` and `statement?: string`.

Tests in `test/services/task11-review.test.ts` expect control to set `contested_control` and to write **no** fact.

## Decisions (locked)

- Treat control and favor outcomes as disposition-only by default: write the disposition and a fact; do not create a Problem.
- Create the usurper/strife Problem (unprepared `control` producing a 2-point Problem, plus `contested_control`) only when an explicit GM opt-in argument requests it.
- Update play (and director if needed) so copy no longer implies an automatic usurper Problem on control.
- Tests cover the default path and the opt-in path.

## Out of scope

- Crushing a court via `apply_outcome` and destruction-consequence facts.

## Approaches

1. **New opt-in `createProblem` (chosen).** Default both modes: disposition + fact, no Problem, no `contested_control` write. `createProblem: true` on `control` restores today's Problem + contested flag when the court rules a faction. Keep `prepared` on the schema so old callers do not break; it no longer gates Problem creation (both `prepared: true` and omitted behave as default: no Problem). If `createProblem` and `prepared` are both set, `createProblem` wins.
2. Invert the meaning of `prepared` so `prepared: true` creates the Problem. Rejected: that fights the current name and the existing “prepared takeover skips strife” reading.
3. Drop Problem creation entirely. Rejected: the issue wants an explicit opt-in, not deletion.

## Design

### Service `swayCourt`

Input adds `createProblem?: boolean` (default false).

Always:

1. Require campaign and court (`ENTITY_NOT_FOUND` if missing).
2. Upsert `court_dispositions` with `disposition = input.mode`.
3. Insert a court fact:
   - `favor`: `statement ?? loadCatalog().minorRelationship[0].text` (unchanged).
   - `control`: `statement ?? "The named target now holds control of this court."` (deterministic; do not roll a relationship line).

Problem path, only when `input.mode === "control" && input.createProblem === true && court.rules_faction_id`:

- `UPDATE factions SET contested_control = 1`
- Insert the existing 2-point cultural Problem using `USURPER_TEXT` and `nextProblemPosition`.

Otherwise do not insert a Problem and do not change `contested_control`.

`createProblem` on `favor` is ignored (no error). `prepared` is ignored for this rule.

Return still `{ factId, mode }` now that control also has a fact.

### MCP

`sway_court` description: record court favor or control as disposition and a fact; a Problem is created only if `createProblem` is true on `control`.

`inputSchema` adds `createProblem: z.boolean().optional()`. Keep `prepared` and `statement`.

Do not put the Problem rule in the handler; pass args to `swayCourt`.

### Play copy

In `user/skills/gdnr-player/references/gdnr-play.md` courts section, replace the control bullet that currently says “Unless `prepared` is set, the faction the court rules gets one 2-point cultural problem…” with:

- `favor` writes a fact about the court's disposition. Pass a `statement` that says what the court now favors.
- `control` writes disposition and a fact that the target holds the court. It does **not** add a Problem by default. Pass `createProblem: true` when the GM wants the 2-point usurper/strife Problem on the faction the court rules (and `contested_control`).

Keep the compelling-court fiction paragraph and the crushing-court `apply_outcome` paragraph.

### Tests

Update `swayCourt control on ruling court sets contested_control and disposition` to assert default control: `contested_control === 0`, zero Problems on the faction, one court fact, disposition `control`.

Add `swayCourt control with createProblem inserts the 2-point usurper Problem and contested_control`.

Keep the favor fact test.

## Self-review

Default is disposition+fact. Opt-in is the only Problem path. Crushing courts untouched. `prepared` is leftover, not a second invert.
