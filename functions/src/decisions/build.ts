import type { Recommendation } from "../shared/recommendation";
import type { DecisionAlternative, DecisionContent, EvidenceQuality, QueueStatus } from "../shared/decision";
import { THRESHOLDS } from "../recommendations/engine";

export const LAYER_VERSION = "decision-layer-v1";
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

function queueFor(q: EvidenceQuality, rec: Recommendation): QueueStatus {
  if (q === "insufficient") return "investigate";
  // Low evidence plus high impact means investigate before acting on money.
  if (q === "partial" && rec.category === "budget") return "investigate";
  const adj = rec.calculation?.adjustedReturn;
  if (rec.category === "budget" && adj != null && adj >= THRESHOLDS.holdBelow && adj < THRESHOLDS.maintainBelow) return "monitor";
  return "act";
}

const HEADLINE: Record<EvidenceQuality, (a: string) => string> = {
  sufficient: (a) => `The evidence supports this: ${a}`,
  partial: (a) => `Provisionally, the suggestion is: ${a}`,
  insufficient: () => "The options cannot be ranked responsibly yet, so the next step is to gather the missing evidence.",
};

function budgetAlternatives(rec: Recommendation): DecisionAlternative[] {
  const adj = rec.calculation?.adjustedReturn ?? null;
  const shown = adj == null ? "not available" : adj.toFixed(2);
  const stance = adj == null ? "hold" : adj < THRESHOLDS.holdBelow ? "cut" : adj < THRESHOLDS.maintainBelow ? "hold" : "grow";
  const mk = (id: string, label: string, summary: string, benefit: string, downside: string, reversible: boolean, favouredStance: string, whyNot: string): DecisionAlternative => ({
    id, label, summary, expectedBenefit: benefit, downside, reversible,
    favoured: stance === favouredStance, ...(stance === favouredStance ? {} : { whyNot }),
  });
  return [
    mk("increase", "Increase spend a little", `Raise one promotion by no more than ${THRESHOLDS.maxSuggestedIncrease * 100}%, then wait two weeks.`,
      "More orders if the return holds as spend rises.", "Returns often fall as spend rises, and the extra spend may be lost.", true, "grow",
      `The adjusted return is ${shown}, below the ${THRESHOLDS.maintainBelow.toFixed(2)} level this rule needs before suggesting more spend.`),
    mk("hold", "Hold spend and link orders", "Keep spend as it is for two weeks and link each order to a promotion.",
      "Clearer evidence about which promotion earns the return.", "Slower growth if the promotions are in fact working well.", true, "hold",
      stance === "cut" ? `The adjusted return is ${shown}, below ${THRESHOLDS.holdBelow.toFixed(2)}, so holding is not cautious enough.` : `The adjusted return is ${shown}, which is high enough to justify a small test instead of waiting.`),
    mk("trim", "Trim the weakest promotion", "Reduce or pause one promotion at a time and check that every cost is entered.",
      "Less money spent where the return is weak.", "Pausing too fast can hide a slow-converting promotion.", true, "cut",
      `The adjusted return is ${shown}, which does not call for cutting spend yet.`),
    {
      id: "wait", label: "Do nothing", summary: "Change nothing and review later.",
      expectedBenefit: "No new risk.", downside: "The gaps in the evidence stay open.", reversible: true, favoured: false,
      whyNot: "Waiting does not add evidence by itself. A two week review with linked orders does.",
    },
  ];
}

function generalAlternatives(rec: Recommendation, q: EvidenceQuality): DecisionAlternative[] {
  const act = q !== "insufficient";
  return [
    {
      id: "act", label: "Do what is suggested", summary: rec.action,
      expectedBenefit: "Moves the objective forward using the data already entered.", downside: rec.risk, reversible: true, favoured: act,
      ...(act ? {} : { whyNot: "The data is too thin to rank this above gathering evidence." }),
    },
    {
      id: "test", label: "Run a smaller version", summary: "Try the same step at a small scale for two weeks and record the result.",
      expectedBenefit: "Lower cost of being wrong.", downside: "Slower, and a small sample can mislead.", reversible: true, favoured: false,
      whyNot: act ? "The suggested step is already small and reversible." : "A test needs data to compare against, and that is missing.",
    },
    {
      id: "gather", label: "Gather the missing data first", summary: rec.nextMeasurement,
      expectedBenefit: "Makes the next decision rankable.", downside: "Delays any change.", reversible: true, favoured: !act,
      ...(!act ? {} : { whyNot: "Enough evidence exists to act provisionally." }),
    },
    {
      id: "wait", label: "Do nothing", summary: "Change nothing and review later.",
      expectedBenefit: "No new risk.", downside: "Open questions stay open.", reversible: true, favoured: false,
      whyNot: "Nothing new is learned by waiting alone.",
    },
  ];
}

export function priorityOf(rec: Recommendation, q: EvidenceQuality): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = IMPACT[rec.category];
  reasons.push(`Impact of a ${rec.category.replace(/_/g, " ")} decision: ${IMPACT[rec.category]} points.`);
  score += EVIDENCE_POINTS[q];
  reasons.push(`Evidence quality is ${q}: ${EVIDENCE_POINTS[q]} points.`);
  const adj = rec.calculation?.adjustedReturn;
  if (rec.category === "budget" && adj != null && adj < THRESHOLDS.holdBelow) {
    score += 25;
    reasons.push("Spend is returning less than it costs, so delay is expensive: 25 points.");
  }
  return { score: Math.min(100, score), reasons };
}

/** Pure and deterministic. No model calls, no I/O. */
export function buildDecision(rec: Recommendation, ctx: { today: string; question?: string }): DecisionContent {
  const q = QUALITY[rec.mode];
  const queueStatus = queueFor(q, rec);
  const adj = rec.calculation?.adjustedReturn ?? null;
  const missing = rec.evidence.missing;
  const alternatives = rec.category === "budget" && rec.calculation ? budgetAlternatives(rec) : generalAlternatives(rec, q);
  const favoured = alternatives.find((a) => a.favoured);

  const why = [...rec.rationale];
  if (favoured) why.push(`Chosen over the other options because: ${favoured.expectedBenefit}`);

  const costOfDelay = rec.category === "budget"
    ? (adj != null && adj < THRESHOLDS.holdBelow
      ? "Each week at the current spend adds cost at a return below 1.00."
      : "Waiting two weeks costs little because the suggested step is small and reversible.")
    : "Low. Waiting two weeks delays learning but puts no money at risk.";

  const mostLikely = missing.length > 0
    ? `Entering the missing ${missing[0]}.`
    : adj != null ? `The adjusted return crossing ${THRESHOLDS.holdBelow.toFixed(2)} or ${THRESHOLDS.maintainBelow.toFixed(2)} (currently ${adj.toFixed(2)}).`
      : "New enquiries or orders linked to a post or promotion.";

  const limitations = [...missing.map((m) => `Missing: ${m}.`), ...rec.evidence.warnings];

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
    guardrails: { watch: rec.nextMeasurement, stopIf: rec.doNotActIf },
    nextStep: rec.action,
    costOfDelay,
    sensitivity: { mostLikelyToChange: mostLikely },
    expectedOutcome: {
      metric: rec.calculation ? "adjusted return" : null,
      text: rec.calculation
        ? "Recompute the adjusted return on the same kind of window. A change in direction means the decision should be reassessed. No specific figure is promised."
        : "A clearer comparison once the missing records are entered. No specific result is promised.",
    },
    reviewOn: addDays(ctx.today, REVIEW_DAYS),
    priority: priorityOf(rec, q),
    layerVersion: LAYER_VERSION,
  };
}
