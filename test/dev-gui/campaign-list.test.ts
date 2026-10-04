import { expect, test } from "vitest";
import { campaignMenuRows, campaignOptionLabel } from "../../dev/tools/gui/client/campaign-list.js";

test("labels a campaign with its name and id", () => {
  expect(campaignOptionLabel({ id: "c1", name: "Kistelek" })).toBe("Kistelek — c1");
});

test("builds menu rows in list order", () => {
  expect(
    campaignMenuRows([
      { id: "c1", name: "Kistelek" },
      { id: "c2", name: "Buda" },
    ]),
  ).toEqual([
    { id: "c1", label: "Kistelek — c1" },
    { id: "c2", label: "Buda — c2" },
  ]);
});
