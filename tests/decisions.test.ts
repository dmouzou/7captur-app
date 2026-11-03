import { describe, expect, it } from "vitest";
import { buildDecision, addDays, REVIEW_DAYS } from "../functions/src/decisions/build";
import { runEngine } from "../functions/src/recommendations/engine";
import { respondInput } from "../shared/decision";
import type { Recommendation } from "../shared/recommendation";

const evidence = { asOf: "2026-10-30", windowStart: "2026-10-03", windowEnd: "2026-10-30", sampleSize: { posts: 2, promotions: 1, leads: 3, sales: 2, costs: 1 }, provenance: { manual: 8 }, missing: [] as string[], warnings: [] as string[] };
const base = (o: Partial<Recommendation> = {}): Recommendation => ({
  category: "promotion", mode: "improve", objective: "qualified_enquiries", action: "Run one small repeat.",
  rationale: ["A cost 50.00 USD per enquiry."], unknowns: ["Whether enquiries became orders."], risk: "A repeat may differ.",
  doNotActIf: "Counts were estimated.", nextMeasurement: "Spend, enquiries and orders.", evidence, engineVersion: "rules-v1", ...o,
});
const budget = (adjusted: number | null, o: Partial<Recommendation> = {}): Recommendation => base({
  category: "budget", mode: "optimize",
  calculation: { formulaVersion: "adjusted-return-v1", currency: "USD", revenue: 1000, costs: 300, spend: 400, adjustedReturn: adjusted, scope: "business_level" }, ...o,
});
const today = "2026-10-30";
const day = (i: number) => `2026-10-${String(2 + i).padStart(2, "0")}`;
const golden = () => ({
  posts: [], leads: [],
  promotions: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, platform: "instagram", startDate: day(i), spend: 625, currency: "USD", objective: "orders" })),
  sales: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, date: day(i), amount: 850, currency: "USD", status: "confirmed", attribution: "unknown", promotionId: `p${i % 8}` })),
  costs: [{ id: "c", category: "cogs", kind: "amount", amount: 8100, currency: "USD", effectiveDate: "2026-10-05" }],
} as never);

describe("decision layer", () => {
  it("maps v1 modes to v2 evidence quality", () => {
    expect(buildDecision(budget(2.5), { today }).evidenceQuality).toBe("sufficient");
    expect(buildDecision(base(), { today }).evidenceQuality).toBe("partial");
    expect(buildDecision(base({ mode: "explore", category: "content" }), { today }).evidenceQuality).toBe("insufficient");
  });

  it("insufficient evidence goes to investigate and never claims support", () => {
    const d = buildDecision(base({ mode: "explore", category: "measurement" }), { today });
    expect(d.queueStatus).toBe("investigate");
    expect(d.headline).toMatch(/cannot be ranked responsibly/);
    expect(d.alternatives.find((a) => a.favoured)?.label).toBe("Do what is suggested");
  });

  it("high impact with partial evidence investigates instead of acting on money", () => {
    expect(buildDecision(budget(1.5, { mode: "improve" }), { today }).queueStatus).toBe("investigate");
  });

  it("uses the engine's computed alternatives as the single source, with exactly one favoured option", () => {
    const rec = runEngine({ records: golden(), business: { objective: "profitability", currency: "USD" }, today: "2026-10-29", processorConnected: true });
    const d = buildDecision(rec, { today: "2026-10-29" });
    expect(d.alternatives.filter((a) => a.favoured)).toHaveLength(1);
    expect(d.alternatives.filter((a) => !a.favoured).map((a) => a.whyNot)).toEqual((rec.alternatives ?? []).map((a) => a.why_not_selected));
    for (const a of d.alternatives.filter((x) => !x.favoured)) expect(a.whyNot).toBeTruthy();
    expect(d.queueStatus).toBe("act");
  });

  it("a hold decision is monitored, a data gap is investigated", () => {
    const hold = runEngine({ records: golden(), business: { objective: "profitability", currency: "USD" }, today: "2026-10-29" });
    expect(buildDecision(hold, { today: "2026-10-29" }).queueStatus).toBe("monitor");
    const thin = runEngine({ records: { posts: [], promotions: [], leads: [], costs: [], sales: [{ id: "s", date: "2026-10-20", amount: 10, currency: "USD", status: "confirmed", attribution: "unknown" }] } as never, business: { objective: "profitability", currency: "USD" }, today: "2026-10-29" });
    expect(buildDecision(thin, { today: "2026-10-29" }).queueStatus).toBe("investigate");
  });

  it("stores the dynamic review plan and a snapshot of aggregates only", () => {
    const rec = runEngine({ records: golden(), business: { objective: "profitability", currency: "USD" }, today: "2026-10-29", processorConnected: true });
    const d = buildDecision(rec, { today: "2026-10-29" });
    expect(d.reviewOn).toBe(rec.review_plan!.decision_review_at);
    expect(d.reviewPlan.readinessConditions.length).toBeGreaterThan(0);
    expect(d.snapshot).toHaveProperty("financials");
    expect(JSON.stringify(d.snapshot)).not.toMatch(/orderNumber|"notes"|email/);
  });

  it("keeps assumptions and limitations separate and lists missing data as limitations", () => {
    const d = buildDecision(base({ evidence: { ...evidence, missing: ["costs"], warnings: ["1 record left out."] } }), { today });
    expect(d.assumptions).toEqual(["Whether enquiries became orders."]);
    expect(d.limitations).toEqual(["Missing: costs.", "1 record left out."]);
    expect(d.sensitivity.mostLikelyToChange).toMatch(/costs/);
  });

  it("sets a review date and promises no specific figure", () => {
    const d = buildDecision(budget(2.5), { today });
    expect(d.reviewOn).toBe(addDays(today, REVIEW_DAYS)); // legacy record without a review plan
    expect(d.expectedOutcome.text).toMatch(/No specific figure is promised/);
    expect(JSON.stringify(d)).not.toMatch(/guarantee/i);
  });

  it("ranks a money-losing budget decision above a content test", () => {
    const money = buildDecision(budget(0.5), { today }).priority.score;
    const content = buildDecision(base({ category: "content", mode: "explore" }), { today }).priority.score;
    expect(money).toBeGreaterThan(content);
  });

  it("is deterministic and follows the copy rules (no em dashes, no exclamation marks)", () => {
    const a = buildDecision(budget(0.6), { today });
    expect(a).toEqual(buildDecision(budget(0.6), { today }));
    expect(JSON.stringify(a)).not.toMatch(/\u2014|!/);
  });

  it("validates update inputs and rejects client-supplied causal labels", () => {
    expect(respondInput.safeParse({ type: "response", workspaceId: "w", decisionId: "d", response: "accepted" }).success).toBe(true);
    expect(respondInput.safeParse({ type: "response", workspaceId: "w", decisionId: "d", response: "executed" }).success).toBe(false);
    expect(respondInput.safeParse({ type: "outcome", workspaceId: "w", decisionId: "d", followThrough: "followed_fully", outcome: "better" }).success).toBe(true);
    const parsed = respondInput.parse({ type: "outcome", workspaceId: "w", decisionId: "d", followThrough: "followed_fully", outcome: "better", evidence: "causally_supported" } as never);
    expect(parsed).not.toHaveProperty("evidence");
  });
});
