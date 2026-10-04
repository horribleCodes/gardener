import { expect, test } from "vitest";
import { schemaSkeleton } from "../../dev/tools/gui/client/schema-skeleton.js";

test("fills every property of a quote_change-shaped schema, including defaults and optionals", () => {
  expect(
    schemaSkeleton({
      type: "object",
      properties: {
        scope: { type: "string", enum: ["village", "city", "region", "nation", "realm"] },
        magnitude: { type: "string", enum: ["plausible", "improbable", "impossible", "vast"] },
        wardRatings: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 20 },
          default: [],
        },
        resisterRatings: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          default: [],
        },
        kind: {
          type: "string",
          enum: ["feature", "fact", "problem_mitigation", "creature_population", "champion", "other"],
        },
        petty: { type: "boolean" },
        deedsRequired: { type: "integer", minimum: 0 },
        challengesRequired: { type: "integer", minimum: 0 },
      },
      required: ["scope", "magnitude"],
    }),
  ).toEqual({
    scope: "village",
    magnitude: "plausible",
    wardRatings: [1],
    resisterRatings: [1],
    kind: "feature",
    petty: false,
    deedsRequired: 0,
    challengesRequired: 0,
  });
});

test("includes one exemplar object for a nested array", () => {
  expect(
    schemaSkeleton({
      type: "object",
      properties: {
        outline: {
          type: "object",
          properties: {
            places: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
      },
    }),
  ).toEqual({ outline: { places: [{ key: "", name: "" }] } });
});

test("emits an empty object for a record with no named fields", () => {
  expect(
    schemaSkeleton({
      type: "object",
      additionalProperties: { type: "array", items: { type: "string" } },
    }),
  ).toEqual({});
});

test("merges every object branch of anyOf and skips non-object branches", () => {
  expect(
    schemaSkeleton({
      anyOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "integer", minimum: 2 } } },
      ],
    }),
  ).toEqual({ a: "", b: 2 });
  expect(
    schemaSkeleton({
      anyOf: [{ type: "null" }, { type: "object", properties: { a: { type: "string" } } }],
    }),
  ).toEqual({ a: "" });
});

test("uses the first union branch when none of them is an object", () => {
  expect(
    schemaSkeleton({
      anyOf: [{ type: "string" }, { type: "integer", minimum: 4 }],
    }),
  ).toBe("");
});

test("merges oneOf when anyOf is absent", () => {
  expect(
    schemaSkeleton({
      oneOf: [{ type: "object", properties: { a: { type: "boolean" } } }],
    }),
  ).toEqual({ a: false });
});

test("lets a later anyOf branch win on a shared key", () => {
  expect(
    schemaSkeleton({
      anyOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { a: { type: "integer", minimum: 3 } } },
      ],
    }),
  ).toEqual({ a: 3 });
});

test("skeletons tuple slots and empty item lists", () => {
  expect(
    schemaSkeleton({ type: "array", items: [{ type: "string" }, { type: "boolean" }] }),
  ).toEqual(["", false]);
  expect(schemaSkeleton({ type: "array" })).toEqual([]);
});

test("treats a missing tool schema as an empty object and an unknown node as null", () => {
  expect(schemaSkeleton(undefined)).toEqual({});
  expect(schemaSkeleton({ type: "object" })).toEqual({});
  expect(schemaSkeleton({})).toBe(null);
  expect(schemaSkeleton({ type: "null" })).toBe(null);
  expect(schemaSkeleton({ type: "number" })).toBe(0);
  expect(schemaSkeleton({ type: "string", enum: [] })).toBe("");
  expect(schemaSkeleton({ type: ["string", "null"] })).toBe("");
});
