import { describe, expect, test } from "vitest";
import { fillResourceUri } from "../../dev/tools/gui/server/uri-template.js";

describe("fillResourceUri", () => {
  test("substitutes campaign id", () => {
    expect(
      fillResourceUri("world://campaigns/{campaignId}/brief", { campaignId: "c1" }),
    ).toBe("world://campaigns/c1/brief");
  });

  test("encodes path params", () => {
    expect(
      fillResourceUri("world://tables/{path}", { path: "a b" }),
    ).toBe("world://tables/a%20b");
  });

  test("throws when a param is missing", () => {
    expect(() => fillResourceUri("world://campaigns/{campaignId}/brief", {})).toThrow(
      /Missing param: campaignId/,
    );
  });
});
