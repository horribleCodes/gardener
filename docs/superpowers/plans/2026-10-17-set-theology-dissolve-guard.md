# Set Theology Dissolve Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `set_theology` on a Power 1 cult refuses unless `acknowledgeDissolve` is true, so an agent sees the dissolve from the tool itself.

**Architecture:** `setTheology` throws `DISSOLVES_CULT` after the cult row is found and before `ensureInternalTurnSlot`. With `acknowledgeDissolve: true`, the existing dissolve runs unchanged. The MCP schema adds the optional flag. Living docs and director copy drop the player-awareness caveat.

**Tech Stack:** TypeScript, better-sqlite3, vitest, zod. Node >= 22.

## Global Constraints

- On Power 1 or less, `setTheology` without `acknowledgeDissolve: true` returns `DISSOLVES_CULT` / `the cult will stop being a faction; holy laws are normally set at form_cult`.
- That refusal writes nothing, spends no Power, inserts no `set_theology` action, and does not open a turn.
- `acknowledgeDissolve: false` is the same refusal as an omitted flag.
- With `acknowledgeDissolve: true` and Power 1 or less, dissolve is unchanged: `{ ended: true, factionId, giftTexts, factIds }`, no collapse, divinity stays `cult`.
- On Power greater than 1, `acknowledgeDissolve` is ignored.
- The guard runs after the cult lookup and before `ensureInternalTurnSlot`.
- `INTERNAL_BUDGET` / `internal action already taken` still applies when the flag is `true` and the slot is already used.
- Implementation continues on this pull request's branch. Do not branch from `main` and do not open a second pull request.
- No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

---

## File map

- Modify: `src/services/populate.ts` (`setTheology` input and the Power 1 guard)
- Modify: `src/mcp/register.ts` (`set_theology` description and schema)
- Modify: `test/services/set-theology-end.test.ts`
- Modify: `test/services/cult-theology.test.ts`
- Modify: `docs/design/current-engine.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`

---

### Task 1: Refuse Power 1 `setTheology` unless `acknowledgeDissolve` is true

**Files:**
- Modify: `src/services/populate.ts` (`setTheology`)
- Modify: `src/mcp/register.ts` (the `set_theology` tool)
- Modify: `test/services/set-theology-end.test.ts`
- Modify: `test/services/cult-theology.test.ts`

**Interfaces:**
- Consumes: `setTheology` from `src/services/populate.ts`; `RuleError` via `wrapRule`.
- Produces: `setTheology` input gains `acknowledgeDissolve?: boolean`. Refusal is `{ ok: false, error: { code: "DISSOLVES_CULT", message: "the cult will stop being a faction; holy laws are normally set at form_cult", details: {} } }`. Successful Power 1 dissolve still returns `{ ended: true, factionId, giftTexts, factIds }`.

- [ ] **Step 1: Write the failing tests**

In `test/services/set-theology-end.test.ts`, add `acknowledgeDissolve: true` to every Power 1 call that is supposed to dissolve or to hit `INTERNAL_BUDGET`:

- `"a Power 1 cult stops being a faction and keeps the gift and worshipers"`
- `"facts land on the home place when the cult has no patron"`
- `"a cult with no patron and no home place still ends, with no facts"`
- `"a patron and no features still records that worshipers remain"`
- `"a spent internal action leaves the Power 1 cult in place"`
- `"ending the cult stops cult Dominion while a linked cult still pays"`

Leave the Power 2 success test and the non-cult test without the flag.

Add these tests after `"a faction that is not a cult is left alone"`:

```ts
test("a Power 1 cult without acknowledgeDissolve is refused and unchanged", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1" });
  feature(db, "feat1", "f1", "The healing gift");
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('prob1', 'f1', 'Holy law', 1, 'cultural', 1, 0, 0, 0)`,
  ).run();
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({
    ok: false,
    error: {
      code: "DISSOLVES_CULT",
      message: "the cult will stop being a faction; holy laws are normally set at form_cult",
      details: {},
    },
  });
  expect(db.prepare("SELECT id, power, cohesion, status FROM factions WHERE id = 'f1'").get()).toEqual({
    id: "f1",
    power: 1,
    cohesion: 1,
    status: "active",
  });
  expect(db.prepare("SELECT id FROM features WHERE id = 'feat1'").get()).toEqual({ id: "feat1" });
  expect(db.prepare("SELECT id FROM problems WHERE id = 'prob1'").get()).toEqual({ id: "prob1" });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM turns").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM actions WHERE type = 'set_theology'").get()).toEqual({ n: 0 });
});

test("acknowledgeDissolve false is not an acknowledgement", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1" });
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    acknowledgeDissolve: false,
  });
  expect(result).toEqual({
    ok: false,
    error: {
      code: "DISSOLVES_CULT",
      message: "the cult will stop being a faction; holy laws are normally set at form_cult",
      details: {},
    },
  });
  expect(db.prepare("SELECT id FROM factions WHERE id = 'f1'").get()).toEqual({ id: "f1" });
  expect(db.prepare("SELECT cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    cult_faction_id: "f1",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM actions WHERE type = 'set_theology'").get()).toEqual({ n: 0 });
});

test("a Power 2 cult with acknowledgeDissolve still drops Power", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, cohesion: 2, patron: "h1", harshness: "nominal" });
  feature(db, "feat1", "f1", "Old gift");
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    acknowledgeDissolve: true,
  });
  expect(result).toEqual({ ok: true, data: { power: 1, cohesion: 1 } });
  expect(db.prepare("SELECT id, power, status FROM factions WHERE id = 'f1'").get()).toEqual({
    id: "f1",
    power: 1,
    status: "active",
  });
  expect(db.prepare("SELECT cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    cult_faction_id: "f1",
  });
});
```

In `test/services/cult-theology.test.ts`, add `acknowledgeDissolve: true` to `"a Power 1 cult still ends when harshness is unrecognized"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/set-theology-end.test.ts test/services/cult-theology.test.ts`

Expected: FAIL. The new Power 1 tests receive `{ ended: true, … }` instead of `DISSOLVES_CULT`. Existing Power 1 success tests still pass until the guard exists; after you add `acknowledgeDissolve: true` they still pass on current code because the flag is ignored. The Power 2 tests pass.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/populate.ts`, add `acknowledgeDissolve?: boolean` to the `setTheology` input type. After the `ENTITY_NOT_FOUND` cult check and before `ensureInternalTurnSlot`, insert:

```ts
if (faction.power <= 1 && input.acknowledgeDissolve !== true) {
  throw new RuleError(
    "DISSOLVES_CULT",
    "the cult will stop being a faction; holy laws are normally set at form_cult",
  );
}
```

Leave the dissolve branch and the Power greater than 1 branch as they are.

In `src/mcp/register.ts`, replace the `set_theology` tool with:

```ts
  reg(
    "set_theology",
    {
      description:
        "Change cult theology. Costs 1 Power and the internal action. Omitted harshness is kept. On Power 1, acknowledgeDissolve must be true or the call is refused with DISSOLVES_CULT; with that flag the cult stops being a faction.",
      inputSchema: {
        campaignId: z.string(),
        cultFactionId: z.string(),
        harshness: z.enum(["nominal", "sharp", "grueling", "overwhelming"]).optional(),
        featureText: z.string().optional(),
        intrinsicTexts: z.array(z.object({ problemId: z.string(), text: z.string() })).optional(),
        acknowledgeDissolve: z.boolean().optional(),
      },
    },
    dbTool((a) => setTheology(db, a)),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/set-theology-end.test.ts test/services/cult-theology.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/populate.ts src/mcp/register.ts test/services/set-theology-end.test.ts test/services/cult-theology.test.ts
git commit -m "Refuse Power 1 set_theology unless acknowledgeDissolve is true"
```

---

### Task 2: State the guard in living docs and drop the skill caveat

**Files:**
- Modify: `docs/design/current-engine.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`
- Modify: `user/skills/gdnr-player/references/gdnr-play.md`

**Interfaces:**
- Consumes: the `DISSOLVES_CULT` code and message from Task 1.
- Produces: no new export. Living engine copy names the flag. Director copy no longer asks the agent to keep the player aware. The player error table lists `DISSOLVES_CULT`.

- [ ] **Step 1: Update current-engine**

In `docs/design/current-engine.md`, replace the first Cult theology paragraph with:

```markdown
`set_theology` costs the cult 1 Power and its internal action. A Power 1 cult stops being a faction only when the call passes `acknowledgeDissolve: true`: the faction row is removed, the hero's divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain as public facts, and they do not pay cult Dominion. This is not a collapse. Without that flag the call returns `DISSOLVES_CULT`, writes nothing, and does not use the internal action. On Power greater than 1 the flag is ignored.
```

In the common error codes sentence on that page, add `DISSOLVES_CULT` after `NAME_TAKEN`.

- [ ] **Step 2: Drop the director caveat**

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace the `set_theology` bullet with:

```markdown
- `set_theology`: changes a cult's harshness, feature text, or the text of intrinsic problems (`intrinsicTexts`). It costs the cult 1 Power and its internal action for the turn. Omitting `harshness` keeps the stored harshness and its laws. A Power 1 cult stops being a faction: divinity stays `cult`, the hero's faction link is cleared, and the leftover worshipers and cult gift remain without paying cult Dominion. That end ignores harshness, feature text, and intrinsic texts.
```

Do not mention `acknowledgeDissolve` in that file. Confirm no other file under `user/`, `.cursor/prompts/`, or `.cursor/skills/` still says “player aware of the consequences.”

- [ ] **Step 3: Add the player error row**

In `user/skills/gdnr-player/references/gdnr-play.md`, add this row to the error table, directly under the `FILL_INCOMPLETE` row:

```markdown
| `DISSOLVES_CULT` | A Power 1 cult would stop being a faction. Pass `acknowledgeDissolve: true` on `set_theology` only when that end is intended. Holy laws are normally set at `form_cult`. |
```

- [ ] **Step 4: Confirm no test asserts on those files**

Do not add a test that reads these markdown files. Spec review is enough.

- [ ] **Step 5: Commit**

```bash
git add docs/design/current-engine.md user/skills/gdnr-director/references/gdnr-direct.md user/skills/gdnr-player/references/gdnr-play.md
git commit -m "Document the set_theology dissolve guard and drop the skill caveat"
```

---

## Self-review

- Placeholder scan: no TBD.
- Spec.md unit-test rule: no test reads docs or skill files.
- Scope: dissolve writes stay; no authoring-edit tool.
- Implement on this PR. Do not open a second pull request.
