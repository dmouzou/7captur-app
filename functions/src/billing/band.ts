import { proPlanForSpend, type PlanId } from "../shared/plans";

export type BandDecision =
  | { action: "none" }
  | { action: "clear" }
  | { action: "schedule"; to: PlanId }
  | { action: "suggest_custom" };

/**
 * Pro price band logic (spec 3.2). The band never changes silently: a different band is announced,
 * then applied from the next billing date. At $50,000 or more we suggest Custom instead of switching.
 */
export function decideBandChange(currentPlan: string, reportedSpendUsd: number, pendingTo: string | null): BandDecision {
  if (!currentPlan.startsWith("pro_")) return { action: "none" };
  const target = proPlanForSpend(reportedSpendUsd);
  if (target === "custom") return { action: "suggest_custom" };
  if (target === currentPlan) return pendingTo ? { action: "clear" } : { action: "none" };
  if (pendingTo === target) return { action: "none" }; // already scheduled
  return { action: "schedule", to: target };
}
