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
