# `form_cult` caller-chosen behavior

> Status: design for issue #132. Not implemented on this branch. Living docs to update at implementation time: [`docs/design/current-engine.md`](../../../docs/design/current-engine.md). Play copy: [`user/skills/gdnr-director/references/gdnr-direct.md`](../../../../user/skills/gdnr-director/references/gdnr-direct.md). Parent: #128. Shared pairing rule later expanded on #133.

## Purpose

A cult formed by `form_cult` currently always stores `behavior: "directed"` with default `control: npc`. Mechanical turns then idle that cult. The caller must choose the stored behavior (and, when it is `directed`, who supplies the plan).

Issue #132 already decided the product shape. There is no **Open questions** section on that issue. The parent #128 question (required `behavior` argument versus creating the cult as `control: player`) is decided there: required `behavior`, optional `control`, no roll and no default behavior.

This spec fills the remaining implementation choices: where the #133 pairing check lives for this path, when `behavior` is required versus ignored, the exact error strings, the reply body, and the director copy for `control: player` versus `control: npc`.

## Approaches

**A. Required `behavior` and optional `control` on a new cult; shared pairing helper used only on that create path. Recommended.**

`formCult` stops hardcoding `directed`. A new cult stores the caller's `behavior` and `control` (`npc` when `control` is omitted). `directed` with table-driven control (`npc`, including omission) throws the #133 error and writes nothing. `directed` with `control: player` is stored. The pairing helper lives in the rules layer so #133 can call the same function on the other write paths. Adoption does not change the adopted row's pair.

**B. Omit `behavior`; default a catalog chart key.**

Rejected by the issue. Nothing is rolled or defaulted.

**C. Always create `control: player` with `behavior: directed`.**

Rejected by the issue. The caller chooses whether the cult acts on mechanical turns or waits for an outside plan.

## Shape

### Where the rules live

New helper `assertDirectedAllowed` in `src/rules/control.ts`. `formCult` in `src/services/populate.ts` calls it only when creating a cult. It does not call it on `adoptFactionId`. `createFaction` does not gain this check in this change; that is #133.

The MCP handler stays a pass-through. `src/mcp/register.ts` adds `behavior` and `control` and updates the `form_cult` description.

### New-cult arguments

`formCult` input gains:

```ts
behavior?: string;
control?: "npc" | "player";
```

MCP schema:

```ts
behavior: z.string().optional(),
control: z.enum(["npc", "player"]).optional(),
```

`behavior` is required for a new cult in the service, not in zod, so adoption can omit it.

Any non-empty string is stored as-is, matching `create_faction`. Catalog keys and `directed` are accepted. This change does not whitelist the five `Behavior` keys.

Omitted `control` stores `npc`, the same default as `create_faction`.

`GM`, `chart`, and `agent` are not accepted. Those values are out of scope.

### Pairing rule (the #133 error, new-cult path only)

```ts
export function assertDirectedAllowed(behavior: string, control: "npc" | "player"): void {
  if (behavior !== "directed") return;
  if (control === "npc") {
    throw new RuleError(
      "DIRECTED_NPC",
      "a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior",
    );
  }
}
```

`formCult` resolves `control` to `"npc"` when it is omitted, then calls this helper, then passes both fields into `createFaction`. Omitted `control` with `behavior: "directed"` is the same refusal as `control: "npc"`.

`control: "player"` with `behavior: "directed"` is stored. A catalog behavior with `control: "player"` is also stored; this change does not add a new restriction there.

#133 will call the same helper from `create_faction`, `seed_campaign`, adoption, and later behavior/control edits. This spec does not wire those paths.

### Adoption

`behavior` and `control` apply only to a new cult. `adoptFactionId` does not validate or rewrite the adopted pair. If the call passes `behavior` or `control` while adopting, the service returns `FILL_INCOMPLETE` / `behavior and control apply only to a new cult` and writes nothing.

### Reply

Success is `{ factionId, behavior, control }` with the values stored on the faction row after the write. A new cult echoes what this call stored. An adopted cult echoes the row as it already was. Nothing is coerced silently.

### Check order

Existing non-write gates stay first: acknowledged, campaign, hero, level, free divinity, harshness, `homePlaceId`.

Then:

| Situation | Code | Message |
| --- | --- | --- |
| New cult, `behavior` omitted or `""` | `FILL_INCOMPLETE` | `behavior required` |
| New cult, `behavior: "directed"` and `control` omitted or `"npc"` | `DIRECTED_NPC` | `a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior` |
| Adopt, `behavior` or `control` present | `FILL_INCOMPLETE` | `behavior and control apply only to a new cult` |

Those throws happen inside the existing transaction. It rolls back. No faction row, no hero `cult_faction_id` change, no Feature, no Problem.

Holy-law and `createFaction` run only after the new-cult pair is accepted. Adopted `ENTITY_NOT_FOUND` / `faction not found` still runs before the extra-argument check on that branch.

### Tool description

`form_cult` in `src/mcp/register.ts`:

`Bind a hero of level 2 or higher to a cult faction. A new cult requires behavior (any stored string, including directed). Optional control is npc or player and defaults to npc. directed requires control player; directed with npc or omitted control returns DIRECTED_NPC and writes nothing. The reply includes the stored behavior and control. Omit behavior and control when adopting. Requires gmOverride for free divinities. Optional homePlaceId must be a place in the campaign.`

## Docs and play copy

In `docs/design/current-engine.md`, add `DIRECTED_NPC` to the common error codes list.

Replace the new-cult paragraph under Cult theology (the one that starts "A new cult is created at Power 1") with:

```markdown
A new cult is created at Power 1 with no rolled Feature and no rolled Problems. `form_cult` requires `behavior` for that create and stores it; it does not roll or default a behavior. Optional `control` is `npc` or `player` and defaults to `npc`. `directed` means the plan comes from outside the tables; `control` says who supplies it. `directed` with `control: player` is stored. `directed` with `control: npc` or with `control` omitted returns `DIRECTED_NPC` and writes nothing. The reply includes the stored `behavior` and `control`. Adopting a faction does not take `behavior` or `control` and does not change that pair. `form_cult` then inserts the caller's Feature. When harshness prices intrinsic points, it inserts one intrinsic Problem whose text is `lawText`. `nominal` inserts none. Adopting a faction keeps its Features and Problems and still adds that Feature and, when it has no holy law yet, that intrinsic Problem.
```

Leave the Control bullet's campaign-wide advisory as it is. Enforcing the pair on every write path is #133.

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `form_cult` bullet with:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. A new cult requires `behavior`. Pass a chart key (`despotic_tyrant`, `self_absorbed_survivor`, `scheming_manipulator`, `martial_conqueror`) when the cult should pick its own goal on a mechanical turn; omit `control` or pass `control: npc` for that NPC-run cult. Pass `behavior: directed` and `control: player` when the player supplies the plan; that cult idles on a mechanical turn until it is given one. `directed` with NPC control is refused. Omit `behavior` and `control` when adopting; that path does not change the adopted pair. The reply names the stored `behavior` and `control`. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. A new cult is Power 1 with only the chosen Feature (`featureText`) and optional intrinsic holy laws. Holy laws require harshness above `nominal` and `lawText`. `nominal` has no holy law. An adopted faction keeps its Features and Problems and still receives the chosen Feature and, if it has no holy law yet, that law. Use `homePlaceId` to specify the new location of the cult faction.
```

## Tests

`test/services/form-cult.test.ts` already opens an in-memory database and calls `formCult`. Keep the existing gate tests. Every successful **new** cult call must pass a non-empty `behavior` (a chart key unless the test is about `directed`). Adopt tests keep omitting `behavior` and `control`.

Add one rule per test:

- New cult, omitted `behavior`: `FILL_INCOMPLETE` / `behavior required`; no faction row; hero unchanged.
- New cult, `behavior: ""`: same refusal.
- New cult, `behavior: "self_absorbed_survivor"`, omitted `control`: stores that behavior and `control: npc`; reply includes both.
- New cult, `behavior: "directed"`, `control: "player"`: stores that pair; reply includes both.
- New cult, `behavior: "directed"`, omitted `control`: `DIRECTED_NPC` with the message above; writes nothing.
- New cult, `behavior: "directed"`, `control: "npc"`: same `DIRECTED_NPC` refusal.
- Adopt with `behavior` or `control` present: `FILL_INCOMPLETE` / `behavior and control apply only to a new cult`; adopted row and hero unchanged.
- After a new cult with a chart behavior and omitted `control`, `runFactionTurn` with no explicit plan for that cult records an action whose `type` is not `idle`.

Do not add a test that reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a prompt file and asserts on that file's text.

## Out of scope

- The pairing check on `create_faction`, `seed_campaign`, adoption of `directed` NPC rows, and later behavior/control edits (#133).
- Stored `npc` + `directed` rows (#134; closed, no migration).
- New `control` values `chart`, `agent`, `GM`.
- Whitelisting behavior strings to the catalog keys.

## Acceptance

- `form_cult` accepts `behavior` and stores it on a new cult.
- A mechanical `run_faction_turn` right after `form_cult` with a non-directed behavior gives the new cult a real action, not `idle`.
- `form_cult` without `behavior` on a new cult fails with a clear error and writes nothing.
- `form_cult` with `behavior: directed` and `control: player` is accepted and stored.
- `form_cult` with `behavior: directed` and no control, or `npc` control, fails with `DIRECTED_NPC` and writes nothing.
- Tests, one rule per test, cover the `behavior` argument.
- The `form_cult` tool description, `docs/design/current-engine.md`, and `user/skills/gdnr-director/references/gdnr-direct.md` describe what control and behavior a new cult gets, and when to pass `control: player` versus `control: npc`.
