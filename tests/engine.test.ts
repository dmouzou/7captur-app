import { describe, expect, it } from "vitest";
import { runEngine, reviewPlan, THRESHOLDS, type EngineInput } from "../functions/src/recommendations/engine";
import type { FxRates } from "../shared/fx";

const today = "2026-10-29"; // window starts 2026-10-02
const day = (i: number) => `2026-10-${String(2 + i).padStart(2, "0")}`;
const biz = { objective: "profitability", currency: "USD" };
const empty = (): EngineInput["records"] => ({ posts: [], promotions: [], leads: [], sales: [], costs: [] });
const post = (id: string, o: object = {}) => ({ id, platform: "instagram" as const, publishedAt: "2026-10-20", reach: 1000, likes: 50, comments: 5, shares: 5, saves: 5, provenance: "manual", ...o });
const promo = (id: string, o: object = {}) => ({ id, platform: "instagram" as const, startDate: "2026-10-21", spend: 100, currency: "USD", objective: "orders" as const, provenance: "manual", ...o });
const lead = (id: string, o: object = {}) => ({ id, date: "2026-10-22", qualified: true, status: "new" as const, provenance: "manual", ...o });
const sale = (id: string, o: object = {}) => ({ id, date: "2026-10-23", amount: 200, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const, provenance: "manual", ...o });
const cost = (id: string, o: object = {}) => ({ id, category: "cogs" as const, kind: "amount" as const, amount: 50, currency: "USD", effectiveDate: "2026-10-05", provenance: "manual", ...o });

/** 20 orders over 20 days, 8 promotions over 8 days. Enough to pass every volume gate. */
function volume(opts: { spendEach?: number; orderAmount?: number; linkedEvery?: number } = {}) {
  const spendEach = opts.spendEach ?? 625;
  const amount = opts.orderAmount ?? 850;
  const every = opts.linkedEvery ?? 1;
  return {
    ...empty(),
    promotions: Array.from({ length: 8 }, (_, i) => promo(`p${i}`, { startDate: day(i), spend: spendEach })),
    sales: Array.from({ length: 20 }, (_, i) => sale(`s${i}`, { date: day(i), amount, ...(i % every === 0 ? { promotionId: `p${i % 8}` } : {}) })),
  };
}
const goldenCosts = (fees = true) => [
  cost("cogs", { category: "cogs", amount: 8100 }),
  ...(fees ? [cost("fees", { category: "fees", amount: 500 })] : []),
  cost("ret", { category: "returns", amount: 300 }),
  cost("disp", { category: "disputes", amount: 100 }),
];
/** Golden fixture: spend 5000, gross 17000, refunds 800, net 16200, returns 300, fees 500, disputes 100. */
function golden(fees = true): EngineInput["records"] {
  const v = volume();
  v.sales[0] = { ...v.sales[0], status: "partially_refunded" as never, refundAmount: 800 } as never;
  return { ...v, costs: goldenCosts(fees) } as never;
}

describe("engine rules-v4: basics", () => {
  it("no data: asks for inputs (measurement, explore)", () => {
    const r = runEngine({ records: empty(), business: biz, today });
    expect(r.category).toBe("measurement");
    expect(r.mode).toBe("explore");
    expect(r.engineVersion).toBe("rules-v4");
  });

  it("ignores records outside the 28-day window", () => {
    const records = { ...empty(), posts: [post("a", { publishedAt: "2026-01-01" })] };
    expect(runEngine({ records, business: biz, today }).category).toBe("measurement");
  });

  it("content_testing: engagement only, never claims sales, ROAS or profit", () => {
    const records = { ...empty(), posts: [post("a", { likes: 200 }), post("b", { likes: 5, comments: 0, shares: 0, saves: 0 })] };
    const r = runEngine({ records, business: { ...biz, objective: "content_testing" }, today });
    expect(r.category).toBe("content");
    expect(JSON.stringify(r)).not.toMatch(/roas|profit(?!ab)/i);
    expect(r.alternatives?.some((a) => /\$200|50%/.test(a.action))).toBe(false);
  });

  it("qualified_enquiries: ranks by cost per qualified enquiry and does not raise budget", () => {
    const records = {
      ...empty(),
      promotions: [promo("p1", { spend: 100 }), promo("p2", { spend: 100 })],
      leads: [lead("l1", { promotionId: "p1" }), lead("l2", { promotionId: "p1" }), lead("l3", { promotionId: "p2" }), lead("l4", { promotionId: "p2", qualified: false })],
    };
    const r = runEngine({ records, business: { ...biz, objective: "qualified_enquiries" }, today });
    expect(r.mode).toBe("improve");
    expect(r.action).toMatch(/Do not raise the budget/);
    expect(r.rationale[0]).toMatch(/50\.00 USD per qualified enquiry/);
    expect(r.decisionBasis?.metric).toBe("Cost per qualified enquiry");
  });

  it("awareness: reach only, no sales or ROAS wording", () => {
    const records = { ...empty(), promotions: [promo("p1", { spend: 100, reach: 10000 })], sales: [sale("s1", { promotionId: "p1" })] };
    const r = runEngine({ records, business: { ...biz, objective: "awareness" }, today });
    expect(r.decisionBasis?.metric).toBe("Cost per 1,000 reached");
    expect(JSON.stringify(r)).not.toMatch(/roas|profit(?!ab)/i);
  });

  it("reduced_waste: cuts the weakest spend when data is sufficient, holds when it is thin", () => {
    const records = {
      ...empty(),
      promotions: Array.from({ length: 8 }, (_, i) => promo(`p${i}`, { startDate: day(i), spend: 100 })),
      // Each promotion needs 10 linked orders before it can be named best or worst.
      sales: [
        ...Array.from({ length: 12 }, (_, i) => sale(`a${i}`, { promotionId: "p0", amount: 50, date: day(i) })),
        ...Array.from({ length: 10 }, (_, i) => sale(`b${i}`, { promotionId: "p1", amount: 10, date: day(i) })),
        ...Array.from({ length: 6 }, (_, i) => sale(`c${i}`, { date: day(14 + i) })),
      ],
    };
    const r = runEngine({ records, business: { ...biz, objective: "reduced_waste" }, today });
    expect(r.action).toMatch(/Pause or cut/);
    const thin = runEngine({ records: { ...records, promotions: records.promotions.slice(0, 2) }, business: { ...biz, objective: "reduced_waste" }, today });
    expect(thin.action).toMatch(/Hold all spend/);
  });
});

describe("engine rules-v4: hard gates constrain the action", () => {
  it("thin data: mode is downgraded and spend is held, even with strong numbers", () => {
    const records = { ...empty(), promotions: [promo("p1", { spend: 100 })], sales: [sale("s1", { amount: 5000, promotionId: "p1" })], costs: [cost("c", { amount: 100 }), cost("f", { category: "fees", amount: 10 })] };
    const r = runEngine({ records, business: biz, today });
    expect(r.mode).toBe("improve");
    expect(r.primary_action?.type).not.toBe("budget_adjustment");
    expect(r.action).toMatch(/Hold spend/);
    expect(r.evidence_quality?.gates?.filter((g) => !g.passed).map((g) => g.key)).toEqual(expect.arrayContaining(["orders", "days", "spend_days"]));
  });

  it("boundary: 19 orders blocks, 20 orders passes the order gate", () => {
    const v = volume();
    const r19 = runEngine({ records: { ...v, sales: v.sales.slice(0, 19), costs: goldenCosts() } as never, business: biz, today });
    expect(r19.evidence_quality?.gates?.find((g) => g.key === "orders")).toMatchObject({ actual: 19, passed: false });
    const r20 = runEngine({ records: { ...v, costs: goldenCosts() } as never, business: biz, today });
    expect(r20.evidence_quality?.gates?.find((g) => g.key === "orders")).toMatchObject({ actual: 20, passed: true });
  });

  it("attribution below 60% never scales or cuts, and asks for links", () => {
    const records = { ...volume({ linkedEvery: 3 }), costs: goldenCosts() } as never;
    const r = runEngine({ records, business: biz, today });
    expect(r.financials!.attributionCoverage!).toBeLessThan(THRESHOLDS.minAttributionCoverage);
    expect(r.action).toMatch(/Hold spend/);
    expect(r.category).toBe("measurement");
  });

  it("no links at all: not measurable yet (never 0.00x), blended return shown, no scaling, cheap tracking steps offered", () => {
    const records = { ...volume({ linkedEvery: 1000 }), costs: goldenCosts() } as never;
    const r = runEngine({ records, business: biz, today });
    const f = r.financials!;
    expect(f.trueRoas).toBeNull();
    expect(f.attributedRoas).toBeNull();
    expect(f.blendedRoas).toBeGreaterThan(3);
    expect(JSON.stringify(r)).not.toMatch(/0\.00x/);
    expect(r.rationale.join(" ")).not.toMatch(/True ROAS is/);
    expect(r.rationale.join(" ")).toMatch(/not measurable yet/);
    expect(r.action).toMatch(/Hold spend/);
    expect(r.what_would_change_the_decision.join(" ")).toMatch(/discount code/);
  });

  it("no links but blended return below break-even: careful reduce, even crediting ads with every order", () => {
    const records = { ...volume({ linkedEvery: 1000, spendEach: 2000 }), costs: goldenCosts() } as never;
    const r = runEngine({ records, business: biz, today });
    expect(r.action).toMatch(/Reduce total ad spend by about 20%/);
    expect(r.action).toMatch(/every order came from ads/);
  });
});

describe("engine rules-v4: True ROAS golden fixture", () => {
  it("matches the spec: kept 15300, True ROAS 3.06, CM 0.5, break-even 2.0, ratio 1.53, scale", () => {
    const r = runEngine({ records: golden(), business: biz, today });
    const f = r.financials!;
    expect(f.adSpend).toBe(5000);
    expect(f.grossSales).toBe(17000);
    expect(f.refunds).toBe(800);
    expect(f.netRevenue).toBe(16200);
    expect(f.returns).toBe(300);
    expect(f.fees).toBe(500);
    expect(f.disputes).toBe(100);
    expect(f.keptAttributedRevenue).toBe(15300);
    expect(f.trueRoas).toBe(3.06);
    expect(f.attributedRoas).toBe(3.24);
    expect(f.contributionMargin).toBe(0.5);
    expect(f.breakEvenRoas).toBe(2);
    expect(f.ratioToBreakEven).toBe(1.53);
    expect(f.contributionAfterMarketing).toBe(2200); // 16200 - 8100 - 900 - 5000
    expect(r.mode).toBe("optimize");
    expect(r.action).toMatch(/Increase spend .* no more than 20%/);
    expect(r.metrics?.some((m) => m.name === "True ROAS")).toBe(true);
  });

  it("fees unknown: no True ROAS claim anywhere, scaling blocked, alternative says why", () => {
    const r = runEngine({ records: golden(false), business: biz, today });
    expect(r.financials!.trueRoas).toBeNull();
    expect(r.financials!.feesVisible).toBe(false);
    expect(r.action).not.toMatch(/Increase/);
    const out = JSON.stringify({ ...r, financials: undefined });
    expect(out).not.toMatch(/True ROAS (is|of|moving|over|falls)/);
    expect(r.metrics?.some((m) => m.name === "True ROAS")).toBe(false);
    expect(r.metrics?.some((m) => m.name === "Attributed ROAS (fees unknown)")).toBe(true);
    expect(r.alternatives?.find((a) => /Increase/.test(a.action))?.why_not_selected).toMatch(/Fees are not visible/);
  });

  it("a connected payment processor makes fees visible", () => {
    const r = runEngine({ records: golden(false), business: biz, today, processorConnected: true });
    expect(r.financials!.feesVisible).toBe(true);
    expect(r.financials!.trueRoas).not.toBeNull();
  });

  it("below break-even: cut, and the alternative reasons use the real ratio", () => {
    const records = { ...volume({ spendEach: 1500 }), costs: goldenCosts() } as never;
    const r = runEngine({ records, business: biz, today });
    expect(r.action).toMatch(/^Reduce spend/);
    expect(r.alternatives?.[0].why_not_selected).toMatch(/\d\.\d\d/);
  });

  it("between break-even and 1.25x: hold", () => {
    // True ROAS ~ 2.3 against break-even 2.0 -> ratio ~1.15
    const records = { ...volume({ spendEach: 1000 }), costs: goldenCosts() } as never;
    const r = runEngine({ records, business: biz, today });
    expect(r.action).toMatch(/^Hold spend/);
  });

  it("orders objective judges attributed ROAS and shows cost per order", () => {
    const r = runEngine({ records: golden(), business: { ...biz, objective: "orders" }, today });
    expect(r.decisionBasis?.metric).toBe("Attributed ROAS (before fees)");
    expect(r.metrics?.some((m) => m.name === "Cost per order")).toBe(true);
  });
});

describe("engine rules-v4: costs", () => {
  it("cost of goods unknown: margin, break-even and contribution stay null, spend is held", () => {
    const records = { ...volume(), costs: [cost("f", { category: "fees", amount: 100 })] } as never;
    const r = runEngine({ records, business: biz, today });
    expect(r.financials!.contributionMargin).toBeNull();
    expect(r.financials!.breakEvenRoas).toBeNull();
    expect(r.financials!.contributionAfterMarketing).toBeNull();
    expect(r.action).toMatch(/Hold spend/);
    expect(r.evidence_quality?.unknownCosts).toContain("cost of goods");
  });

  it("monthly costs are prorated over the days they overlap the window", () => {
    const r = runEngine({ records: { ...volume(), costs: [cost("m", { category: "cogs", amount: 3043.75, frequency: "monthly", effectiveDate: "2026-01-01" })] } as never, business: biz, today });
    expect(r.financials!.cogs).toBe(2800); // 28 / 30.4375 of a month
  });

  it("yearly costs are prorated, and an end date stops them", () => {
    const y = runEngine({ records: { ...volume(), costs: [cost("y", { amount: 36525, frequency: "yearly", effectiveDate: "2026-01-01" })] } as never, business: biz, today });
    expect(y.financials!.cogs).toBe(2800);
    const ended = runEngine({ records: { ...volume(), costs: [cost("y", { amount: 36525, frequency: "yearly", effectiveDate: "2026-01-01", endDate: "2026-10-15" })] } as never, business: biz, today });
    expect(ended.financials!.cogs).toBe(14 * 100); // 10-02..10-15 = 14 days
  });

  it("per-order costs scale with orders, one-off costs count once, legacy costs warn", () => {
    const po = runEngine({ records: { ...volume(), costs: [cost("p", { amount: 5, scope: "per_order", effectiveDate: "2026-01-01" })] } as never, business: biz, today });
    expect(po.financials!.cogs).toBe(100);
    const once = runEngine({ records: { ...volume(), costs: [cost("o", { amount: 700, frequency: "one_off" })] } as never, business: biz, today });
    expect(once.financials!.cogs).toBe(700);
    const legacy = runEngine({ records: { ...volume(), costs: [cost("l", { amount: 700 })] } as never, business: biz, today });
    expect(legacy.evidence.warnings.join()).toMatch(/no frequency/);
  });

  it("a one-off cost dated before the window is not counted", () => {
    const r = runEngine({ records: { ...volume(), costs: [cost("o", { amount: 700, frequency: "one_off", effectiveDate: "2026-09-01" })] } as never, business: biz, today });
    expect(r.financials!.cogs).toBe(0);
    expect(r.financials!.contributionMargin).toBeNull();
  });
});

describe("engine rules-v4: currency", () => {
  const fx: FxRates = { date: "2026-10-28", base: "EUR", source: "ecb", rates: { USD: 1.1, GBP: 0.85 } };
  const records = { ...empty(), promotions: [promo("p1", { currency: "EUR", spend: 100 })], posts: [post("a"), post("b", { likes: 1 })] };

  it("conversion off: other-currency records are left out with a warning", () => {
    const r = runEngine({ records, business: { ...biz, convertCurrencies: false }, today, fx });
    expect(r.evidence.warnings.join()).toMatch(/left out/);
    expect(r.evidence.sampleSize.promotions).toBe(0);
  });

  it("conversion on: converted with the rate and date recorded", () => {
    const r = runEngine({ records, business: { ...biz, objective: "awareness", convertCurrencies: true }, today, fx });
    expect(r.evidence.sampleSize.promotions).toBe(1);
    expect(r.evidence.fx).toMatchObject({ reportingCurrency: "USD", rateDate: "2026-10-28", convertedRecords: 1 });
    expect(r.evidence.warnings.join()).toMatch(/ECB reference rates dated 2026-10-28/);
  });

  it("owner has not chosen yet: nothing is converted silently, the choice is surfaced", () => {
    const r = runEngine({ records, business: { ...biz, objective: "awareness" }, today, fx });
    expect(r.evidence.sampleSize.promotions).toBe(0);
    expect(r.evidence.fx).toBeUndefined();
    expect(r.evidence.currencyMismatch).toMatchObject({ reportingCurrency: "USD", decided: false });
  });

  it("owner chose to keep them out: no prompt", () => {
    const r = runEngine({ records, business: { ...biz, objective: "awareness", convertCurrencies: false }, today, fx });
    expect(r.evidence.currencyMismatch?.decided).toBe(true);
  });

  it("no rate available: left out, never guessed", () => {
    const r = runEngine({ records, business: { ...biz, convertCurrencies: true }, today, fx: { ...fx, rates: {} } });
    expect(r.evidence.sampleSize.promotions).toBe(0);
  });
});

describe("engine rules-v4: review plan and honesty", () => {
  it("review timing depends on how fast orders arrive", () => {
    const fast = reviewPlan("budget", today, 5, []);
    const slow = reviewPlan("budget", today, 0.5, []);
    expect(fast.decision_review_at! < slow.decision_review_at!).toBe(true);
    expect(reviewPlan("cut", today, 5, []).decision_review_at).toBe("2026-11-05");
  });

  it("no hard-coded strawmen in alternatives or what-would-change", () => {
    const r = runEngine({ records: golden(), business: biz, today });
    const text = JSON.stringify([r.alternatives, r.what_would_change_the_decision]);
    expect(text).not.toMatch(/\$200|50%|30%|25%/);
  });

  it("what would change the decision is derived from the data", () => {
    const r = runEngine({ records: golden(), business: biz, today });
    expect(r.what_would_change_the_decision?.join()).toMatch(/2\.00x/);
  });

  it("legacy screenshot provenance reads as manual", () => {
    const records = { ...empty(), posts: [post("a", { provenance: "screenshot_extracted" }), post("b", { provenance: "manual" })] };
    const r = runEngine({ records, business: { ...biz, objective: "content_testing" }, today });
    expect(r.evidence.provenance).toEqual({ manual: 2 });
  });
});

describe("engine rules-v4: loophole regressions (V3 review)", () => {
  const run = (records: unknown, b: Partial<typeof biz> & { convertCurrencies?: boolean } = {}) => runEngine({ records: records as never, business: { ...biz, ...b }, today });
  const costs = goldenCosts();

  it("B: orders linked only to an organic post (no promotion promotes it) are not ad sales", () => {
    const v = volume();
    const r = run({ ...v, costs, sales: v.sales.map((s) => ({ ...s, promotionId: undefined, postId: "organic-1" })) });
    expect(r.financials!.attributedRevenue).toBe(0);
    expect(r.action).not.toMatch(/Increase spend/);
    expect(r.financials!.trueRoas).toBeNull();
  });

  it("C: a link to a promotion that does not exist counts for nothing", () => {
    const v = volume();
    const r = run({ ...v, costs, sales: v.sales.map((s) => ({ ...s, promotionId: "deleted-promo" })) });
    expect(r.financials!.attributedRevenue).toBe(0);
    expect(r.action).not.toMatch(/Increase spend/);
  });

  it("E: one huge linked order cannot carry the attribution gate", () => {
    const v = volume();
    const sales = v.sales.map((s, i) => (i === 0 ? { ...s, amount: 20000, promotionId: "p0" } : { ...s, promotionId: undefined }));
    const r = run({ ...v, costs, sales });
    expect(r.financials!.attributionCoverage!).toBeLessThan(0.1);
    expect(r.action).not.toMatch(/Increase spend/);
  });

  it("I: spend left out because of an unchosen currency blocks scaling", () => {
    const v = golden();
    const r = run({ ...v, promotions: [...v.promotions, promo("usd-less", { startDate: day(3), spend: 4000, currency: "INR" })] } as never);
    expect(r.action).not.toMatch(/Increase spend/);
    expect(r.evidence.currencyMismatch).toMatchObject({ decided: false });
  });

  it("D3: linked orders look below break-even but the blended upper bound is above it: hold, never cut", () => {
    const v = volume({ spendEach: 1000 });
    // 13 of 20 orders linked (61% of revenue). Linked return 0.81x is below break-even 1.10x, blended 1.34x is above it.
    const sales = v.sales.map((s, i) => (i < 13 ? { ...s, amount: 500, promotionId: `p${i % 8}` } : { ...s, amount: 600, promotionId: undefined }));
    const r = run({ ...v, costs: [cost("cogs", { category: "cogs", amount: 1000 })], sales });
    expect(r.financials!.attributionCoverage!).toBeGreaterThanOrEqual(THRESHOLDS.minAttributionCoverage);
    expect(r.action).not.toMatch(/Reduce spend|Pause or cut/);
    expect(r.action).toMatch(/Hold spend/);
  });

  it("A: a confirmed order carrying a refund amount is reduced by the refund", () => {
    const v = volume();
    const plain = run({ ...v, costs });
    const refunded = run({ ...v, costs, sales: v.sales.map((s) => ({ ...s, refundAmount: 100 })) });
    expect(refunded.financials!.netRevenue).toBeCloseTo(plain.financials!.netRevenue - 2000, 1);
  });

  it("L: a refund larger than the order is capped at the order", () => {
    const v = volume();
    const r = run({ ...v, costs, sales: v.sales.map((s) => ({ ...s, refundAmount: 99999 })) });
    expect(r.financials!.netRevenue).toBeGreaterThanOrEqual(0);
  });

  it("H: the same order number from two sources is counted once", () => {
    const v = volume();
    const dup = v.sales.map((s, i) => ({ ...s, orderNumber: `#${1000 + i}`, provenance: "connected" }));
    const both = [...dup, ...dup.map((s) => ({ ...s, id: `${s.id}-csv`, provenance: "imported" }))];
    const once = run({ ...v, costs, sales: dup });
    const twice = run({ ...v, costs, sales: both });
    expect(twice.financials!.netRevenue).toBe(once.financials!.netRevenue);
    expect(twice.evidence.warnings.join(" ")).toMatch(/counted once/);
  });

  it("N: a brand-new promotion with no orders is never named the cut target", () => {
    const v = volume({ spendEach: 2000 });
    const r = run({ ...v, costs, promotions: [...v.promotions, promo("new", { startDate: day(19), spend: 50 })] });
    expect(r.action).not.toMatch(/promotion from 2026-10-21/);
    expect(r.action).not.toMatch(new RegExp(`promotion from ${day(19)}`));
  });

  it("O2: two promotions promoting one post split its orders instead of crediting the later one", () => {
    const base = { ...empty(), promotions: [promo("a", { postId: "x", spend: 100 }), promo("b", { postId: "x", spend: 100 })], sales: Array.from({ length: 20 }, (_, i) => sale(`s${i}`, { postId: "x", amount: 100 })) };
    const r = run({ ...base, costs });
    expect(r.financials!.attributedRevenue).toBe(2000);
  });

  it("J: an awareness goal with no reach recorded asks for reach, never for more spend", () => {
    const v = volume();
    const r = run({ ...v, costs }, { objective: "awareness" });
    expect(r.action).toMatch(/Record reach/);
    expect(r.action).not.toMatch(/Increase|Reduce|Cut|Pause/);
  });

  it("F: a percentage cost only applies to orders inside its dates", () => {
    const v = volume();
    const all = run({ ...v, costs: [cost("f", { category: "fees", kind: "percentage", amount: 10, effectiveDate: "2026-10-02" })] });
    const late = run({ ...v, costs: [cost("f", { category: "fees", kind: "percentage", amount: 10, effectiveDate: day(10) })] });
    expect(late.financials!.fees).toBeLessThan(all.financials!.fees);
  });
});

describe("freshness gate", () => {
  it("warns and blocks scale when a connected source is stale", () => {
    const rec = runEngine({ records: golden(), business: biz, today, processorConnected: true, staleSources: ["shopify"] });
    expect(rec.evidence.warnings.join(" ")).toMatch(/48 hours/);
    expect(rec.action).not.toMatch(/^Increase/);
  });
});

describe("fee coverage and stacked percentage rows", () => {
  const noFees = () => golden(false);
  it("a fee that starts late in the window does not make fees visible", () => {
    const records = { ...noFees(), costs: [...noFees().costs, cost("fee-late", { category: "fees", kind: "percentage", amount: 3, effectiveDate: "2026-10-28" })] };
    const r = runEngine({ records: records as never, business: biz, today });
    expect(r.evidence.warnings.join(" ")).toMatch(/cover only/);
    expect(r.financials?.feesVisible).toBe(false);
  });
  it("a recurring fee from before the window counts as visible", () => {
    const records = { ...noFees(), costs: [...noFees().costs, cost("fee-ok", { category: "fees", kind: "percentage", amount: 3, effectiveDate: "2026-09-01" })] };
    const r = runEngine({ records: records as never, business: biz, today });
    expect(r.financials?.feesVisible).toBe(true);
  });
  it("overlapping percentage rows of one category are flagged", () => {
    const records = { ...noFees(), costs: [...noFees().costs,
      cost("f1", { category: "fees", kind: "percentage", amount: 3, effectiveDate: "2026-09-01" }),
      cost("f2", { category: "fees", kind: "percentage", amount: 2, effectiveDate: "2026-09-15" })] };
    const r = runEngine({ records: records as never, business: biz, today });
    expect(r.evidence.warnings.join(" ")).toMatch(/added together/);
  });
});
