# form_cult Caller-Chosen Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `form_cult` stores the caller's `behavior` (and optional `control`) on a new cult so a chart-behavior cult acts on a mechanical turn instead of always idling as a directed NPC.

**Architecture:** `formCult` passes caller `behavior` and resolved `control` into `createFaction` instead of hardcoding `directed`. A rules helper `assertDirectedAllowed` refuses `directed` under `npc` control with `DIRECTED_NPC`. Adoption does not change the pair. The success reply includes the stored `behavior` and `control`.

**Tech Stack:** TypeScript, better-sqlite3, vitest, zod. Node >= 22.

## Global Constraints

- A new cult requires `behavior`. Omitted or `""` returns `FILL_INCOMPLETE` / `behavior required` and writes nothing.
- `behavior` is stored as given when non-empty. It is not rolled and not defaulted.
- Optional `control` is `npc` or `player`. Omitted `control` stores `npc`.
- `directed` with `control: player` is stored.
- `directed` with omitted `control` or `control: npc` returns `DIRECTED_NPC` / `a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior` and writes nothing.
- Adoption does not validate or rewrite behavior or control. Passing `behavior` or `control` while adopting returns `FILL_INCOMPLETE` / `behavior and control apply only to a new cult`.
- Success data is `{ factionId, behavior, control }` from the stored row.
- `createFaction`, `seed_campaign`, and adoption pairing checks stay for #133.
- Implementation continues on this pull request's branch. Do not branch from `main` and do not open a second pull request.
- No test reads `docs/`, `user/`, `AGENTS.md`, `README.md`, or a file under `.cursor/prompts/` or `.cursor/skills/` and asserts on that file's text.

---

## File map

- Create: `src/rules/control.ts`
- Modify: `src/services/populate.ts` (`formCult` input, pairing check, `createFaction` call, reply)
- Modify: `src/mcp/register.ts` (`form_cult` description and schema)
- Modify: `test/services/form-cult.test.ts`
- Modify: `docs/design/current-engine.md`
- Modify: `docs/design/mechanics.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

---

### Task 1: Store caller behavior on a new cult

**Files:**
- Create: `src/rules/control.ts`
- Modify: `src/services/populate.ts` (`formCult`)
- Modify: `src/mcp/register.ts` (the `form_cult` tool)
- Modify: `test/services/form-cult.test.ts`

**Interfaces:**
- Consumes: `formCult` and `createFaction` from `src/services/populate.ts`; `RuleError` via `wrapRule`.
- Produces: `assertDirectedAllowed(behavior: string, control: "npc" | "player"): void`. `formCult` input gains `behavior?: string` and `control?: "npc" | "player"`. Success data is `{ factionId: string; behavior: string; control: string }`.

- [ ] **Step 1: Write the failing tests**

In `test/services/form-cult.test.ts`, add `behavior: "self_absorbed_survivor"` to every **new-cult** call that is supposed to succeed or to hit a later create-path error (`holy law required`). That is:

- `"gmOverride lets free divinity found a grueling cult"`
- `"omitted harshness stores nominal and no problems"`
- `"a new cult without a holy law is refused when harshness prices one"`
- `"new cult composition matches each harshness budget"`
- `"form_cult stores homePlaceId on a new cult"`

Leave gate failures that currently omit `behavior` without it (`LEVEL_TOO_LOW`, `FREE_DIVINITY`, unrecognized harshness, missing place, missing acknowledged). Leave adopt tests without `behavior` or `control`.

Where a success result is compared with `toEqual` on the whole `ServiceResult`, include the stored pair. Update `"an adopted Power 3 cult prices sharp laws from the d10"`:

```ts
expect(result).toEqual({
  ok: true,
  data: { factionId: "f1", behavior: "directed", control: "npc" },
});
```

After the existing tests, add:

```ts
test("a new cult without behavior is refused and writes nothing", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "behavior required", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "none",
    cult_faction_id: null,
  });
});

test("empty behavior is refused as missing", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    behavior: "",
  });
  expect(result).toEqual({
    ok: false,
    error: { code: "FILL_INCOMPLETE", message: "behavior required", details: {} },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
});

test("a new cult stores the caller behavior and default npc control", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    behavior: "self_absorbed_survivor",
  });
  expect(result).toEqual({
    ok: true,
    data: {
      factionId: expect.any(String),
      behavior: "self_absorbed_survivor",
      control: "npc",
    },
  });
  if (!result.ok) return;
  expect(
    db.prepare("SELECT behavior, control FROM factions WHERE id = ?").get(result.data.factionId),
  ).toEqual({ behavior: "self_absorbed_survivor", control: "npc" });
});

test("directed with player control is stored", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    behavior: "directed",
    control: "player",
  });
  expect(result).toEqual({
    ok: true,
    data: { factionId: expect.any(String), behavior: "directed", control: "player" },
  });
  if (!result.ok) return;
  expect(
    db.prepare("SELECT behavior, control FROM factions WHERE id = ?").get(result.data.factionId),
  ).toEqual({ behavior: "directed", control: "player" });
});

test("directed with omitted control is refused", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    behavior: "directed",
  });
  expect(result).toEqual({
    ok: false,
    error: {
      code: "DIRECTED_NPC",
      message:
        "a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior",
      details: {},
    },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "none",
    cult_faction_id: null,
  });
});

test("directed with npc control is refused", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    behavior: "directed",
    control: "npc",
  });
  expect(result).toEqual({
    ok: false,
    error: {
      code: "DIRECTED_NPC",
      message:
        "a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior",
      details: {},
    },
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions").get()).toEqual({ n: 0 });
});

test("adopting rejects a passed behavior", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  faction(db, { id: "f1", power: 3 });
  const result = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The tithe",
    acknowledged: true,
    adoptFactionId: "f1",
    behavior: "self_absorbed_survivor",
  });
  expect(result).toEqual({
    ok: false,
    error: {
      code: "FILL_INCOMPLETE",
      message: "behavior and control apply only to a new cult",
      details: {},
    },
  });
  expect(
    db.prepare("SELECT behavior, control, cult FROM factions WHERE id = 'f1'").get(),
  ).toEqual({ behavior: "directed", control: "npc", cult: 0 });
  expect(db.prepare("SELECT divinity FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "none",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: FAIL. Existing new-cult successes fail because `formCult` still stores `directed` / does not require `behavior`. The new tests fail because `behavior required` and `DIRECTED_NPC` are not thrown and the reply is still `{ factionId }`.

- [ ] **Step 3: Write the helper and `formCult` changes**

Create `src/rules/control.ts`:

```ts
import { RuleError } from "../domain/types.js";

export function assertDirectedAllowed(
  behavior: string,
  control: "npc" | "player",
): void {
  if (behavior !== "directed") return;
  if (control === "npc") {
    throw new RuleError(
      "DIRECTED_NPC",
      "a directed faction must not be table-driven: make it player-, agent-, or GM-controlled, or give it a real behavior",
    );
  }
}
```

In `src/services/populate.ts`, import `assertDirectedAllowed` from `../rules/control.js`.

Change `formCult` input and return type:

```ts
export function formCult(
  db: Database.Database,
  input: {
    campaignId: string;
    heroId: string;
    featureText: string;
    lawText?: string;
    harshness?: string;
    acknowledged?: boolean;
    adoptFactionId?: string;
    name?: string;
    gmOverride?: boolean;
    homePlaceId?: string;
    behavior?: string;
    control?: "npc" | "player";
  },
): ServiceResult<{ factionId: string; behavior: string; control: string }> {
```

After the existing `homePlaceId` lookup, replace the create/adopt block and the final `return { factionId }` with:

```ts
      let factionId = input.adoptFactionId;
      if (!factionId) {
        if (input.behavior === undefined || input.behavior === "") {
          throw new RuleError("FILL_INCOMPLETE", "behavior required");
        }
        const control = input.control ?? "npc";
        assertDirectedAllowed(input.behavior, control);
        const budget = cultBudget(parseHarshness(harshness), DIE_BY_POWER[1]);
        if (budget > 0 && !input.lawText) {
          throw new RuleError("FILL_INCOMPLETE", "holy law required");
        }
        const created = createFaction(db, {
          campaignId: input.campaignId,
          name: input.name ?? "Cult",
          power: 1,
          behavior: input.behavior,
          control,
          origin: "forged",
          featureCount: 0,
          problemCount: 0,
          homePlaceId: input.homePlaceId,
        });
        if (!created.ok) throw new RuleError(created.error.code, created.error.message);
        factionId = created.data.factionId;
      } else {
        const adopted = db
          .prepare("SELECT id FROM factions WHERE id = ? AND campaign_id = ?")
          .get(factionId, input.campaignId) as { id: string } | undefined;
        if (!adopted) throw new RuleError("ENTITY_NOT_FOUND", "faction not found");
        if (input.behavior !== undefined || input.control !== undefined) {
          throw new RuleError(
            "FILL_INCOMPLETE",
            "behavior and control apply only to a new cult",
          );
        }
      }
```

Keep the existing cult/feature/law/hero writes. Replace `return { factionId };` with:

```ts
      const stored = db
        .prepare("SELECT behavior, control FROM factions WHERE id = ?")
        .get(factionId) as { behavior: string; control: string };
      return { factionId, behavior: stored.behavior, control: stored.control };
```

There is already a `stored` binding for `power` later in the function. Do not reuse that name. Read behavior/control in a separately named row at the return, or extend the existing `SELECT power` to `SELECT power, behavior, control` and return those fields from that row.

In `src/mcp/register.ts`, change the `form_cult` registration to:

```ts
  reg(
    "form_cult",
    {
      description:
        "Bind a hero of level 2 or higher to a cult faction. A new cult requires behavior (any stored string, including directed). Optional control is npc or player and defaults to npc. directed requires control player; directed with npc or omitted control returns DIRECTED_NPC and writes nothing. The reply includes the stored behavior and control. Omit behavior and control when adopting. Requires gmOverride for free divinities. Optional homePlaceId must be a place in the campaign.",
      inputSchema: {
        campaignId: z.string(),
        heroId: z.string(),
        featureText: z.string(),
        lawText: z.string().optional(),
        harshness: z.enum(["nominal", "sharp", "grueling", "overwhelming"]).optional(),
        acknowledged: z.boolean().optional(),
        adoptFactionId: z.string().optional(),
        name: z.string().optional(),
        gmOverride: z.boolean().optional(),
        homePlaceId: z.string().optional(),
        behavior: z.string().optional(),
        control: z.enum(["npc", "player"]).optional(),
      },
    },
    dbTool((a) => formCult(db, a)),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules/control.ts src/services/populate.ts src/mcp/register.ts test/services/form-cult.test.ts
git commit -m "form_cult stores caller-chosen cult behavior"
```

---

### Task 2: Mechanical turn after a chart-behavior cult

**Files:**
- Modify: `test/services/form-cult.test.ts`

**Interfaces:**
- Consumes: `formCult` from Task 1; `runFactionTurn` from `src/services/turn.ts`.
- Produces: no new API. A new cult with a chart behavior and default `npc` control records a non-`idle` action on `runFactionTurn`.

- [ ] **Step 1: Write the failing test**

In `test/services/form-cult.test.ts`, import `runFactionTurn` from `../../src/services/turn.js` and add:

```ts
test("a chart-behavior cult takes a real action on the next mechanical turn", () => {
  const db = world();
  hero(db, { id: "h1", level: 2 });
  const formed = formCult(db, {
    campaignId: "c1",
    heroId: "h1",
    featureText: "The law",
    acknowledged: true,
    behavior: "self_absorbed_survivor",
  });
  expect(formed.ok).toBe(true);
  if (!formed.ok) return;
  const factionId = formed.data.factionId;

  const turned = runFactionTurn(db, ":memory:", { campaignId: "c1" });
  expect(turned.ok).toBe(true);

  const row = db
    .prepare("SELECT type FROM actions WHERE actor_id = ?")
    .get(factionId) as { type: string } | undefined;
  expect(row).toBeDefined();
  expect(row?.type).not.toBe("idle");
});
```

Do not also assert a specific strategy name. The rule is: not `idle`.

- [ ] **Step 2: Run the test to verify it fails if the create path still hardcoded directed**

Run: `npx vitest run test/services/form-cult.test.ts`

If Task 1 is done, this test should PASS already because the cult is `self_absorbed_survivor` / `npc`. If it FAILs with `type: "idle"`, the create path is still storing `directed` or `control` is not `npc`. Fix `formCult` before continuing. If it PASSes, do not change product code in this task.

- [ ] **Step 3: Commit**

```bash
git add test/services/form-cult.test.ts
git commit -m "test form_cult chart behavior acts on a mechanical turn"
```

---

### Task 3: Living docs and director copy

**Files:**
- Modify: `docs/design/current-engine.md`
- Modify: `docs/design/mechanics.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

**Interfaces:**
- Consumes: the tool description and errors from Task 1.
- Produces: no new API.

- [ ] **Step 1: Update `docs/design/current-engine.md`**

Add `DIRECTED_NPC` to the common error codes list, before the final `and `DISSOLVES_CULT``.

Do not change the Control bullet. That campaign-wide enforcement is #133.

- [ ] **Step 2: Update `docs/design/mechanics.md`**

Replace the Cult theology paragraph that starts "A new cult is created at Power 1" with:

```markdown
A new cult is created at Power 1 with no rolled Feature and no rolled Problems. `form_cult` requires `behavior` for that create and stores it; it does not roll or default a behavior. Optional `control` is `npc` or `player` and defaults to `npc`. `directed` means the plan comes from outside the tables; `control` says who supplies it. `directed` with `control: player` is stored. `directed` with `control: npc` or with `control` omitted returns `DIRECTED_NPC` and writes nothing. The reply includes the stored `behavior` and `control`. Adopting a faction does not take `behavior` or `control` and does not change that pair. `form_cult` then inserts the caller's Feature. When harshness prices intrinsic points, it inserts one intrinsic Problem whose text is `lawText`. `nominal` inserts none. Adopting a faction keeps its Features and Problems and still adds that Feature and, when it has no holy law yet, that intrinsic Problem.
```

- [ ] **Step 3: Update `user/skills/gdnr-director/references/gdnr-direct.md`**

Replace the `form_cult` bullet with:

```markdown
- `form_cult`: binds a hero to a cult faction, new or adopted (`adoptFactionId`). The hero must be level 2 or higher. It needs `acknowledged: true`, meaning at least a village of willing worshippers exists. A hero with `divinity: free` is refused unless `gmOverride` is true. A new cult requires `behavior`. Pass a chart key (`despotic_tyrant`, `self_absorbed_survivor`, `scheming_manipulator`, `martial_conqueror`) when the cult should pick its own goal on a mechanical turn; omit `control` or pass `control: npc` for that NPC-run cult. Pass `behavior: directed` and `control: player` when the player supplies the plan; that cult idles on a mechanical turn until it is given one. `directed` with NPC control is refused. Omit `behavior` and `control` when adopting; that path does not change the adopted pair. The reply names the stored `behavior` and `control`. `harshness` is `nominal`, `sharp`, `grueling`, or `overwhelming`; omitting it stores `nominal`. A new cult is Power 1 with only the chosen Feature (`featureText`) and optional intrinsic holy laws. Holy laws require harshness above `nominal` and `lawText`. `nominal` has no holy law. An adopted faction keeps its Features and Problems and still receives the chosen Feature and, if it has no holy law yet, that law. Use `homePlaceId` to specify the new location of the cult faction.
```

- [ ] **Step 4: Run the service tests**

Run: `npx vitest run test/services/form-cult.test.ts`

Expected: PASS. Do not add a test that reads these files.

- [ ] **Step 5: Commit**

```bash
git add docs/design/current-engine.md docs/design/mechanics.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "document form_cult behavior and control"
```
