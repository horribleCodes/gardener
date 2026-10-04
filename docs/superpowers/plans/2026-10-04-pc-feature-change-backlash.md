# PC feature change backlash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PC feature change plants one backlash Problem, inside `commit_resources`, and `apply_outcome` cannot add that Feature or that backlash again.

**Architecture:** `commitResources` already inserts the Feature and one backlash when the change is ready and `feature_id` is null. `applyOutcome` gains an optional `changeId`. When `addFeatureText` is also set, that branch inserts nothing and returns `CHANGE_ALREADY_LANDED` or `CHANGE_NOT_READY` or `ENTITY_NOT_FOUND`. `addFeatureText` without `changeId` still inserts one Feature and one backlash. The MCP handler stays a pass-through; the tool schema accepts `changeId`, and play copy stops telling the caller to land the change with `apply_outcome`.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5, zod 3.24.2 (see `package.json`).

## Global Constraints

- For a PC feature change, the only backlash insert is the one in `commitResources` when that call creates the Feature.
- `applyOutcome` reads `changeId` only in the `addFeatureText` branch, and only when `changeId` is set. That branch then inserts nothing.
- `CHANGE_ALREADY_LANDED` message is `feature change already landed`. Details are `{ featureId, backlashProblemId }` from the change row.
- A feature change with `feature_id` null returns `RuleError("CHANGE_NOT_READY", "feature change lands in commit_resources", { changeId })`.
- A change whose `kind` is not `feature` returns `RuleError("CHANGE_NOT_READY", "change is not a feature change", { changeId })`.
- A missing change, a change in another campaign, or a change whose `faction_id` is not the call’s `factionId` returns `RuleError("ENTITY_NOT_FOUND", "change ${changeId} not found")`.
- `addFeatureText` with no `changeId` still inserts one Feature and one backlash Problem.
- Remove, remove-part, and reduce do not read `changeId`. Their current order stays.
- The check throws before any insert in that branch. The transaction rolls back.
- Do not put this rule in `src/mcp/register.ts`. The handler stays a pass-through. The tool schema gains optional `changeId`, and the two tool descriptions change as specified.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file’s text.

---

## File map

- Create: `test/services/feature-change-backlash.test.ts` — one backlash on landing; `apply_outcome` with `changeId` does not insert.
- Modify: `src/services/change.ts` — `applyOutcome` input type and the `addFeatureText` branch.
- Create: `test/mcp/apply-outcome-change.test.ts` — `apply_outcome` schema has optional `changeId`.
- Modify: `src/mcp/register.ts` — optional `changeId`, and the `commit_resources` and `apply_outcome` descriptions. Handler stays `dbTool((a) => applyOutcome(db, a))`.
- Modify: `docs/design/overview.md` — delete the double-backlash known-gap bullet.
- Modify: `docs/design/current-engine.md` — add `CHANGE_ALREADY_LANDED` to the common error-code list.
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` — one landing path, and the two error rows.

---

### Task 1: Refuse a second Feature when `apply_outcome` names the change

**Files:**
- Create: `test/services/feature-change-backlash.test.ts`
- Modify: `src/services/change.ts` (`applyOutcome` input type around the `addFeatureText` field; the `addFeatureText` branch)

**Interfaces:**
- Consumes: `beginChange`, `commitResources`, and `applyOutcome` from `src/services/change.ts`; `openDb` from `src/store/db.ts`; `loadCatalog` from `src/tables/catalog.ts`; `RuleError` from `src/domain/types.ts`.
- Produces: `applyOutcome` accepts optional `changeId?: string`. With `addFeatureText` and `changeId`, it returns `{ ok: false, error: { code, message, details } }` and inserts nothing. Codes and messages are the Global Constraints. No new export.

- [ ] **Step 1: Write the failing test**

Create `test/services/feature-change-backlash.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { applyOutcome, beginChange, commitResources } from "../../src/services/change.js";
import { loadCatalog } from "../../src/tables/catalog.js";

const FEATURE = "The village has a band of trained warriors.";
const BACKLASH = "The warriors demand pay.";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 42, 0)",
  ).run("c1", "Kistelek");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("village", "c1", "Village", 1, 1, 0, "native", "self_absorbed_survivor", "npc", 0, "active");
  db.prepare(
    `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("neighbor", "c1", "Neighbor City", 2, 2, 0, "native", "martial_conqueror", "npc", 0, "active");
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("sword", "c1", "Sword", 3, "[]", 2, 0, 0, "free");
  return db;
}

function counts(db: Database.Database, factionId: string): { features: number; problems: number } {
  const features = db
    .prepare("SELECT COUNT(*) AS c FROM features WHERE faction_id = ?")
    .get(factionId) as { c: number };
  const problems = db
    .prepare("SELECT COUNT(*) AS c FROM problems WHERE faction_id = ?")
    .get(factionId) as { c: number };
  return { features: features.c, problems: problems.c };
}

function landFeature(db: Database.Database): string {
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: FEATURE,
    heroId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) throw new Error("begin");
  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    heroId: "sword",
    influence: 1,
    backlash: BACKLASH,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) throw new Error("commit");
  expect(committed.data.status).toBe("active");
  return begun.data.changeId;
}

test("landed feature change keeps one backlash when apply_outcome names that change", () => {
  const db = world();
  const changeId = landFeature(db);
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
  const problem = db.prepare("SELECT text FROM problems WHERE faction_id = ?").get("village") as {
    text: string;
  };
  expect(problem.text).toBe(BACKLASH);

  const again = commitResources(db, {
    changeId,
    heroId: "sword",
    influence: 0,
  });
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.data).toEqual({ status: "active", covered: 1 });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });

  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId,
    addFeatureText: FEATURE,
    backlash: "A second problem",
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  const row = db
    .prepare("SELECT feature_id, backlash_problem_id FROM changes WHERE id = ?")
    .get(changeId) as { feature_id: string; backlash_problem_id: string };
  expect(outcome.error).toEqual({
    code: "CHANGE_ALREADY_LANDED",
    message: "feature change already landed",
    details: { featureId: row.feature_id, backlashProblemId: row.backlash_problem_id },
  });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
  const texts = db.prepare("SELECT text FROM problems WHERE faction_id = ?").all("village") as {
    text: string;
  }[];
  expect(texts).toEqual([{ text: BACKLASH }]);
});

test("apply_outcome does not land a feature change whose deeds are still open", () => {
  const db = world();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "feature",
    featureText: FEATURE,
    heroId: "sword",
    deedsRequired: 1,
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;
  const committed = commitResources(db, {
    changeId: begun.data.changeId,
    heroId: "sword",
    influence: 1,
    backlash: BACKLASH,
  });
  expect(committed.ok).toBe(true);
  if (!committed.ok) return;
  expect(committed.data).toEqual({ status: "pending", covered: 1 });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });

  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId: begun.data.changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "CHANGE_NOT_READY",
    message: "feature change lands in commit_resources",
    details: { changeId: begun.data.changeId },
  });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });
});

test("apply_outcome does not add a feature for a change that is not a feature change", () => {
  const db = world();
  const begun = beginChange(db, {
    campaignId: "c1",
    owner: "pc",
    factionId: "village",
    scope: "village",
    magnitude: "plausible",
    kind: "fact",
    heroId: "sword",
  });
  expect(begun.ok).toBe(true);
  if (!begun.ok) return;

  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId: begun.data.changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "CHANGE_NOT_READY",
    message: "change is not a feature change",
    details: { changeId: begun.data.changeId },
  });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });
});

test("apply_outcome changeId on another faction inserts nothing", () => {
  const db = world();
  const changeId = landFeature(db);
  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "neighbor",
    changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "ENTITY_NOT_FOUND",
    message: `change ${changeId} not found`,
    details: {},
  });
  expect(counts(db, "neighbor")).toEqual({ features: 0, problems: 0 });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
});

test("apply_outcome changeId from another campaign inserts nothing", () => {
  const db = world();
  const changeId = landFeature(db);
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, ?, 1, 7, 0)",
  ).run("c2", "Other");
  const outcome = applyOutcome(db, {
    campaignId: "c2",
    factionId: "village",
    changeId,
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "ENTITY_NOT_FOUND",
    message: `change ${changeId} not found`,
    details: {},
  });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
});

test("apply_outcome unknown changeId inserts nothing", () => {
  const db = world();
  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    changeId: "missing",
    addFeatureText: FEATURE,
  });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toEqual({
    code: "ENTITY_NOT_FOUND",
    message: "change missing not found",
    details: {},
  });
  expect(counts(db, "village")).toEqual({ features: 0, problems: 0 });
});

test("addFeatureText without changeId still inserts one backlash", () => {
  const db = world();
  const backlashText = loadCatalog().backlash[0];
  const outcome = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    addFeatureText: "A shrine to the sword.",
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(counts(db, "village")).toEqual({ features: 1, problems: 1 });
  const problem = db.prepare("SELECT text FROM problems WHERE faction_id = ?").get("village") as {
    text: string;
  };
  expect(problem.text).toBe(backlashText);
});

test("removeFeatureId ignores changeId and does not insert addFeatureText", () => {
  const db = world();
  const changeId = landFeature(db);
  const shrine = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    addFeatureText: "A shrine to the sword.",
  });
  expect(shrine.ok).toBe(true);
  if (!shrine.ok) return;
  const shrineId = shrine.data.featureId as string;

  const removed = applyOutcome(db, {
    campaignId: "c1",
    factionId: "village",
    removeFeatureId: shrineId,
    changeId,
    addFeatureText: "This text must not become a feature.",
  });
  expect(removed.ok).toBe(true);
  if (!removed.ok) return;
  expect(removed.data).toEqual({ removedFeatureId: shrineId });
  expect(counts(db, "village")).toEqual({ features: 1, problems: 2 });
  const feature = db.prepare("SELECT text FROM features WHERE faction_id = ?").get("village") as {
    text: string;
  };
  expect(feature.text).toBe(FEATURE);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/feature-change-backlash.test.ts`

Expected: FAIL. These tests fail because `applyOutcome` ignores `changeId` and inserts a Feature: `landed feature change keeps one backlash when apply_outcome names that change`, `apply_outcome does not land a feature change whose deeds are still open`, `apply_outcome does not add a feature for a change that is not a feature change`, `apply_outcome changeId on another faction inserts nothing`, `apply_outcome changeId from another campaign inserts nothing`, and `apply_outcome unknown changeId inserts nothing`. The failure on the landed test is `expected true to be false` at `expect(outcome.ok).toBe(false)`. `addFeatureText without changeId still inserts one backlash` and `removeFeatureId ignores changeId and does not insert addFeatureText` already pass.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/change.ts`, add `changeId?: string` to the `applyOutcome` input type, after `backlash?: string`.

Replace the `addFeatureText` branch:

```ts
      if (input.addFeatureText) {
        const featureId = insertFeatureFromText(db, input.factionId, input.addFeatureText);
        const backlashId = insertBacklashProblem(db, input.factionId, input.backlash);
        return { featureId, backlashProblemId: backlashId };
      }
```

with:

```ts
      if (input.addFeatureText) {
        if (input.changeId) {
          const change = db
            .prepare(
              `SELECT id, campaign_id, faction_id, kind, feature_id, backlash_problem_id
               FROM changes WHERE id = ?`,
            )
            .get(input.changeId) as
            | {
                id: string;
                campaign_id: string;
                faction_id: string | null;
                kind: string;
                feature_id: string | null;
                backlash_problem_id: string | null;
              }
            | undefined;
          if (
            !change ||
            change.campaign_id !== input.campaignId ||
            change.faction_id !== input.factionId
          ) {
            throw new RuleError("ENTITY_NOT_FOUND", `change ${input.changeId} not found`);
          }
          if (change.kind !== "feature") {
            throw new RuleError("CHANGE_NOT_READY", "change is not a feature change", {
              changeId: change.id,
            });
          }
          if (change.feature_id) {
            throw new RuleError("CHANGE_ALREADY_LANDED", "feature change already landed", {
              featureId: change.feature_id,
              backlashProblemId: change.backlash_problem_id,
            });
          }
          throw new RuleError("CHANGE_NOT_READY", "feature change lands in commit_resources", {
            changeId: change.id,
          });
        }
        const featureId = insertFeatureFromText(db, input.factionId, input.addFeatureText);
        const backlashId = insertBacklashProblem(db, input.factionId, input.backlash);
        return { featureId, backlashProblemId: backlashId };
      }
```

Leave the remove, remove-part, and reduce branches above it unchanged. Do not change `commitResources`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/feature-change-backlash.test.ts test/services/kistelek.test.ts`

Expected: PASS. The kistelek case `applyOutcome addFeatureText inserts catalog backlash problem` still passes.

- [ ] **Step 5: Commit**

```bash
git add test/services/feature-change-backlash.test.ts src/services/change.ts
git commit -m "fix: apply_outcome does not add a second backlash for a feature change"
```

---

### Task 2: Accept optional `changeId` on the `apply_outcome` tool

**Files:**
- Create: `test/mcp/apply-outcome-change.test.ts`
- Modify: `src/mcp/register.ts` (the `apply_outcome` `inputSchema` only in this task)

**Interfaces:**
- Consumes: `applyOutcome`’s optional `changeId` from Task 1. `buildServer` from `src/mcp/register.ts`.
- Produces: the registered `apply_outcome` input schema has `changeId` as a string property and does not require it. The handler stays `dbTool((a) => applyOutcome(db, a))`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp/apply-outcome-change.test.ts`:

```ts
import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/mcp/register.js";

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(":memory:");
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

test("apply_outcome accepts an optional changeId", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const apply = tools.tools.find((tool) => tool.name === "apply_outcome");
    expect(apply).toBeDefined();
    const schema = apply!.inputSchema as {
      required?: string[];
      properties: { changeId?: { type: string } };
    };
    expect(schema.properties.changeId).toEqual({ type: "string" });
    expect(schema.required).toEqual(["campaignId", "factionId"]);
  });
});
```

Do not assert on the tool description string.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp/apply-outcome-change.test.ts`

Expected: FAIL. `schema.properties.changeId` is `undefined` (`expected undefined to deeply equal { type: 'string' }`).

- [ ] **Step 3: Add the argument**

In `src/mcp/register.ts`, add `changeId` to the `apply_outcome` `inputSchema` after `backlash`:

```ts
        addFeatureText: z.string().optional(),
        backlash: z.string().optional(),
        changeId: z.string().optional(),
```

Leave the description string for Task 3. Leave the handler as `dbTool((a) => applyOutcome(db, a))`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp/apply-outcome-change.test.ts test/services/feature-change-backlash.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/mcp/apply-outcome-change.test.ts src/mcp/register.ts
git commit -m "fix: accept changeId on apply_outcome"
```

---

### Task 3: Describe the single backlash path

**Files:**
- Modify: `src/mcp/register.ts` (the `commit_resources` and `apply_outcome` description strings)
- Modify: `docs/design/overview.md` (the Changes, Influence, and Dominion gap list)
- Modify: `docs/design/current-engine.md` (the common error-code sentence)
- Modify: `user/skills/gdnr-player/references/gdnr-play.md` (the concrete-act bullet, the error table, and steps 4 and 5 of a sprawling ambition)

**Interfaces:**
- Consumes: `CHANGE_ALREADY_LANDED` and `CHANGE_NOT_READY` from Task 1, and optional `changeId` from Task 2.
- Produces: no new export. The tool descriptions, the gap list, the current-engine page, and the player manual state the single path.

- [ ] **Step 1: Update the tool descriptions**

In `src/mcp/register.ts`, replace the `commit_resources` description `Commit influence or wealth to a change` with:

```ts
description:
  "Commit influence or wealth to a change. When a feature change's coverage, deeds, and challenges are met, this call adds the Feature and one backlash Problem.",
```

Replace the `apply_outcome` description `Apply a scripted adventure outcome` with:

```ts
description:
  "Apply a scripted adventure outcome. addFeatureText without changeId adds one Feature and one backlash Problem. addFeatureText with changeId adds neither: CHANGE_ALREADY_LANDED if that feature change already landed, CHANGE_NOT_READY if it has not landed or is not a feature change, ENTITY_NOT_FOUND if that change is not on this faction in this campaign.",
```

Leave both handlers as pass-throughs.

- [ ] **Step 2: Remove the known-gap bullet**

In `docs/design/overview.md`, under **Changes, Influence, and Dominion**, delete this bullet. It is the first bullet in that section. Leave the following bullet, Hero Dominion cannot be spent on changes:

```markdown
- A PC feature change lands inside `commit_resources`, so a later `apply_outcome` for the same change adds the feature and its backlash twice.
```

- [ ] **Step 3: Name the error on the current-engine page**

In `docs/design/current-engine.md`, in the common error-code sentence, insert `CHANGE_ALREADY_LANDED` immediately after `CHANGE_NOT_READY`, so that pair reads `` `CHANGE_NOT_READY`, `CHANGE_ALREADY_LANDED` ``.

- [ ] **Step 4: State the single path in the player manual**

In `user/skills/gdnr-player/references/gdnr-play.md`, replace the `apply_outcome` bullet under single concrete acts with:

```markdown
  - `apply_outcome` changes a faction with no dice: `removeFeatureId` when what a feature depended on is gone, `removeFeaturePartId` for one part of it, `reduceProblemId` with `reduceBy` to shrink a problem that is not intrinsic, or `addFeatureText` for a new structure that is not a change project. That new structure also adds a 1-point backlash problem (`backlash`, or the next catalog row). Passing `changeId` with `addFeatureText` does not add a Feature or a backlash. A feature change that already landed returns `CHANGE_ALREADY_LANDED`. A feature change that has not landed, or a change that is not a feature change, returns `CHANGE_NOT_READY`. An unknown change id returns `ENTITY_NOT_FOUND`.
```

Add these rows directly under the `FILL_INCOMPLETE` row:

```markdown
| `CHANGE_ALREADY_LANDED` | This feature change already has its Feature and backlash. `commit_resources` recorded them. |
| `CHANGE_NOT_READY` | The call does not fit the change. `apply_outcome` was asked to add the Feature for a change that has not landed, or for a change that is not a feature change. The same code already covers a withdrawal that is not decaying and a deed when none remain. |
```

Replace steps 4 and 5 of the sprawling-ambition procedure with:

```markdown
  4. If the GM sets deed or challenge quotas on `quote_change` / `begin_change` (including explicit zero), record them with `record_deed`, `create_challenge`, and `record_challenge_outcome`. Omitted quotas are 0; the quote does not invent a mighty deed. Recording a deed or a challenge does not itself add the Feature. When the quotas are met, call `commit_resources` again.
  5. When `commit_resources` returns `active` for a feature change, that call has already added the Feature and its one backlash Problem. Do not call `apply_outcome` to add that Feature or that Problem again.
```

Leave the sentence that a Feature added by Influence or Dominion plants one backlash Problem. Do not link outside `user/`. Do not edit `user/skills/gdnr-player/SKILL.md`, `user/skills/gdnr-director/`, `docs/design/glossary.md`, `.cursor/prompts/`, or `.cursor/skills/`.

- [ ] **Step 5: Re-run the tests**

Run: `npx vitest run test/services/feature-change-backlash.test.ts test/mcp/apply-outcome-change.test.ts test/services/kistelek.test.ts`

Expected: PASS. These edits do not change the service behavior. Do not add a test that reads these markdown files.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/register.ts docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-player/references/gdnr-play.md
git commit -m "docs: feature change backlash is recorded once in commit_resources"
```
