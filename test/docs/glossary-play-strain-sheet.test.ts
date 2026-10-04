import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const glossary = readFileSync("docs/design/glossary.md", "utf8");
const play = readFileSync("user/skills/gdnr-player/references/gdnr-play.md", "utf8");
const direct = readFileSync("user/skills/gdnr-director/references/gdnr-direct.md", "utf8");

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

test("play and director copy teach a GM bonus and omit automatic origin", () => {
  for (const text of [play, direct]) {
    expect(text).toMatch(/attackerBonus/);
    expect(text).toMatch(/defenderBonus/);
    expect(text).toMatch(/0 to 3/);
    expect(text).not.toMatch(/automatic bonus/i);
    expect(text).not.toMatch(/attackerEdge/);
    expect(text).not.toMatch(/`origin`/);
  }
  expect(glossary).not.toMatch(/`magical`/);
});

test("glossary records 8-character hex identifiers", () => {
  expect(glossary).toContain("## Identifier");
  expect(glossary).toMatch(/8 lowercase hex characters/);
  expect(glossary).toContain("`newId()`");
  expect(glossary).toMatch(/Nothing rewrites them/);
});
