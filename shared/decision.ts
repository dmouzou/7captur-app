import { z } from "zod";

/**
 * v2 decision layer. Additive: it wraps a v1 recommendation and never changes it.
 * Evidence quality is the v2 wording for the v1 evidence modes
 * (optimize = sufficient, improve = partial, explore = insufficient).
 */
export const EVIDENCE_QUALITY = ["sufficient", "partial", "insufficient"] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITY)[number];

/** Decision Center queue states. */
export const QUEUE_STATUS = ["act", "investigate", "monitor"] as const;
export type QueueStatus = (typeof QUEUE_STATUS)[number];

/** What the customer decided. Separate from execution. */
export const CUSTOMER_RESPONSES = ["accepted", "modified", "rejected", "deferred", "not_acted"] as const;
export type CustomerResponse = (typeof CUSTOMER_RESPONSES)[number];

/** Customer-reported progress. 7Captur never executes anything. */
export const EXECUTION_STATES = ["not_started", "in_progress", "done", "abandoned"] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const FOLLOW_THROUGH = ["followed_fully", "followed_partly", "chose_other", "did_not_act"] as const;
export const OUTCOME_LABELS = ["better", "as_expected", "worse", "too_early", "insufficient_info"] as const;

export interface DecisionAlternative {
  id: string;
  label: string;
  summary: string;
  /** Present for the chosen option only. Other options carry whyNot, computed from the same numbers. */
  expectedBenefit?: string;
  downside?: string;
  reversible: boolean;
  favoured: boolean;
  /** Why this option is not the recommended one. Present only when not favoured. */
  whyNot?: string;
}

export interface DecisionContent {
  objective: string;
  question: string;
  evidenceQuality: EvidenceQuality;
  queueStatus: QueueStatus;
  /** One sentence in the wording the evidence allows. */
  headline: string;
  decision: string;
  whyThisOption: string[];
  alternatives: DecisionAlternative[];
  evidenceUsed: { asOf: string; windowStart: string; windowEnd: string; provenance: Record<string, number>; sampleSize: Record<string, number> };
  /** Things taken as true without proof. Never mixed with observed facts. */
  assumptions: string[];
  /** Known gaps and data warnings. */
  limitations: string[];
  guardrails: { watch: string; stopIf: string };
  nextStep: string;
  costOfDelay: string;
  sensitivity: { mostLikelyToChange: string };
  expectedOutcome: { metric: string | null; text: string };
  reviewOn: string;
  /** Dynamic review timing from the engine, by decision type and order rate. */
  reviewPlan: { safetyCheckOn: string | null; evidenceCheckOn: string | null; decisionReviewOn: string | null; readinessConditions: string[] };
  /** Frozen aggregate evidence. The only thing AI follow-up questions may see. Never raw rows. */
  snapshot: Record<string, unknown>;
  priority: { score: number; reasons: string[] };
  layerVersion: string;
}

export type SuggestedOutcome = "better" | "as_expected" | "worse";

export type SufficiencyStatus = "ready" | "too_early" | "not_enough_data";

export type SufficiencyResult =
  | { status: "ready"; suggestedOutcome: SuggestedOutcome; prompt: string }
  | { status: "too_early"; readyOn: string; reason: string }
  | { status: "not_enough_data"; whatToAdd: string };

export const respondInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("response"),
    workspaceId: z.string().min(1).max(128),
    decisionId: z.string().min(1).max(160),
    response: z.enum(CUSTOMER_RESPONSES),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    type: z.literal("execution"),
    workspaceId: z.string().min(1).max(128),
    decisionId: z.string().min(1).max(160),
    executionState: z.enum(EXECUTION_STATES),
  }),
  z.object({
    type: z.literal("outcome"),
    workspaceId: z.string().min(1).max(128),
    decisionId: z.string().min(1).max(160),
    followThrough: z.enum(FOLLOW_THROUGH),
    outcome: z.enum(OUTCOME_LABELS),
    suggestedOutcome: z.enum(["better", "as_expected", "worse"]).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
]);
export type RespondInput = z.infer<typeof respondInput>;

export const createDecisionInput = z.object({
  workspaceId: z.string().min(1).max(128),
  recommendationId: z.string().min(1).max(128),
});
