# Glossary and play: Feature, Problem, Trouble, Cohesion

> Status: design for https://github.com/horribleCodes/gardener/issues/51. Documentation only. Does not change MCP tools, `defaultRelevance`, or Contest arguments.

## Purpose

The living glossary and player-facing play guidance must match the strain-sheet fidelity for four words: **Feature**, **Problem**, **Trouble**, and **Cohesion**. Current play copy can teach catalog-domain mismatch as automatic marginality, and it leaves intrinsic versus holy-law Problems and culprit bands easy to misread.

## Decisions (locked)

- Add glossary entries in `docs/design/glossary.md` for Feature, Problem, Trouble, and Cohesion, using the definitions in this spec.
- Cite **intrinsic** as approximately the holy-law Problems concept, not as a claim that every Problem is intrinsic.
- State that culprit bands are a gardener compare implementation detail, not a separate book concept.
- Insert the play blurb in `user/skills/gdnr-player/references/gdnr-play.md` (hyphenated path), covering Faction sheet / Reading the dice: one Feature versus one Feature, Trouble derived, Cohesion equals Power, marginality is a GM call, and the uneven Contest bonus product summary.
- Remove or rewrite play/director wording that teaches catalog-domain mismatch as automatically marginal.
- Public copy contains no personal names.

## Out of scope

- Engine `defaultRelevance` and Contest argument changes (Contest fidelity card).
- Changing how Trouble checks pick a culprit in code.
- Changing Cohesion, Feature, or Problem schema.

## Approaches

1. **Glossary plus play rewrite (chosen).** Living `docs/design/glossary.md` becomes the naming source. Play copy teaches the sheet in the same words. Director copy is touched only where it currently over-teaches automatic marginality (today it does not).
2. Play-only rewrite, glossary later. Rejected: design work already uses those four words without entries.
3. Engine change in the same card so play can match code. Rejected: issue out of scope.

## Glossary entries (normative wording)

Place these as new `##` sections in `docs/design/glossary.md`, alphabetically among existing entries (Cohesion after Character / before Chart; Feature after Fact; Problem after Module; Trouble after Table). Wording may tighten but must keep every bullet of meaning.

### Feature

A **Feature** is a sentence-long tool on a faction sheet: what the group uses to act, resist, or be targeted. A Feature may have parts; it works until every part is gone.

Optional marks, used only for contest modifiers when they apply: size (`normal` or `vast`), quality (`normal` or `superior`), edged (code: `magical`), and origin (`native`, `improbable`, `impossible`). Those marks are product of the Feature, not a second sheet.

Heroes removing the person or thing a Feature names can delete that Feature with no contest (`apply_outcome`). That is an adventure override, not a turn action.

### Problem

A **Problem** is a scored affliction on the faction sheet, usually 1 or 2 points. Problems are the only sheet rows whose points sum into Trouble.

Some Problems are marked **intrinsic** in code. That flag is approximately the holy-law Problems concept: they are not shrinkable by the usual solve path (`NOTHING_TO_SOLVE` / `INTRINSIC_PROBLEM`). Not every Problem is intrinsic. Ordinary Problems are the ones a faction can work down.

### Trouble

**Trouble** is a derived number: the sum of the faction's Problem points. Callers never write it. A roll-over check succeeds only when the roll is greater than Trouble. Trouble at or above the action-die maximum collapses the faction.

On a failed roll-over check, play names a Problem as the reason. Gardener compares the failed face to contiguous **culprit bands** (each Problem covers a band as wide as its points, in stored order) so `get_faction` can show which Problem the face landed in. Culprit bands are that compare implementation. They are not a separate book concept and must not be taught as a third sheet row.

### Cohesion

**Cohesion** is the group's remaining integrity. It starts equal to Power (scale), never rises above Power, and at 0 the faction collapses. Restoring Cohesion is a paid internal action that needs a usable Feature.

## Play copy (normative content)

### Faction sheet

Add a short **Faction sheet** block immediately before **Reading the dice** in `gdnr-play.md`. Required points:

- The sheet the tools show is Features, Problems, Cohesion, Power, and Dominion. Trouble is not stored; it is the sum of Problem points.
- Cohesion starts equal to Power and cannot exceed Power.
- One Feature contests one Feature. Name which Feature each side used.

### Reading the dice (rewrite)

Replace the current bullets that define Trouble, culprit, contest, and domain-mismatch marginality with:

- A faction's action die follows its Power: d6, d8, d10, d12, d20 for Power 1–5.
- **Trouble** is derived (sum of Problem points). A check succeeds only when the roll is **greater than** Trouble.
- On a failure, narrate the failure as the fault of the Problem `get_faction` names for that roll. Do not invent a second mechanic called bands.
- In a contest, **one Feature versus one Feature**. The higher total wins; a tie goes to the higher Power, then to the defender.
- **Marginality is a GM call** (roll twice, keep the lower). Catalog domain mismatch is not automatically marginal. Do not teach domain mismatch as rulebook law. (The engine may still default that way; that is over-enforced implementation, tracked elsewhere. Play must not instruct agents to treat it as the rule.)
- Uneven contest bonus, for the Feature that is rolling, when those marks are actually set: +1 vast against a Feature that is not, +1 superior against one that is not, +1 edged when the edge matters, +1 if origin is improbable, +2 if impossible. A natural 1 suppresses the uneven bonus.
- When an attack succeeds, keep the existing defender-choice bullet (1 cohesion, sacrifice the defending Feature, or problem points).
- Keep the collapse bullet.

### Other play/director lines

- Keep the heroic-override paragraph that already uses Feature / Problem with capitals.
- `gdnr-direct.md` has no domain-mismatch marginality sentence today. Do not add one. No other director rewrite is required for this card unless a later pass finds the same teaching.

## Error handling and tests

Documentation-only. Tests, if any, are string guards that the play file does not contain “different domains the roll is marginal” (or equivalent automatic-mismatch wording) and that `glossary.md` contains the four headings.

## Self-review

- No TBD. Intrinsic ≠ every Problem. Bands are implementation. Marginality is a GM call. Contest fidelity engine work stays out.
