import type { CostRecord, LeadRecord, PostRecord, PromotionRecord, SaleRecord } from "../shared/records";
import type { Recommendation } from "../shared/recommendation";

export const ENGINE_VERSION = "rules-v1";
export const FORMULA_VERSION = "adjusted-return-v1";
export const WINDOW_DAYS = 28;
/** Versioned thresholds. Change only with a version bump. */
export const THRESHOLDS = { holdBelow: 1, maintainBelow: 2, maxSuggestedIncrease: 0.2 };

type WithId<T> = T & { id: string; provenance?: string };
export interface EngineInput {
  records: {
    posts: WithId<PostRecord>[]; promotions: WithId<PromotionRecord>[]; leads: WithId<LeadRecord>[];
    sales: WithId<SaleRecord>[]; costs: WithId<CostRecord>[];
  };
  business: { objective: string; currency: string };
  today: string; // YYYY-MM-DD in workspace timezone
}

function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (n: number, c: string) => `${n.toFixed(2)} ${c}`;

export function runEngine(input: EngineInput): Recommendation {
  const { business, today } = input;
  const start = addDays(today, -(WINDOW_DAYS - 1));
  const inWin = (d: string) => d >= start && d <= today;
  const cur = business.currency;
  const warnings: string[] = [];
  const missing: string[] = [];

  const posts = input.records.posts.filter((p) => inWin(p.publishedAt));
  const allPromos = input.records.promotions.filter((p) => inWin(p.startDate));
  const allLeads = input.records.leads.filter((l) => inWin(l.date));
  const allSales = input.records.sales.filter((s) => inWin(s.date));
  const allCosts = input.records.costs.filter((c) => c.effectiveDate <= today);

  // Comparable only: same currency as the business. Never convert silently.
  const promos = allPromos.filter((p) => p.currency === cur);
  const sales = allSales.filter((s) => s.currency === cur);
  const costs = allCosts.filter((c) => c.kind === "percentage" || c.currency === cur);
  const excluded = allPromos.length - promos.length + (allSales.length - sales.length) + (allCosts.length - costs.length);
  if (excluded > 0) warnings.push(`${excluded} record(s) in a different currency than ${cur} were left out of calculations.`);
  const leads = allLeads;

  const prov: Record<string, number> = {};
  for (const r of [...posts, ...promos, ...leads, ...sales, ...costs]) {
    const k = r.provenance ?? "unknown";
    prov[k] = (prov[k] ?? 0) + 1;
  }
  const sampleSize = { posts: posts.length, promotions: promos.length, leads: leads.length, sales: sales.length, costs: costs.length };
  const total = Object.values(sampleSize).reduce((a, b) => a + b, 0);
  const evidence = (m: string[] = missing) => ({
    asOf: today, windowStart: start, windowEnd: today, sampleSize, provenance: prov, missing: m, warnings,
  });
  const base = { objective: business.objective, engineVersion: ENGINE_VERSION };

  // 0. Nothing to work with: ask for the most useful input.
  if (total === 0) {
    return {
      ...base, category: "measurement", mode: "explore",
      action: "Record your posts from the last two weeks, plus any enquiries or orders you received.",
      rationale: [`There are no records in the last ${WINDOW_DAYS} days, so there is nothing to compare yet.`],
      unknowns: ["Which content or promotion is working, because no data has been entered."],
      risk: "None. This only asks you to record information.",
      doNotActIf: "You cannot recall figures reasonably well. Estimates are fine if you mark them as estimates.",
      nextMeasurement: "For each post: date, platform, reach and likes. For each enquiry or order: date and where it came from if known.",
      evidence: evidence(["posts", "enquiries", "orders"]),
    };
  }

  const confirmed = sales.filter((s) => s.status === "confirmed" || s.status === "partially_refunded");
  const revenue = sum(confirmed.map((s) => s.amount - (s.status === "partially_refunded" ? s.refundAmount ?? 0 : 0)));
  const spend = sum(promos.map((p) => p.spend));
  const fixedCosts = sum(costs.filter((c) => c.kind === "amount").map((c) => c.amount));
  const pctCosts = sum(costs.filter((c) => c.kind === "percentage").map((c) => (c.amount / 100) * revenue));

  if (spend === 0) missing.push("promotion spend");
  if (confirmed.length === 0) missing.push("confirmed orders");
  if (costs.length === 0) missing.push("costs (cost of goods, fees, shipping)");
  const unlinkedSales = confirmed.filter((s) => !s.postId && !s.promotionId).length;

  // Mode follows evidence, not the plan.
  const canOptimize = spend > 0 && confirmed.length > 0 && costs.length > 0;
  const canImprove = leads.length > 0 || sales.length > 0;
  const mode = canOptimize ? "optimize" : canImprove ? "improve" : "explore";

  if (mode === "optimize") {
    const totalCosts = fixedCosts + pctCosts;
    const adjusted = (revenue - totalCosts) / spend;
    const calculation = {
      formulaVersion: FORMULA_VERSION, currency: cur, revenue, costs: totalCosts, spend,
      adjustedReturn: Number.isFinite(adjusted) ? adjusted : null, scope: "business_level" as const,
    };
    const rationale = [
      `Over the last ${WINDOW_DAYS} days: revenue ${money(revenue, cur)}, declared costs ${money(totalCosts, cur)}, promotion spend ${money(spend, cur)}.`,
      `Adjusted return = (revenue - declared costs) / spend = ${adjusted.toFixed(2)}. This is business-level, not attributed to individual promotions.`,
    ];
    const unknowns = [
      "Revenue is not attributed to specific promotions, so this does not show which promotion earned it.",
      "Only costs you entered are counted. Any cost you have not entered is treated as unknown, not zero.",
    ];
    if (unlinkedSales > 0) unknowns.push(`${unlinkedSales} order(s) are not linked to a post or promotion.`);
    let action: string, risk: string, category: Recommendation["category"] = "budget";
    if (adjusted < THRESHOLDS.holdBelow) {
      action = "Do not increase promotion spend. Review which promotions you can pause or shrink, and check that all costs are entered.";
      risk = "Pausing too quickly can hide a slow-converting promotion. Change one promotion at a time.";
    } else if (adjusted < THRESHOLDS.maintainBelow) {
      action = "Keep promotion spend where it is for two more weeks while you link each order to a promotion.";
      risk = "Holding spend means slower growth if the promotions are in fact working well.";
    } else {
      action = `Consider a small, reversible increase (no more than ${THRESHOLDS.maxSuggestedIncrease * 100}%) on one promotion, then wait two weeks before judging.`;
      risk = "Returns often fall as spend rises. Do this only if you can afford to lose the extra spend.";
    }
    return {
      ...base, category, mode, action, rationale, unknowns, risk,
      doNotActIf: "Your cost entries are incomplete, or the period included an unusual sale or stock problem.",
      nextMeasurement: "Link each order to its promotion for the next two weeks and re-check the adjusted return.",
      evidence: evidence(), calculation,
    };
  }

  if (mode === "improve") {
    const byPromo = promos
      .map((p) => ({ p, n: leads.filter((l) => l.promotionId === p.id).length }))
      .filter((x) => x.n > 0 && x.p.spend > 0)
      .map((x) => ({ ...x, cpe: x.p.spend / x.n }))
      .sort((a, b) => a.cpe - b.cpe);
    if (byPromo.length >= 1) {
      const best = byPromo[0];
      const rationale = [`Promotion on ${best.p.platform} (${best.p.startDate}) cost ${money(best.cpe, cur)} per enquiry (${best.n} enquiries for ${money(best.p.spend, cur)}).`];
      if (byPromo.length > 1) rationale.push(`The next best cost ${money(byPromo[1].cpe, cur)} per enquiry.`);
      return {
        ...base, category: "promotion", mode,
        action: "Run one small, time-limited repeat of the lowest cost-per-enquiry promotion and record which enquiries become confirmed orders. Do not raise the budget yet.",
        rationale,
        unknowns: ["Whether these enquiries became orders, so this cannot show which promotion earns more revenue or profit.", "Small sample sizes can look better or worse than they are."],
        risk: "A repeat may not perform the same way. Keep spend at the original level.",
        doNotActIf: "Enquiry counts for these promotions were estimated rather than counted.",
        nextMeasurement: "Same test window: spend, enquiries, qualified enquiries and confirmed orders.",
        evidence: evidence(),
      };
    }
    const noLinks = leads.every((l) => !l.postId && !l.promotionId) && sales.every((s) => !s.postId && !s.promotionId);
    return {
      ...base, category: noLinks ? "measurement" : "lead_sales_process", mode,
      action: "Link each enquiry and order to the post or promotion that brought it, even if it is your best guess (mark it as estimated).",
      rationale: [`You have ${leads.length} enquiries and ${sales.length} orders in the last ${WINDOW_DAYS} days, but not enough links to a post or promotion to compare them.`],
      unknowns: ["Which content or promotion is bringing enquiries and orders."],
      risk: "None. Guessed links must be labelled as estimates so they are not treated as fact.",
      doNotActIf: "You have no reasonable way to tell where an enquiry came from. Leave it unlinked.",
      nextMeasurement: "For two weeks, record the source of every enquiry and order, and the spend of every promotion.",
      evidence: evidence(),
    };
  }

  // Explore
  const rated = posts
    .filter((p) => (p.reach ?? 0) > 0)
    .map((p) => ({ p, rate: ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / (p.reach as number) }))
    .sort((a, b) => b.rate - a.rate);
  if (rated.length >= 2) {
    const top = rated[0], low = rated[rated.length - 1];
    const what = [top.p.format, top.p.topic].filter(Boolean).join(" / ") || `the ${top.p.platform} post from ${top.p.publishedAt}`;
    return {
      ...base, category: "content", mode,
      action: `Post one or two more in the style of ${what} and record any enquiries they bring.`,
      rationale: [
        `The ${top.p.platform} post from ${top.p.publishedAt} had an engagement rate of ${(top.rate * 100).toFixed(1)}% of reach, versus ${(low.rate * 100).toFixed(1)}% for the lowest post.`,
        "Engagement is an early signal about content, not about sales.",
      ],
      unknowns: ["Whether engagement turns into enquiries or orders. No enquiry or sales data is recorded.", "Reach and engagement may be affected by timing and by whether posts were promoted."],
      risk: "Low. Do not put money behind this on engagement alone.",
      doNotActIf: "The best post was boosted and the others were not. That is not a fair comparison.",
      nextMeasurement: "Record enquiries (date and which post if known) for the next two weeks.",
      evidence: evidence([...missing, "enquiries"]),
    };
  }
  return {
    ...base, category: "measurement", mode,
    action: "Add reach and likes for at least two recent posts, and log any enquiries you received.",
    rationale: [`There are ${posts.length} post(s) with usable reach in the last ${WINDOW_DAYS} days. Two are needed to compare.`],
    unknowns: ["Which content performs better."],
    risk: "None. This only asks you to record information.",
    doNotActIf: "Metrics are not available for these posts. Record what you can see.",
    nextMeasurement: "Reach, likes, comments, shares and saves per post, and enquiries per week.",
    evidence: evidence([...missing, "enquiries"]),
  };
}
