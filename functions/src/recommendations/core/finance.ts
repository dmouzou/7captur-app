import type { EngineInput } from "./shared";
import { THRESHOLDS, WINDOW_DAYS, daysBetween, sum, r2, r3, pct } from "./shared";
import type { Gate } from "./shared";

/** Costs, attribution, financial figures, hard gates. Pure arithmetic over the normalised records. */
export function computeFinance(input: EngineInput, n: ReturnType<typeof import("./normalize").normalize>) {
  const { today } = input;
  const { start, cur, warnings, posts, leads, promos, sales, costsIn } = n;
  /* ---- costs: frequency, proration, end dates ---- */
  const confirmed = sales.filter((s) => s.status === "confirmed" || s.status === "partially_refunded");
  const refundedFully = sales.filter((s) => s.status === "refunded");
  const counted = [...confirmed, ...refundedFully];
  const grossSales = sum(counted.map((s) => s.amount + s.discountAmount));
  const discounts = sum(counted.map((s) => s.discountAmount));
  const refunds = sum(confirmed.map((s) => (s.status === "partially_refunded" ? s.refundAmount : 0))) + sum(refundedFully.map((s) => s.amount));
  const netRevenue = grossSales - discounts - refunds;
  const spend = sum(promos.map((p) => p.spend));

  /** Net revenue of one order: nothing when fully refunded, the amount less the refund when partly refunded. */
  const netSale = (s: (typeof sales)[number]) => (s.status === "refunded" ? 0 : s.amount - (s.status === "partially_refunded" ? s.refundAmount : 0));
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
    if (c.kind === "percentage") amt = (c.amount / 100) * sum(counted.filter((s) => s.date >= lo && s.date <= hi).map(netSale));
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
  // A sale counts as linked only when its link leads to a promotion that is in the window. A link to an organic post, a
  // deleted promotion or one outside the window proves nothing about ad return. If two promotions promote the same post,
  // the order is split between them.
  const promoIds = new Set(promos.map((p) => p.id));
  const promosOfPost = new Map<string, string[]>();
  for (const p of promos) if (p.postId) promosOfPost.set(p.postId, [...(promosOfPost.get(p.postId) ?? []), p.id]);
  const sharesOf = (s: (typeof sales)[number]): [string, number][] => {
    if (s.promotionId && promoIds.has(s.promotionId)) return [[s.promotionId, 1]];
    const ids = s.postId ? promosOfPost.get(s.postId) : undefined;
    return ids && ids.length ? ids.map((id) => [id, 1 / ids.length] as [string, number]) : [];
  };
  const linked = confirmed.filter((s) => sharesOf(s).length > 0);
  const netOf = (s: (typeof sales)[number]) => s.amount - (s.status === "partially_refunded" ? s.refundAmount : 0);
  const attributedNet = sum(linked.map(netOf));
  const share = netRevenue > 0 ? attributedNet / netRevenue : 0;
  // Coverage must hold by revenue AND by order count, so one large linked order cannot carry the gate.
  const orderShare = confirmed.length > 0 ? linked.length / confirmed.length : 0;
  const attributionCoverage = Math.min(share, orderShare);

  /* ---- financial components ---- */
  // Entered fees count as visible only when they cover most orders. A recurring fee (percentage, per order, monthly) that
  // starts late in the window says nothing about the orders before it. A one-off amount is read as the period's total.
  const recurringFee = (c: (typeof costsIn)[number]) => c.kind === "percentage" || c.scope === "per_order" || c.scope === "per_unit" || c.frequency === "monthly" || c.frequency === "yearly";
  const feeRows = costsIn.filter((c) => c.category === "fees" && c.effectiveDate <= today);
  const feeCovered = counted.filter((s) => feeRows.some((c) => !recurringFee(c) || (c.effectiveDate <= s.date && (!c.endDate || c.endDate >= s.date)))).length;
  const feeCoverage = counted.length > 0 ? feeCovered / counted.length : feeRows.length > 0 ? 1 : 0;
  const feesEntered = known.fees && feeCoverage >= 0.8;
  if (known.fees && !feesEntered && !input.processorConnected) warnings.push(`Payment fees are entered but cover only ${Math.round(feeCoverage * 100)}% of orders (fees must be recurring and start before the orders). They are treated as not visible.`);
  const feesVisible = Boolean(input.processorConnected) || feesEntered;

  // Several percentage rows of one cost category that overlap are added together. That is right for separate fees and
  // wrong for a rate that changed, and the records cannot tell which, so the owner is asked.
  const pctRows = costsIn.filter((c) => c.kind === "percentage" && costActive(c));
  const stacked = new Set<string>();
  for (const a of pctRows) for (const b of pctRows) {
    if (a === b || a.category !== b.category) continue;
    const aEnd = a.endDate ?? today, bEnd = b.endDate ?? today;
    if (a.effectiveDate <= bEnd && b.effectiveDate <= aEnd) stacked.add(a.category);
  }
  if (stacked.size > 0) warnings.push(`More than one percentage ${[...stacked].join(" and ")} entry applies to the same orders, so they are added together. If a rate changed, set an end date on the old entry.`);
  const deductions = total.fees + total.returns + total.disputes;
  const keptAttributed = attributedNet - deductions * share;
  const attributedRoas = spend > 0 && confirmed.length > 0 ? attributedNet / spend : null;
  const trueRoas = feesVisible && attributedRoas !== null ? keptAttributed / spend : null;
  const cogsKnown = known.cogs;
  const cm = cogsKnown && netRevenue > 0 ? (netRevenue - total.cogs - total.shipping) / netRevenue : null;
  const breakEven = cm !== null && cm > 0 ? 1 / cm : null;
  const ratio = trueRoas !== null && breakEven !== null && attributionCoverage >= THRESHOLDS.minAttributionCoverage ? trueRoas / breakEven : null;
  const contributionAfterMarketing = cm === null ? null : netRevenue - total.cogs - total.shipping - deductions - spend;
  const operatingResult = contributionAfterMarketing === null ? null : contributionAfterMarketing - total.other;
  const attributedOrders = linked.length;

  const unknownCosts: string[] = [];
  if (!cogsKnown) unknownCosts.push("cost of goods");
  if (!known.shipping) unknownCosts.push("shipping");
  if (!feesVisible) unknownCosts.push("payment fees");
  if (!known.returns) unknownCosts.push("return costs");
  if (!input.processorConnected && !known.disputes) unknownCosts.push("payment disputes");
  const staleSources = input.staleSources ?? [];
  if (staleSources.length) warnings.push(`${staleSources.join(", ")} has not synced in over 48 hours. Figures may miss recent activity.`);
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

  const missing: string[] = [];
  if (spend === 0) missing.push("promotion spend");
  if (confirmed.length === 0) missing.push("confirmed orders");
  if (!cogsKnown) missing.push("cost of goods");
  if (!feesVisible) missing.push("payment fees (connect Stripe or PayPal, or enter a fee)");
  if (confirmed.length > 0 && spend > 0 && !attributionPass) {
    warnings.push(`Only ${pct(attributionCoverage)} of net revenue is linked to a post or promotion (${pct(THRESHOLDS.minAttributionCoverage)} needed). Attributed ROAS is understated and is not used to cut or scale.`);
  }

  const sampleSize = { posts: posts.length, promotions: promos.length, leads: leads.length, sales: sales.length, costs: costsIn.length };
  return { attributedNet, attributedOrders, attributedRoas, attributionCoverage, attributionPass, blendedRoas, breakEven, cm, cogsKnown, confidence, confirmed, confirmedOrders, contributionAfterMarketing, costActive, counted, deductions, discounts, distinctDays, failedText, feesVisible, financials, gates, grossSales, keptAttributed, known, legacy, linked, linksTooThin, missing, netOf, netRevenue, netSale, operatingResult, orderShare, promoIds, promosOfPost, ratio, refundedFully, refunds, sampleDays, sampleSize, share, sharesOf, spend, spendDays, staleSources, total, trueRoas, unknownCosts, volumeGatesPass,  };
}
