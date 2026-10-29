import config from "./plans.json";

export type PlanId = keyof typeof config.plans;
export const PLAN_IDS = Object.keys(config.plans) as PlanId[];
export const PLAN_CONFIG_VERSION: number = config.version;

export interface PlanDefinition {
  name: string;
  priceMonthly?: number;
  priceMonthlyFrom?: number;
  provisional: boolean;
  spendBandUsd?: { min: number; max: number };
  maxConnections: number;
  maxBusinesses: number;
  recommendations: { weekly: number; monthly: number | null };
  importsPerMonth: number;
  historyDays: number;
}

export const PLANS = config.plans as Record<PlanId, PlanDefinition>;

export function getPlan(id: string): PlanDefinition {
  const plan = (PLANS as Record<string, PlanDefinition>)[id];
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** Pro band for a monthly USD ad spend. Lower bound inclusive, upper exclusive; >= $50k needs Custom. */
export function proPlanForSpend(monthlySpendUsd: number): PlanId | "custom" {
  if (monthlySpendUsd < 15000) return "pro_growth";
  if (monthlySpendUsd < 30000) return "pro_scale";
  if (monthlySpendUsd < 50000) return "pro_pro";
  return "custom";
}
