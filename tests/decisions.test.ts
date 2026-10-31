import { describe, expect, it } from "vitest";
import { buildDecision, addDays, REVIEW_DAYS } from "../functions/src/decisions/build";
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
    expect(d.alternatives.find((a) => a.favoured)?.id).toBe("gather");
  });

  it("high impact with partial evidence investigates instead of acting on money", () => {
    expect(buildDecision(budget(1.5, { mode: "improve" }), { today }).queueStatus).toBe("investigate");
  });

  it("budget stance follows the same thresholds as the v1 engine", () => {
    const fav = (n: number) => buildDecision(budget(n), { today }).alternatives.find((a) => a.favoured)?.id;
    expect(fav(0.6)).toBe("trim");
    expect(fav(1.5)).toBe("hold");
    expect(fav(2.4)).toBe("increase");
    expect(buildDecision(budget(1.5), { today }).queueStatus).toBe("monitor");
  });

  it("exactly one option is favoured and every other option explains why not", () => {
    for (const rec of [budget(0.6), budget(1.5), budget(3), base(), base({ mode: "explore", category: "content" })]) {
      const alts = buildDecision(rec, { today }).alternatives;
      expect(alts.filter((a) => a.favoured)).toHaveLength(1);
      for (const a of alts.filter((x) => !x.favoured)) expect(a.whyNot).toBeTruthy();
      expect(alts.some((a) => a.id === "wait")).toBe(true);
    }
  });

  it("keeps assumptions and limitations separate and lists missing data as limitations", () => {
    const d = buildDecision(base({ evidence: { ...evidence, missing: ["costs"], warnings: ["1 record left out."] } }), { today });
    expect(d.assumptions).toEqual(["Whether enquiries became orders."]);
    expect(d.limitations).toEqual(["Missing: costs.", "1 record left out."]);
    expect(d.sensitivity.mostLikelyToChange).toMatch(/costs/);
  });

  it("sets a review date and promises no specific figure", () => {
    const d = buildDecision(budget(2.5), { today });
    expect(d.reviewOn).toBe(addDays(today, REVIEW_DAYS));
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
