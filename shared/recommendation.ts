import { z } from "zod";
import { EVIDENCE_MODES } from "./schemas";

export const CATEGORIES = [
  "content", "promotion", "audience_offer", "budget", "lead_sales_process", "measurement", "general",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export interface Recommendation {
  category: Category;
  mode: EvidenceMode;
  objective: string;
  /** One concrete action. */
  action: string;
  rationale: string[];
  unknowns: string[];
  risk: string;
  /** When not to act. */
  doNotActIf: string;
  nextMeasurement: string;
  evidence: {
    asOf: string;
    windowStart: string;
    windowEnd: string;
    sampleSize: { posts: number; promotions: number; leads: number; sales: number; costs: number };
    provenance: Record<string, number>;
    missing: string[];
    warnings: string[];
    /** Present only when records in other currencies were converted. */
    fx?: { reportingCurrency: string; rateDate: string; source: "ecb"; rates: Record<string, number>; convertedRecords: number };
  };
  /** Legacy (rules-v3 and earlier). Not written by rules-v4. */
  calculation?: {
    formulaVersion: string;
    currency: string;
    revenue: number;
    costs: number;
    spend: number;
    adjustedReturn: number | null;
    scope: "business_level";
  };
  engineVersion: string;

  /* Decision Engine V3 Additions (Master Guide V2 / Companion V3) */
  primary_action?: { type: string; description: string };
  evidence_quality?: {
    mode: EvidenceMode;
    status: "sufficient" | "partial" | "insufficient";
    warnings: string[];
    attributionCoverage?: number | null;
    sampleDays?: number;
    confirmedOrders?: number;
    spendDays?: number;
    /** rules-v4: hard gates with the actual and required values. A failed gate constrains the action. */
    gates?: { key: "orders" | "days" | "spend_days" | "attribution"; label: string; actual: number; required: number; passed: boolean }[];
    /** Costs that are not entered. They lower confidence, they are never treated as zero. */
    unknownCosts?: string[];
    confidence?: "high" | "medium" | "low";
  };
  /** rules-v4: which metric the decision was judged on, and what the objective table says. */
  decisionBasis?: { objective: string; metric: string; rule: string };
  metrics?: { name: string; value: string; definition_version: string }[];
  alternatives?: { action: string; why_not_selected: string }[];
  guardrails?: { budget_cap: number | null; duration: string | null; stop_conditions: string[] };
  what_would_change_the_decision?: string[];
  review_plan?: {
    safety_check_at: string | null;
    evidence_check_at: string | null;
    decision_review_at: string | null;
    readiness_conditions: string[];
  };
  financials?: {
    grossSales: number;
    discounts: number;
    refunds: number;
    /** Cost of returned goods and handling (cost entries), deducted in True ROAS, not in contribution margin. */
    returns: number;
    fees?: number;
    disputes?: number;
    netRevenue: number;
    attributedRevenue?: number;
    /** Attributed net revenue minus fees, returns and disputes (allocated by attributed share). */
    keptAttributedRevenue?: number | null;
    /** True ROAS. Null unless fees are visible. Never shown as True ROAS when null. */
    trueRoas?: number | null;
    feesVisible?: boolean;
    ratioToBreakEven?: number | null;
    costPerOrder?: number | null;
    adSpend: number;
    cogs: number;
    shipping: number;
    otherVariableCosts: number;
    contributionMargin: number | null;
    breakEvenRoas: number | null;
    attributedRoas: number | null;
    attributionCoverage: number | null;
    contributionAfterMarketing: number | null;
    operatingResult: number | null;
    runRate30d: number | null;
    currency: string;
  };
}

export const RECOMMENDATION_ACTIONS = ["viewed", "marked_to_try", "dismissed", "deferred", "completed", "outcome_recorded"] as const;

export const generateRecommendationInput = z.object({
  workspaceId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128),
  requestId: z.string().min(8).max(64),
  overrideSafetyNet: z.boolean().optional(),
});

export const recordActionInput = z.object({
  workspaceId: z.string().min(1).max(128),
  recommendationId: z.string().min(1).max(128),
  action: z.enum(RECOMMENDATION_ACTIONS),
  reason: z.union([z.string().trim().max(300), z.literal(""), z.null(), z.undefined()]).optional(),
  outcomeNote: z.union([z.string().trim().max(1000), z.literal(""), z.null(), z.undefined()]).optional(),
});
