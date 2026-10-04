# Power 1 cult stops being a faction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Power 1 cult that changes theology stops being a faction, without collapsing and without storing Power 0.

**Architecture:** The change is the Power `<= 1` branch of `setTheology` in `src/services/populate.ts`. That branch copies the cult gift and a worshiper sentence into public facts, clears the hero's `cult_faction_id` without touching divinity, deletes the faction sheet, and deletes the faction row. `ensureInternalTurnSlot` still spends the internal action first. `advanceMonth` and `cultIncome` are left alone, so clearing the link is what stops cult Dominion.

**Tech Stack:** Node >= 22, TypeScript 7.0.2, `better-sqlite3` 13.0.3, Vitest 5 (see `package.json`).

## Global Constraints

- On Power 1 or less, `setTheology` deletes the faction. It does not set `status` to `collapsed`, does not write `cohesion`, does not write `power`, and does not insert `type` `faction_collapsed`.
- Hero `divinity` stays `cult`. Every `cult_faction_id` that pointed at the removed faction becomes null.
- The worshiper fact statement is exactly `Worshipers remain, and they are not a faction.` Each gift fact statement is that feature's `text`, features ordered by `id` ascending.
- Fact subject is `hero` when `patron_hero_id` is a hero in the campaign, otherwise `place` when `home_place_id` is a place in the campaign, otherwise no facts are written.
- The return on this path is `{ ended: true, factionId, giftTexts, factIds }` and has no `collapsed` field.
- `INTERNAL_BUDGET` / `internal action already taken` still aborts before any of these writes.
- The Power greater than 1 path is unchanged.
- Faction status values stay `active` and `collapsed` only. No schema change.
- Package manager is npm. Tests are `npx vitest run <file>`. Node >= 22.
- Implement on the spec draft's existing branch. Do not open a second pull request and do not branch from `main`.
- Do not add a test that reads a documentation file or a prompt file and asserts on that file's text.

---

## File map

- Create: `test/services/set-theology-end.test.ts` — Power 1 ends the faction; a spent internal action and a non-cult do not; Power 2 still only loses 1 Power; income stops because the link is cleared.
- Modify: `src/services/populate.ts` — the `faction.power <= 1` branch of `setTheology`, and the `SELECT` that loads the faction.
- Modify: `src/mcp/register.ts` — the `set_theology` description string only.
- Modify: `docs/design/glossary.md` — the Cult section.
- Modify: `docs/design/current-engine.md` — the Cult theology section.
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` — the `set_theology` bullet.

`ensureInternalTurnSlot`, `rescaleIntrinsic`, `advanceMonth`, `cultIncome`, `setDivinity`, and `applyCollapseIfNeeded` are not modified.

---

### Task 1: End a Power 1 cult in `setTheology`

**Files:**
- Create: `test/services/set-theology-end.test.ts`
- Modify: `src/services/populate.ts` (`setTheology`)

**Interfaces:**
- Consumes: `setTheology` from `src/services/populate.ts`; `advanceMonth` from `src/services/turn.ts`; `cultIncome` from `src/queries/detail.ts`; `openDb` from `src/store/db.ts`. `newId` is already imported in `populate.ts`.
- Produces: `setTheology` on Power `<= 1` returns `{ ok: true, data: { ended: true, factionId: string, giftTexts: string[], factIds: string[] } }`. On Power greater than 1 it still returns `{ ok: true, data: { power: number, cohesion: number } }`. No new export.

- [ ] **Step 1: Write the failing test**

Create `test/services/set-theology-end.test.ts`:

```ts
import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDb } from "../../src/store/db.js";
import { setTheology } from "../../src/services/populate.js";
import { advanceMonth } from "../../src/services/turn.js";
import { cultIncome } from "../../src/queries/detail.js";

function world(): Database.Database {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO campaigns (id, name, month, rng_seed, roll_counter) VALUES ('c1', 'Cults', 1, 42, 0)",
  ).run();
  return db;
}

function hero(
  db: Database.Database,
  id: string,
  cultFactionId: string | null,
  dominion = 0,
): void {
  db.prepare(
    `INSERT INTO heroes (id, campaign_id, name, level, words, influence, dominion, wealth, divinity, cult_faction_id)
     VALUES (?, 'c1', ?, 2, '[]', 0, ?, 0, 'cult', ?)`,
  ).run(id, id, dominion, cultFactionId);
}

function faction(
  db: Database.Database,
  row: {
    id: string;
    power: number;
    cohesion: number;
    cult?: number;
    harshness?: string | null;
    patron?: string | null;
    home?: string | null;
    dominion?: number;
  },
): void {
  db.prepare(
    `INSERT INTO factions (
       id, campaign_id, name, power, cohesion, dominion, origin, behavior, control,
       auto_intervene, status, contested_control, cult, harshness, patron_hero_id, home_place_id
     ) VALUES (?, 'c1', ?, ?, ?, ?, 'forged', 'directed', 'npc', 0, 'active', 0, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.id,
    row.power,
    row.cohesion,
    row.dominion ?? 0,
    row.cult ?? 1,
    row.harshness ?? "nominal",
    row.patron ?? null,
    row.home ?? null,
  );
}

function feature(
  db: Database.Database,
  id: string,
  factionId: string,
  text: string,
  aimedAt: string | null = null,
): void {
  db.prepare(
    `INSERT INTO features (id, faction_id, text, domain, origin, aimed_at_faction_id)
     VALUES (?, ?, ?, 'other', 'native', ?)`,
  ).run(id, factionId, text, aimedAt);
  db.prepare(
    "INSERT INTO feature_parts (id, feature_id, text, position) VALUES (?, ?, ?, 0)",
  ).run(`${id}-part`, id, text);
}

test("a Power 1 cult stops being a faction and keeps the gift and worshipers", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1", dominion: 4 });
  faction(db, { id: "f2", power: 2, cohesion: 2, cult: 0, harshness: null });
  feature(db, "feat1", "f1", "The healing gift");
  feature(db, "feat2", "f1", "The war gift");
  feature(db, "feat-other", "f2", "Spies", "f1");
  db.prepare(
    `INSERT INTO characters (
       id, campaign_id, name, role, faction_id, side, is_leader, is_hidden_controller, shares_authority
     ) VALUES ('ch1', 'c1', 'Acolyte', 'priest', 'f1', 'unaffiliated', 0, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO courts (id, campaign_id, type, power_structure, atmosphere, rules_faction_id, blank)
     VALUES ('court1', 'c1', 'temple', 'autocratic', 'tense', 'f1', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO problems (id, faction_id, text, points, domain, intrinsic, external, resistance, position)
     VALUES ('prob1', 'f1', 'Holy law', 1, 'cultural', 1, 0, 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO changes (
       id, campaign_id, scope, magnitude, kind, owner, status, faction_id, feature_id, backlash_problem_id
     ) VALUES ('chng1', 'c1', 'village', 'plausible', 'feature', 'pc', 'active', 'f1', 'feat1', 'prob1')`,
  ).run();
  db.prepare(
    `INSERT INTO interests (id, from_faction_id, to_faction_id, points, nature)
     VALUES ('int1', 'f2', 'f1', 1, 'alliance'), ('int2', 'f1', 'f2', 1, 'rivalry')`,
  ).run();
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order, missing, advance_month)
     VALUES ('t1', 'c1', 1, 1, 1, '[]', 'idle', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO write_queue (
       id, campaign_id, turn_id, unit_type, unit_id, kind, payload, status, enqueued_at
     ) VALUES ('q1', 'c1', 't1', 'faction', 'f1', 'plan', '{}', 'queued', 1)`,
  ).run();

  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1", harshness: "sharp", featureText: "ignored" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factIds = result.data.factIds as string[];
  expect(result.data).toEqual({
    ended: true,
    factionId: "f1",
    giftTexts: ["The healing gift", "The war gift"],
    factIds,
  });
  expect(factIds).toHaveLength(3);
  const facts = factIds.map((id) =>
    db.prepare(
      "SELECT subject, subject_id, statement, kind, visibility FROM facts WHERE id = ?",
    ).get(id),
  );
  expect(facts).toEqual([
    { subject: "hero", subject_id: "h1", statement: "The healing gift", kind: "explicit", visibility: "public" },
    { subject: "hero", subject_id: "h1", statement: "The war gift", kind: "explicit", visibility: "public" },
    {
      subject: "hero",
      subject_id: "h1",
      statement: "Worshipers remain, and they are not a faction.",
      kind: "explicit",
      visibility: "public",
    },
  ]);
  expect(db.prepare("SELECT id FROM factions WHERE id = 'f1'").get()).toBeUndefined();
  expect(db.prepare("SELECT COUNT(*) AS n FROM factions WHERE status = 'collapsed' OR power = 0").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'faction_collapsed'").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT id FROM features WHERE faction_id = 'f1'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM feature_parts WHERE id = 'feat1-part'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM problems WHERE faction_id = 'f1'").get()).toBeUndefined();
  expect(db.prepare("SELECT id FROM interests").get()).toBeUndefined();
  expect(db.prepare("SELECT divinity, cult_faction_id, dominion FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: null,
    dominion: 0,
  });
  expect(db.prepare("SELECT faction_id FROM characters WHERE id = 'ch1'").get()).toEqual({ faction_id: null });
  expect(db.prepare("SELECT rules_faction_id FROM courts WHERE id = 'court1'").get()).toEqual({ rules_faction_id: null });
  expect(
    db.prepare("SELECT faction_id, feature_id, backlash_problem_id FROM changes WHERE id = 'chng1'").get(),
  ).toEqual({ faction_id: null, feature_id: null, backlash_problem_id: null });
  expect(db.prepare("SELECT id, power FROM factions WHERE id = 'f2'").get()).toEqual({ id: "f2", power: 2 });
  expect(db.prepare("SELECT aimed_at_faction_id FROM features WHERE id = 'feat-other'").get()).toEqual({
    aimed_at_faction_id: null,
  });
  expect(db.prepare("SELECT status FROM write_queue WHERE id = 'q1'").get()).toEqual({ status: "queued" });
  expect(
    db.prepare("SELECT type, actor_id, outcome FROM actions WHERE turn_id = 't1' AND type = 'set_theology'").get(),
  ).toEqual({ type: "set_theology", actor_id: "f1", outcome: "success" });
});

test("facts land on the home place when the cult has no patron", () => {
  const db = world();
  db.prepare(
    "INSERT INTO places (id, campaign_id, name, scope) VALUES ('p1', 'c1', 'Village', 'village')",
  ).run();
  faction(db, { id: "f1", power: 1, cohesion: 1, home: "p1" });
  feature(db, "feat1", "f1", "Place gift");
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const factIds = result.data.factIds as string[];
  expect(result.data.giftTexts).toEqual(["Place gift"]);
  expect(factIds).toHaveLength(2);
  expect(
    db.prepare("SELECT subject, subject_id, statement FROM facts WHERE id = ?").get(factIds[0]),
  ).toEqual({ subject: "place", subject_id: "p1", statement: "Place gift" });
  expect(
    db.prepare("SELECT subject, subject_id, statement FROM facts WHERE id = ?").get(factIds[1]),
  ).toEqual({
    subject: "place",
    subject_id: "p1",
    statement: "Worshipers remain, and they are not a faction.",
  });
});

test("a cult with no patron and no home place still ends, with no facts", () => {
  const db = world();
  faction(db, { id: "f1", power: 1, cohesion: 1 });
  feature(db, "feat1", "f1", "A gift");
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toEqual({ ended: true, factionId: "f1", giftTexts: ["A gift"], factIds: [] });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT id FROM factions WHERE id = 'f1'").get()).toBeUndefined();
});

test("a patron and no features still records that worshipers remain", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1" });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.giftTexts).toEqual([]);
  const factIds = result.data.factIds as string[];
  expect(factIds).toHaveLength(1);
  expect(db.prepare("SELECT statement FROM facts WHERE id = ?").get(factIds[0])).toEqual({
    statement: "Worshipers remain, and they are not a faction.",
  });
});

test("a spent internal action leaves the Power 1 cult in place", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1" });
  db.prepare(
    `INSERT INTO turns (id, campaign_id, month, sequence, open, faction_order)
     VALUES ('t1', 'c1', 1, 1, 1, '[]')`,
  ).run();
  db.prepare(
    `INSERT INTO actions (id, turn_id, type, actor_type, actor_id, outcome)
     VALUES ('a1', 't1', 'build_strength', 'faction', 'f1', 'success')`,
  ).run();
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({
    ok: false,
    error: { code: "INTERNAL_BUDGET", message: "internal action already taken", details: {} },
  });
  expect(db.prepare("SELECT id, status, power, cohesion FROM factions WHERE id = 'f1'").get()).toEqual({
    id: "f1",
    status: "active",
    power: 1,
    cohesion: 1,
  });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
});

test("a faction that is not a cult is left alone", () => {
  const db = world();
  faction(db, { id: "f1", power: 1, cohesion: 1, cult: 0 });
  const result = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(result).toEqual({
    ok: false,
    error: { code: "ENTITY_NOT_FOUND", message: "cult faction not found", details: {} },
  });
  expect(db.prepare("SELECT status FROM factions WHERE id = 'f1'").get()).toEqual({ status: "active" });
});

test("a Power 2 cult loses 1 Power and stays a faction", () => {
  const db = world();
  hero(db, "h1", "f1");
  faction(db, { id: "f1", power: 2, cohesion: 2, patron: "h1", harshness: "nominal" });
  feature(db, "feat1", "f1", "Old gift");
  const result = setTheology(db, {
    campaignId: "c1",
    cultFactionId: "f1",
    harshness: "sharp",
    featureText: "New gift",
  });
  expect(result).toEqual({ ok: true, data: { power: 1, cohesion: 1 } });
  expect(db.prepare("SELECT power, cohesion, harshness, status FROM factions WHERE id = 'f1'").get()).toEqual({
    power: 1,
    cohesion: 1,
    harshness: "sharp",
    status: "active",
  });
  expect(db.prepare("SELECT text FROM features WHERE id = 'feat1'").get()).toEqual({ text: "New gift" });
  expect(db.prepare("SELECT divinity, cult_faction_id FROM heroes WHERE id = 'h1'").get()).toEqual({
    divinity: "cult",
    cult_faction_id: "f1",
  });
  expect(db.prepare("SELECT COUNT(*) AS n FROM facts").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'faction_collapsed'").get()).toEqual({ n: 0 });
});

test("ending the cult stops cult Dominion while a linked cult still pays", () => {
  const db = world();
  hero(db, "h1", "f1");
  hero(db, "h2", "f2");
  faction(db, { id: "f1", power: 1, cohesion: 1, patron: "h1", harshness: "nominal" });
  faction(db, { id: "f2", power: 1, cohesion: 1, patron: "h2", harshness: "nominal" });
  const ended = setTheology(db, { campaignId: "c1", cultFactionId: "f1" });
  expect(ended.ok).toBe(true);
  advanceMonth(db, "c1");
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h1'").get()).toEqual({ dominion: 0 });
  expect(db.prepare("SELECT dominion FROM heroes WHERE id = 'h2'").get()).toEqual({ dominion: 1 });
  const income = cultIncome(db, "c1");
  expect(income.find((row) => row.heroId === "h1")).toMatchObject({ divinity: "cult", grant: 0 });
  expect(income.find((row) => row.heroId === "h2")).toMatchObject({ divinity: "cult", grant: 1 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/services/set-theology-end.test.ts`

Expected: FAIL. `a Power 1 cult stops being a faction and keeps the gift and worshipers` receives `{ collapsed: true }` rather than `{ ended: true, factionId, giftTexts, factIds }`. The Power 2 test and the non-cult test can pass on the current code. The file fails.

- [ ] **Step 3: Write the minimal implementation**

In `setTheology`, replace the faction `SELECT` and the `faction.power <= 1` branch. Leave `ensureInternalTurnSlot` and the Power greater than 1 branch as they are.

The `SELECT` becomes:

```ts
const faction = db
  .prepare(
    `SELECT id, power, cohesion, cult, patron_hero_id, home_place_id
     FROM factions WHERE id = ? AND campaign_id = ?`,
  )
  .get(input.cultFactionId, input.campaignId) as
  | {
      id: string;
      power: Power;
      cohesion: number;
      cult: number;
      patron_hero_id: string | null;
      home_place_id: string | null;
    }
  | undefined;
```

Replace the body of `if (faction.power <= 1)` (the collapse update, the `faction_collapsed` insert, and `return { collapsed: true }`) with:

```ts
if (faction.power <= 1) {
  const features = db
    .prepare("SELECT id, text FROM features WHERE faction_id = ? ORDER BY id ASC")
    .all(faction.id) as { id: string; text: string }[];
  const giftTexts = features.map((row) => row.text);
  const factIds: string[] = [];

  let factSubject: "hero" | "place" | null = null;
  let factSubjectId: string | null = null;
  if (faction.patron_hero_id) {
    const patron = db
      .prepare("SELECT id FROM heroes WHERE id = ? AND campaign_id = ?")
      .get(faction.patron_hero_id, input.campaignId) as { id: string } | undefined;
    if (patron) {
      factSubject = "hero";
      factSubjectId = patron.id;
    }
  }
  if (!factSubjectId && faction.home_place_id) {
    const place = db
      .prepare("SELECT id FROM places WHERE id = ? AND campaign_id = ?")
      .get(faction.home_place_id, input.campaignId) as { id: string } | undefined;
    if (place) {
      factSubject = "place";
      factSubjectId = place.id;
    }
  }
  if (factSubject && factSubjectId) {
    const insertFact = db.prepare(
      `INSERT INTO facts (id, campaign_id, subject, subject_id, statement, kind, visibility)
       VALUES (?, ?, ?, ?, ?, 'explicit', 'public')`,
    );
    for (const text of giftTexts) {
      const factId = newId();
      insertFact.run(factId, input.campaignId, factSubject, factSubjectId, text);
      factIds.push(factId);
    }
    const worshipersId = newId();
    insertFact.run(
      worshipersId,
      input.campaignId,
      factSubject,
      factSubjectId,
      "Worshipers remain, and they are not a faction.",
    );
    factIds.push(worshipersId);
  }

  db.prepare("UPDATE heroes SET cult_faction_id = NULL WHERE cult_faction_id = ?").run(faction.id);
  db.prepare("UPDATE characters SET faction_id = NULL WHERE faction_id = ?").run(faction.id);
  db.prepare("UPDATE courts SET rules_faction_id = NULL WHERE rules_faction_id = ?").run(faction.id);
  db.prepare("UPDATE changes SET faction_id = NULL WHERE faction_id = ?").run(faction.id);
  db.prepare(
    `UPDATE changes SET feature_id = NULL
     WHERE feature_id IN (SELECT id FROM features WHERE faction_id = ?)`,
  ).run(faction.id);
  db.prepare(
    `UPDATE changes SET backlash_problem_id = NULL
     WHERE backlash_problem_id IN (SELECT id FROM problems WHERE faction_id = ?)`,
  ).run(faction.id);
  db.prepare("UPDATE features SET aimed_at_faction_id = NULL WHERE aimed_at_faction_id = ?").run(
    faction.id,
  );
  db.prepare(
    `DELETE FROM feature_parts WHERE feature_id IN (SELECT id FROM features WHERE faction_id = ?)`,
  ).run(faction.id);
  db.prepare("DELETE FROM problems WHERE faction_id = ?").run(faction.id);
  db.prepare("DELETE FROM interests WHERE from_faction_id = ? OR to_faction_id = ?").run(
    faction.id,
    faction.id,
  );
  db.prepare("DELETE FROM features WHERE faction_id = ?").run(faction.id);
  db.prepare("DELETE FROM factions WHERE id = ?").run(faction.id);

  return { ended: true, factionId: faction.id, giftTexts, factIds };
}
```

Do not call `applyCollapseIfNeeded`. Do not insert an event. Do not assign `input.harshness` or `input.featureText` on this path. Do not add a column, a status, or a Power of 0.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/services/set-theology-end.test.ts`

Expected: PASS. All eight tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/services/set-theology-end.test.ts src/services/populate.ts
git commit -m "A Power 1 cult stops being a faction"
```

---

### Task 2: State the ruling in the tool description, the glossary, the engine page, and the director prompt

**Files:**
- Modify: `src/mcp/register.ts` (the `set_theology` description string)
- Modify: `docs/design/glossary.md` (after **Chart catalog**, before **Fact**)
- Modify: `docs/design/current-engine.md` (after **Turns, units, and the write queue**, before **Visibility and rumors**)
- Modify: `user/skills/gdnr-director/references/gdnr-direct.md` (the `set_theology` bullet)

**Interfaces:**
- Consumes: the ruling in `docs/superpowers/specs/2026-10-04-power-1-cult-ends-design.md`.
- Produces: no new function. The tool description string is the sentence below.

- [ ] **Step 1: Replace the tool description**

In `src/mcp/register.ts`, replace:

```ts
description: "Change cult theology at the cost of power",
```

with:

```ts
description: "Change cult theology. Costs 1 Power and the internal action. A Power 1 cult stops being a faction.",
```

Leave the input schema as it is.

- [ ] **Step 2: Add the glossary section**

In `docs/design/glossary.md`, after the **Chart catalog** section and before `## Fact`, insert:

```markdown
## Cult

A **cult** is a faction bound to a hero whose divinity is `cult`. `set_theology` costs that cult 1 Power and its internal action. At Power 1 the cult stops being a faction: the faction row is removed, divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain, and they do not pay cult Dominion. This is not a collapse.

```

- [ ] **Step 3: Add the engine section**

In `docs/design/current-engine.md`, after the **Lock** bullet of **Turns, units, and the write queue** and before `## Visibility and rumors`, insert:

```markdown
## Cult theology

`set_theology` costs the cult 1 Power and its internal action. A Power 1 cult stops being a faction: the faction row is removed, the hero's divinity stays `cult`, and `cult_faction_id` is cleared. Leftover worshipers and the cult gift remain as public facts, and they do not pay cult Dominion. This is not a collapse.

```

- [ ] **Step 4: Correct the director bullet**

In `user/skills/gdnr-director/references/gdnr-direct.md`, replace:

```markdown
- `set_theology`: changes a cult's harshness or feature text. It costs the cult 1 Power and its internal action for the turn; a Power 1 cult collapses instead.
```

with:

```markdown
- `set_theology`: changes a cult's harshness or feature text. It costs the cult 1 Power and its internal action for the turn. A Power 1 cult stops being a faction: divinity stays `cult`, the hero's faction link is cleared, and the leftover worshipers and cult gift remain without paying cult Dominion.
```

Leave the `form_cult` bullet unchanged. Leave `user/skills/gdnr-player/references/gdnr-play.md` unchanged. Leave the cult gap bullets in `docs/design/overview.md` unchanged. Do not edit `docs/superpowers/specs/2026-09-21-godbound-faction-mcp-design.md`.

- [ ] **Step 5: Re-run the service test**

Run: `npx vitest run test/services/set-theology-end.test.ts`

Expected: PASS. All eight tests pass. Do not add a test that reads these markdown files.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/register.ts docs/design/glossary.md docs/design/current-engine.md user/skills/gdnr-director/references/gdnr-direct.md
git commit -m "State the Power 1 cult ruling in living docs"
```
