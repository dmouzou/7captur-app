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
