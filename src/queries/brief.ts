export type CourtActorInput = {
  id: string;
  rank: "major" | "minor";
  isLeader: boolean;
  isHiddenController: boolean;
  sharesAuthority: boolean;
};

export type PowerStructure =
  | "autocratic"
  | "figurehead"
  | "shared"
  | "consensus"
  | "democratic"
  | "anarchic";

export function decisionMakers(input: {
  powerStructure: PowerStructure;
  actors: CourtActorInput[];
}): { binds: boolean; approaches: string[]; insufficient?: string[] } {
  const majors = input.actors.filter((a) => a.rank === "major");
  const leaders = input.actors.filter((a) => a.isLeader);
  const hidden = input.actors.filter((a) => a.isHiddenController);
  const shared = input.actors.filter((a) => a.sharesAuthority);

  switch (input.powerStructure) {
    case "autocratic":
      return {
        binds: leaders.length > 0,
        approaches: leaders.map((a) => a.id),
      };
    case "figurehead": {
      const insufficient = leaders.map((a) => a.id);
      return {
        binds: hidden.length > 0,
        approaches: hidden.map((a) => a.id),
        insufficient: insufficient.length ? insufficient : undefined,
      };
    }
    case "shared":
      return {
        binds: shared.length > 0,
        approaches: shared.map((a) => a.id),
      };
    case "consensus":
      return {
        binds: majors.length > 0,
        approaches: majors.map((a) => a.id),
      };
    case "democratic": {
      const count = Math.floor(majors.length / 2) + 1;
      return {
        binds: majors.length > 0,
        approaches: majors.slice(0, count).map((a) => a.id),
      };
    }
    case "anarchic":
      return {
        binds: false,
        approaches: majors.map((a) => a.id),
      };
    default:
      return { binds: false, approaches: [] };
  }
}
