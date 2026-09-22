import type { RollRecord } from "../domain/types.js";

export interface Rng { next(): number }

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function sequenceRng(values: number[]): Rng {
  let i = 0;
  return {
    next() {
      const face = values[i++] ?? 1;
      return (face - 1) / 6;
    },
  };
}

export function rollDie(rng: Rng, faces: number, forced?: number): RollRecord {
  const natural = forced ?? 1 + Math.floor(rng.next() * faces);
  if (natural < 1 || natural > faces) {
    throw new Error(`die face ${natural} outside 1..${faces}`);
  }
  return { faces, natural, kept: natural, bonus: 0, total: natural, forced: forced != null };
}
