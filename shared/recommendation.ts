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
  };
  /** Reproducible calculation, present only when inputs allow it. */
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
  };
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
    returns: number;
    netRevenue: number;
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
});

export const recordActionInput = z.object({
  workspaceId: z.string().min(1).max(128),
  recommendationId: z.string().min(1).max(128),
  action: z.enum(RECOMMENDATION_ACTIONS),
  reason: z.string().trim().max(300).optional(),
  outcomeNote: z.string().trim().max(1000).optional(),
});
