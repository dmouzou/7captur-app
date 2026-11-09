import { THRESHOLDS, WINDOW_DAYS, pct, money, r2, reviewPlan } from "./shared";
import type { Recommendation } from "../../shared/recommendation";
import type { Ctx } from "./context";

export function contentRec(c: Ctx): Recommendation | null {
  const { base, missing, objective, posts, evidence, ordersPerDay, quality, today } = c;
  const rated = posts.filter((p) => (p.reach ?? 0) > 0)
    .map((p) => ({ p, rate: ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / (p.reach as number) }))
    .sort((a, b) => b.rate - a.rate);
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
}

export function enquiryRec(c: Ctx): Recommendation | null {
  const { base, cur, objective, sales, financials, evidence, label, ordersPerDay, perPromo, quality, today } = c;
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
}

export function awarenessRec(c: Ctx): Recommendation | null {
  const { base, cur, objective, evidence, label, ordersPerDay, perPromo, quality, today } = c;
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
}

export function wasteRec(c: Ctx): Recommendation | null {
  const { roasMissing, base, cur, objective, financials, sampleDays, spendDays, anyPromoOrders, eligible, evidence, label, ordersPerDay, perPromo, quality, today } = c;
    const pool = perPromo.filter(eligible);
    if (pool.length < 2) return null;
    const byOrders = anyPromoOrders;
    const score = (x: (typeof perPromo)[number]) => (byOrders ? x.roas : x.enquiries / x.p.spend);
    const sorted = [...pool].sort((a, b) => score(a) - score(b));
    const weakest = sorted[0], strongest = sorted[sorted.length - 1];
    const gatesOk = sampleDays >= THRESHOLDS.minDaysWithRecords && spendDays >= THRESHOLDS.minDaysWithSpend;
    const weakText = byOrders ? `${Math.round(weakest.orders)} linked order(s), ${money(weakest.revenue, cur)} attributed on ${money(weakest.p.spend, cur)} spend` : `${weakest.enquiries} enquiries on ${money(weakest.p.spend, cur)} spend`;
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
}

export function trackingRec(c: Ctx): Recommendation {
  const { leads, sales, attributionCoverage, measurement, quality } = c;
    const noLinks = leads.every((l) => !l.postId && !l.promotionId) && sales.every((s) => !s.postId && !s.promotionId);
    const action = "Link each enquiry and order to the post or promotion that brought it, even if it is your best guess (mark it as estimated).";
    const r = measurement(action,
      [`You have ${leads.length} enquiries and ${sales.length} orders in the last ${WINDOW_DAYS} days, but not enough links to a post or promotion to compare them.`],
      ["Which content or promotion is bringing enquiries and orders."], "improve",
      [{ action: "Assume every order came from your biggest ad channel", why_not_selected: "Unverified credit sends money to the wrong place when it is wrong." }]);
    return { ...r, category: noLinks ? "measurement" : "lead_sales_process", evidence_quality: quality("improve", "partial"), what_would_change_the_decision: [`Linking more orders (now ${pct(attributionCoverage)}, ${pct(THRESHOLDS.minAttributionCoverage)} needed).`] };
}

