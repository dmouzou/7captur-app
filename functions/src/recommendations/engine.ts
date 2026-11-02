import type { CostRecord, LeadRecord, PostRecord, PromotionRecord, SaleRecord } from "../shared/records";
import type { Recommendation } from "../shared/recommendation";

export const ENGINE_VERSION = "rules-v3";
export const FORMULA_VERSION = "adjusted-return-v1";
export const WINDOW_DAYS = 28;

/** Versioned thresholds per Master Specification V3. Change only with a version bump. */
export const THRESHOLDS = {
  holdBelow: 1.0,
  maintainBelow: 2.0,
  maxSuggestedIncrease: 0.20,
  attributionSafetyGate: 0.60,
  minSampleDays: 14,
  minSpendDays: 7,
  minConfirmedOrdersForScaling: 20,
};

type WithId<T> = T & { id: string; provenance?: string };
export interface EngineInput {
  records: {
    posts: WithId<PostRecord>[];
    promotions: WithId<PromotionRecord>[];
    leads: WithId<LeadRecord>[];
    sales: WithId<SaleRecord>[];
    costs: WithId<CostRecord>[];
  };
  business: { objective: string; currency: string };
  today: string; // YYYY-MM-DD in workspace timezone
}

function addDays(d: string, n: number): string {
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
  const excluded =
    allPromos.length - promos.length + (allSales.length - sales.length) + (allCosts.length - costs.length);
  if (excluded > 0) {
    warnings.push(`${excluded} record(s) in a different currency than ${cur} were left out of calculations.`);
  }
  const leads = allLeads;

  const prov: Record<string, number> = {};
  for (const r of [...posts, ...promos, ...leads, ...sales, ...costs]) {
    const k = r.provenance ?? "unknown";
    prov[k] = (prov[k] ?? 0) + 1;
  }
  const sampleSize = {
    posts: posts.length,
    promotions: promos.length,
    leads: leads.length,
    sales: sales.length,
    costs: costs.length,
  };
  const totalRecords = Object.values(sampleSize).reduce((a, b) => a + b, 0);

  // Distinct day tracking for evidence gates
  const distinctDays = new Set([
    ...posts.map((p) => p.publishedAt),
    ...promos.map((p) => p.startDate),
    ...leads.map((l) => l.date),
    ...sales.map((s) => s.date),
  ]);
  const spendDays = new Set(promos.filter((p) => p.spend > 0).map((p) => p.startDate)).size;

  const evidence = (m: string[] = missing) => ({
    asOf: today,
    windowStart: start,
    windowEnd: today,
    sampleSize,
    provenance: prov,
    missing: m,
    warnings,
  });

  const base = {
    objective: business.objective,
    engineVersion: ENGINE_VERSION,
  };

  // 0. Cold start: Nothing to work with
  if (totalRecords === 0) {
    const action = "Record your posts from the last two weeks, plus any enquiries or orders you received.";
    return {
      ...base,
      category: "measurement",
      mode: "explore",
      action,
      primary_action: { type: "data_collection", description: action },
      rationale: [`There are no records in the last ${WINDOW_DAYS} days, so there is nothing to compare yet.`],
      unknowns: ["Which content or promotion is working, because no data has been entered."],
      risk: "None. This only asks you to record information.",
      doNotActIf: "You cannot recall figures reasonably well. Estimates are fine if you mark them as estimates.",
      nextMeasurement:
        "For each post: date, platform, reach and likes. For each enquiry or order: date and where it came from if known.",
      evidence: evidence(["posts", "enquiries", "orders"]),
      evidence_quality: {
        mode: "explore",
        status: "insufficient",
        warnings: ["Zero records found in 28-day window."],
        sampleDays: 0,
        confirmedOrders: 0,
        spendDays: 0,
      },
      alternatives: [
        { action: "Wait without recording", why_not_selected: "Without records, the engine cannot generate insights or track performance." },
      ],
      guardrails: { budget_cap: 0, duration: "14 days", stop_conditions: ["Stop if data sources cannot be accessed"] },
      what_would_change_the_decision: ["Adding at least 2 posts or 5 sales records."],
      review_plan: {
        safety_check_at: addDays(today, 2),
        evidence_check_at: addDays(today, 7),
        decision_review_at: addDays(today, 14),
        readiness_conditions: ["Minimum 2 posts or 1 order logged"],
      },
    };
  }

  // Component-first financial calculations (Spec V3)
  const confirmed = sales.filter((s) => s.status === "confirmed" || s.status === "partially_refunded");
  const grossSales = sum(confirmed.map((s) => s.amount));
  const refunds = sum(
    confirmed.map((s) => (s.status === "partially_refunded" ? s.refundAmount ?? 0 : 0))
  );
  const discounts = 0;
  const returns = 0;
  const revenue = grossSales - discounts - refunds - returns;
  const spend = sum(promos.map((p) => p.spend));

  // Costs by category
  const cogsCosts = sum(costs.filter((c) => c.category === "cogs" && c.kind === "amount").map((c) => c.amount));
  const shippingCosts = sum(costs.filter((c) => c.category === "shipping" && c.kind === "amount").map((c) => c.amount));
  const feeCosts = sum(costs.filter((c) => c.category === "fees" && c.kind === "amount").map((c) => c.amount));
  const fixedCosts = sum(costs.filter((c) => c.kind === "amount").map((c) => c.amount));
  const pctCosts = sum(costs.filter((c) => c.kind === "percentage").map((c) => (c.amount / 100) * revenue));
  const totalVariableCosts = cogsCosts + shippingCosts + feeCosts + pctCosts;

  if (spend === 0) missing.push("promotion spend");
  if (confirmed.length === 0) missing.push("confirmed orders");
  if (costs.length === 0) missing.push("costs (cost of goods, fees, shipping)");

  // Attribution analysis
  const linkedSales = confirmed.filter((s) => s.postId || s.promotionId);
  const unlinkedSalesCount = confirmed.length - linkedSales.length;
  const attributedRevenue = sum(
    linkedSales.map((s) => s.amount - (s.status === "partially_refunded" ? s.refundAmount ?? 0 : 0))
  );
  const attributionCoverage = revenue > 0 ? attributedRevenue / revenue : 0;
  const attributedRoas = spend > 0 ? attributedRevenue / spend : null;

  // Derived financial metrics
  const contributionMargin = revenue > 0 && costs.length > 0 ? (revenue - totalVariableCosts) / revenue : null;
  const breakEvenRoas = contributionMargin !== null && contributionMargin > 0 ? 1 / contributionMargin : null;
  const contributionAfterMarketing =
    contributionMargin !== null ? revenue * contributionMargin - spend : revenue - spend;
  const operatingResult = contributionAfterMarketing - (fixedCosts - (cogsCosts + shippingCosts + feeCosts));
  const runRate30d = (revenue / WINDOW_DAYS) * 30;

  const financials = {
    grossSales,
    discounts,
    refunds,
    returns,
    netRevenue: revenue,
    adSpend: spend,
    cogs: cogsCosts,
    shipping: shippingCosts,
    otherVariableCosts: feeCosts + pctCosts,
    contributionMargin: contributionMargin !== null ? Math.round(contributionMargin * 1000) / 1000 : null,
    breakEvenRoas: breakEvenRoas !== null ? Math.round(breakEvenRoas * 100) / 100 : null,
    attributedRoas: attributedRoas !== null ? Math.round(attributedRoas * 100) / 100 : null,
    attributionCoverage: Math.round(attributionCoverage * 1000) / 1000,
    contributionAfterMarketing: Math.round(contributionAfterMarketing * 100) / 100,
    operatingResult: Math.round(operatingResult * 100) / 100,
    runRate30d: Math.round(runRate30d * 100) / 100,
    currency: cur,
  };

  // Determine mode
  const canOptimize = spend > 0 && confirmed.length > 0 && costs.length > 0;
  const canImprove = leads.length > 0 || sales.length > 0;
  const mode = canOptimize ? "optimize" : canImprove ? "improve" : "explore";

  // Check evidence quality gates
  const sampleDays = distinctDays.size;
  const confirmedOrders = confirmed.length;
  const passesAttributionGate = attributionCoverage >= THRESHOLDS.attributionSafetyGate;
  const passesSampleGate = sampleDays >= THRESHOLDS.minSampleDays && spendDays >= THRESHOLDS.minSpendDays;

  if (attributionCoverage < THRESHOLDS.attributionSafetyGate && confirmed.length > 0 && spend > 0) {
    warnings.push(
      `Attribution coverage is ${(attributionCoverage * 100).toFixed(1)}% (below safety gate of 60%). Platform ROAS cannot be trusted for scaling.`
    );
  }

  // 1. OPTIMIZE MODE
  if (mode === "optimize") {
    const totalCosts = fixedCosts + pctCosts;
    const adjusted = (revenue - totalCosts) / spend;
    const calculation = {
      formulaVersion: FORMULA_VERSION,
      currency: cur,
      revenue,
      costs: totalCosts,
      spend,
      adjustedReturn: Number.isFinite(adjusted) ? adjusted : null,
      scope: "business_level" as const,
    };

    const rationale = [
      `Over the last ${WINDOW_DAYS} days: revenue ${money(revenue, cur)}, declared costs ${money(totalCosts, cur)}, promotion spend ${money(spend, cur)}.`,
      `Adjusted return = (revenue - declared costs) / spend = ${adjusted.toFixed(2)}. This is business-level, not attributed to individual promotions.`,
    ];

    const unknowns = [
      "Revenue is not attributed to specific promotions, so this does not show which promotion earned it.",
      "Only costs you entered are counted. Any cost you have not entered is treated as unknown, not zero.",
    ];
    if (unlinkedSalesCount > 0) {
      unknowns.push(`${unlinkedSalesCount} order(s) are not linked to a post or promotion.`);
    }

    let action: string;
    let risk: string;
    let category: Recommendation["category"] = "budget";
    let budgetCap: number | null = null;
    let stopConditions: string[] = [];

    // Objective-aware evaluation
    const isGrowthObjective = business.objective === "growth" || business.objective === "revenue_growth";

    if (adjusted < THRESHOLDS.holdBelow) {
      action = "Do not increase promotion spend. Review which promotions you can pause or shrink, and check that all costs are entered.";
      risk = "Pausing too quickly can hide a slow-converting promotion. Change one promotion at a time.";
      stopConditions = ["Immediately pause campaigns that have generated 0 attributed sales over 7 consecutive days."];
    } else if (adjusted < THRESHOLDS.maintainBelow) {
      action = "Keep promotion spend where it is for two more weeks while you link each order to a promotion.";
      risk = "Holding spend means slower growth if the promotions are in fact working well.";
      stopConditions = ["Re-evaluate if 3-day trailing return dips below 1.0x."];
    } else {
      // Return is strong, but check safety gate on attribution
      if (!passesAttributionGate && isGrowthObjective) {
        action = `Hold current budget. Even with strong adjusted return (${adjusted.toFixed(2)}), attribution coverage is only ${(attributionCoverage * 100).toFixed(0)}% (safety gate is 60%). Fix order attribution before scaling spend.`;
        risk = "Scaling budget without attribution risks putting more money into the wrong campaigns.";
        stopConditions = ["Do not increase budget until at least 60% of sales are linked to campaigns."];
      } else {
        const increasePct = Math.round(THRESHOLDS.maxSuggestedIncrease * 100);
        action = `Consider a small, reversible increase (no more than ${increasePct}%) on one promotion, then wait two weeks before judging.`;
        risk = "Returns often fall as spend rises. Do this only if you can afford to lose the extra spend.";
        budgetCap = Math.round(spend * THRESHOLDS.maxSuggestedIncrease);
        stopConditions = [
          "Halt budget increase if cost per acquisition rises above break-even.",
          "Stop test if contribution margin falls below target.",
        ];
      }
    }

    const metricsList = [
      { name: "Net Revenue", value: money(revenue, cur), definition_version: "v3" },
      { name: "Declared Costs", value: money(totalCosts, cur), definition_version: "v3" },
      { name: "Promotion Spend", value: money(spend, cur), definition_version: "v3" },
      { name: "Adjusted Return", value: `${adjusted.toFixed(2)}x`, definition_version: "v3" },
      { name: "Attribution Coverage", value: `${(attributionCoverage * 100).toFixed(1)}%`, definition_version: "v3" },
    ];
    if (contributionMargin !== null) {
      metricsList.push({ name: "Contribution Margin", value: `${(contributionMargin * 100).toFixed(1)}%`, definition_version: "v3" });
    }
    if (breakEvenRoas !== null) {
      metricsList.push({ name: "Break-even ROAS", value: `${breakEvenRoas.toFixed(2)}x`, definition_version: "v3" });
    }

    return {
      ...base,
      category,
      mode,
      action,
      primary_action: { type: "budget_adjustment", description: action },
      rationale,
      unknowns,
      risk,
      doNotActIf: "Your cost entries are incomplete, or the period included an unusual sale or stock problem.",
      nextMeasurement: "Link each order to its promotion for the next two weeks and re-check the adjusted return.",
      evidence: evidence(),
      calculation,
      evidence_quality: {
        mode: "optimize",
        status: passesAttributionGate && passesSampleGate ? "sufficient" : "partial",
        warnings,
        attributionCoverage,
        sampleDays,
        confirmedOrders,
        spendDays,
      },
      metrics: metricsList,
      financials,
      alternatives: [
        {
          action: "Aggressively scale ad budget by 50% across all channels",
          why_not_selected: "Marginal returns diminish as budgets surge. A conservative 20% cap avoids cash flow strain.",
        },
        {
          action: "Pause all marketing spend completely",
          why_not_selected: "The overall return is healthy enough to support measured testing rather than halting traffic.",
        },
      ],
      guardrails: {
        budget_cap: budgetCap,
        duration: "14 days",
        stop_conditions: stopConditions,
      },
      what_would_change_the_decision: [
        "A sudden drop in contribution margin below 30%",
        "A severe drop in order volume (>25%) during the test window",
        "Discovery of missing supplier or shipping cost increases",
      ],
      review_plan: {
        safety_check_at: addDays(today, 3),
        evidence_check_at: addDays(today, 7),
        decision_review_at: addDays(today, 14),
        readiness_conditions: [
          "Minimum 7 days elapsed post-adjustment",
          "No data sync interruptions > 48 hours",
          "Attribution coverage maintained above 60%",
        ],
      },
    };
  }

  // 2. IMPROVE MODE
  if (mode === "improve") {
    const byPromo = promos
      .map((p) => ({ p, n: leads.filter((l) => l.promotionId === p.id).length }))
      .filter((x) => x.n > 0 && x.p.spend > 0)
      .map((x) => ({ ...x, cpe: x.p.spend / x.n }))
      .sort((a, b) => a.cpe - b.cpe);

    if (byPromo.length >= 1) {
      const best = byPromo[0];
      const rationale = [
        `Promotion on ${best.p.platform} (${best.p.startDate}) cost ${money(best.cpe, cur)} per enquiry (${best.n} enquiries for ${money(best.p.spend, cur)}).`,
      ];
      if (byPromo.length > 1) {
        rationale.push(`The next best cost ${money(byPromo[1].cpe, cur)} per enquiry.`);
      }
      const action =
        "Run one small, time-limited repeat of the lowest cost-per-enquiry promotion and record which enquiries become confirmed orders. Do not raise the budget yet.";

      return {
        ...base,
        category: "promotion",
        mode,
        action,
        primary_action: { type: "bounded_experiment", description: action },
        rationale,
        unknowns: [
          "Whether these enquiries became orders, so this cannot show which promotion earns more revenue or profit.",
          "Small sample sizes can look better or worse than they are.",
        ],
        risk: "A repeat may not perform the same way. Keep spend at the original level.",
        doNotActIf: "Enquiry counts for these promotions were estimated rather than counted.",
        nextMeasurement: "Same test window: spend, enquiries, qualified enquiries and confirmed orders.",
        evidence: evidence(),
        evidence_quality: {
          mode: "improve",
          status: "partial",
          warnings,
          sampleDays,
          confirmedOrders,
          spendDays,
        },
        financials,
        alternatives: [
          { action: "Double the promotion budget now", why_not_selected: "Enquiries have not yet been proven to convert into profitable sales." },
          { action: "Stop all promotions", why_not_selected: "Initial enquiry cost signal is promising and merits a controlled confirmation test." },
        ],
        guardrails: {
          budget_cap: Math.round(best.p.spend),
          duration: "7 days",
          stop_conditions: ["Stop if cost per enquiry doubles during the repeat."],
        },
        what_would_change_the_decision: ["Confirmation that enquiries from this promotion convert to orders at a healthy margin."],
        review_plan: {
          safety_check_at: addDays(today, 2),
          evidence_check_at: addDays(today, 5),
          decision_review_at: addDays(today, 7),
          readiness_conditions: ["At least 10 new enquiries or 3 confirmed orders recorded"],
        },
      };
    }

    const noLinks =
      leads.every((l) => !l.postId && !l.promotionId) && sales.every((s) => !s.postId && !s.promotionId);
    const action =
      "Link each enquiry and order to the post or promotion that brought it, even if it is your best guess (mark it as estimated).";

    return {
      ...base,
      category: noLinks ? "measurement" : "lead_sales_process",
      mode,
      action,
      primary_action: { type: "tracking_improvement", description: action },
      rationale: [
        `You have ${leads.length} enquiries and ${sales.length} orders in the last ${WINDOW_DAYS} days, but not enough links to a post or promotion to compare them.`,
      ],
      unknowns: ["Which content or promotion is bringing enquiries and orders."],
      risk: "None. Guessed links must be labelled as estimates so they are not treated as fact.",
      doNotActIf: "You have no reasonable way to tell where an enquiry came from. Leave it unlinked.",
      nextMeasurement: "For two weeks, record the source of every enquiry and order, and the spend of every promotion.",
      evidence: evidence(),
      evidence_quality: {
        mode: "improve",
        status: "partial",
        warnings,
        sampleDays,
        confirmedOrders,
        spendDays,
      },
      financials,
      alternatives: [
        { action: "Assume all sales came from Google Ads", why_not_selected: "Conflating unverified platform claims with true sales leads to costly misallocation." },
      ],
      guardrails: { budget_cap: 0, duration: "14 days", stop_conditions: [] },
      what_would_change_the_decision: ["Achieving at least 60% attribution link coverage."],
      review_plan: {
        safety_check_at: addDays(today, 3),
        evidence_check_at: addDays(today, 7),
        decision_review_at: addDays(today, 14),
        readiness_conditions: ["At least 5 orders linked to marketing sources"],
      },
    };
  }

  // 3. EXPLORE MODE
  const rated = posts
    .filter((p) => (p.reach ?? 0) > 0)
    .map((p) => ({
      p,
      rate:
        ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / (p.reach as number),
    }))
    .sort((a, b) => b.rate - a.rate);

  if (rated.length >= 2) {
    const top = rated[0];
    const low = rated[rated.length - 1];
    const what =
      [top.p.format, top.p.topic].filter(Boolean).join(" / ") ||
      `the ${top.p.platform} post from ${top.p.publishedAt}`;
    const action = `Post one or two more in the style of ${what} and record any enquiries they bring.`;

    return {
      ...base,
      category: "content",
      mode,
      action,
      primary_action: { type: "creative_test", description: action },
      rationale: [
        `The ${top.p.platform} post from ${top.p.publishedAt} had an engagement rate of ${(
          top.rate * 100
        ).toFixed(1)}% of reach, versus ${(low.rate * 100).toFixed(1)}% for the lowest post.`,
        "Engagement is an early signal about content, not about sales.",
      ],
      unknowns: [
        "Whether engagement turns into enquiries or orders. No enquiry or sales data is recorded.",
        "Reach and engagement may be affected by timing and by whether posts were promoted.",
      ],
      risk: "Low. Do not put money behind this on engagement alone.",
      doNotActIf: "The best post was boosted and the others were not. That is not a fair comparison.",
      nextMeasurement: "Record enquiries (date and which post if known) for the next two weeks.",
      evidence: evidence([...missing, "enquiries"]),
      evidence_quality: {
        mode: "explore",
        status: "insufficient",
        warnings,
        sampleDays,
        confirmedOrders,
        spendDays,
      },
      ...((sales.length > 0 || promos.length > 0 || costs.length > 0) ? { financials } : {}),
      alternatives: [
        { action: "Immediately boost the top post with a $200 ad budget", why_not_selected: "Engagement rate alone does not prove commercial demand." },
      ],
      guardrails: { budget_cap: 0, duration: "7 days", stop_conditions: ["Stop if negative audience feedback arises"] },
      what_would_change_the_decision: ["Organic posts driving enquiries or direct checkout links."],
      review_plan: {
        safety_check_at: addDays(today, 3),
        evidence_check_at: addDays(today, 7),
        decision_review_at: addDays(today, 10),
        readiness_conditions: ["2 new posts published and reach recorded"],
      },
    };
  }

  const action = "Add reach and likes for at least two recent posts, and log any enquiries you received.";
  return {
    ...base,
    category: "measurement",
    mode,
    action,
    primary_action: { type: "data_collection", description: action },
    rationale: [
      `There are ${posts.length} post(s) with usable reach in the last ${WINDOW_DAYS} days. Two are needed to compare.`,
    ],
    unknowns: ["Which content performs better."],
    risk: "None. This only asks you to record information.",
    doNotActIf: "Metrics are not available for these posts. Record what you can see.",
    nextMeasurement: "Reach, likes, comments, shares and saves per post, and enquiries per week.",
    evidence: evidence([...missing, "enquiries"]),
    evidence_quality: {
      mode: "explore",
      status: "insufficient",
      warnings,
      sampleDays,
      confirmedOrders,
      spendDays,
    },
    ...((sales.length > 0 || promos.length > 0 || costs.length > 0) ? { financials } : {}),
    alternatives: [
      { action: "Publish daily without tracking reach", why_not_selected: "Without recording reach and reactions, content iterations cannot be evaluated." },
    ],
    guardrails: { budget_cap: 0, duration: "14 days", stop_conditions: [] },
    what_would_change_the_decision: ["Logging metrics for at least two separate posts."],
    review_plan: {
      safety_check_at: addDays(today, 3),
      evidence_check_at: addDays(today, 7),
      decision_review_at: addDays(today, 14),
      readiness_conditions: ["2 posts with reach entered"],
    },
  };
}
