import { THRESHOLDS, WINDOW_DAYS, FORMULA_VERSION, CHEAP_TRACKING, pct, money, r2, reviewPlan, reviewDaysOf } from "./shared";
import type { Recommendation } from "../../shared/recommendation";
import type { Ctx } from "./context";

export function moneyRec(c: Ctx): Recommendation | null {
  const { base, cur, objective, excludedPromos, attributedRoas, attributionCoverage, attributionPass, blendedRoas, breakEven, cm, confirmed, confirmedOrders, failedText, feesVisible, financials, gates, keptAttributed, netRevenue, spend, staleSources, trueRoas, unknownCosts, volumeGatesPass, eligible, evidence, label, ordersPerDay, perPromo, quality, today } = c;
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

    const pool = perPromo.filter(eligible);
    const strongest = [...pool].filter((x) => x.revenue > 0).sort((a, b) => b.roas - a.roas)[0];
    const weakest = [...pool].sort((a, b) => a.roas - b.roas)[0];

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
      // Below break-even even before fees. Unlinked revenue may still come from ads, so a cut also needs the blended
      // upper bound (all revenue credited to ads) to be below break-even. With full coverage the two are equal.
      if (blendedRatio !== null && blendedRatio < THRESHOLDS.cutBelowRatio) stance = "cut";
      else block = `Linked orders alone look below break-even, but ${pct(1 - attributionCoverage)} of net revenue is not linked to a promotion and may come from ads, so spend is not cut on this evidence.`;
    } else if (judgedRatio === null) {
      block = "Fees are not visible, so spend cannot be increased and no True ROAS figure is claimed.";
    } else if (objective !== "orders" && judgedRatio < THRESHOLDS.cutBelowRatio) {
      if (blendedRatio !== null && blendedRatio < THRESHOLDS.cutBelowRatio) stance = "cut";
      else block = `True ROAS on linked orders is below break-even, but ${pct(1 - attributionCoverage)} of net revenue is not linked to a promotion and may come from ads, so spend is not cut on this evidence.`;
    } else if (judgedRatio >= THRESHOLDS.scaleAtRatio && feesVisible) {
      stance = "scale";
    } else {
      stance = "hold";
    }
    if (objective === "orders" && stance !== "cut" && !feesVisible && stance === "scale") { stance = "hold"; block = "Fees are not visible, so spend cannot be increased on attributed ROAS alone."; }

    if (stance === "scale" && staleSources.length > 0) {
      stance = "hold";
      block = `${staleSources.join(", ")} has not synced in over 48 hours, so recent sales or spend may be missing. Reconnect or re-sync first.`;
    }
    if (stance === "scale" && excludedPromos > 0) {
      stance = "hold";
      block = `${excludedPromos} promotion record(s) in another currency are left out, so ad spend may be understated and a return above break-even cannot be trusted. Choose how to handle them first.`;
    }
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
      const target = weakest && pool.length > 1 ? `the ${label(weakest.p)}, the weakest (${weakest.roas.toFixed(2)}x attributed)` : "overall promotion spend";
      action = `Reduce spend: cut ${target}. ${judgedRatio !== null ? `Return is ${ratioText}.` : `Even before fees, attributed ROAS (${metricShown}) is below break-even (${be!.toFixed(2)}x).`}`;
      stop = [`Restore spend if orders fall by more than the spend saved is worth.`];
    } else if (stance === "scale") {
      const target = strongest && pool.length > 1 ? `the ${label(strongest.p)} (${strongest.roas.toFixed(2)}x attributed)` : "one promotion";
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

    const sufficient = volumeGatesPass && attributionPass && be !== null && feesVisible && staleSources.length === 0;
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
}

