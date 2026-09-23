import { z } from "zod";
import { RuleError } from "../domain/types.js";
import type { FactionAction } from "./turn.js";

const standingOrderSchema = z.object({
  targetFactionId: z.string(),
  side: z.enum(["help", "harm"]),
  maxSpend: z.number().int().positive(),
});

const unitPlanBase = z.object({
  standingOrders: z.array(standingOrderSchema).optional(),
});

const unitPlanSchema = z.discriminatedUnion("type", [
  unitPlanBase.extend({ type: z.literal("idle") }),
  unitPlanBase.extend({ type: z.literal("build_strength") }),
  unitPlanBase.extend({
    type: z.literal("enact_change"),
    magnitude: z.enum(["plausible", "improbable"]).optional(),
    improbable: z.boolean().optional(),
    featureText: z.string().optional(),
    solveProblemId: z.string().optional(),
    meansFeatureId: z.string().optional(),
    domain: z.string().optional(),
    covert: z.number().optional(),
    aimedAtFactionId: z.string().optional(),
    addPartToFeatureId: z.string().optional(),
  }),
  unitPlanBase.extend({
    type: z.literal("attack"),
    targetFactionId: z.string(),
    attackerFeatureId: z.string(),
    defenderFeatureId: z.string().optional(),
    problemId: z.string().optional(),
    marginal: z.boolean().optional(),
  }),
  unitPlanBase.extend({
    type: z.literal("extend_interest"),
    targetFactionId: z.string(),
    attackerFeatureId: z.string(),
    defenderFeatureId: z.string().optional(),
    marginal: z.boolean().optional(),
  }),
  unitPlanBase.extend({
    type: z.literal("aid"),
    targetFactionId: z.string(),
    amount: z.number().int().positive().optional(),
  }),
  unitPlanBase.extend({
    type: z.literal("restore_cohesion"),
  }),
  unitPlanBase.extend({
    type: z.literal("remove_interest"),
    targetFactionId: z.string(),
    willing: z.boolean().optional(),
  }),
]);

export type UnitPlan = z.infer<typeof unitPlanSchema>;
export type StandingOrder = z.infer<typeof standingOrderSchema>;

export function parseUnitPlan(raw: Record<string, unknown>): UnitPlan {
  const forbidden = [
    "factionId",
    "forcedRoll",
    "forcedAttackerRoll",
    "forcedDefenderRoll",
    "defenderChoice",
  ];
  if (raw.type !== "remove_interest") forbidden.push("willing");
  for (const key of forbidden) {
    if (key in raw && raw[key] !== undefined) {
      throw new RuleError("FILL_INCOMPLETE", `forbidden plan field: ${key}`);
    }
  }
  return unitPlanSchema.parse(raw);
}

export function factionActionFromUnitPlan(plan: UnitPlan): FactionAction {
  const { standingOrders: _so, ...rest } = plan;
  return rest as FactionAction;
}

export function standingOrdersFromPlan(plan: UnitPlan): StandingOrder[] {
  return plan.standingOrders ?? [];
}
