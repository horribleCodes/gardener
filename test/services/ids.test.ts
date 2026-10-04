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
