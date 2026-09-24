import { expect, test } from "vitest";
import { projectUnitView } from "../../src/rules/knowledge.js";

const world = {
  factions: [
    { id: "us", name: "Us", power: 1, cohesion: 1, dominion: 3, homePlaceId: "p", behavior: "directed", status: "active" },
    { id: "them", name: "Them", power: 2, cohesion: 2, dominion: 9, homePlaceId: "far", behavior: "despotic_tyrant", status: "active" },
  ],
  places: [{ id: "p", name: "Home", scope: "village", parentPlaceId: null }, { id: "far", name: "Far", scope: "city", parentPlaceId: null }],
  features: [
    { id: "f1", factionId: "them", text: "Open market", domain: "economic", covert: false },
    { id: "f2", factionId: "them", text: "Secret rifles", domain: "military", covert: true },
  ],
  problems: [
    { id: "pr1", factionId: "them", text: "Bandits", domain: "military", points: 1, intrinsic: false },
    { id: "pr2", factionId: "them", text: "Empty treasury", domain: "economic", points: 1, intrinsic: false },
  ],
  interests: [{ fromFactionId: "us", toFactionId: "them", points: 4, nature: "rivalry" }],
  courts: [],
  characters: [{ id: "c1", name: "Spy", statNote: "HD 4", courtId: null, isHiddenController: false }],
  facts: [],
  events: [],
};

test("a rival sees military secrets and not dominion", () => {
  const view = projectUnitView(world, { type: "faction", id: "us" });
  const them = view.known.factions.find((faction) => faction.id === "them");
  expect(them?.features.map((feature) => feature.id).sort()).toEqual(["f1", "f2"]);
  expect(them?.problems.map((problem) => problem.id)).toEqual(["pr1"]);
  expect(them).not.toHaveProperty("dominion");
  expect(JSON.stringify(view)).not.toContain("HD 4");
  expect(JSON.stringify(view)).not.toContain("despotic_tyrant");
});

test("hidden faction fact does not include distant faction without max spy network", () => {
  const isolated = {
    ...world,
    interests: [] as typeof world.interests,
    facts: [
      {
        id: "hf1",
        subject: "faction",
        subjectId: "them",
        statement: "Classified dossier",
        visibility: "hidden",
      },
    ],
  };
  const view = projectUnitView(isolated, { type: "faction", id: "us" });
  expect(view.known.factions.some((f) => f.id === "them")).toBe(false);
});

test("public fact naming a distant faction includes that faction", () => {
  const distant = {
    ...world,
    interests: [] as typeof world.interests,
    facts: [
      {
        id: "ff1",
        subject: "faction",
        subjectId: "them",
        statement: "Rumors of their armies",
        visibility: "public",
      },
    ],
  };
  const view = projectUnitView(distant, { type: "faction", id: "us" });
  expect(view.known.factions.some((f) => f.id === "them")).toBe(true);
});

test("hero with cult sees cult dominion not unrelated distant faction", () => {
  const cultWorld = {
    factions: [
      {
        id: "cult",
        name: "Cult",
        power: 2,
        cohesion: 3,
        dominion: 7,
        homePlaceId: "p",
        behavior: "directed",
        status: "active",
      },
      {
        id: "stranger",
        name: "Stranger",
        power: 1,
        cohesion: 1,
        dominion: 4,
        homePlaceId: "far",
        behavior: "self_absorbed_survivor",
        status: "active",
      },
    ],
    places: [
      { id: "p", name: "Home", scope: "village", parentPlaceId: null },
      { id: "far", name: "Far", scope: "city", parentPlaceId: null },
    ],
    features: [],
    problems: [],
    interests: [],
    courts: [],
    characters: [],
    facts: [],
    events: [],
    heroes: [
      {
        id: "gb1",
        name: "Saint",
        level: 3,
        divinity: "cult",
        cultFactionId: "cult",
        dominion: 5,
        influence: 4,
        actsOnOwn: true,
      },
    ],
  };
  const view = projectUnitView(cultWorld, { type: "hero", id: "gb1" });
  const cult = view.known.factions.find((faction) => faction.id === "cult");
  expect(cult?.dominion).toBe(7);
  expect(view.known.factions.some((faction) => faction.id === "stranger")).toBe(false);
  expect(view.known.heroes).toEqual([
    {
      id: "gb1",
      name: "Saint",
      level: 3,
      divinity: "cult",
      cultFactionId: "cult",
      dominion: 5,
      influence: 4,
    },
  ]);
});

test("local fact at unknown place is absent from the view", () => {
  const isolated = {
    ...world,
    interests: [] as typeof world.interests,
    facts: [
      {
        id: "lf1",
        subject: "place",
        subjectId: "far",
        statement: "A secret only locals know",
        visibility: "local",
        placeId: "far",
      },
    ],
  };
  const view = projectUnitView(isolated, { type: "faction", id: "us" });
  expect(view.known.facts.some((f) => f.id === "lf1")).toBe(false);
});
