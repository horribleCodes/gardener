# Strain Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the strain contract so a campaign file has a schema version, setpieces point at what they created, challenges can exist without a change, and a willing Remove Interest plan skips the roll.

**Architecture:** `openDb` reads SQLite `user_version` and refuses an incompatible file before any other read or write. A new file gets the current `schema.sql`. An unversioned v1 file is altered in place. `ensureSetpiece` writes the created row id onto the setpiece. `parseUnitPlan` allows `willing` only on `remove_interest`, which `runAction` already honors.

**Tech Stack:** Node >= 22, TypeScript 5.8, `better-sqlite3` 11.10.0, `zod` 3.24.2, Vitest 2.1.9.

## Global Constraints

- Roadmap items 1–3 in `docs/ROADMAP.md`. Behavior details in `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md` (setpiece needs, free-floating challenge, willing interest).
- A file newer than this server, or older than the oldest migration it can apply, is refused with a compatibility error before any read or write.
- `CREATE TABLE IF NOT EXISTS` does not add columns to an existing file and does not record a version.
- `user_version` 0 is an unversioned v1 file and is the oldest version this server migrates. `SCHEMA_VERSION` is 2. `MIN_SCHEMA_VERSION` is 0.
- Compatibility failures throw `RuleError` with code `INCOMPATIBLE_SCHEMA`. The message contains the word `compatible`.
- A challenge card has `kind`, `text`, optional `changeId`, and `status` (`open` | `overcome`). A missing `changeId` is a free-floating card. It still belongs to a campaign via `campaign_id`.
- `ensure_setpiece` is idempotent on `(campaign_id, key)`. A challenge need rolls a catalog kind and a catalog row from `seed`. It does not always insert the first entry of the challenge chart.
- A setpiece stores the id of the court, challenge, character, or fact it created: `court_id`, `challenge_id`, `character_id`, `fact_id`.
- `parseUnitPlan` still rejects `factionId`, `forcedRoll`, `forcedAttackerRoll`, `forcedDefenderRoll`, and `defenderChoice` on every plan. It rejects `willing` on every plan except `remove_interest`.
- Do not call a generation list a table. Database tables stay tables. Chart entries stay in `src/tables/catalog.json`.
- One SQLite transaction per service call. Rule failures roll back.
- Package manager: npm. Tests: `npx vitest run <file>`.

---

### Task 1: Schema version checked on open

**Files:**
- Modify: `src/store/schema.sql` (challenges and setpieces definitions only; the rest of the file stays)
- Modify: `src/store/db.ts`
- Test: `test/store/schema-version.test.ts`

**Interfaces:**
- Consumes: `RuleError` from `src/domain/types.ts`. `better-sqlite3` `Database`.
- Produces:
  - `SCHEMA_VERSION = 2`
  - `MIN_SCHEMA_VERSION = 0`
  - `checkSchemaVersion(fileVersion: number, current?: number, min?: number): void`
  - `migrate(db: Database.Database, fileVersion?: number): void`
  - `openDb(path: string): Database.Database` — checks version, migrates, then `foreign_keys = ON`, then WAL when `path !== ":memory:"`

- [ ] **Step 1: Write the failing test**

Create `test/store/schema-version.test.ts`:

```ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RuleError } from "../../src/domain/types.js";
import {
  MIN_SCHEMA_VERSION,
  SCHEMA_VERSION,
  checkSchemaVersion,
  openDb,
} from "../../src/store/db.js";

test("checkSchemaVersion refuses a file newer or older than this server can open", () => {
  expect(() => checkSchemaVersion(SCHEMA_VERSION + 1)).toThrow(RuleError);
  expect(() => checkSchemaVersion(SCHEMA_VERSION + 1)).toThrow(/compatib/i);
  expect(() => checkSchemaVersion(MIN_SCHEMA_VERSION - 1)).toThrow(/compatib/i);
  expect(() => checkSchemaVersion(SCHEMA_VERSION)).not.toThrow();
  expect(() => checkSchemaVersion(MIN_SCHEMA_VERSION)).not.toThrow();
});

test("a new database is stamped with this server's schema version", () => {
  const db = openDb(":memory:");
  expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  const challenges = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'challenges'")
    .get() as { sql: string };
  expect(challenges.sql.toLowerCase()).not.toContain("change_id text not null");
  db.close();
});

test("an unversioned v1 file is migrated and can store a free-floating challenge", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-schema-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        month INTEGER NOT NULL,
        rng_seed INTEGER NOT NULL,
        roll_counter INTEGER NOT NULL
      );
      CREATE TABLE changes (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id)
      );
      CREATE TABLE challenges (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        change_id TEXT NOT NULL REFERENCES changes(id),
        status TEXT NOT NULL
      );
      CREATE TABLE setpieces (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        key TEXT NOT NULL,
        need TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(campaign_id, key)
      );
      INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Old', 3, 1, 0);
      INSERT INTO changes (id, campaign_id) VALUES ('ch1', 'c1');
      INSERT INTO challenges (id, kind, text, change_id, status)
        VALUES ('card1', 'convince', 'They dislike the petitioners', 'ch1', 'open');
    `);
    expect(legacy.pragma("user_version", { simple: true })).toBe(0);
    legacy.close();

    const db = openDb(path);
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    const kept = db.prepare("SELECT change_id, campaign_id FROM challenges WHERE id = 'card1'").get() as {
      change_id: string;
      campaign_id: string;
    };
    expect(kept).toEqual({ change_id: "ch1", campaign_id: "c1" });
    db.prepare(
      "INSERT INTO challenges (id, campaign_id, kind, text, change_id, status) VALUES ('free', 'c1', 'find_thing', 'A decoy', NULL, 'open')",
    ).run();
    const columns = db.prepare("PRAGMA table_info(setpieces)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["court_id", "challenge_id", "character_id", "fact_id"]),
    );
    const month = db.prepare("SELECT month FROM campaigns WHERE id = 'c1'").get() as { month: number };
    expect(month.month).toBe(3);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file newer than this server is refused before any write", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-schema-new-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const future = new Database(path);
    future.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY)");
    future.prepare("INSERT INTO marker (id) VALUES (1)").run();
    future.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    future.close();

    expect(() => openDb(path)).toThrow(RuleError);
    expect(() => openDb(path)).toThrow(/compatib/i);

    const after = new Database(path);
    expect(after.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION + 1);
    expect(after.prepare("SELECT id FROM marker").get()).toEqual({ id: 1 });
    expect(
      after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factions'").get(),
    ).toBeUndefined();
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store/schema-version.test.ts`

Expected: FAIL. `checkSchemaVersion` is missing, and `openDb` does not refuse `user_version` above this server.

- [ ] **Step 3: Write minimal implementation**

Replace the `challenges` and `setpieces` definitions in `src/store/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  change_id TEXT REFERENCES changes(id),
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setpieces (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  key TEXT NOT NULL,
  need TEXT NOT NULL,
  status TEXT NOT NULL,
  court_id TEXT REFERENCES courts(id),
  challenge_id TEXT REFERENCES challenges(id),
  character_id TEXT REFERENCES characters(id),
  fact_id TEXT REFERENCES facts(id),
  UNIQUE(campaign_id, key)
);
```

Replace `src/store/db.ts` with:

```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RuleError } from "../domain/types.js";

/** Schema this server writes. A higher user_version is a newer file. */
export const SCHEMA_VERSION = 2;
/** Lowest user_version this server can migrate. 0 is an unversioned v1 file. */
export const MIN_SCHEMA_VERSION = 0;

export function checkSchemaVersion(
  fileVersion: number,
  current = SCHEMA_VERSION,
  min = MIN_SCHEMA_VERSION,
): void {
  if (!Number.isInteger(fileVersion) || fileVersion < min || fileVersion > current) {
    throw new RuleError(
      "INCOMPATIBLE_SCHEMA",
      `campaign file schema ${fileVersion} is not compatible with this server (${min}–${current})`,
    );
  }
}

function schemaSql(): string {
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
  return readFileSync(schemaPath, "utf8");
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[];
  return new Set(rows.map((row) => row.name));
}

function migrateLegacyStrain(db: Database.Database): void {
  const challengeColumns = db.prepare("PRAGMA table_info(challenges)").all() as {
    name: string;
    notnull: number;
  }[];
  const changeId = challengeColumns.find((column) => column.name === "change_id");
  const hasCampaign = challengeColumns.some((column) => column.name === "campaign_id");
  if (changeId?.notnull === 1 || !hasCampaign) {
    db.exec(`
      CREATE TABLE challenges_next (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        change_id TEXT REFERENCES changes(id),
        status TEXT NOT NULL
      );
      INSERT INTO challenges_next (id, campaign_id, kind, text, change_id, status)
      SELECT c.id, ch.campaign_id, c.kind, c.text, c.change_id, c.status
      FROM challenges c
      JOIN changes ch ON ch.id = c.change_id;
      DROP TABLE challenges;
      ALTER TABLE challenges_next RENAME TO challenges;
    `);
  }

  const links: Array<[string, string]> = [
    ["court_id", "courts"],
    ["challenge_id", "challenges"],
    ["character_id", "characters"],
    ["fact_id", "facts"],
  ];
  const present = columnNames(db, "setpieces");
  for (const [column, parent] of links) {
    if (!present.has(column)) {
      db.exec(`ALTER TABLE setpieces ADD COLUMN ${column} TEXT REFERENCES ${parent}(id)`);
    }
  }
}

export function migrate(db: Database.Database, fileVersion = Number(db.pragma("user_version", { simple: true }))): void {
  if (fileVersion === SCHEMA_VERSION) return;
  const legacy = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'")
    .get() as { ok: number } | undefined;
  db.pragma("foreign_keys = OFF");
  const apply = db.transaction(() => {
    if (!legacy) {
      db.exec(schemaSql());
    } else {
      migrateLegacyStrain(db);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  apply();
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  try {
    const fileVersion = Number(db.pragma("user_version", { simple: true }));
    checkSchemaVersion(fileVersion);
    migrate(db, fileVersion);
    db.pragma("foreign_keys = ON");
    if (path !== ":memory:") {
      db.pragma("journal_mode = WAL");
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function withTransaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn)();
}
```

The version check is the first statement after `new Database`. A failing check closes the handle and does not run `schema.sql`, `journal_mode`, or any campaign query.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store/schema-version.test.ts test/store/db.test.ts`

Expected: PASS. The existing WAL reopen test still passes.

- [ ] **Step 5: Commit**

```bash
git add src/store/schema.sql src/store/db.ts test/store/schema-version.test.ts
git commit -m "$(cat <<'EOF'
feat: refuse incompatible campaign files before migration

EOF
)"
```

---

### Task 2: Setpiece links and free-floating challenges

**Files:**
- Modify: `src/services/populate.ts` (`ensureSetpiece`, `createChallenge`, `recordChallengeOutcome`)
- Modify: `src/services/turn.ts` (`listHooks` challenge query)
- Modify: `src/mcp/register.ts` (`ensure_setpiece` input schema)
- Test: `test/services/strain-contract.test.ts` (the three setpiece tests; the willing test is Task 3)

**Interfaces:**
- Consumes: Task 1 schema. `challenges.campaign_id` is `NOT NULL`. `challenges.change_id` is nullable. `setpieces` has `court_id`, `challenge_id`, `character_id`, `fact_id`. `createCourt`, `createCharacter`, `createFact`, `pickOrRoll`, `mulberry32`, `loadCatalog`.
- Produces:
  - `ensureSetpiece` accepts optional `kind?: string`. A challenge with no `changeId` inserts `change_id` NULL and sets `setpieces.challenge_id`. A court sets `court_id`. A character or problem face sets `character_id`. A fact sets `fact_id`.
  - `createChallenge` writes `campaign_id` from the change.
  - `recordChallengeOutcome` on a card with null `change_id` sets `status = 'overcome'` and does not update `changes`.
  - `listHooks` selects open challenges by `challenges.campaign_id`.

- [ ] **Step 1: Write the failing test**

Create `test/services/strain-contract.test.ts` with the helper and the three setpiece tests. Leave the willing test for Task 3.

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ensureSetpiece, recordChallengeOutcome } from "../../src/services/populate.js";
import { listHooks } from "../../src/services/turn.js";
import { openDb } from "../../src/store/db.js";
import { loadCatalog } from "../../src/tables/catalog.js";

function campaignDb() {
  const dir = mkdtempSync(join(tmpdir(), "gb-strain-"));
  const db = openDb(join(dir, "c.sqlite"));
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Strain', 1, 1, 0)",
  ).run();
  return { dir, db };
}

test("ensure_setpiece rolls a challenge and points at it, including a free-floating card", () => {
  const { dir, db } = campaignDb();
  try {
    const texts = new Set<string>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const created = ensureSetpiece(db, {
        campaignId: "c1",
        key: `hook-${seed}`,
        need: "challenge",
        seed,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const row = db
        .prepare(
          `SELECT s.challenge_id, c.kind, c.text, c.change_id, c.campaign_id
           FROM setpieces s JOIN challenges c ON c.id = s.challenge_id
           WHERE s.id = ?`,
        )
        .get(created.data.setpieceId) as {
        challenge_id: string;
        kind: string;
        text: string;
        change_id: string | null;
        campaign_id: string;
      };
      expect(row.change_id).toBeNull();
      expect(row.campaign_id).toBe("c1");
      texts.add(row.text);
      kinds.add(row.kind);
      const again = ensureSetpiece(db, {
        campaignId: "c1",
        key: `hook-${seed}`,
        need: "challenge",
        seed: seed + 100,
      });
      expect(again.ok && again.data.created).toBe(false);
    }
    expect(texts.size).toBeGreaterThan(1);
    expect(kinds.size).toBeGreaterThan(1);
    const firstKind = Object.keys(loadCatalog().challenges)[0];
    const firstText = loadCatalog().challenges[firstKind][0];
    expect([...texts].every((text) => text === firstText)).toBe(false);

    const hooks = listHooks(db, "c1");
    expect(hooks.ok).toBe(true);
    if (!hooks.ok) return;
    const listed = (hooks.data as { challenges: { change_id: string | null }[] }).challenges;
    expect(listed.length).toBe(12);
    expect(listed.every((card) => card.change_id === null)).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a challenge attached to a change still points both ways, and a free card can be overcome alone", () => {
  const { dir, db } = campaignDb();
  try {
    db.prepare(
      `INSERT INTO changes (id, campaign_id, scope, magnitude, kind, owner, status, challenges_required)
       VALUES ('chg', 'c1', 'village', 'plausible', 'other', 'pc', 'active', 1)`,
    ).run();
    const attached = ensureSetpiece(db, {
      campaignId: "c1",
      key: "on-change",
      need: "challenge",
      changeId: "chg",
      seed: 2,
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    const linked = db
      .prepare(
        `SELECT c.change_id FROM setpieces s JOIN challenges c ON c.id = s.challenge_id WHERE s.id = ?`,
      )
      .get(attached.data.setpieceId) as { change_id: string };
    expect(linked.change_id).toBe("chg");

    const floating = ensureSetpiece(db, {
      campaignId: "c1",
      key: "loose",
      need: "challenge",
      seed: 3,
    });
    expect(floating.ok).toBe(true);
    if (!floating.ok) return;
    const card = db
      .prepare("SELECT challenge_id FROM setpieces WHERE id = ?")
      .get(floating.data.setpieceId) as { challenge_id: string };
    const outcome = recordChallengeOutcome(db, { challengeId: card.challenge_id, overcome: true });
    expect(outcome.ok).toBe(true);
    const status = db.prepare("SELECT status FROM challenges WHERE id = ?").get(card.challenge_id) as {
      status: string;
    };
    expect(status.status).toBe("overcome");
    const change = db.prepare("SELECT challenges_done FROM changes WHERE id = 'chg'").get() as {
      challenges_done: number;
    };
    expect(change.challenges_done).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a court setpiece stores the court it created", () => {
  const { dir, db } = campaignDb();
  try {
    const created = ensureSetpiece(db, {
      campaignId: "c1",
      key: "gate-court",
      need: "court",
      seed: 4,
      fill: "blank",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = db
      .prepare("SELECT court_id FROM setpieces WHERE id = ?")
      .get(created.data.setpieceId) as { court_id: string | null };
    expect(row.court_id).toBeTruthy();
    const court = db.prepare("SELECT id FROM courts WHERE id = ?").get(row.court_id);
    expect(court).toBeTruthy();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/services/strain-contract.test.ts`

Expected: FAIL. `ensureSetpiece` requires `changeId` for a challenge, inserts the first chart entry, and `setpieces` has no `challenge_id` written by the service (the column exists after Task 1, but the insert path does not fill it).

- [ ] **Step 3: Write minimal implementation**

In `src/services/populate.ts`, add these helpers above `ensureSetpiece`:

```ts
function unwrap<T>(result: ServiceResult<T>): T {
  if (!result.ok) throw new RuleError(result.error.code, result.error.message, result.error.details);
  return result.data;
}

function linkSetpiece(
  db: Database.Database,
  setpieceId: string,
  column: "court_id" | "challenge_id" | "character_id" | "fact_id",
  entityId: string,
): void {
  db.prepare(`UPDATE setpieces SET ${column} = ? WHERE id = ?`).run(entityId, setpieceId);
}
```

Add `kind?: string` to the `ensureSetpiece` input type.

Replace the `need` branches inside `ensureSetpiece` so each created row is stored on the setpiece. Challenge branch:

```ts
} else if (input.need === "challenge") {
  const catalog = loadCatalog();
  const rng = mulberry32(seed);
  const kinds = Object.keys(catalog.challenges);
  const kind = input.kind ?? kinds[Math.floor(rng.next() * kinds.length)];
  if (!catalog.challenges[kind]) {
    throw new RuleError("PICK_UNKNOWN", `${kind} is not a challenge kind`);
  }
  let changeId: string | null = null;
  if (input.changeId) {
    const change = db
      .prepare("SELECT campaign_id FROM changes WHERE id = ?")
      .get(input.changeId) as { campaign_id: string } | undefined;
    if (!change || change.campaign_id !== input.campaignId) {
      throw new RuleError("ENTITY_NOT_FOUND", "change not found");
    }
    changeId = input.changeId;
  }
  const text = pickOrRoll(catalog, `challenges.${kind}`, rng).text;
  const challengeId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO challenges (id, campaign_id, kind, text, change_id, status) VALUES (?, ?, ?, ?, ?, 'open')",
  ).run(challengeId, input.campaignId, kind, text, changeId);
  linkSetpiece(db, setpieceId, "challenge_id", challengeId);
}
```

Court branch calls `createCourt`, `unwrap`s it, and `linkSetpiece(..., "court_id", court.courtId)`. Character branch does the same with `createCharacter` and `character_id`, passing `courtId: input.courtId`. Fact branch keeps the missing-mode guard, then `unwrap(createFact(...))` and links `fact_id`. Problem-face branch links `character_id` after it sets `problems.face_character_id`.

`createChallenge` selects `campaign_id` from the change and inserts it:

```ts
db.prepare(
  "INSERT INTO challenges (id, campaign_id, kind, text, change_id, status) VALUES (?, ?, ?, ?, ?, 'open')",
).run(challengeId, change.campaign_id, input.kind, text, input.changeId);
```

`recordChallengeOutcome` types `change_id` as `string | null`. After marking the card `overcome`, if `change_id` is null, return `{ status: "overcome" }` and do not touch `changes`.

In `src/services/turn.ts`, replace the open-challenge query with:

```sql
SELECT c.id, c.text, c.change_id FROM challenges c
WHERE c.campaign_id = ? AND c.status = 'open'
```

In `src/mcp/register.ts`, add `kind: z.string().optional()` to the `ensure_setpiece` input schema, next to `changeId`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/services/strain-contract.test.ts`

Expected: PASS for the three setpiece tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/populate.ts src/services/turn.ts src/mcp/register.ts test/services/strain-contract.test.ts
git commit -m "$(cat <<'EOF'
feat: link setpieces to rolled challenges, including free-floating cards

EOF
)"
```

---

### Task 3: Willing Remove Interest in unit plans

**Files:**
- Modify: `src/services/unitPlan.ts` (`parseUnitPlan` only). The `remove_interest` zod object already has `willing: z.boolean().optional()`. `runRemoveInterest` in `src/services/actions.ts` already skips the roll when `willing` is true. Do not change that function.
- Modify: `test/services/strain-contract.test.ts` (append one test)

**Interfaces:**
- Consumes: `parseUnitPlan`, `factionActionFromUnitPlan`, `runAction`. `FactionAction` already includes `remove_interest` with `willing?: boolean`.
- Produces: `parseUnitPlan({ type: "remove_interest", targetFactionId, willing: true })` returns that object. The same `willing` key on any other type throws `RuleError` `FILL_INCOMPLETE`.

- [ ] **Step 1: Write the failing test**

Append to `test/services/strain-contract.test.ts`:

```ts
import { RuleError } from "../../src/domain/types.js";
import { runAction } from "../../src/services/actions.js";
import { factionActionFromUnitPlan, parseUnitPlan } from "../../src/services/unitPlan.js";

test("a willing remove-interest plan skips the roll and drops a point", () => {
  const { dir, db } = campaignDb();
  try {
    expect(() =>
      parseUnitPlan({ type: "attack", targetFactionId: "def", attackerFeatureId: "f", willing: true }),
    ).toThrow(RuleError);
    const plan = parseUnitPlan({
      type: "remove_interest",
      targetFactionId: "def",
      willing: true,
    });
    expect(plan).toMatchObject({ type: "remove_interest", willing: true });

    db.prepare(
      `INSERT INTO factions (id, campaign_id, name, power, cohesion, dominion, origin, behavior, control, auto_intervene, status)
       VALUES ('atk', 'c1', 'Atk', 1, 1, 0, 'existing', 'directed', 'npc', 0, 'active'),
              ('def', 'c1', 'Def', 5, 5, 0, 'existing', 'directed', 'npc', 0, 'active')`,
    ).run();
    db.prepare(
      "INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature) VALUES ('i1', 'atk', 'def', 2, 'rivalry')",
    ).run();
    const action = factionActionFromUnitPlan(plan);
    const result = runAction(db, { campaignId: "c1", factionId: "atk", ...action });
    expect(result.ok).toBe(true);
    const edge = db
      .prepare("SELECT points FROM interests WHERE from_faction_id = 'atk' AND to_faction_id = 'def'")
      .get() as { points: number };
    expect(edge.points).toBe(1);
    const roll = db.prepare("SELECT payload FROM rolls").get() as { payload: string };
    expect(JSON.parse(roll.payload).willing).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Put the new imports at the top of the file with the existing imports. Do not import the same module twice.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/services/strain-contract.test.ts`

Expected: FAIL with `forbidden plan field: willing`.

- [ ] **Step 3: Write minimal implementation**

In `parseUnitPlan`, remove `"willing"` from the base forbidden list and append it only when the plan is not a removal:

```ts
export function parseUnitPlan(raw: Record<string, unknown>): UnitPlan {
  const forbidden = [
    "factionId",
    "forcedRoll",
    "forcedAttackerRoll",
    "forcedDefenderRoll",
    "defenderChoice",
  ];
  if (raw.type !== "remove_interest") forbidden.push("willing");
  for (const key of forbidden) {
    if (key in raw && raw[key] !== undefined) {
      throw new RuleError("FILL_INCOMPLETE", `forbidden plan field: ${key}`);
    }
  }
  return unitPlanSchema.parse(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/services/strain-contract.test.ts test/final-review-critical.test.ts`

Expected: PASS. The existing test that rejects `factionId` and `forcedRoll` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/services/unitPlan.ts test/services/strain-contract.test.ts
git commit -m "$(cat <<'EOF'
fix: accept willing on remove-interest unit plans

EOF
)"
```

---

## Self-review

Spec coverage:

- Item 1, version on open, refuse newer and older, no reliance on `CREATE TABLE IF NOT EXISTS` for columns: Task 1.
- Item 2, setpiece links, nullable `change_id`, rolled challenge chart, free-floating card, hooks still list it, overcoming it does not bump a change: Task 2. The legacy rebuild that makes `change_id` nullable lives in Task 1 because a versioned file cannot open without that migration.
- Item 3, `willing` on Remove Interest only: Task 3.

Placeholder scan: none.

Type consistency: `SCHEMA_VERSION` is 2 in Task 1 and is not redefined later. `ensureSetpiece` `kind` is added in Task 2 and is not used by Task 3. `parseUnitPlan` return value matches `factionActionFromUnitPlan` and `runAction`'s `remove_interest` arm.
