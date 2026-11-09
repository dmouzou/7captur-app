import type { EngineInput } from "./shared";
import { THRESHOLDS, ENGINE_VERSION, WINDOW_DAYS, sum, r3, reviewPlan } from "./shared";
import type { Alt } from "./shared";
import type { Recommendation } from "../../shared/recommendation";
import { normalize } from "./normalize";
import { computeFinance } from "./finance";

/** Everything the rules need, computed once: figures, gates, per-promotion view and the shared builders. */
export function buildContext(input: EngineInput) {
  const { business, today } = input;
  const n = normalize(input);
  const f = computeFinance(input, n);
  const { start, cur, warnings, posts, leads, promos, sales, prov, excluded, excludedBy, fxRatesUsed, convertedRecords, attributionCoverage, confidence, confirmedOrders, financials, gates, linked, missing, netOf, sampleDays, sampleSize, sharesOf, spendDays, unknownCosts } = { ...n, ...f };
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
    const mine = linked.flatMap((s) => sharesOf(s).filter(([id]) => id === p.id).map(([, w]) => ({ s, w })));
    const revenue = sum(mine.map((m) => netOf(m.s) * m.w));
    const orderCount = sum(mine.map((m) => m.w));
    const enquiries = leads.filter((l) => l.promotionId === p.id);
    const qualified = enquiries.filter((l) => l.qualified).length;
    return {
      p, revenue, orders: orderCount, roas: revenue / p.spend, enquiries: enquiries.length, qualified,
      cpe: enquiries.length ? p.spend / enquiries.length : null,
      cpq: qualified ? p.spend / qualified : null,
      reach: p.reach ?? 0,
    };
  });
  // A promotion can be named best or worst only with enough evidence behind it.
  const anyPromoOrders = perPromo.some((x) => x.orders > 0);
  const eligible = (x: (typeof perPromo)[number]) => (anyPromoOrders ? x.orders : x.enquiries) >= THRESHOLDS.minOrdersPerPromotion;
  const label = (p: { platform: string; startDate: string }) => `${p.platform} promotion from ${p.startDate}`;

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
  return { input, business, today, ...n, ...f, anyPromoOrders, base, eligible, evidence, label, measurement, ordersPerDay, perPromo, quality, roasMissing, totalRecords };
}
export type Ctx = ReturnType<typeof buildContext>;
