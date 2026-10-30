import { describe, expect, it } from "vitest";
import { mapCampaignDay, promotionDocId, windowFor, SPEND_QUERY } from "../functions/src/integrations/googleads/spend";

const row = (over: object = {}) => ({ campaign: { id: "9", name: "Brand" }, segments: { date: "2026-10-28" }, metrics: { costMicros: "12345678", impressions: "1000", clicks: "40" }, ...over });

describe("Google Ads mapping", () => {
  it("converts micros to currency units, one record per campaign per day", () => {
    const m = mapCampaignDay(row(), "123", "usd")!;
    expect(m.id).toBe("gads_123_9_2026-10-28");
    expect(m.synced).toEqual({ startDate: "2026-10-28", endDate: "2026-10-28", spend: 12.35, currency: "USD", impressions: 1000, clicks: 40 });
    expect(promotionDocId("123", "9", "2026-10-28")).toBe(m.id);
  });
  it("skips rows with no spend and no activity, keeps zero-spend rows with impressions", () => {
    expect(mapCampaignDay(row({ metrics: {} }), "1", "USD")).toBeNull();
    expect(mapCampaignDay(row({ metrics: { costMicros: "0", impressions: "5" } }), "1", "USD")?.synced.spend).toBe(0);
  });
  it("rejects invalid spend", () => expect(mapCampaignDay(row({ metrics: { costMicros: "abc" } }), "1", "USD")).toBeNull());
});

describe("sync window", () => {
  it("first sync reads 60 days, later syncs re-read the last 7 days", () => {
    expect(windowFor(null, "2026-10-30")).toEqual({ from: "2026-08-31", to: "2026-10-30" });
    expect(windowFor("2026-10-30", "2026-10-30")).toEqual({ from: "2026-10-23", to: "2026-10-30" });
  });
  it("query embeds only validated dates", () => expect(SPEND_QUERY("2026-10-01", "2026-10-30")).toContain("BETWEEN '2026-10-01' AND '2026-10-30'"));
});
