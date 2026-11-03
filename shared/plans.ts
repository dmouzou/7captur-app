import config from "./plans.json";

export type PlanId = keyof typeof config.plans;
export const PLAN_IDS = Object.keys(config.plans) as PlanId[];
export const PLAN_CONFIG_VERSION: number = config.version;

export interface PlanDefinition {
  name: string;
  priceMonthly?: number;
  priceAnnualMonthly?: number;
  priceAnnual?: number;
  priceMonthlyFrom?: number | null;
  trialDays: number;
  prioritySupport: boolean;
  weeklySummary: boolean;
  strategyCall?: boolean;
  maxConnections: number;
  maxBusinesses: number;
  recommendations: { weekly: number; monthly: number | null };
  importsPerMonth: number;
  /** AI follow-up questions on a saved decision. Separate from recommendation credits. */
  aiFollowUps: { monthly: number; perDecision: number };
  historyDays: number;
}

export const PLANS = config.plans as Record<PlanId, PlanDefinition>;

export function getPlan(id: string): PlanDefinition {
  const plan = (PLANS as Record<string, PlanDefinition>)[id];
  if (!plan) return PLANS.starter;
  return plan;
}
