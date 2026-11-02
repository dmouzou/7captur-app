import { describe, expect, it } from "vitest";
import { runEngine, type EngineInput } from "../functions/src/recommendations/engine";

const today = "2026-10-29";
const biz = { objective: "qualified_enquiries", currency: "USD" };
const empty = (): EngineInput["records"] => ({ posts: [], promotions: [], leads: [], sales: [], costs: [] });
const post = (id: string, o: object = {}) => ({ id, platform: "instagram" as const, publishedAt: "2026-10-20", reach: 1000, likes: 50, comments: 5, shares: 5, saves: 5, provenance: "manual", ...o });
const promo = (id: string, o: object = {}) => ({ id, platform: "instagram" as const, startDate: "2026-10-21", spend: 100, currency: "USD", objective: "qualified_enquiries" as const, provenance: "manual", ...o });
const lead = (id: string, o: object = {}) => ({ id, date: "2026-10-22", qualified: true, status: "new" as const, provenance: "manual", ...o });
const sale = (id: string, o: object = {}) => ({ id, date: "2026-10-23", amount: 200, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const, provenance: "manual", ...o });
const cost = (id: string, o: object = {}) => ({ id, category: "cogs" as const, kind: "amount" as const, amount: 50, currency: "USD", effectiveDate: "2026-10-01", provenance: "manual", ...o });

describe("engine", () => {
  it("no data: asks for inputs (measurement, explore)", () => {
    const r = runEngine({ records: empty(), business: biz, today });
    expect(r.category).toBe("measurement");
    expect(r.mode).toBe("explore");
  });

  it("explore with posts only: content test, never claims sales, ROAS or profit", () => {
    const records = { ...empty(), posts: [post("a", { likes: 200 }), post("b", { likes: 5, comments: 0, shares: 0, saves: 0 })] };
    const r = runEngine({ records, business: biz, today });
    expect(r.mode).toBe("explore");
    expect(r.category).toBe("content");
    expect(JSON.stringify(r)).not.toMatch(/roas|profit(?!ab)/i);
    expect(r.calculation).toBeUndefined();
    expect(r.unknowns.length).toBeGreaterThan(0);
  });

  it("improve: picks lowest cost per enquiry, does not raise budget, flags unknown orders", () => {
    const records = {
      ...empty(),
      promotions: [promo("p1", { spend: 100 }), promo("p2", { spend: 100 })],
      leads: [lead("l1", { promotionId: "p1" }), lead("l2", { promotionId: "p1" }), lead("l3", { promotionId: "p2" })],
    };
    const r = runEngine({ records, business: biz, today });
    expect(r.mode).toBe("improve");
    expect(r.category).toBe("promotion");
    expect(r.action).toMatch(/Do not raise the budget/);
    expect(r.rationale[0]).toMatch(/50\.00 USD per enquiry/);
    expect(r.calculation).toBeUndefined();
  });

  it("improve: enquiries without links ask for source tracking", () => {
    const r = runEngine({ records: { ...empty(), leads: [lead("l1")] }, business: biz, today });
    expect(r.mode).toBe("improve");
    expect(r.category).toBe("measurement");
  });

  it("optimize: reproducible adjusted return, business-level only", () => {
    const records = {
      ...empty(), promotions: [promo("p1", { spend: 100 })], sales: [sale("s1", { amount: 400 })],
      costs: [cost("c1", { amount: 100 }), cost("c2", { kind: "percentage", amount: 10, currency: undefined })],
    };
    const r = runEngine({ records, business: biz, today });
    expect(r.mode).toBe("optimize");
    // revenue 400, costs 100 + 10% of 400 = 140, spend 100 -> (400-140)/100 = 2.6
    expect(r.calculation).toMatchObject({ revenue: 400, costs: 140, spend: 100, adjustedReturn: 2.6, scope: "business_level" });
    expect(r.calculation?.formulaVersion).toBe("adjusted-return-v1");
    expect(r.action).toMatch(/no more than 20%/);
  });

  it("optimize: low return says do not increase spend", () => {
    const records = { ...empty(), promotions: [promo("p1", { spend: 300 })], sales: [sale("s1", { amount: 400 })], costs: [cost("c1", { amount: 150 })] };
    expect(runEngine({ records, business: biz, today }).action).toMatch(/Do not increase promotion spend/);
  });

  it("missing costs are unknown, not zero: no spend decision without costs", () => {
    const records = { ...empty(), promotions: [promo("p1")], sales: [sale("s1")], };
    const r = runEngine({ records, business: biz, today });
    expect(r.mode).toBe("improve");
    expect(r.calculation).toBeUndefined();
    expect(r.evidence.missing.join()).toMatch(/costs/);
  });

  it("refunds reduce revenue", () => {
    const records = { ...empty(), promotions: [promo("p1", { spend: 100 })],
      sales: [sale("s1", { amount: 400, status: "partially_refunded", refundAmount: 100 }), sale("s2", { amount: 999, status: "refunded" })],
      costs: [cost("c1", { amount: 0 })] };
    expect(runEngine({ records, business: biz, today }).calculation?.revenue).toBe(300);
  });

  it("other-currency records are excluded with a warning", () => {
    const records = { ...empty(), promotions: [promo("p1", { currency: "EUR" })], posts: [post("a"), post("b", { likes: 1 })] };
    const r = runEngine({ records, business: biz, today });
    expect(r.evidence.warnings.join()).toMatch(/different currency/);
    expect(r.evidence.sampleSize.promotions).toBe(0);
  });

  it("ignores records outside the 28-day window", () => {
    const records = { ...empty(), posts: [post("a", { publishedAt: "2026-01-01" })] };
    expect(runEngine({ records, business: biz, today }).category).toBe("measurement");
  });

  describe("Decision Engine V3 specifications", () => {
    it("attribution safety gate: holds budget if attribution coverage is below 60%", () => {
      const records = {
        ...empty(),
        promotions: [promo("p1", { spend: 100 })],
        sales: [
          sale("s1", { amount: 200, promotionId: "p1" }), // attributed 200
          sale("s2", { amount: 400 }), // unlinked 400 -> total 600, coverage = 33.3% (< 60%)
        ],
        costs: [cost("c1", { amount: 50 })],
      };
      const r = runEngine({ records, business: { objective: "growth", currency: "USD" }, today });
      expect(r.mode).toBe("optimize");
      expect(r.action).toMatch(/Hold current budget.*attribution coverage/i);
      expect(r.financials?.attributionCoverage).toBeCloseTo(0.333, 2);
      expect(r.evidence_quality?.warnings.some((w) => w.includes("Attribution coverage"))).toBe(true);
    });

    it("component-first financials: computes CM, break-even ROAS, and structured outputs", () => {
      const records = {
        ...empty(),
        promotions: [promo("p1", { spend: 100 })],
        sales: [sale("s1", { amount: 500, promotionId: "p1" })],
        costs: [
          cost("c1", { category: "cogs", amount: 150 }), // COGS = 150
          cost("c2", { category: "shipping", amount: 50 }), // shipping = 50 -> total variable = 200
        ],
      };
      const r = runEngine({ records, business: { objective: "profit", currency: "USD" }, today });
      expect(r.mode).toBe("optimize");
      expect(r.engineVersion).toBe("rules-v3");
      expect(r.financials?.grossSales).toBe(500);
      expect(r.financials?.netRevenue).toBe(500);
      // CM = (500 - 200) / 500 = 0.60 (60%)
      expect(r.financials?.contributionMargin).toBe(0.6);
      // Break-even ROAS = 1 / 0.60 = 1.67
      expect(r.financials?.breakEvenRoas).toBe(1.67);
      expect(r.primary_action).toBeDefined();
      expect(r.guardrails?.duration).toBe("14 days");
      expect(r.alternatives?.length).toBeGreaterThan(0);
      expect(r.review_plan?.safety_check_at).toBeDefined();
    });
  });
});
