# Short random ids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint new row ids as 8 lowercase hex characters from one `newId()` function, and keep every id already stored valid.

**Architecture:** `src/services/ids.ts` exports `newId()`, which hex-encodes 4 random bytes. The 65 `crypto.randomUUID()` calls under `src/services/` become `newId()` calls. Schema, MCP schemas, and stored rows stay as they are. `resolveWithdrawal` renames its local `newId` binding so it does not shadow the import.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `node:crypto` `randomBytes`, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-04-short-random-ids-design.md`. Issue #80.
- `newId(): string` returns exactly 8 lowercase hex characters. No length or alphabet argument.
- Alphabet is `0-9` and `a-f`. Collision risk at 32 bits is accepted. Do not retry on a duplicate primary key.
- Existing longer ids stay valid. Do not migrate or rewrite persisted ids. `SCHEMA_VERSION` stays 4. No `CHECK` constraint.
- Do not edit `user/` skills. Do not rewrite historical specs under `docs/superpowers/` other than this plan and its design.
- Leave the `crypto.randomUUID()` fixture in `test/services/turn.test.ts` in place.
- Implement on the spec draft’s existing branch. Do not open a second pull request and do not branch from `main`.
- Package manager: npm. Tests: `npx vitest run <file>`.

---

## File map

- Create: `src/services/ids.ts` — `newId()`.
- Create: `test/services/ids.test.ts` — generator contract.
- Create: `test/services/short-id-persistence.test.ts` — new campaign ids are short; a stored UUID still loads.
- Modify: `src/services/populate.ts` — 31 call sites, plus `import { newId } from "./ids.js"`.
- Modify: `src/services/actions.ts` — 11 call sites, plus the same import.
- Modify: `src/services/change.ts` — rename the local `newId` to `successorFactId`, then 7 call sites, plus the same import.
- Modify: `src/services/util.ts` — 6 call sites, plus the same import.
- Modify: `src/services/queue.ts` — 5 call sites, plus the same import.
- Modify: `src/services/turn.ts` — 4 call sites, plus the same import.
- Modify: `src/services/collapse.ts` — 1 call site, plus the same import.
- Modify: `docs/design/glossary.md` — **Identifier** entry.
- Modify: `docs/design/current-engine.md` — **Identifiers** subsection.
- Modify: `test/docs/glossary-play-strain-sheet.test.ts` — assert the glossary entry exists.

---

### Task 1: `newId`

**Files:**
- Create: `src/services/ids.ts`
- Create: `test/services/ids.test.ts`

**Interfaces:**
- Consumes: `randomBytes` from `node:crypto`.
- Produces: `newId(): string` — 8 lowercase hex characters. Later tasks import this exact name from `./ids.js`.

- [ ] **Step 1: Write the failing test**

Create `test/services/ids.test.ts`:

```ts
import { expect, test } from "vitest";
import { newId } from "../../src/services/ids.js";

test("newId returns 8 lowercase hex characters", () => {
  for (let i = 0; i < 50; i++) {
    expect(newId()).toMatch(/^[0-9a-f]{8}$/);
  }
});

test("newId does not return one constant", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newId()));
  expect(ids.size).toBe(1000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/ids.test.ts`

Expected: FAIL because `src/services/ids.ts` does not exist (cannot find module).

- [ ] **Step 3: Write the minimal implementation**

Create `src/services/ids.ts`:

```ts
import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(4).toString("hex");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/ids.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/ids.ts test/services/ids.test.ts
git commit -m "feat: add 8-character hex newId generator"
```

---

### Task 2: Mint short ids and keep stored UUIDs

**Files:**
- Create: `test/services/short-id-persistence.test.ts`
- Modify: `src/services/change.ts` (rename local `newId` around lines 493–508, then replace every `crypto.randomUUID()`)
- Modify: `src/services/populate.ts`
- Modify: `src/services/actions.ts`
- Modify: `src/services/util.ts`
- Modify: `src/services/queue.ts`
- Modify: `src/services/turn.ts`
- Modify: `src/services/collapse.ts`

**Interfaces:**
- Consumes: `newId(): string` from Task 1. `createCampaign` from `src/services/populate.ts`. `requireCampaign` from `src/services/util.ts`. `openDb` from `src/store/db.ts`.
- Produces: every new row id minted under `src/` is an 8-character hex string. `requireCampaign(db, legacyUuid)` still returns that uuid. No new public function.

- [ ] **Step 1: Write the failing persistence tests**

Create `test/services/short-id-persistence.test.ts`:

```ts
import { expect, test } from "vitest";
import { createCampaign } from "../../src/services/populate.js";
import { requireCampaign } from "../../src/services/util.js";
import { openDb } from "../../src/store/db.js";

test("createCampaign stores an 8-character hex id", () => {
  const db = openDb(":memory:");
  const created = createCampaign(db, { name: "N" });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.data.campaignId).toMatch(/^[0-9a-f]{8}$/);
  const row = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(created.data.campaignId) as {
    id: string;
  };
  expect(row.id).toBe(created.data.campaignId);
});

test("requireCampaign still loads a stored UUID", () => {
  const db = openDb(":memory:");
  const legacyId = "11111111-2222-4333-8444-555555555555";
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES (?, 'Old', 1, 1, 0)",
  ).run(legacyId);
  expect(requireCampaign(db, legacyId).id).toBe(legacyId);
});
```

- [ ] **Step 2: Run the new tests to verify the campaign-id test fails**

Run: `npx vitest run test/services/short-id-persistence.test.ts`

Expected: FAIL on `createCampaign stores an 8-character hex id` because `campaignId` is still a UUID. `requireCampaign still loads a stored UUID` already passes; leave it in the file.

- [ ] **Step 3: Rename the shadowing local in `change.ts`**

In `src/services/change.ts`, inside the `input.choice === "undo"` branch, replace the local binding and its two uses. The block becomes:

```ts
          const successorFactId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, source_change_id, visibility, place_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            successorFactId,
            old.campaign_id,
            old.subject,
            old.subject_id,
            `${old.statement} (undone)`,
            old.kind,
            old.source_change_id,
            old.visibility,
            old.place_id,
          );
          db.prepare("UPDATE facts SET superseded_by = ? WHERE id = ?").run(successorFactId, f.id);
```

Do this before the file-wide replace. A replace that runs first would produce `const newId = newId()`.

- [ ] **Step 4: Point every production call at `newId`**

In each of these files, add this import with the other local imports:

```ts
import { newId } from "./ids.js";
```

Then replace every remaining `crypto.randomUUID()` in that file with `newId()`. Counts and lines after the Task 2 rename (the undo site is now `successorFactId = crypto.randomUUID()` and is included in the replace):

| File | Count | Lines on current `main` |
| --- | --- | --- |
| `src/services/populate.ts` | 31 | 42, 59, 61, 62, 64, 77, 81, 89, 137, 251, 266, 289, 335, 375, 458, 663, 667, 801, 857, 898, 930, 1008, 1074, 1097, 1135, 1155, 1218, 1261, 1298, 1312, 1328 |
| `src/services/actions.ts` | 11 | 156, 253, 308, 403, 454, 616, 822, 852, 916, 965, 1021 |
| `src/services/change.ts` | 7 | 76, 98, 102, 493, 527, 604, 678 |
| `src/services/util.ts` | 6 | 89, 129, 207, 227, 236, 249 |
| `src/services/queue.ts` | 5 | 359, 398, 550, 584, 731 |
| `src/services/turn.ts` | 4 | 275, 757, 808, 1177 |
| `src/services/collapse.ts` | 1 | 33 |

Examples of the expression change (the surrounding statement stays):

```ts
const campaignId = newId();
```

```ts
idMap.set(actor.id, newId());
```

```ts
const protagonistId = idMap.get(draft.conflict.protagonistId) ?? newId();
```

```ts
).run(newId(), placeId, ward.rating);
```

Do not edit `test/services/turn.test.ts`. Do not add `newId` to MCP handlers or domain rules.

- [ ] **Step 5: Confirm `src/` no longer mints UUIDs**

Run: `rg -n "crypto\\.randomUUID" src`

Expected: no matches. `rg -n "crypto\\.randomUUID" test` still shows `test/services/turn.test.ts`.

- [ ] **Step 6: Run the persistence tests and the generator tests**

Run: `npx vitest run test/services/short-id-persistence.test.ts test/services/ids.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`

Expected: PASS. Existing tests insert short fixture ids and full UUIDs by hand; those rows must still load.

- [ ] **Step 8: Commit**

```bash
git add src/services/populate.ts src/services/actions.ts src/services/change.ts src/services/util.ts src/services/queue.ts src/services/turn.ts src/services/collapse.ts test/services/short-id-persistence.test.ts
git commit -m "feat: mint 8-character hex ids for new rows"
```

---

### Task 3: Note the convention in living design

**Files:**
- Modify: `docs/design/glossary.md` (insert after the **Hero** section, before **Module**)
- Modify: `docs/design/current-engine.md` (insert after **Campaigns and the database file**, before **Schema versioning**)
- Modify: `test/docs/glossary-play-strain-sheet.test.ts`

**Interfaces:**
- Consumes: the generator name `newId` from Task 1.
- Produces: glossary heading `## Identifier` and current-engine heading `## Identifiers`. No code exports.

- [ ] **Step 1: Write the failing doc test**

Append to `test/docs/glossary-play-strain-sheet.test.ts`:

```ts
test("glossary records 8-character hex identifiers", () => {
  expect(glossary).toContain("## Identifier");
  expect(glossary).toMatch(/8 lowercase hex characters/);
  expect(glossary).toContain("`newId()`");
  expect(glossary).toMatch(/Nothing rewrites them/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/glossary-play-strain-sheet.test.ts`

Expected: FAIL because `## Identifier` is not in the glossary yet.

- [ ] **Step 3: Add the glossary entry**

In `docs/design/glossary.md`, after the **Hero** section and before `## Module`, insert:

```md
## Identifier

A randomly generated **identifier** is 8 lowercase hex characters (`0-9`, `a-f`), about 32 bits. The server mints one through `newId()` whenever it creates a row id. Collision risk at that size is accepted; the generator does not retry. Identifiers already stored, including full UUID v4 values and short fixture ids, stay valid. Nothing rewrites them.
```

- [ ] **Step 4: Add the current-engine subsection**

In `docs/design/current-engine.md`, after the **Campaigns and the database file** section and before `## Schema versioning`, insert:

```md
## Identifiers

New row ids minted by the server are 8 lowercase hex characters from `newId()`. A stored id is an opaque string: a full UUID from an older file, or a caller-chosen id, still addresses its row. The server does not rewrite existing ids and does not reject a longer id. Eight hex characters are about 32 bits. A duplicate inside one table surfaces as a SQLite constraint error; the generator does not retry.
```

- [ ] **Step 5: Run the doc test**

Run: `npx vitest run test/docs/glossary-play-strain-sheet.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/design/glossary.md docs/design/current-engine.md test/docs/glossary-play-strain-sheet.test.ts
git commit -m "docs: record 8-character hex id convention"
```

---

## Self-review

Spec coverage:

- Shared `newId()` of 8 lowercase hex characters: Task 1.
- About 32 bits, collision risk accepted, no retry: Task 1 implementation and Task 3 wording.
- All 65 production `crypto.randomUUID()` call sites: Task 2 table.
- `change.ts` local `newId` shadowing: Task 2 Step 3.
- Existing longer ids stay valid, no migration, `SCHEMA_VERSION` unchanged: Task 2 persistence test and Global Constraints.
- Fixture UUID in `test/services/turn.test.ts` left alone: Task 2 Step 4.
- Living glossary and current-engine notes: Task 3.
- `user/` skills and historical superpowers pages untouched: Global Constraints; no task edits them.

Placeholder scan: the plan has no open items. The call-site table lists every line. The expression examples cover assignment, map insert, `??`, and `.run(`.

Type consistency: every task calls `newId(): string` from `src/services/ids.ts`. The renamed local is `successorFactId` in Task 2 only.
