/**
 * Plain, deterministic data health and evidence level. The same rules the Understand screen shows,
 * kept here so the assistant answers from the same numbers. No AI, no estimates.
 */
export const STALE_DAYS = 14;

export interface HealthInput {
  sales: { date?: string; provenance?: string; currency?: string; attribution?: string }[];
  promotions: { startDate?: string; platform?: string; currency?: string; objective?: string }[];
  leads: { date?: string; source?: string }[];
  costs: { effectiveDate?: string; category?: string }[];
  posts: { publishedAt?: string; platform?: string }[];
}

export type EvidenceLevel = "Explore" | "Improve" | "Optimize";

export interface DataHealth {
  totalRecords: number;
  counts: { sales: number; promotions: number; leads: number; costs: number; posts: number };
  newestDate: string | null;
  oldestDate: string | null;
  freshnessDays: number | null;
  isStale: boolean;
  sources: string[];
  currencies: string[];
  salesWithoutAttribution: number;
  promotionsWithoutObjective: number;
  leadsWithoutSource: number;
  evidenceLevel: EvidenceLevel;
  nextLevelUnlock: string;
}

export function computeDataHealth(input: HealthInput, nowMs: number): DataHealth {
  const dates: string[] = [];
  const sources = new Set<string>();
  const currencies = new Set<string>();
  let salesNoAttr = 0, promosNoObj = 0, leadsNoSource = 0;

  for (const s of input.sales) {
    if (s.date) dates.push(s.date);
    if (s.provenance) sources.add(s.provenance);
    if (s.currency) currencies.add(s.currency);
    if (!s.attribution || s.attribution === "unknown") salesNoAttr++;
  }
  for (const p of input.promotions) {
    if (p.startDate) dates.push(p.startDate);
    if (p.platform) sources.add(p.platform);
    if (p.currency) currencies.add(p.currency);
    if (!p.objective) promosNoObj++;
  }
  for (const l of input.leads) {
    if (l.date) dates.push(l.date);
    if (l.source) sources.add(l.source); else leadsNoSource++;
  }
  for (const c of input.costs) { if (c.effectiveDate) dates.push(c.effectiveDate); if (c.category) sources.add(c.category); }
  for (const p of input.posts) { if (p.publishedAt) dates.push(p.publishedAt); if (p.platform) sources.add(p.platform); }

  dates.sort();
  const newest = dates[dates.length - 1] ?? null;
  let freshnessDays: number | null = null;
  let isStale = false;
  if (newest) {
    const ms = Date.parse(newest);
    if (!Number.isNaN(ms)) {
      freshnessDays = Math.max(0, Math.floor((nowMs - ms) / 86400000));
      isStale = freshnessDays > STALE_DAYS;
    }
  }

  const counts = { sales: input.sales.length, promotions: input.promotions.length, leads: input.leads.length, costs: input.costs.length, posts: input.posts.length };
  const totalRecords = counts.sales + counts.promotions + counts.leads + counts.costs + counts.posts;

  let evidenceLevel: EvidenceLevel = "Explore";
  let nextLevelUnlock = "Record at least 20 items from the last 14 days to reach Improve.";
  if (totalRecords >= 20 && freshnessDays !== null && freshnessDays <= STALE_DAYS) {
    if (sources.has("connected") || totalRecords >= 50) {
      evidenceLevel = "Optimize";
      nextLevelUnlock = "You are at the top level. Keep your numbers fresh to stay there.";
    } else {
      evidenceLevel = "Improve";
      nextLevelUnlock = "Connect a store or add 50 or more records to reach Optimize.";
    }
  }

  return {
    totalRecords, counts, newestDate: newest, oldestDate: dates[0] ?? null, freshnessDays, isStale,
    sources: [...sources].sort(), currencies: [...currencies].sort(),
    salesWithoutAttribution: salesNoAttr, promotionsWithoutObjective: promosNoObj, leadsWithoutSource: leadsNoSource,
    evidenceLevel, nextLevelUnlock,
  };
}
