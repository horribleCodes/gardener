# Campaign flags and godbound preset implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist campaign flags and the `godbound` preset on each campaign row, defaulting new and migrated campaigns to today's Godbound numbers, without implementing other named presets or changing cost math.

**Architecture:** Schema version 3 adds typed columns on `campaigns`. `resolveCampaignFlags` + `createCampaign` / `seed_campaign` write them. `worldBrief` reads them. `quoteChange` is not wired in this card.

**Tech Stack:** SQLite, TypeScript, Vitest.

## Global Constraints

- Design: `docs/superpowers/specs/2026-09-30-campaign-flags-godbound-preset-design.md`. If this plan disagrees, fix the plan.
- GitHub issue: https://github.com/horribleCodes/gardener/issues/54
- Do not ship named ashes/cities/assets/reach presets.
- Do not change `quoteChange` / `factionProjectCost` formulas in this card.
- Existing campaigns keep godbound values via column defaults.
- No game rules in MCP handlers.
- Public copy: no personal names.

---

### Task 1: Flag module and failing tests

**Files:**
- Create: `src/domain/campaignFlags.ts`
- Create: `test/domain/campaignFlags.test.ts`
- Create: `test/services/campaign-flags.test.ts` (createCampaign + worldBrief; will fail until schema exists — write after Task 2 if imports break on missing columns; prefer Task 1 unit tests that do not open SQLite)

**Interfaces:**
- Consumes: none
- Produces: `GODBOUND_PRESET`, `resolveCampaignFlags`

- [ ] **Step 1: Write `src/domain/campaignFlags.ts`**

```typescript
import { RuleError } from "./types.js";

export type CampaignProfile = "strain" | "assets";
export type ProjectBase = "scope" | "scale";
export type OppositionMode = "stack" | "largest";
export type ReachUnit = "place" | "miles" | "hex";

export interface CampaignFlags {
  preset: "godbound";
  profile: CampaignProfile;
  projectBase: ProjectBase;
  opposition: OppositionMode;
  wards: boolean;
  heldChanges: boolean;
  capabilityGate: boolean;
  reachUnit: ReachUnit;
}

export const GODBOUND_PRESET: CampaignFlags = {
  preset: "godbound",
  profile: "strain",
  projectBase: "scope",
  opposition: "stack",
  wards: true,
  heldChanges: true,
  capabilityGate: false,
  reachUnit: "place",
};

const PROFILES = new Set<CampaignProfile>(["strain", "assets"]);
const PROJECT_BASES = new Set<ProjectBase>(["scope", "scale"]);
const OPPOSITIONS = new Set<OppositionMode>(["stack", "largest"]);
const REACH = new Set<ReachUnit>(["place", "miles", "hex"]);

export function resolveCampaignFlags(input: {
  preset?: string;
  flags?: Partial<Omit<CampaignFlags, "preset">>;
}): CampaignFlags {
  const presetName = input.preset ?? "godbound";
  if (presetName !== "godbound") {
    throw new RuleError("PICK_UNKNOWN", `unknown campaign preset: ${presetName}`);
  }
  const next: CampaignFlags = { ...GODBOUND_PRESET };
  const flags = input.flags ?? {};
  if (flags.profile != null) {
    if (!PROFILES.has(flags.profile)) throw new RuleError("PICK_UNKNOWN", "unknown profile");
    next.profile = flags.profile;
  }
  if (flags.projectBase != null) {
    if (!PROJECT_BASES.has(flags.projectBase)) throw new RuleError("PICK_UNKNOWN", "unknown projectBase");
    next.projectBase = flags.projectBase;
  }
  if (flags.opposition != null) {
    if (!OPPOSITIONS.has(flags.opposition)) throw new RuleError("PICK_UNKNOWN", "unknown opposition");
    next.opposition = flags.opposition;
  }
  if (flags.wards != null) next.wards = flags.wards;
  if (flags.heldChanges != null) next.heldChanges = flags.heldChanges;
  if (flags.capabilityGate != null) next.capabilityGate = flags.capabilityGate;
  if (flags.reachUnit != null) {
    if (!REACH.has(flags.reachUnit)) throw new RuleError("PICK_UNKNOWN", "unknown reachUnit");
    next.reachUnit = flags.reachUnit;
  }
  return next;
}
```

- [ ] **Step 2: Tests for the resolver**

```typescript
import { expect, test } from "vitest";
import { RuleError } from "../../src/domain/types.js";
import { GODBOUND_PRESET, resolveCampaignFlags } from "../../src/domain/campaignFlags.js";

test("omitted preset is godbound", () => {
  expect(resolveCampaignFlags({})).toEqual(GODBOUND_PRESET);
});

test("ashes preset is unknown", () => {
  expect(() => resolveCampaignFlags({ preset: "ashes" })).toThrow(RuleError);
  try {
    resolveCampaignFlags({ preset: "ashes" });
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe("PICK_UNKNOWN");
  }
});

test("flag overlay persists scale without renaming the preset", () => {
  expect(resolveCampaignFlags({ flags: { projectBase: "scale" } })).toMatchObject({
    preset: "godbound",
    projectBase: "scale",
    opposition: "stack",
  });
});
```

- [ ] **Step 3: Run**

```bash
npx vitest run test/domain/campaignFlags.test.ts
```

Expected: PASS once the module exists (write module and tests in one step if easier; still commit together).

- [ ] **Step 4: Commit**

```bash
git add src/domain/campaignFlags.ts test/domain/campaignFlags.test.ts
git commit -m "feat: resolve godbound campaign flags"
```

---

### Task 2: Schema version 3 and migration

**Files:**
- Modify: `src/store/schema.sql`
- Modify: `src/store/db.ts`
- Modify: `test/store/schema-version.test.ts`
- Create: `test/store/campaign-flags-migrate.test.ts`

**Interfaces:**
- Consumes: `columnNames` in `db.ts`
- Produces: version 3; ALTER missing columns with godbound defaults

- [ ] **Step 1: Failing version test**

In `test/store/schema-version.test.ts`, the assertion `user_version === SCHEMA_VERSION` will follow the constant. Add a test that a new campaigns row has `preset = 'godbound'`. Add `test/store/campaign-flags-migrate.test.ts`:

```typescript
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";

test("a v2 campaign file gains godbound flag columns without changing month", () => {
  const dir = mkdtempSync(join(tmpdir(), "gb-flags-"));
  const path = join(dir, "campaign.sqlite");
  try {
    const v2 = new Database(path);
    v2.exec(`
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        month INTEGER NOT NULL,
        rng_seed INTEGER NOT NULL,
        roll_counter INTEGER NOT NULL,
        name_lists TEXT NOT NULL DEFAULT '{}'
      );
    `);
    v2.prepare(
      "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Old', 7, 1, 0)",
    ).run();
    v2.pragma("user_version = 2");
    v2.close();

    const db = openDb(path);
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    const row = db.prepare(
      "SELECT month, preset, profile, project_base, opposition, wards, held_changes, capability_gate, reach_unit FROM campaigns WHERE id = 'c1'",
    ).get() as Record<string, unknown>;
    expect(row).toMatchObject({
      month: 7,
      preset: "godbound",
      profile: "strain",
      project_base: "scope",
      opposition: "stack",
      wards: 1,
      held_changes: 1,
      capability_gate: 0,
      reach_unit: "place",
    });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Expected FAIL until `SCHEMA_VERSION` is 3 and ALTER exists.

- [ ] **Step 2: schema.sql campaigns table**

Add the eight columns with the defaults from the design after `name_lists`.

- [ ] **Step 3: db.ts**

Set `SCHEMA_VERSION = 3`. After `migrateLegacyStrain` (and on the `!legacy` path as well, so a file that already has `campaigns` but lacked columns is fixed), call:

```typescript
function migrateCampaignFlags(db: Database.Database): void {
  const present = columnNames(db, "campaigns");
  const additions: Array<[string, string]> = [
    ["preset", "TEXT NOT NULL DEFAULT 'godbound'"],
    ["profile", "TEXT NOT NULL DEFAULT 'strain'"],
    ["project_base", "TEXT NOT NULL DEFAULT 'scope'"],
    ["opposition", "TEXT NOT NULL DEFAULT 'stack'"],
    ["wards", "INTEGER NOT NULL DEFAULT 1"],
    ["held_changes", "INTEGER NOT NULL DEFAULT 1"],
    ["capability_gate", "INTEGER NOT NULL DEFAULT 0"],
    ["reach_unit", "TEXT NOT NULL DEFAULT 'place'"],
  ];
  for (const [name, spec] of additions) {
    if (!present.has(name)) {
      db.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${spec}`);
    }
  }
}
```

Call it inside the existing migrate transaction after `db.exec(schemaSql())` and `migrateLegacyStrain` when the table exists. Guard `columnNames` if `campaigns` is missing (fresh `schemaSql()` already created it).

- [ ] **Step 4: Run**

```bash
npx vitest run test/store/schema-version.test.ts test/store/campaign-flags-migrate.test.ts
```

Expected: PASS. Existing schema-version tests still pass with `SCHEMA_VERSION === 3`.

- [ ] **Step 5: Commit**

```bash
git add src/store/schema.sql src/store/db.ts test/store/schema-version.test.ts test/store/campaign-flags-migrate.test.ts
git commit -m "feat: persist godbound campaign flags (schema v3)"
```

---

### Task 3: createCampaign, seed_campaign, worldBrief

**Files:**
- Modify: `src/services/populate.ts` (`createCampaign`, `seedCampaign`)
- Modify: `src/mcp/register.ts`
- Modify: `src/queries/rumors.ts` (`worldBrief`)
- Create: `test/services/campaign-flags.test.ts`

**Interfaces:**
- Consumes: `resolveCampaignFlags`
- Produces: flags on insert and on `get_world_brief`

- [ ] **Step 1: Failing service test**

```typescript
import { expect, test } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createCampaign } from "../../src/services/populate.js";
import { worldBrief } from "../../src/queries/rumors.js";
import { GODBOUND_PRESET } from "../../src/domain/campaignFlags.js";

test("createCampaign stores and returns godbound flags", () => {
  const db = openDb(":memory:");
  const created = createCampaign(db, { name: "N" });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.data.flags).toEqual(GODBOUND_PRESET);
  const brief = worldBrief(db, created.data.campaignId);
  expect(brief?.flags).toEqual(GODBOUND_PRESET);
});

test("createCampaign stores projectBase overlay", () => {
  const db = openDb(":memory:");
  const created = createCampaign(db, { name: "N", flags: { projectBase: "scale" } });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(created.data.flags.projectBase).toBe("scale");
  const row = db.prepare("SELECT project_base FROM campaigns WHERE id = ?").get(created.data.campaignId) as {
    project_base: string;
  };
  expect(row.project_base).toBe("scale");
});

test("createCampaign rejects an unknown preset", () => {
  const db = openDb(":memory:");
  const created = createCampaign(db, { name: "N", preset: "ashes" });
  expect(created.ok).toBe(false);
  if (!created.ok) expect(created.error.code).toBe("PICK_UNKNOWN");
});
```

- [ ] **Step 2: Extend `createCampaign` input** with `preset?: string` and `flags?: Partial<...>`. Call `resolveCampaignFlags`. INSERT the eight columns. Return `flags` on success.

- [ ] **Step 3: `seedCampaign`** currently calls `createCampaign(db, { name, rngSeed: seed })`. Pass `preset` and `flags` from its input.

- [ ] **Step 4: MCP schemas** on `create_campaign` and `seed_campaign`: `preset: z.string().optional()`, `flags: z.object({ profile: z.enum(["strain", "assets"]).optional(), projectBase: z.enum(["scope", "scale"]).optional(), opposition: z.enum(["stack", "largest"]).optional(), wards: z.boolean().optional(), heldChanges: z.boolean().optional(), capabilityGate: z.boolean().optional(), reachUnit: z.enum(["place", "miles", "hex"]).optional() }).optional()`. Forward to the services. Unknown preset is handled in `resolveCampaignFlags` (string, not Zod enum).

- [ ] **Step 5: `worldBrief`** SELECT the flag columns and return camelCase `flags`. Add `loadCampaignFlags` in `src/queries/rumors.ts` or `src/services/util.ts` and use it here.

Map integers: `wards: row.wards !== 0`, same for `held_changes` and `capability_gate`.

- [ ] **Step 6: Run**

```bash
npx vitest run test/services/campaign-flags.test.ts test/domain/campaignFlags.test.ts
npm test
```

Expected: PASS. Fix any INSERT INTO campaigns in tests that listed columns without defaults — new columns have DEFAULT so old INSERT lists should still work.

- [ ] **Step 7: Commit**

```bash
git add src/services/populate.ts src/mcp/register.ts src/queries/rumors.ts test/services/campaign-flags.test.ts
git commit -m "feat: create_campaign stores godbound flags"
```

---

### Task 4: Living docs

**Files:**
- Modify: `docs/design/overview.md`
- Modify: `docs/design/current-engine.md`
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md`

- [ ] **Step 1: overview.md**

Replace the sentence that flags do not exist. After the v1 / ashes table, state: campaigns store these seven flags plus `preset`; `create_campaign` / `seed_campaign` default to `godbound`; other named presets are not shipped; cost/turn code still uses the godbound formulas until follow-on cards read the stored flags.

- [ ] **Step 2: current-engine.md**

Schema version 3. Campaign row includes the flags. `get_world_brief` returns them.

- [ ] **Step 3: director create_campaign row**

Note optional `preset` (only `godbound`) and optional `flags` overlays.

- [ ] **Step 4: Commit**

```bash
git add docs/design/overview.md docs/design/current-engine.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "docs: living copy for campaign flags and godbound preset"
```

---

## Self-review

- Spec coverage: seven flags, godbound preset, migrate existing, no ashes preset, no cost-math switch, worldBrief, tests.
- `SCHEMA_VERSION` is 3 in Task 2 and not redefined later.
- Overlay does not rename `preset` off `godbound`.
