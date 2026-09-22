import { expect, test } from "vitest";
import { loadCatalog, pickOrRoll } from "../../src/tables/catalog.js";
import { mulberry32 } from "../../src/rules/dice.js";

test("aristocratic conflicts are a d12 and picks are 1-based", () => {
  const catalog = loadCatalog();
  expect(catalog.courts.aristocratic.conflict).toHaveLength(12);
  const picked = pickOrRoll(catalog, "courts.aristocratic.conflict", mulberry32(1), 1);
  expect(picked.text).toBe(catalog.courts.aristocratic.conflict[0]);
  expect(picked.forced).toBe(true);
  try {
    pickOrRoll(catalog, "courts.aristocratic.conflict", mulberry32(1), 13);
    throw new Error("should have thrown");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("PICK_OUT_OF_RANGE");
  }
});

test("a missing field rolls once and a provided field is kept", () => {
  const catalog = loadCatalog();
  const kept = pickOrRoll(catalog, "courts.aristocratic.atmosphere", mulberry32(1), undefined, "Already chosen");
  expect(kept.text).toBe("Already chosen");
  expect(kept.forced).toBe(false);
  const rolled = pickOrRoll(catalog, "powerStructure", mulberry32(2));
  expect(rolled.index).toBeGreaterThanOrEqual(1);
  expect(rolled.index).toBeLessThanOrEqual(6);
});
