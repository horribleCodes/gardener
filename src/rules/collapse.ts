import { DIE_BY_POWER, type Power } from "../domain/types.js";

export function collapseState(input: { power: Power; trouble: number; cohesion: number }): {
  collapsed: boolean;
  dieMax: number;
  margin: number;
} {
  const dieMax = DIE_BY_POWER[input.power];
  const collapsed = input.cohesion <= 0 || input.trouble >= dieMax;
  return { collapsed, dieMax, margin: dieMax - input.trouble };
}
