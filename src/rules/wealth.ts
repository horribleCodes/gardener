import { RuleError } from "../domain/types.js";

export function influenceFromWealth(wealth: number, want?: number): { influence: number; wealthUsed: number } {
  if (want != null) {
    const wealthUsed = (want * (want + 1)) / 2;
    if (wealth < wealthUsed) throw new RuleError("INSUFFICIENT_WEALTH", `need ${wealthUsed} wealth for ${want} influence`);
    return { influence: want, wealthUsed };
  }
  let influence = 0;
  let wealthUsed = 0;
  let next = 1;
  while (wealth - wealthUsed >= next) {
    wealthUsed += next;
    influence += 1;
    next += 1;
  }
  return { influence, wealthUsed };
}
