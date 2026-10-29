import type { CostRecord, LeadRecord, PostRecord, PromotionRecord, SaleRecord } from "../shared/records";
import type { PeriodMetrics, WeeklyReport } from "../shared/report";
import { addDays, daysBetween } from "./time";

export const REPORT_ENGINE_VERSION = "report-v1";
export const STALE_AFTER_DAYS = 14;

type Id<T> = T & { id: string };
export interface RecSummary { id: string; action: string; status: string; createdDate: string }
export interface RecEvent { type: string; date: string }

export interface ReportInput {
  records: { posts: Id<PostRecord>[]; promotions: Id<PromotionRecord>[]; leads: Id<LeadRecord>[]; sales: Id<SaleRecord>[]; costs: Id<CostRecord>[] };
  recommendations: RecSummary[];
  events: RecEvent[];
  currency: string;
  today: string; // local date the report runs on
  weekId: string;
  statusOnly: boolean;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function periodMetrics(r: ReportInput["records"], currency: string, from: string, to: string): PeriodMetrics {
  const inP = (d: string) => d >= from && d <= to;
  const leads = r.leads.filter((l) => inP(l.date));
  const sales = r.sales.filter((s) => inP(s.date) && s.currency === currency && (s.status === "confirmed" || s.status === "partially_refunded"));
  return {
    posts: r.posts.filter((p) => inP(p.publishedAt)).length,
    spend: sum(r.promotions.filter((p) => inP(p.startDate) && p.currency === currency).map((p) => p.spend)),
    enquiries: leads.length,
    qualifiedEnquiries: leads.filter((l) => l.qualified).length,
    orders: sales.length,
    revenue: sum(sales.map((s) => s.amount - (s.status === "partially_refunded" ? s.refundAmount ?? 0 : 0))),
  };
}

const LABEL: Record<keyof PeriodMetrics, string> = {
  posts: "Posts", spend: "Promotion spend", enquiries: "Enquiries", qualifiedEnquiries: "Qualified enquiries", orders: "Confirmed orders", revenue: "Recorded revenue",
};

/**
 * Deterministic weekly summary. Never creates advice or a new recommendation, never uses
 * recommendation credits, and states only what was recorded. Returns null when nothing changed
 * (unless the customer opted into status-only summaries).
 */
export function buildWeeklyReport(inp: ReportInput): WeeklyReport | null {
  const periodEnd = addDays(inp.today, -1);
  const periodStart = addDays(inp.today, -7);
  const prevEnd = addDays(inp.today, -8);
  const prevStart = addDays(inp.today, -14);
  const cur = periodMetrics(inp.records, inp.currency, periodStart, periodEnd);
  const prev = periodMetrics(inp.records, inp.currency, prevStart, prevEnd);

  const changes: string[] = [];
  for (const k of Object.keys(LABEL) as (keyof PeriodMetrics)[]) {
    if (cur[k] === prev[k]) continue;
    const fmt = (n: number) => (k === "spend" || k === "revenue" ? `${n.toFixed(2)} ${inp.currency}` : String(n));
    changes.push(`${LABEL[k]}: ${fmt(cur[k])}, ${cur[k] > prev[k] ? "up" : "down"} from ${fmt(prev[k])} the week before.`);
  }

  const dates = [
    ...inp.records.posts.map((p) => p.publishedAt), ...inp.records.promotions.map((p) => p.startDate),
    ...inp.records.leads.map((l) => l.date), ...inp.records.sales.map((s) => s.date),
  ].filter((d) => d <= inp.today).sort();
  const latest = dates.length ? dates[dates.length - 1] : null;
  const since = latest ? daysBetween(latest, inp.today) : null;
  const freshness = { latestRecordDate: latest, daysSince: since, stale: since === null || since > STALE_AFTER_DAYS };

  const inWeek = (d: string) => d >= periodStart && d <= periodEnd;
  const evs = inp.events.filter((e) => inWeek(e.date));
  const recs = {
    generated: inp.recommendations.filter((r) => inWeek(r.createdDate)).length,
    markedToTry: evs.filter((e) => e.type === "marked_to_try").length,
    dismissed: evs.filter((e) => e.type === "dismissed").length,
    outcomesRecorded: evs.filter((e) => e.type === "outcome_recorded").length,
    awaitingOutcome: inp.recommendations.filter((r) => r.status === "marked_to_try" || r.status === "completed").slice(0, 3).map((r) => ({ id: r.id, action: r.action })),
  };

  const gaps: string[] = [];
  const spendAny = inp.records.promotions.some((p) => p.currency === inp.currency && p.startDate >= prevStart);
  if (spendAny && inp.records.costs.length === 0) gaps.push("No costs entered, so no spend decisions can be based on returns.");
  if (cur.orders > 0 && inp.records.sales.filter((s) => inWeek(s.date) && !s.postId && !s.promotionId).length === cur.orders) gaps.push("None of this week's orders are linked to a post or promotion.");
  if (cur.posts > 0 && cur.enquiries === 0 && cur.orders === 0) gaps.push("Posts were recorded but no enquiries or orders, so content cannot be tied to results.");
  if (freshness.stale) gaps.push(latest ? `Your latest entry is from ${latest} (${since} days ago), so recent results may be missing.` : "No entries recorded yet.");

  const recActivity = recs.generated + recs.markedToTry + recs.dismissed + recs.outcomesRecorded;
  const hasChange = changes.length > 0 || recActivity > 0;
  if (!hasChange && !inp.statusOnly) return null;

  let nextFocus = "Keep recording posts, enquiries and orders so the next recommendation has more to work with.";
  if (recs.awaitingOutcome.length > 0) nextFocus = `Record how this went: ${recs.awaitingOutcome[0].action}`;
  else if (gaps.length > 0) nextFocus = gaps[0];

  return {
    weekId: inp.weekId, kind: hasChange ? "update" : "status_only", periodStart, periodEnd, currency: inp.currency,
    metrics: { current: cur, previous: prev }, changes, freshness, recommendations: recs, gaps, nextFocus, engineVersion: REPORT_ENGINE_VERSION,
  };
}
