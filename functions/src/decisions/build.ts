import type { Recommendation } from "../shared/recommendation";
import type { DecisionAlternative, DecisionContent, EvidenceQuality, QueueStatus } from "../shared/decision";
import { THRESHOLDS } from "../recommendations/engine";

export const LAYER_VERSION = "decision-layer-v2";
/** Used only when an older recommendation has no review plan. */
export const REVIEW_DAYS = 14;

const QUALITY: Record<Recommendation["mode"], EvidenceQuality> = { optimize: "sufficient", improve: "partial", explore: "insufficient" };
const IMPACT: Record<Recommendation["category"], number> = {
  budget: 40, promotion: 30, audience_offer: 25, lead_sales_process: 20, content: 15, measurement: 10, general: 10,
};
const EVIDENCE_POINTS: Record<EvidenceQuality, number> = { sufficient: 20, partial: 10, insufficient: 0 };

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The engine's own evidence status wins when present (rules-v4); older records fall back to the mode. */
function qualityOf(rec: Recommendation): EvidenceQuality {
  return rec.evidence_quality?.status ?? QUALITY[rec.mode];
}

const isHold = (rec: Recommendation) => rec.primary_action?.type === "hold";
const isCut = (rec: Recommendation) => rec.category === "budget" && rec.primary_action?.type === "budget_adjustment" && /^Reduce spend|^Pause or cut/.test(rec.action);
const ratioOf = (rec: Recommendation) => rec.financials?.ratioToBreakEven ?? null;

function queueFor(q: EvidenceQuality, rec: Recommendation): QueueStatus {
  if (q === "insufficient") return "investigate";
  if (rec.category === "measurement") return "investigate";
  if (q === "partial" && rec.category === "budget" && !isCut(rec) && !isHold(rec)) return "investigate";
  if (isHold(rec)) return "monitor";
  // Legacy rules-v3 records
  const adj = rec.calculation?.adjustedReturn;
  if (!rec.primary_action && rec.category === "budget" && adj != null && adj >= 1 && adj < 2) return "monitor";
  return "act";
}

const HEADLINE: Record<EvidenceQuality, (a: string) => string> = {
  sufficient: (a) => `The evidence supports this: ${a}`,
  partial: (a) => `Provisionally, the suggestion is: ${a}`,
  insufficient: () => "The options cannot be ranked responsibly yet, so the next step is to gather the missing evidence.",
};

const kindLabel = (rec: Recommendation) =>
  isCut(rec) ? "Cut spend" : isHold(rec) ? "Hold spend" : rec.primary_action?.type === "data_collection" || rec.primary_action?.type === "tracking_improvement" ? "Gather the missing data"
  : rec.primary_action?.type === "creative_test" ? "Run the content test" : rec.primary_action?.type === "bounded_experiment" ? "Run a small repeat" : "Do what is suggested";

/** One source of truth: the chosen action plus the engine's computed alternatives. No text is invented here. */
function alternativesOf(rec: Recommendation): DecisionAlternative[] {
  const chosen: DecisionAlternative = {
    id: "chosen", label: kindLabel(rec), summary: rec.action,
    expectedBenefit: rec.rationale[0], downside: rec.risk, reversible: true, favoured: true,
  };
  const others = (rec.alternatives ?? []).map((a, i): DecisionAlternative => ({
    id: `alt_${i + 1}`, label: a.action, summary: a.action, reversible: true, favoured: false, whyNot: a.why_not_selected,
  }));
  return [chosen, ...others];
}

export function priorityOf(rec: Recommendation, q: EvidenceQuality): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = IMPACT[rec.category];
  reasons.push(`Impact of a ${rec.category.replace(/_/g, " ")} decision: ${IMPACT[rec.category]} points.`);
  score += EVIDENCE_POINTS[q];
  reasons.push(`Evidence quality is ${q}: ${EVIDENCE_POINTS[q]} points.`);
  const ratio = ratioOf(rec);
  const adj = rec.calculation?.adjustedReturn;
  if ((ratio != null && ratio < THRESHOLDS.cutBelowRatio) || (ratio == null && adj != null && adj < 1)) {
    score += 25;
    reasons.push("Spend is returning less than it costs, so delay is expensive: 25 points.");
  }
  return { score: Math.min(100, score), reasons };
}

/** Pure and deterministic. No model calls, no I/O. */
export function buildDecision(rec: Recommendation, ctx: { today: string; question?: string }): DecisionContent {
  const q = qualityOf(rec);
  const queueStatus = queueFor(q, rec);
  const alternatives = alternativesOf(rec);
  const missing = rec.evidence.missing;
  const ratio = ratioOf(rec);

  const why = [...rec.rationale];
  if (rec.decisionBasis) why.push(`Judged on: ${rec.decisionBasis.metric}. ${rec.decisionBasis.rule}`);

  const costOfDelay = isCut(rec) && ratio != null
    ? `Each week at the current spend adds cost at a return of ${ratio.toFixed(2)} times break-even.`
    : rec.category === "budget"
      ? "Waiting costs little because the suggested step is small and reversible."
      : "Low. Waiting delays learning but puts no money at risk.";

  const mostLikely = rec.what_would_change_the_decision?.[0]
    ?? (missing.length > 0 ? `Entering the missing ${missing[0]}.` : "New enquiries or orders linked to a post or promotion.");

  const limitations = [...missing.map((m) => `Missing: ${m}.`), ...rec.evidence.warnings];
  const rp = rec.review_plan;
  const reviewOn = rp?.decision_review_at ?? addDays(ctx.today, REVIEW_DAYS);
  const metric = rec.decisionBasis?.metric ?? (rec.calculation ? "adjusted return" : null);

  return {
    objective: rec.objective,
    question: ctx.question ?? "What should I do next with my marketing?",
    evidenceQuality: q,
    queueStatus,
    headline: HEADLINE[q](rec.action),
    decision: rec.action,
    whyThisOption: why,
    alternatives,
    evidenceUsed: {
      asOf: rec.evidence.asOf, windowStart: rec.evidence.windowStart, windowEnd: rec.evidence.windowEnd,
      provenance: rec.evidence.provenance, sampleSize: rec.evidence.sampleSize,
    },
    assumptions: rec.unknowns,
    limitations,
    guardrails: {
      watch: rec.nextMeasurement,
      stopIf: rec.guardrails?.stop_conditions?.length ? rec.guardrails.stop_conditions.join(" ") : rec.doNotActIf,
    },
    nextStep: rec.action,
    costOfDelay,
    sensitivity: { mostLikelyToChange: mostLikely },
    expectedOutcome: {
      metric,
      text: metric
        ? `Recompute ${metric} on the same kind of window at the review date. A change in direction means the decision should be reassessed. No specific figure is promised.`
        : "A clearer comparison once the missing records are entered. No specific result is promised.",
    },
    reviewOn,
    reviewPlan: {
      safetyCheckOn: rp?.safety_check_at ?? null, evidenceCheckOn: rp?.evidence_check_at ?? null,
      decisionReviewOn: reviewOn, readinessConditions: rp?.readiness_conditions ?? [],
    },
    // Aggregates only. Raw records are never copied here, and never sent to an AI model.
    snapshot: {
      engineVersion: rec.engineVersion,
      objective: rec.objective,
      action: rec.action,
      rationale: rec.rationale,
      unknowns: rec.unknowns,
      decisionBasis: rec.decisionBasis ?? null,
      financials: rec.financials ?? null,
      metrics: rec.metrics ?? [],
      gates: rec.evidence_quality?.gates ?? [],
      unknownCosts: rec.evidence_quality?.unknownCosts ?? [],
      confidence: rec.evidence_quality?.confidence ?? null,
      alternatives: rec.alternatives ?? [],
      whatWouldChange: rec.what_would_change_the_decision ?? [],
      guardrails: rec.guardrails ?? null,
      evidence: rec.evidence,
    },
    priority: priorityOf(rec, q),
    layerVersion: LAYER_VERSION,
  };
}
