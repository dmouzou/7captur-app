import type { CostRecord, LeadRecord, PostRecord, PromotionRecord, SaleRecord } from "../shared/records";
import type { Recommendation } from "../shared/recommendation";
import { OBJECTIVES } from "../shared/schemas";
import { convert, type FxRates } from "../shared/fx";

export const ENGINE_VERSION = "rules-v4";
export const FORMULA_VERSION = "true-roas-v2";
export const WINDOW_DAYS = 28;

/** Versioned thresholds. Change only with an engine version bump. */
/** Low-effort ways to tell which promotion brought an order, cheapest first. */
const CHEAP_TRACKING = [
  "Add one question at checkout or in chat: \"How did you find us?\" and link the order to the answer.",
  "Give each promotion its own discount code and link orders that use it.",
  "Put a different link (with ?utm_campaign=) on each promotion and note which orders follow.",
  "For today's orders only, link each one to your best guess and mark it as estimated.",
];

export const THRESHOLDS = {
  /** True ROAS must be at least this many times break-even before a small increase is suggested. */
  scaleAtRatio: 1.25,
  /** Below break-even the spend loses money. */
  cutBelowRatio: 1.0,
  maxSuggestedIncrease: 0.2,
  minAttributionCoverage: 0.6,
  minDaysWithRecords: 14,
  minDaysWithSpend: 7,
  minConfirmedOrders: 20,
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
  business: { objective: string; currency: string; convertCurrencies?: boolean };
  today: string; // YYYY-MM-DD in workspace timezone
  /** Daily ECB rates. Conversion is used only when business.convertCurrencies is not false. */
  fx?: FxRates | null;
  /** True when Stripe or PayPal is connected, so processor fees are visible. */
  processorConnected?: boolean;
}

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const money = (n: number, c: string) => `${n.toFixed(2)} ${c}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

type Gate = NonNullable<NonNullable<Recommendation["evidence_quality"]>["gates"]>[number];
type Alt = { action: string; why_not_selected: string };
type Review = NonNullable<Recommendation["review_plan"]>;
type Obj = (typeof OBJECTIVES)[number];

/** Review timing depends on the kind of decision and on how fast orders arrive. */
export function reviewPlan(
  kind: "budget" | "experiment" | "creative" | "tracking" | "cut",
  today: string,
  ordersPerDay: number,
  conditions: string[],
): Review {
  const ordersNeeded = 10;
  const byOrders = ordersPerDay > 0 ? Math.ceil(ordersNeeded / ordersPerDay) : 14;
  const days =
    kind === "budget" ? Math.min(21, Math.max(7, byOrders))
    : kind === "cut" ? 7
    : kind === "experiment" ? 7
    : kind === "creative" ? 10
    : 14;
  return {
    safety_check_at: addDays(today, Math.min(3, Math.max(1, Math.floor(days / 3)))),
    evidence_check_at: addDays(today, Math.max(2, Math.round(days / 2))),
    decision_review_at: addDays(today, days),
    readiness_conditions: conditions,
  };
}
const reviewDaysOf = (r: Review, today: string) => daysBetween(today, r.decision_review_at ?? addDays(today, 14));

export function runEngine(input: EngineInput): Recommendation {
  const { business, today } = input;
  const start = addDays(today, -(WINDOW_DAYS - 1));
  const inWin = (d: string) => d >= start && d <= today;
  const cur = business.currency;
  const objective: Obj = (OBJECTIVES as readonly string[]).includes(business.objective) ? (business.objective as Obj) : "profitability";
  const warnings: string[] = [];
  const missing: string[] = [];
  // Conversion is the owner's choice. Until they answer (undefined) nothing is converted and nothing is guessed.
  const convertOn = business.convertCurrencies === true;
  const excludedBy: Record<string, number> = {};

  /* ---- currency: convert when allowed and a rate exists, otherwise leave out, never guess ---- */
  const fxRatesUsed: Record<string, number> = {};
  let convertedRecords = 0;
  let excluded = 0;
  const rateTo = (from: string | undefined): number | null => {
    if (!from || from === cur) return 1;
    if (convertOn) {
      const c = convert(1, from, cur, input.fx);
      if (c) { fxRatesUsed[from] = Math.round(c.rate * 1e6) / 1e6; convertedRecords++; return c.rate; }
    }
    excluded++;
    excludedBy[from] = (excludedBy[from] ?? 0) + 1;
    return null;
  };

  const normProv = (p?: string) => (p === "screenshot_extracted" ? "manual" : p ?? "unknown");
  const posts = input.records.posts.filter((p) => inWin(p.publishedAt));
  const leads = input.records.leads.filter((l) => inWin(l.date));

  const promos = input.records.promotions.filter((p) => inWin(p.startDate)).flatMap((p) => {
    const f = rateTo(p.currency);
    return f === null ? [] : [{ ...p, spend: p.spend * f }];
  });
  const sales = input.records.sales.filter((s) => inWin(s.date)).flatMap((s) => {
    const f = rateTo(s.currency);
    return f === null ? [] : [{ ...s, amount: s.amount * f, refundAmount: (s.refundAmount ?? 0) * f, discountAmount: (s.discountAmount ?? 0) * f }];
  });
  const costsIn = input.records.costs.flatMap((c) => {
    if (c.kind === "percentage") return [c];
    const f = rateTo(c.currency);
    return f === null ? [] : [{ ...c, amount: c.amount * f }];
  });
  if (excluded > 0) warnings.push(`${excluded} record(s) in a currency other than ${cur} were left out of every figure. ${business.convertCurrencies === undefined ? "Choose how to handle them (convert, switch your reporting currency, or keep them out)." : "Conversion is off or no rate is available."}`);
  if (convertedRecords > 0 && input.fx) warnings.push(`${convertedRecords} record(s) were converted to ${cur} using ECB reference rates dated ${input.fx.date}.`);

  const prov: Record<string, number> = {};
  for (const r of [...posts, ...promos, ...leads, ...sales]) {
    const k = normProv(r.provenance);
    prov[k] = (prov[k] ?? 0) + 1;
  }

  /* ---- costs: frequency, proration, end dates ---- */
  const confirmed = sales.filter((s) => s.status === "confirmed" || s.status === "partially_refunded");
  const refundedFully = sales.filter((s) => s.status === "refunded");
  const counted = [...confirmed, ...refundedFully];
  const grossSales = sum(counted.map((s) => s.amount + s.discountAmount));
  const discounts = sum(counted.map((s) => s.discountAmount));
  const refunds = sum(confirmed.map((s) => (s.status === "partially_refunded" ? s.refundAmount : 0))) + sum(refundedFully.map((s) => s.amount));
  const netRevenue = grossSales - discounts - refunds;
  const spend = sum(promos.map((p) => p.spend));

  const costActive = (c: (typeof costsIn)[number]) => {
    if (c.effectiveDate > today) return false;
    if (c.endDate && c.endDate < start) return false;
    const recurring = c.kind === "percentage" || c.scope === "per_order" || c.scope === "per_unit" || c.frequency === "monthly" || c.frequency === "yearly";
    return recurring ? true : c.effectiveDate >= start;
  };
  const known: Record<string, boolean> = { cogs: false, shipping: false, fees: false, returns: false, disputes: false, other: false };
  const total: Record<string, number> = { cogs: 0, shipping: 0, fees: 0, returns: 0, disputes: 0, other: 0 };
  let legacy = 0;
  for (const c of costsIn) {
    if (!costActive(c)) continue;
    const lo = c.effectiveDate > start ? c.effectiveDate : start;
    const hi = c.endDate && c.endDate < today ? c.endDate : today;
    const overlap = Math.max(0, daysBetween(lo, hi) + 1);
    let amt: number;
    if (c.kind === "percentage") amt = (c.amount / 100) * netRevenue;
    else if (c.scope === "per_order") amt = c.amount * counted.filter((s) => s.date >= lo && s.date <= hi).length;
    else if (c.scope === "per_unit") amt = c.amount * sum(counted.filter((s) => s.date >= lo && s.date <= hi).map((s) => s.quantity ?? 1));
    else if (c.frequency === "monthly") amt = (c.amount * overlap) / 30.4375;
    else if (c.frequency === "yearly") amt = (c.amount * overlap) / 365.25;
    else { amt = c.amount; if (!c.frequency) legacy++; }
    total[c.category] += amt;
    known[c.category] = true;
  }
  if (legacy > 0) warnings.push(`${legacy} cost entr${legacy === 1 ? "y has" : "ies have"} no frequency, so each is counted once on its date. Set monthly, yearly or per order for a fairer result.`);

  /* ---- attribution ---- */
  const promoOfPost = new Map<string, string>();
  for (const p of promos) if (p.postId) promoOfPost.set(p.postId, p.id);
  const promoOf = (s: (typeof sales)[number]) => s.promotionId ?? (s.postId ? promoOfPost.get(s.postId) : undefined);
  const linked = confirmed.filter((s) => s.postId || s.promotionId);
  const netOf = (s: (typeof sales)[number]) => s.amount - (s.status === "partially_refunded" ? s.refundAmount : 0);
  const attributedNet = sum(linked.map(netOf));
  const attributionCoverage = netRevenue > 0 ? attributedNet / netRevenue : 0;
  const share = netRevenue > 0 ? attributedNet / netRevenue : 0;

  /* ---- financial components ---- */
  const feesVisible = Boolean(input.processorConnected) || known.fees;
  const deductions = total.fees + total.returns + total.disputes;
  const keptAttributed = attributedNet - deductions * share;
  const attributedRoas = spend > 0 && confirmed.length > 0 ? attributedNet / spend : null;
  const trueRoas = feesVisible && attributedRoas !== null ? keptAttributed / spend : null;
  const cogsKnown = known.cogs;
  const cm = cogsKnown && netRevenue > 0 ? (netRevenue - total.cogs - total.shipping) / netRevenue : null;
  const breakEven = cm !== null && cm > 0 ? 1 / cm : null;
  const ratio = trueRoas !== null && breakEven !== null ? trueRoas / breakEven : null;
  const contributionAfterMarketing = cm === null ? null : netRevenue - total.cogs - total.shipping - deductions - spend;
  const operatingResult = contributionAfterMarketing === null ? null : contributionAfterMarketing - total.other;
  const attributedOrders = linked.length;

  const unknownCosts: string[] = [];
  if (!cogsKnown) unknownCosts.push("cost of goods");
  if (!known.shipping) unknownCosts.push("shipping");
  if (!feesVisible) unknownCosts.push("payment fees");
  if (!known.returns) unknownCosts.push("return costs");
  if (!input.processorConnected && !known.disputes) unknownCosts.push("payment disputes");
  const confidence: "high" | "medium" | "low" = unknownCosts.length === 0 ? "high" : unknownCosts.length <= 2 ? "medium" : "low";

  const linksTooThin = attributionCoverage < THRESHOLDS.minAttributionCoverage;
  const blendedRoas = spend > 0 && netRevenue > 0 ? netRevenue / spend : null;
  const financials = {
    grossSales: r2(grossSales), discounts: r2(discounts), refunds: r2(refunds), returns: r2(total.returns),
    fees: r2(total.fees), disputes: r2(total.disputes), netRevenue: r2(netRevenue),
    attributedRevenue: r2(attributedNet),
    // With too few linked orders the attributed figures are understated, so they are "not measurable yet", never 0.00x.
    keptAttributedRevenue: feesVisible && !linksTooThin ? r2(keptAttributed) : null,
    trueRoas: trueRoas !== null && !linksTooThin ? r2(trueRoas) : null,
    blendedRoas: blendedRoas !== null ? r2(blendedRoas) : null,
    feesVisible,
    ratioToBreakEven: ratio !== null ? r2(ratio) : null,
    costPerOrder: attributedOrders > 0 && spend > 0 ? r2(spend / attributedOrders) : null,
    adSpend: r2(spend), cogs: r2(total.cogs), shipping: r2(total.shipping),
    otherVariableCosts: r2(total.fees + total.returns + total.disputes),
    contributionMargin: cm !== null ? r3(cm) : null,
    breakEvenRoas: breakEven !== null ? r2(breakEven) : null,
    attributedRoas: attributedRoas !== null && !linksTooThin ? r2(attributedRoas) : null,
    attributionCoverage: r3(attributionCoverage),
    contributionAfterMarketing: contributionAfterMarketing !== null ? r2(contributionAfterMarketing) : null,
    operatingResult: operatingResult !== null ? r2(operatingResult) : null,
    runRate30d: r2((netRevenue / WINDOW_DAYS) * 30),
    currency: cur,
  };

  /* ---- hard gates ---- */
  const distinctDays = new Set([
    ...posts.map((p) => p.publishedAt), ...promos.map((p) => p.startDate), ...leads.map((l) => l.date), ...sales.map((s) => s.date),
  ]);
  const sampleDays = distinctDays.size;
  const spendDays = new Set(promos.filter((p) => p.spend > 0).map((p) => p.startDate)).size;
  const confirmedOrders = confirmed.length;
  const gates: Gate[] = [
    { key: "orders", label: "Confirmed orders", actual: confirmedOrders, required: THRESHOLDS.minConfirmedOrders, passed: confirmedOrders >= THRESHOLDS.minConfirmedOrders },
    { key: "days", label: "Days with records", actual: sampleDays, required: THRESHOLDS.minDaysWithRecords, passed: sampleDays >= THRESHOLDS.minDaysWithRecords },
    { key: "spend_days", label: "Days with ad spend", actual: spendDays, required: THRESHOLDS.minDaysWithSpend, passed: spendDays >= THRESHOLDS.minDaysWithSpend },
    { key: "attribution", label: "Orders linked to a post or promotion", actual: r3(attributionCoverage), required: THRESHOLDS.minAttributionCoverage, passed: attributionCoverage >= THRESHOLDS.minAttributionCoverage },
  ];
  const volumeGatesPass = gates.slice(0, 3).every((g) => g.passed);
  const attributionPass = gates[3].passed;
  const failedText = (gs: Gate[]) =>
    gs.filter((g) => !g.passed).map((g) => g.key === "attribution" ? `${g.label}: ${pct(g.actual)} of ${pct(g.required)} needed` : `${g.label}: ${g.actual} of ${g.required} needed`);

  if (spend === 0) missing.push("promotion spend");
  if (confirmed.length === 0) missing.push("confirmed orders");
  if (!cogsKnown) missing.push("cost of goods");
  if (!feesVisible) missing.push("payment fees (connect Stripe or PayPal, or enter a fee)");
  if (confirmed.length > 0 && spend > 0 && !attributionPass) {
    warnings.push(`Only ${pct(attributionCoverage)} of net revenue is linked to a post or promotion (${pct(THRESHOLDS.minAttributionCoverage)} needed). Attributed ROAS is understated and is not used to cut or scale.`);
  }

  const sampleSize = { posts: posts.length, promotions: promos.length, leads: leads.length, sales: sales.length, costs: costsIn.length };
  const totalRecords = posts.length + promos.length + leads.length + sales.length;
  const ordersPerDay = confirmedOrders / WINDOW_DAYS;
  const evidence = (m: string[] = missing): Recommendation["evidence"] => ({
    asOf: today, windowStart: start, windowEnd: today, sampleSize, provenance: prov, missing: m, warnings,
    ...(excluded > 0 ? { currencyMismatch: { reportingCurrency: cur, excluded: excludedBy, decided: business.convertCurrencies !== undefined } } : {}),
    ...(convertedRecords > 0 && input.fx ? { fx: { reportingCurrency: cur, rateDate: input.fx.date, source: "ecb" as const, rates: fxRatesUsed, convertedRecords } } : {}),
  });
  const quality = (mode: Recommendation["mode"], status: "sufficient" | "partial" | "insufficient"): NonNullable<Recommendation["evidence_quality"]> => ({
    mode, status, warnings, attributionCoverage: r3(attributionCoverage), sampleDays, confirmedOrders, spendDays, gates, unknownCosts, confidence,
  });
  const base = { objective: business.objective, engineVersion: ENGINE_VERSION };
  const roasMissing = unknownCosts.length ? [`Costs not entered: ${unknownCosts.join(", ")}. They are unknown, not zero.`] : [];

  /* ---- per-promotion view (used by several objectives) ---- */
  const perPromo = promos.filter((p) => p.spend > 0).map((p) => {
    const mine = linked.filter((s) => promoOf(s) === p.id);
    const revenue = sum(mine.map(netOf));
    const enquiries = leads.filter((l) => l.promotionId === p.id);
    const qualified = enquiries.filter((l) => l.qualified).length;
    return {
      p, revenue, orders: mine.length, roas: revenue / p.spend, enquiries: enquiries.length, qualified,
      cpe: enquiries.length ? p.spend / enquiries.length : null,
      cpq: qualified ? p.spend / qualified : null,
      reach: p.reach ?? 0,
    };
  });
  const label = (p: { platform: string; startDate: string }) => `${p.platform} promotion from ${p.startDate}`;

  /* ---- shared builders ---- */
  const measurement = (action: string, rationale: string[], unknowns: string[], mode: Recommendation["mode"], extraAlt: Alt[] = []): Recommendation => ({
    ...base, category: "measurement", mode, action,
    primary_action: { type: "data_collection", description: action },
    rationale, unknowns,
    risk: "None. This only asks you to record information.",
    doNotActIf: "You cannot recall figures reasonably well. Estimates are fine if you mark them as estimates.",
    nextMeasurement: "Per promotion: spend. Per order: date, amount and the post or promotion that brought it. Per enquiry: date and source if known.",
    evidence: evidence(),
    evidence_quality: quality(mode, "insufficient"),
    ...(sales.length > 0 || promos.length > 0 ? { financials } : {}),
    alternatives: [
      ...extraAlt,
      { action: "Change spend now without better records", why_not_selected: "The records are too thin to say whether spend is helping, so any change would be a guess." },
    ],
    guardrails: { budget_cap: 0, duration: "14 days", stop_conditions: [] },
    what_would_change_the_decision: ["Entering the missing records listed above."],
    review_plan: reviewPlan("tracking", today, ordersPerDay, ["New records entered for the missing items"]),
  });

  /* ---- 0. cold start ---- */
  if (totalRecords === 0) {
    return {
      ...measurement(
        "Record your posts from the last two weeks, plus any enquiries or orders you received.",
        [`There are no records in the last ${WINDOW_DAYS} days, so there is nothing to compare yet.`],
        ["Which content or promotion is working, because no data has been entered."], "explore",
      ),
      evidence: evidence(["posts", "enquiries", "orders"]),
      nextMeasurement: "For each post: date, platform, reach and likes. For each enquiry or order: date and where it came from if known.",
    };
  }

  /* ---- content_testing: engagement ---- */
  const rated = posts.filter((p) => (p.reach ?? 0) > 0)
    .map((p) => ({ p, rate: ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / (p.reach as number) }))
    .sort((a, b) => b.rate - a.rate);
  const contentRec = (): Recommendation | null => {
    if (rated.length < 2) return null;
    const top = rated[0], low = rated[rated.length - 1];
    const what = [top.p.format, top.p.topic].filter(Boolean).join(" / ") || `the ${top.p.platform} post from ${top.p.publishedAt}`;
    const action = `Post one or two more in the style of ${what} and record any enquiries they bring.`;
    const promotedNote = rated.some((r) => r.p.promoted) && !rated.every((r) => r.p.promoted);
    return {
      ...base, category: "content", mode: "explore", action,
      primary_action: { type: "creative_test", description: action },
      rationale: [
        `The ${top.p.platform} post from ${top.p.publishedAt} had an engagement rate of ${(top.rate * 100).toFixed(1)}% of reach, versus ${(low.rate * 100).toFixed(1)}% for the lowest post.`,
        "Engagement is an early signal about content, not about sales.",
      ],
      unknowns: [
        "Whether engagement turns into enquiries or orders.",
        promotedNote ? "Some posts were promoted and others were not, so the comparison is not fully fair." : "Reach and engagement may be affected by timing.",
      ],
      risk: "Low. Do not put money behind this on engagement alone.",
      doNotActIf: "The best post was boosted and the others were not. That is not a fair comparison.",
      nextMeasurement: "Record enquiries (date and which post if known) for the next two weeks.",
      evidence: evidence([...missing.filter((m) => m !== "promotion spend" && m !== "confirmed orders"), "enquiries"]),
      evidence_quality: quality("explore", "insufficient"),
      decisionBasis: { objective, metric: "Engagement rate", rule: "Content testing compares engagement per reach. No sales claim is made." },
      alternatives: [
        { action: "Put ad budget behind the top post now", why_not_selected: `Its engagement rate of ${(top.rate * 100).toFixed(1)}% shows interest, not demand, and no enquiries or orders are linked to it.` },
        { action: "Keep posting the same mix", why_not_selected: `The spread between the best (${(top.rate * 100).toFixed(1)}%) and lowest (${(low.rate * 100).toFixed(1)}%) post is a signal worth testing.` },
      ],
      guardrails: { budget_cap: 0, duration: "10 days", stop_conditions: ["Stop if the repeat posts get clearly lower engagement than the original."] },
      what_would_change_the_decision: ["Organic posts that bring enquiries or orders.", "The top post turning out to have been promoted."],
      review_plan: reviewPlan("creative", today, ordersPerDay, ["2 new posts published and reach recorded"]),
    };
  };

  /* ---- qualified_enquiries / improve with leads: cost per qualified enquiry ---- */
  const enquiryRec = (): Recommendation | null => {
    const ranked = perPromo.filter((x) => x.cpq !== null).sort((a, b) => (a.cpq as number) - (b.cpq as number));
    const useQualified = ranked.length > 0;
    const list = useQualified ? ranked : perPromo.filter((x) => x.cpe !== null).sort((a, b) => (a.cpe as number) - (b.cpe as number));
    if (list.length === 0) return null;
    const key = useQualified ? "cpq" : "cpe";
    const noun = useQualified ? "qualified enquiry" : "enquiry";
    const val = (x: (typeof list)[number]) => x[key] as number;
    const best = list[0], worst = list[list.length - 1];
    const n = useQualified ? best.qualified : best.enquiries;
    const rationale = [`The ${label(best.p)} cost ${money(val(best), cur)} per ${noun} (${n} for ${money(best.p.spend, cur)}).`];
    if (list.length > 1) rationale.push(`The weakest, the ${label(worst.p)}, cost ${money(val(worst), cur)} per ${noun}.`);
    if (!useQualified) rationale.push("No enquiry is marked qualified yet, so all enquiries are counted.");
    const action = "Run one small, time-limited repeat of the lowest-cost promotion and record which enquiries become confirmed orders. Do not raise the budget yet.";
    return {
      ...base, category: "promotion", mode: "improve", action,
      primary_action: { type: "bounded_experiment", description: action },
      rationale,
      unknowns: ["Whether these enquiries became orders, so this cannot show which promotion earns more revenue.", "Small samples can look better or worse than they are."],
      risk: "A repeat may not perform the same way. Keep spend at the original level.",
      doNotActIf: "Enquiry counts for these promotions were estimated rather than counted.",
      nextMeasurement: "Same test window: spend, enquiries, qualified enquiries and confirmed orders.",
      evidence: evidence(), evidence_quality: quality("improve", "partial"),
      decisionBasis: { objective, metric: `Cost per ${noun}`, rule: "Qualified-enquiry objectives rank promotions by cost per qualified enquiry." },
      ...(sales.length > 0 ? { financials } : {}),
      alternatives: [
        { action: `Raise the ${label(best.p)} budget now`, why_not_selected: `${n} ${noun}${n === 1 ? "" : "s"} is a small sample and none is yet linked to revenue.` },
        ...(list.length > 1 ? [{ action: `Cut the ${label(worst.p)} now`, why_not_selected: `Its cost per ${noun} is ${money(val(worst), cur)}, but without conversions to orders it is too early to call it a loss.` }] : []),
      ],
      guardrails: { budget_cap: r2(best.p.spend), duration: "7 days", stop_conditions: [`Stop if cost per ${noun} rises well above ${money(val(best), cur)} during the repeat.`] },
      what_would_change_the_decision: [
        `Enquiries from the ${label(best.p)} turning into confirmed orders (or not).`,
        `Cost per ${noun} for the repeat landing far from ${money(val(best), cur)}.`,
      ],
      review_plan: reviewPlan("experiment", today, ordersPerDay, ["At least 3 new qualified enquiries or 1 confirmed order recorded for the repeat"]),
    };
  };

  /* ---- awareness: reach, never sales ---- */
  const awarenessRec = (): Recommendation | null => {
    const withReach = perPromo.filter((x) => x.reach > 0);
    if (withReach.length === 0) return null;
    const rows = withReach.map((x) => ({ ...x, cpm: (x.p.spend / x.reach) * 1000 })).sort((a, b) => a.cpm - b.cpm);
    const best = rows[0], worst = rows[rows.length - 1];
    const action = `Keep the ${label(best.p)} running at its current budget and compare it with the next promotion on cost per 1,000 people reached.`;
    return {
      ...base, category: "promotion", mode: "improve", action,
      primary_action: { type: "bounded_experiment", description: action },
      rationale: [
        `The ${label(best.p)} reached people at ${money(best.cpm, cur)} per 1,000 reached.`,
        ...(rows.length > 1 ? [`The most expensive reached people at ${money(worst.cpm, cur)} per 1,000.`] : []),
      ],
      unknowns: ["Reach shows who saw the promotion, not who bought. No sales claim is made."],
      risk: "Low. Reach can be bought cheaply from people who will never buy.",
      doNotActIf: "Reach figures were estimated rather than reported by the platform.",
      nextMeasurement: "Reach, spend and any enquiries or orders that mention where they heard of you.",
      evidence: evidence([]), evidence_quality: quality("improve", "partial"),
      decisionBasis: { objective, metric: "Cost per 1,000 reached", rule: "Awareness objectives compare cost per 1,000 reached. No sales claim is made." },
      alternatives: [
        { action: `Move budget to the ${label(best.p)} now`, why_not_selected: "Cheaper reach does not show it reaches the right people." },
      ],
      guardrails: { budget_cap: 0, duration: "14 days", stop_conditions: ["Stop if cost per 1,000 reached rises sharply."] },
      what_would_change_the_decision: ["Enquiries or orders that trace back to these promotions."],
      review_plan: reviewPlan("experiment", today, ordersPerDay, ["14 more days of reach and spend recorded"]),
    };
  };

  /* ---- reduced_waste: cut the weakest spend ---- */
  const wasteRec = (): Recommendation | null => {
    if (perPromo.length < 2) return null;
    const anyOutcome = perPromo.some((x) => x.orders > 0 || x.qualified > 0 || x.enquiries > 0);
    if (!anyOutcome) return null;
    const score = (x: (typeof perPromo)[number]) => (perPromo.some((y) => y.orders > 0) ? x.roas : x.enquiries / x.p.spend);
    const sorted = [...perPromo].sort((a, b) => score(a) - score(b));
    const weakest = sorted[0], strongest = sorted[sorted.length - 1];
    const byOrders = perPromo.some((y) => y.orders > 0);
    const gatesOk = sampleDays >= THRESHOLDS.minDaysWithRecords && spendDays >= THRESHOLDS.minDaysWithSpend;
    const weakText = byOrders ? `${weakest.orders} linked order(s), ${money(weakest.revenue, cur)} attributed on ${money(weakest.p.spend, cur)} spend` : `${weakest.enquiries} enquiries on ${money(weakest.p.spend, cur)} spend`;
    const action = gatesOk
      ? `Pause or cut the ${label(weakest.p)}, the weakest spend (${weakText}). Change only this one.`
      : `Hold all spend for now. The ${label(weakest.p)} looks weakest (${weakText}), but there are not enough days of records to cut it.`;
    return {
      ...base, category: "budget", mode: "improve", action,
      primary_action: { type: gatesOk ? "budget_adjustment" : "hold", description: action },
      rationale: [`Ranked on ${byOrders ? "attributed revenue per unit of spend" : "enquiries per unit of spend"}, the ${label(weakest.p)} is weakest and the ${label(strongest.p)} is strongest.`],
      unknowns: ["Links from orders to promotions are partly manual, so a promotion may be under-credited.", ...roasMissing],
      risk: "Pausing too quickly can hide a slow-converting promotion. Change one promotion at a time.",
      doNotActIf: "The weakest promotion was only recently started or serves a purpose other than orders.",
      nextMeasurement: "Total spend and orders for the next two weeks, to confirm cutting did not remove orders.",
      evidence: evidence(), evidence_quality: quality("improve", gatesOk ? "partial" : "insufficient"),
      decisionBasis: { objective, metric: byOrders ? "Attributed revenue per spend" : "Enquiries per spend", rule: "Reduced-waste objectives cut the weakest spend first." },
      financials,
      alternatives: [
        { action: "Cut every promotion that is below average", why_not_selected: "Cutting several at once makes it impossible to see which change mattered." },
        { action: `Increase the ${label(strongest.p)}`, why_not_selected: "The objective is to waste less, not to spend more." },
      ],
      guardrails: { budget_cap: 0, duration: "14 days", stop_conditions: ["Restore the promotion if total orders fall after the cut."] },
      what_would_change_the_decision: [`The ${label(weakest.p)} bringing linked orders or enquiries after more days of data.`],
      review_plan: reviewPlan("cut", today, ordersPerDay, ["7 days of spend and orders after the change"]),
    };
  };

  /* ---- profitability / orders: the money decision ---- */
  const moneyRec = (): Recommendation | null => {
    if (!(spend > 0 && confirmed.length > 0)) return null;
    const blended = !attributionPass; // too few orders are linked to judge individual promotions
    const blendedRatio = blendedRoas !== null && breakEven !== null ? blendedRoas / breakEven : null;
    const metricName = blended ? "Blended return (all net revenue / ad spend)" : objective === "orders" ? "Attributed ROAS (before fees)" : feesVisible ? "True ROAS" : "Attributed ROAS (fees unknown)";
    const metricValue = blended ? blendedRoas : objective === "orders" ? attributedRoas : trueRoas ?? attributedRoas;
    const metricShown = metricValue !== null ? `${metricValue.toFixed(2)}x` : "n/a";
    const be = breakEven;
    const rule = blended
      ? "Too few orders are linked to a promotion, so the engine compares all net revenue with all ad spend (blended return) against break-even ROAS. Blended return credits every order to ads, so it can only flatter them: it can justify holding or reducing spend, never scaling."
      : objective === "orders"
      ? "Order objectives judge attributed ROAS and cost per order against break-even ROAS (1 divided by contribution margin)."
      : "Profit objectives judge True ROAS against break-even ROAS (1 divided by contribution margin). A True ROAS figure appears only when fees are visible.";
    const decisionBasis = { objective, metric: metricName, rule };

    const strongest = [...perPromo].filter((x) => x.revenue > 0).sort((a, b) => b.roas - a.roas)[0];
    const weakest = [...perPromo].sort((a, b) => a.roas - b.roas)[0];

    // The metric the ratio uses. Orders objective uses attributed ROAS, profit uses True ROAS.
    const judged = blended ? null : objective === "orders" ? attributedRoas : trueRoas;
    const judgedRatio = judged !== null && be !== null ? judged / be : null;
    const preFeeRatio = !blended && attributedRoas !== null && be !== null ? attributedRoas / be : null;

    type Stance = "scale" | "hold" | "cut";
    let stance: Stance = "hold";
    let block: string | null = null;

    if (!volumeGatesPass) {
      block = `Not enough data to change spend: ${failedText(gates.slice(0, 3)).join("; ")}.`;
    } else if (blended) {
      if (be === null) block = `Only ${pct(attributionCoverage)} of net revenue is linked to a promotion and cost of goods is not entered, so neither the ads nor the break-even point can be judged yet.`;
      else if (blendedRatio !== null && blendedRatio < THRESHOLDS.cutBelowRatio) stance = "cut"; // below break-even even if ads got credit for every order
      else block = `Which promotions bring orders is not measurable yet (${pct(attributionCoverage)} of net revenue is linked, ${pct(THRESHOLDS.minAttributionCoverage)} needed), so spend is not increased. Blended return is ${blendedRatio !== null ? `${blendedRatio.toFixed(2)} times break-even` : "unknown"}.`;
    } else if (be === null) {
      block = "Cost of goods is not entered, so break-even ROAS cannot be calculated.";
    } else if (preFeeRatio !== null && preFeeRatio < THRESHOLDS.cutBelowRatio) {
      stance = "cut"; // below break-even even before fees, so fees can only make it worse
    } else if (judgedRatio === null) {
      block = "Fees are not visible, so spend cannot be increased and no True ROAS figure is claimed.";
    } else if (objective !== "orders" && judgedRatio < THRESHOLDS.cutBelowRatio) {
      stance = "cut";
    } else if (judgedRatio >= THRESHOLDS.scaleAtRatio && feesVisible) {
      stance = "scale";
    } else {
      stance = "hold";
    }
    if (objective === "orders" && stance !== "cut" && !feesVisible && stance === "scale") { stance = "hold"; block = "Fees are not visible, so spend cannot be increased on attributed ROAS alone."; }

    const shownRatio = blended ? blendedRatio : judgedRatio;
    const ratioText = shownRatio !== null ? `${shownRatio.toFixed(2)} times break-even` : null;
    const rationale: string[] = [
      `Over the last ${WINDOW_DAYS} days: net revenue ${money(netRevenue, cur)}, ad spend ${money(spend, cur)}, ${confirmedOrders} confirmed orders, ${pct(attributionCoverage)} of revenue linked to a promotion.`,
    ];
    if (blended) {
      rationale.push(`Which promotions brought orders is not measurable yet: only ${pct(attributionCoverage)} of net revenue is linked to a post or promotion.`);
      if (blendedRoas !== null) rationale.push(`Blended return is ${blendedRoas.toFixed(2)}x (all net revenue divided by all ad spend). It credits every order to ads, so it is an upper bound, not True ROAS.`);
    } else if (feesVisible && trueRoas !== null) rationale.push(`True ROAS is ${trueRoas.toFixed(2)}x: attributed net revenue after fees, returns and disputes (${money(keptAttributed, cur)}) divided by ad spend.`);
    else if (attributedRoas !== null) rationale.push(`Attributed ROAS (fees unknown) is ${attributedRoas.toFixed(2)}x. This is before fees, so it is not called True ROAS.`);
    if (be !== null) rationale.push(`Break-even ROAS is ${be.toFixed(2)}x (contribution margin ${pct(cm as number)}).`);

    let action: string;
    let category: Recommendation["category"] = "budget";
    let type = "budget_adjustment";
    let budgetCap: number | null = null;
    let stop: string[] = [];
    let kind: "budget" | "cut" | "tracking" = "budget";
    const risk = stance === "scale" ? "Returns often fall as spend rises. Do this only if you can afford to lose the extra spend."
      : stance === "cut" ? "Pausing too quickly can hide a slow-converting promotion. Change one promotion at a time."
      : "Holding spend means slower growth if the promotions are in fact working well.";

    if (stance === "cut" && blended) {
      kind = "cut";
      const step = Math.round(THRESHOLDS.maxSuggestedIncrease * 100);
      action = `Reduce total ad spend by about ${step}% and review. Even if every order came from ads, blended return (${blendedRoas!.toFixed(2)}x) is below break-even (${be!.toFixed(2)}x).`;
      stop = [`Restore spend if total orders fall by more than the spend saved is worth.`];
    } else if (stance === "cut") {
      kind = "cut";
      const target = weakest && perPromo.length > 1 ? `the ${label(weakest.p)}, the weakest (${weakest.roas.toFixed(2)}x attributed)` : "overall promotion spend";
      action = `Reduce spend: cut ${target}. ${judgedRatio !== null ? `Return is ${ratioText}.` : `Even before fees, attributed ROAS (${metricShown}) is below break-even (${be!.toFixed(2)}x).`}`;
      stop = [`Restore spend if orders fall by more than the spend saved is worth.`];
    } else if (stance === "scale") {
      const target = strongest && perPromo.length > 1 ? `the ${label(strongest.p)} (${strongest.roas.toFixed(2)}x attributed)` : "one promotion";
      const inc = Math.round(THRESHOLDS.maxSuggestedIncrease * 100);
      action = `Increase spend on ${target} by no more than ${inc}%, then review. Return is ${ratioText}.`;
      stop = [`Revert if ${objective === "orders" ? "attributed ROAS" : "True ROAS"} over the test falls below break-even (${be!.toFixed(2)}x).`];
    } else {
      type = "hold";
      if (block) {
        category = !attributionPass || !volumeGatesPass ? "measurement" : "budget";
        if (category === "measurement") type = "tracking_improvement";
        kind = category === "measurement" ? "tracking" : "budget";
        action = `Hold spend where it is. ${block}`;
      } else {
        action = `Hold spend where it is. Return is ${ratioText}, between break-even (${THRESHOLDS.cutBelowRatio.toFixed(2)}x) and the ${THRESHOLDS.scaleAtRatio.toFixed(2)}x line needed to scale.`;
      }
      stop = [`Re-evaluate if ${objective !== "orders" && feesVisible ? "True ROAS" : "attributed ROAS"} falls below break-even${be !== null ? ` (${be.toFixed(2)}x)` : ""}.`];
    }

    const review = reviewPlan(kind, today, ordersPerDay, [
      `About 10 new confirmed orders (${ordersPerDay > 0 ? `roughly ${Math.ceil(10 / ordersPerDay)} days at the current rate` : "no recent order rate to estimate from"})`,
      "No data sync gap longer than 48 hours",
      ...(!attributionPass ? [`Order links above ${pct(THRESHOLDS.minAttributionCoverage)}`] : []),
    ]);
    if (stance === "scale") budgetCap = r2((spend / WINDOW_DAYS) * reviewDaysOf(review, today) * THRESHOLDS.maxSuggestedIncrease);

    // Alternatives: computed from the same numbers, never hard-coded.
    const why = (s: Stance): string => {
      if (block && s !== "hold") return block;
      if (blended && s === "scale") return `Scaling needs real evidence of which ads bring orders. Only ${pct(attributionCoverage)} of net revenue is linked.`;
      if (s === "scale") {
        if (!feesVisible) return "Fees are not visible, so scaling is blocked and no True ROAS figure is claimed.";
        return `Return is ${ratioText ?? "unknown"}, below the ${THRESHOLDS.scaleAtRatio.toFixed(2)}x needed to scale.`;
      }
      if (s === "cut") return `Return is ${ratioText ?? "not known before fees"}, not below break-even (${THRESHOLDS.cutBelowRatio.toFixed(2)}x), so a cut is not called for.`;
      return stance === "cut" ? `Holding keeps spending at a return of ${ratioText ?? "below break-even"}.` : `Return is ${ratioText}, above the ${THRESHOLDS.scaleAtRatio.toFixed(2)}x scaling line, so holding leaves a good return unused.`;
    };
    const names: Record<Stance, string> = {
      scale: `Increase spend by up to ${Math.round(THRESHOLDS.maxSuggestedIncrease * 100)}% on one promotion`,
      hold: "Hold spend where it is",
      cut: "Cut the weakest promotion",
    };
    const alternatives = (["scale", "hold", "cut"] as Stance[]).filter((s) => s !== stance).map((s) => ({ action: names[s], why_not_selected: why(s) }));

    const unknowns = [
      "Revenue links to promotions are partly manual or estimated.",
      ...(unknownCosts.length ? [`Not entered: ${unknownCosts.join(", ")}. These are unknown, not zero, and lower confidence.`] : []),
    ];

    const wwc: string[] = [];
    const roasLabel = blended ? "Blended return" : objective !== "orders" && feesVisible ? "True ROAS" : objective === "orders" ? "Attributed ROAS" : "Attributed ROAS (fees unknown)";
    if (be !== null) wwc.push(`${roasLabel} moving below break-even (${be.toFixed(2)}x, now ${metricShown}) would call for a cut.`);
    if (be !== null && !blended) wwc.push(`Return reaching ${(be * THRESHOLDS.scaleAtRatio).toFixed(2)}x (${THRESHOLDS.scaleAtRatio.toFixed(2)} times break-even) with fees visible would allow a small increase.`);
    if (unknownCosts.length) wwc.push(`Entering ${unknownCosts.join(", ")} would change break-even and return.`);
    if (!attributionPass) {
      wwc.push(`Linking more orders (now ${pct(attributionCoverage)}, ${pct(THRESHOLDS.minAttributionCoverage)} needed) would let the engine judge each promotion and consider scaling.`);
      wwc.push(...CHEAP_TRACKING);
    }
    if (!volumeGatesPass) wwc.push(`Reaching the data minimums: ${failedText(gates.slice(0, 3)).join("; ")}.`);

    const metrics: NonNullable<Recommendation["metrics"]> = [
      { name: "Net revenue", value: money(netRevenue, cur), definition_version: "v4" },
      { name: "Ad spend", value: money(spend, cur), definition_version: "v4" },
      { name: metricName, value: metricShown, definition_version: FORMULA_VERSION },
      ...(objective === "orders" && financials.costPerOrder !== null ? [{ name: "Cost per order", value: money(financials.costPerOrder, cur), definition_version: "v4" }] : []),
      { name: "Attribution coverage", value: pct(attributionCoverage), definition_version: "v4" },
      ...(cm !== null ? [{ name: "Contribution margin", value: `${(cm * 100).toFixed(1)}%`, definition_version: "v4" }] : []),
      ...(be !== null ? [{ name: "Break-even ROAS", value: `${be.toFixed(2)}x`, definition_version: "v4" }] : []),
    ];

    const sufficient = volumeGatesPass && attributionPass && be !== null && feesVisible;
    return {
      ...base, category, mode: volumeGatesPass ? "optimize" : "improve", action,
      primary_action: { type, description: action },
      rationale, unknowns, risk,
      doNotActIf: "A cost you have not entered is large, or the period had an unusual sale or stock problem.",
      nextMeasurement: !attributionPass ? `Pick the cheapest tracking step: ${CHEAP_TRACKING[0].replace(/\.$/, "")}. Then re-check at the review date.` : "Keep linking orders to promotions and re-check return against break-even at the review date.",
      evidence: evidence(),
      evidence_quality: quality(volumeGatesPass ? "optimize" : "improve", sufficient ? "sufficient" : "partial"),
      decisionBasis, metrics, financials, alternatives,
      guardrails: { budget_cap: budgetCap, duration: `${reviewDaysOf(review, today)} days`, stop_conditions: stop },
      what_would_change_the_decision: wwc,
      review_plan: review,
    };
  };

  const hasSignal = leads.length > 0 || sales.length > 0 || spend > 0;
  const trackingRec = (): Recommendation => {
    const noLinks = leads.every((l) => !l.postId && !l.promotionId) && sales.every((s) => !s.postId && !s.promotionId);
    const action = "Link each enquiry and order to the post or promotion that brought it, even if it is your best guess (mark it as estimated).";
    const r = measurement(action,
      [`You have ${leads.length} enquiries and ${sales.length} orders in the last ${WINDOW_DAYS} days, but not enough links to a post or promotion to compare them.`],
      ["Which content or promotion is bringing enquiries and orders."], "improve",
      [{ action: "Assume every order came from your biggest ad channel", why_not_selected: "Unverified credit sends money to the wrong place when it is wrong." }]);
    return { ...r, category: noLinks ? "measurement" : "lead_sales_process", evidence_quality: quality("improve", "partial"), what_would_change_the_decision: [`Linking more orders (now ${pct(attributionCoverage)}, ${pct(THRESHOLDS.minAttributionCoverage)} needed).`] };
  };

  /* ---- route by objective ---- */
  let rec: Recommendation | null = null;
  if (objective === "content_testing") rec = contentRec();
  else if (objective === "awareness") rec = awarenessRec();
  else if (objective === "reduced_waste") rec = wasteRec();
  else if (objective === "qualified_enquiries") rec = enquiryRec();
  else rec = moneyRec();

  // Fallbacks when the objective's own evidence is missing.
  rec ??= moneyRec() ?? enquiryRec() ?? (hasSignal ? trackingRec() : null) ?? contentRec();
  if (rec) return rec;

  return measurement(
    "Add reach and likes for at least two recent posts, and log any enquiries you received.",
    [`There are ${posts.length} post(s) with usable reach in the last ${WINDOW_DAYS} days. Two are needed to compare.`],
    ["Which content performs better."], "explore",
  );
}
