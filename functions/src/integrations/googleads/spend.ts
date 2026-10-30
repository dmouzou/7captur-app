/** Pure mapping from Google Ads campaign/day rows to promotion records. Spend only; no conversion value (platform revenue claims are kept out of evidence). */
export interface CampaignDayRow {
  campaign: { id: string; name?: string };
  segments: { date: string };
  metrics: { costMicros?: string | number; impressions?: string | number; clicks?: string | number };
}
export interface MappedPromotion {
  id: string;
  synced: { startDate: string; endDate: string; spend: number; currency: string; impressions: number; clicks: number };
  campaignName: string;
}

export const promotionDocId = (customerId: string, campaignId: string, date: string) => `gads_${customerId}_${campaignId}_${date}`;

/** cost_micros / 1,000,000 in the account's own currency. Rows with no spend and no activity are skipped. */
export function mapCampaignDay(r: CampaignDayRow, customerId: string, currency: string): MappedPromotion | null {
  const spend = Number(r.metrics.costMicros ?? 0) / 1e6;
  const impressions = Number(r.metrics.impressions ?? 0), clicks = Number(r.metrics.clicks ?? 0);
  if (!Number.isFinite(spend) || spend < 0) return null;
  if (spend === 0 && impressions === 0 && clicks === 0) return null;
  return {
    id: promotionDocId(customerId, r.campaign.id, r.segments.date),
    synced: { startDate: r.segments.date, endDate: r.segments.date, spend: Math.round(spend * 100) / 100, currency: currency.toUpperCase(), impressions, clicks },
    campaignName: (r.campaign.name ?? "").slice(0, 120),
  };
}

export const SPEND_QUERY = (from: string, to: string) =>
  `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export function windowFor(lastSyncedDate: string | null, today: string, initialDays = 60, overlapDays = 7): { from: string; to: string } {
  const d = (s: string, back: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() - back * 86400000).toISOString().slice(0, 10);
  if (!isDate(today)) throw new Error("bad date");
  return { from: d(lastSyncedDate && isDate(lastSyncedDate) ? lastSyncedDate : today, lastSyncedDate ? overlapDays : initialDays), to: today };
}
