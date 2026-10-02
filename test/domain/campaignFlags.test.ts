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
