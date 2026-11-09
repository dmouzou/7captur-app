import type { CostRecord, LeadRecord, PostRecord, PromotionRecord, SaleRecord } from "../../shared/records";
import type { Recommendation } from "../../shared/recommendation";
import { OBJECTIVES } from "../../shared/schemas";
import { type FxRates } from "../../shared/fx";

export const ENGINE_VERSION = "rules-v4";
export const FORMULA_VERSION = "true-roas-v2";
export const WINDOW_DAYS = 28;

/** Versioned thresholds. Change only with an engine version bump. */
/** Low-effort ways to tell which promotion brought an order, cheapest first. */
export const CHEAP_TRACKING = [
  "Add one question at checkout or in chat: \"How did you find us?\" and link the order to the answer.",
  "Give each promotion its own discount code and link orders that use it.",
  "Put a different link (with ?utm_campaign=) on each promotion and note which orders follow.",
  "For today's orders only, link each one to your best guess and mark it as estimated.",
];

export const THRESHOLDS = {
  /** True ROAS must be at least this many times break-even before a small increase is suggested. */
  scaleAtRatio: 1.25,
  /** Below break-even the spend loses money. */
  cutBelowRatio: 1.0,
  maxSuggestedIncrease: 0.2,
  minAttributionCoverage: 0.6,
  minDaysWithRecords: 14,
  minDaysWithSpend: 7,
  minConfirmedOrders: 20,
  /** A promotion needs this many linked orders (or enquiries, when no orders exist) before it can be named a winner or a cut target. */
  minOrdersPerPromotion: 10,
};

export type WithId<T> = T & { id: string; provenance?: string };
export interface EngineInput {
  records: {
    posts: WithId<PostRecord>[];
    promotions: WithId<PromotionRecord>[];
    leads: WithId<LeadRecord>[];
    sales: WithId<SaleRecord>[];
    costs: WithId<CostRecord>[];
  };
  business: { objective: string; currency: string; convertCurrencies?: boolean };
  today: string; // YYYY-MM-DD in workspace timezone
  /** Daily ECB rates. Conversion is used only when business.convertCurrencies is not false. */
  fx?: FxRates | null;
  /** True when Stripe or PayPal is connected, so processor fees are visible. */
  processorConnected?: boolean;
  /** Connected sources whose last successful sync is older than 48 hours (or never). Computed by the caller. */
  staleSources?: string[];
}

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const money = (n: number, c: string) => `${n.toFixed(2)} ${c}`;
export const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export type Gate = NonNullable<NonNullable<Recommendation["evidence_quality"]>["gates"]>[number];
export type Alt = { action: string; why_not_selected: string };
export type Review = NonNullable<Recommendation["review_plan"]>;
export type Obj = (typeof OBJECTIVES)[number];

/** Review timing depends on the kind of decision and on how fast orders arrive. */
export function reviewPlan(
  kind: "budget" | "experiment" | "creative" | "tracking" | "cut",
  today: string,
  ordersPerDay: number,
  conditions: string[],
): Review {
  const ordersNeeded = 10;
  const byOrders = ordersPerDay > 0 ? Math.ceil(ordersNeeded / ordersPerDay) : 14;
  const days =
    kind === "budget" ? Math.min(21, Math.max(7, byOrders))
    : kind === "cut" ? 7
    : kind === "experiment" ? 7
    : kind === "creative" ? 10
    : 14;
  return {
    safety_check_at: addDays(today, Math.min(3, Math.max(1, Math.floor(days / 3)))),
    evidence_check_at: addDays(today, Math.max(2, Math.round(days / 2))),
    decision_review_at: addDays(today, days),
    readiness_conditions: conditions,
  };
}
export const reviewDaysOf = (r: Review, today: string) => daysBetween(today, r.decision_review_at ?? addDays(today, 14));
