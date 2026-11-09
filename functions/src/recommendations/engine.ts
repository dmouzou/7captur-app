import type { Recommendation } from "../shared/recommendation";
import { WINDOW_DAYS, type EngineInput } from "./core/shared";
import { buildContext } from "./core/context";
import { contentRec, enquiryRec, awarenessRec, wasteRec, trackingRec } from "./core/objectives";
import { moneyRec } from "./core/money";

export { ENGINE_VERSION, FORMULA_VERSION, WINDOW_DAYS, THRESHOLDS, addDays, reviewPlan } from "./core/shared";
export type { EngineInput } from "./core/shared";

/**
 * Deterministic recommendation engine (rules-v4). Stages, each a pure function:
 *   normalize (window, currency, dedupe) -> finance (costs, attribution, gates) -> context (builders)
 *   -> one rule per objective (objectives.ts, money.ts) -> fallbacks.
 */
export function runEngine(input: EngineInput): Recommendation {
  const c = buildContext(input);
  const { objective, totalRecords, measurement, evidence, leads, sales, spend, posts } = c;

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

  let rec: Recommendation | null = null;
  if (objective === "content_testing") rec = contentRec(c);
  else if (objective === "awareness") rec = awarenessRec(c);
  else if (objective === "reduced_waste") rec = wasteRec(c);
  else if (objective === "qualified_enquiries") rec = enquiryRec(c);
  else rec = moneyRec(c);

  // Fallbacks when the objective's own evidence is missing. A non-money objective never falls into spend advice.
  const moneyObjective = objective === "orders" || objective === "profitability";
  if (!rec && !moneyObjective) {
    const ask: Record<string, [string, string]> = {
      awareness: ["Record reach for each promotion, next to its spend.", "Awareness is judged on cost per 1,000 people reached, and no promotion has reach recorded."],
      qualified_enquiries: ["Record each enquiry with the promotion that brought it, and mark which ones are qualified.", "Qualified-enquiry goals are judged on cost per qualified enquiry, and no promotion has linked enquiries."],
      reduced_waste: ["Record spend per promotion, and link the orders or enquiries each one brought.", "Reducing waste needs at least two promotions with enough linked orders or enquiries to compare."],
      content_testing: ["Add reach and likes for at least two recent posts.", "Content testing compares engagement per reach, and fewer than two posts have reach recorded."],
    };
    const [a, why] = ask[objective] ?? ask.content_testing;
    return { ...measurement(a, [why], ["Which option is working, because the data for your goal is not there yet."], "explore"), evidence: evidence() };
  }
  const hasSignal = leads.length > 0 || sales.length > 0 || spend > 0;
  rec ??= moneyRec(c) ?? enquiryRec(c) ?? (hasSignal ? trackingRec(c) : null) ?? contentRec(c);
  if (rec) return rec;

  return measurement(
    "Add reach and likes for at least two recent posts, and log any enquiries you received.",
    [`There are ${posts.length} post(s) with usable reach in the last ${WINDOW_DAYS} days. Two are needed to compare.`],
    ["Which content performs better."], "explore",
  );
}
