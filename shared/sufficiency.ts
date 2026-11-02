import type { SuggestedOutcome, SufficiencyResult } from "./decision";
import type { ReadyToReviewItem, TooEarlyItem, NotEnoughDataItem } from "./report";
import { addDays, daysBetween } from "./periods";

export const MIN_DAYS_ELAPSED = 14;
export const MIN_NEW_RECORDS = 3;
export const MAX_STALE_DAYS = 14;

export interface DecisionForReview {
  id: string;
  decision?: string;
  action?: string;
  category?: string;
  status?: string;
  markedToTryDate?: string;
  headline?: string;
  reviewOn: string;
  evidenceUsed?: { windowStart: string; windowEnd: string };
  expectedOutcome?: { metric: string | null; text?: string };
  outcome?: { outcome?: string; result?: string; followThrough?: string } | null;
  outcomeRecordedAt?: string;
  updatedAtDate?: string;
}

export interface ReviewRecords {
  posts: { publishedAt: string }[];
  promotions: { startDate: string; spend: number; currency: string }[];
  leads: { date: string; qualified?: boolean }[];
  sales: { date: string; amount: number; currency: string; status: string; refundAmount?: number }[];
  costs: { date?: string }[];
}

/**
 * Evaluates whether a decision past its reviewOn date has sufficient evidence
 * to prompt the user for an outcome review.
 *
 * Never prompts for a review on a decision that is not ready.
 */
export function checkDecisionSufficiency(
  decision: DecisionForReview,
  today: string,
  records: ReviewRecords,
  currency = "USD"
): SufficiencyResult {
  // 1. If today is before reviewOn, it is too early
  if (today < decision.reviewOn) {
    return {
      status: "too_early",
      readyOn: decision.reviewOn,
      reason: `Review scheduled for ${decision.reviewOn}. Observation window is still running.`,
    };
  }

  // 2. Minimum days elapsed since the decision's evidence window closed (or marked to try date)
  const windowEnd = decision.evidenceUsed?.windowEnd ?? decision.markedToTryDate ?? addDays(decision.reviewOn, -MIN_DAYS_ELAPSED);
  const elapsed = daysBetween(windowEnd, today);
  if (elapsed < MIN_DAYS_ELAPSED) {
    const readyOn = addDays(windowEnd, MIN_DAYS_ELAPSED);
    return {
      status: "too_early",
      readyOn,
      reason: `Only ${elapsed} day${elapsed === 1 ? "" : "s"} elapsed since the decision window (${windowEnd}). Needs at least ${MIN_DAYS_ELAPSED} days.`,
    };
  }

  // 3. Minimum new records in (windowEnd, today]
  const inWindow = (d: string) => d > windowEnd && d <= today;
  const newPosts = records.posts.filter((p) => inWindow(p.publishedAt));
  const newPromos = records.promotions.filter((p) => inWindow(p.startDate));
  const newLeads = records.leads.filter((l) => inWindow(l.date));
  const newSales = records.sales.filter((s) => inWindow(s.date) && s.status !== "refunded");

  const totalNewRecords = newPosts.length + newPromos.length + newLeads.length + newSales.length;
  if (totalNewRecords < MIN_NEW_RECORDS) {
    return {
      status: "not_enough_data",
      whatToAdd: `Add at least ${MIN_NEW_RECORDS - totalNewRecords} more commercial record${MIN_NEW_RECORDS - totalNewRecords === 1 ? "" : "s"} (posts, enquiries or sales) logged after ${windowEnd}.`,
    };
  }

  // 4. Data freshness & consecutive gaps
  const sortedDates = [
    windowEnd,
    ...newPosts.map((p) => p.publishedAt),
    ...newPromos.map((p) => p.startDate),
    ...newLeads.map((l) => l.date),
    ...newSales.map((s) => s.date),
  ].sort();

  for (let i = 0; i < sortedDates.length - 1; i++) {
    const gap = daysBetween(sortedDates[i], sortedDates[i + 1]);
    if (gap > MAX_STALE_DAYS) {
      return {
        status: "not_enough_data",
        whatToAdd: `Data gap detected: ${gap} days with no entries between ${sortedDates[i]} and ${sortedDates[i + 1]}. Log activity during this period to complete the review.`,
      };
    }
  }

  const latestDate = sortedDates[sortedDates.length - 1];
  const daysSinceLatest = daysBetween(latestDate, today);
  if (daysSinceLatest > MAX_STALE_DAYS) {
    return {
      status: "not_enough_data",
      whatToAdd: `Recent data gap: latest entry was ${daysSinceLatest} days ago (${latestDate}). Log your latest activity to close the gap.`,
    };
  }

  const promoSpend = newPromos.filter((p) => p.currency === currency).reduce((sum, p) => sum + p.spend, 0);
  if (promoSpend > 0 && records.costs.length === 0) {
    return {
      status: "not_enough_data",
      whatToAdd: "Promotion spend was recorded without product or operational costs. Enter costs to compute net outcome.",
    };
  }

  // 5. Ready: pre-select suggested outcome from baseline vs new window
  const suggestedOutcome = computeSuggestedOutcome(decision, records, currency, windowEnd, today);
  const prompt = `Review outcome: based on recorded figures since ${windowEnd}, results look ${suggestedOutcome.replace("_", " ")}. Confirm or override.`;

  return {
    status: "ready",
    suggestedOutcome,
    prompt,
  };
}

/** Pre-selects a suggested outcome from new data vs baseline */
export function computeSuggestedOutcome(
  decision: DecisionForReview,
  records: ReviewRecords,
  currency: string,
  newStart: string,
  newEnd: string
): SuggestedOutcome {
  const baseStart = decision.evidenceUsed?.windowStart ?? addDays(newStart, -14);
  const baseEnd = decision.evidenceUsed?.windowEnd ?? newStart;
  const baseDays = Math.max(1, daysBetween(baseStart, baseEnd));
  const newDays = Math.max(1, daysBetween(newStart, newEnd));

  const baseSales = records.sales.filter((s) => s.date >= baseStart && s.date <= baseEnd && s.currency === currency && s.status !== "refunded");
  const newSales = records.sales.filter((s) => s.date > newStart && s.date <= newEnd && s.currency === currency && s.status !== "refunded");

  const baseRev = baseSales.reduce((sum, s) => sum + s.amount, 0);
  const newRev = newSales.reduce((sum, s) => sum + s.amount, 0);

  if (baseRev > 0 || newRev > 0) {
    const baseRevDaily = baseRev / baseDays;
    const newRevDaily = newRev / newDays;
    if (newRevDaily > baseRevDaily * 1.05) return "better";
    if (newRevDaily < baseRevDaily * 0.95) return "worse";
    return "as_expected";
  }

  const baseLeads = records.leads.filter((l) => l.date >= baseStart && l.date <= baseEnd).length;
  const newLeads = records.leads.filter((l) => l.date > newStart && l.date <= newEnd).length;

  if (baseLeads > 0 || newLeads > 0) {
    const baseLeadDaily = baseLeads / baseDays;
    const newLeadDaily = newLeads / newDays;
    if (newLeadDaily > baseLeadDaily * 1.05) return "better";
    if (newLeadDaily < baseLeadDaily * 0.95) return "worse";
    return "as_expected";
  }

  return "as_expected";
}

/** Groups unreviewed decisions into the three groups for the weekly summary */
export function groupDecisionsForReview(
  decisions: DecisionForReview[],
  today: string,
  records: ReviewRecords,
  currency = "USD"
): { ready: ReadyToReviewItem[]; tooEarly: TooEarlyItem[]; notEnoughData: NotEnoughDataItem[] } {
  const ready: ReadyToReviewItem[] = [];
  const tooEarly: TooEarlyItem[] = [];
  const notEnoughData: NotEnoughDataItem[] = [];

  for (const d of decisions) {
    if (d.outcome) continue; // Already reviewed
    const check = checkDecisionSufficiency(d, today, records, currency);
    if (check.status === "ready") {
      ready.push({
        id: d.id,
        action: d.decision ?? d.action ?? "",
        suggestedOutcome: check.suggestedOutcome,
        prompt: check.prompt,
      });
    } else if (check.status === "too_early") {
      tooEarly.push({
        id: d.id,
        action: d.decision ?? d.action ?? "",
        readyOn: check.readyOn,
        reason: check.reason,
      });
    } else {
      notEnoughData.push({
        id: d.id,
        action: d.decision ?? d.action ?? "",
        whatToAdd: check.whatToAdd,
      });
    }
  }

  return { ready, tooEarly, notEnoughData };
}

/**
 * Computes a track record count over the plan's history window.
 * Product copy: records and reviews outcomes.
 * Example: "12 decisions: 7 better, 3 as expected, 2 worse"
 */
export function computeTrackRecord(
  decisions: { outcome?: { outcome?: string; result?: string } | null; reviewOn?: string; updatedAtDate?: string; outcomeRecordedAt?: string }[],
  historyDays: number,
  today: string
): string {
  const cutoff = addDays(today, -historyDays);
  const reviewed = decisions.filter((d) => {
    const oc = d.outcome?.outcome ?? d.outcome?.result;
    if (!oc) return false;
    const date = d.outcomeRecordedAt ?? d.updatedAtDate ?? d.reviewOn;
    return Boolean(date && date >= cutoff);
  });

  const total = reviewed.length;
  if (total === 0) return "No outcomes recorded yet in this period";

  let better = 0;
  let asExpected = 0;
  let worse = 0;

  for (const d of reviewed) {
    const oc = d.outcome?.outcome ?? d.outcome?.result;
    if (oc === "better") better++;
    else if (oc === "as_expected") asExpected++;
    else if (oc === "worse") worse++;
  }

  return `${total} decision${total === 1 ? "" : "s"}: ${better} better, ${asExpected} as expected, ${worse} worse`;
}
