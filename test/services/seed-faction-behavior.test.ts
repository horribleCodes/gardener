import { expect, test } from "vitest";
import { seedCampaign } from "../../src/services/populate.js";
import { openDb } from "../../src/store/db.js";

const CHART = [
  "despotic_tyrant",
  "martial_conqueror",
  "scheming_manipulator",
  "self_absorbed_survivor",
] as const;

function behaviorOf(
  db: ReturnType<typeof openDb>,
  campaignId: string,
  name: string,
): string {
  const row = db
    .prepare("SELECT behavior FROM factions WHERE campaign_id = ? AND name = ?")
    .get(campaignId, name) as { behavior: string };
  return row.behavior;
}

function campaignCount(db: ReturnType<typeof openDb>): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number }).n;
}

test("omitted behavior under fill missing rolls the chart for seed 42", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("martial_conqueror");
});

test("omitted fill is missing, so seed 42 still rolls martial_conqueror", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("martial_conqueror");
});

test("seed 1 rolls survivor then schemer by outline index", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 1,
    linkInterests: false,
    outline: {
      factions: [
        { key: "a", name: "A" },
        { key: "b", name: "B" },
      ],
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("self_absorbed_survivor");
  expect(behaviorOf(db, result.data.campaignId, "B")).toBe("scheming_manipulator");
});

test("an explicit behavior wins over the roll", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "despotic_tyrant" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("despotic_tyrant");
});

test("explicit directed is stored and not replaced by a chart roll", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "directed" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("directed");
});

test("the outline index includes factions that passed a behavior", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 1,
    linkInterests: false,
    outline: {
      factions: [
        { key: "a", name: "A", behavior: "despotic_tyrant" },
        { key: "b", name: "B" },
      ],
    },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("despotic_tyrant");
  expect(behaviorOf(db, result.data.campaignId, "B")).toBe("scheming_manipulator");
});

test("an empty behavior string is omission and rolls", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Roll",
    fill: "missing",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("martial_conqueror");
});

test("fill require rejects an omitted behavior and commits nothing", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Nope",
    fill: "require",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
  expect(result.error.message).toBe("behavior required");
  expect(campaignCount(db)).toBe(0);
});

test("fill blank rejects an omitted behavior and commits nothing", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Nope",
    fill: "blank",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A" }] },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("FILL_INCOMPLETE");
  expect(result.error.message).toBe("behavior required");
  expect(campaignCount(db)).toBe(0);
});

test("fill require stores an explicit behavior", () => {
  const db = openDb(":memory:");
  const result = seedCampaign(db, {
    name: "Kept",
    fill: "require",
    seed: 42,
    linkInterests: false,
    outline: { factions: [{ key: "a", name: "A", behavior: "despotic_tyrant" }] },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(behaviorOf(db, result.data.campaignId, "A")).toBe("despotic_tyrant");
});

test("a missing-fill roll stays on a chart behavior", () => {
  for (let seed = 1; seed <= 24; seed++) {
    const db = openDb(":memory:");
    const result = seedCampaign(db, {
      name: "Roll",
      fill: "missing",
      seed,
      linkInterests: false,
      outline: { factions: [{ key: "a", name: "A" }] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(CHART).toContain(behaviorOf(db, result.data.campaignId, "A"));
  }
});
