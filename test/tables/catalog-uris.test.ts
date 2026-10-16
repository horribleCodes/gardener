import { expect, test } from "vitest";
import { catalogRowsAt, catalogTableUris } from "../../src/tables/catalog.js";

test("catalogTableUris lists paths catalogRowsAt can read", () => {
  const uris = catalogTableUris();
  expect(uris.length).toBeGreaterThan(0);
  expect(uris).toContain("world://tables/powerStructure");
  expect(uris).toContain("world://tables/backlash");
  for (const uri of uris) {
    expect(uri.startsWith("world://tables/")).toBe(true);
    const rows = catalogRowsAt(uri.slice("world://tables/".length));
    expect(rows.length).toBeGreaterThan(0);
  }
  expect(uris.some((uri) => uri.endsWith("/cults") || uri.endsWith(".cults"))).toBe(false);
  expect(uris.some((uri) => uri.endsWith("/godbound") || uri.endsWith(".godbound"))).toBe(false);
});
