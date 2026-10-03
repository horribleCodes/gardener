import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const glossary = readFileSync("docs/design/glossary.md", "utf8");
const play = readFileSync("user/skills/gdnr-player/references/gdnr-play.md", "utf8");

test("glossary names Feature, Problem, Trouble, and Cohesion", () => {
  for (const heading of ["## Feature", "## Problem", "## Trouble", "## Cohesion"]) {
    expect(glossary).toContain(heading);
  }
  expect(glossary.toLowerCase()).toContain("holy-law");
  expect(glossary.toLowerCase()).toContain("culprit bands");
  expect(glossary).toMatch(/Not every Problem is intrinsic/i);
});

test("play does not teach domain mismatch as automatic marginality", () => {
  expect(play).toMatch(/Marginality is the caller's `marginal`/i);
  expect(play).toMatch(/one Feature versus one Feature/i);
  expect(play.toLowerCase()).not.toMatch(
    /different domains the roll is marginal/,
  );
});
