import { describe, expect, it } from "vitest";
import { evaluateHomeBanner, type HomeBannerInput } from "../shared/homeBanner";

describe("evaluateHomeBanner (Section 8 deterministic rules)", () => {
  const baseNow = 1700000000000;
  const freshRecordTime = baseNow - 2 * 24 * 60 * 60 * 1000; // 2 days ago

  const baseInput: HomeBannerInput = {
    totalRecords: 10,
    connections: [],
    staleThresholdDays: 14,
    lastRecordOrSyncMs: freshRecordTime,
    nowMs: baseNow,
    unviewedRecommendationsCount: 0,
  };

  it("Rule 1: triggers 'Add your first data' when totalRecords is 0", () => {
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 0,
      connections: [{ id: "1", provider: "shopify", status: "needs_reconnect" }], // Rule 1 takes precedence
    });
    expect(res.rule).toBe(1);
    expect(res.title).toBe("Add your first data");
    expect(res.ctaRoute).toBe("/add");
  });

  it("Rule 2: triggers 'Reconnect {source}' when a connection has an error or needs reconnect", () => {
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 5,
      connections: [
        { id: "s1", provider: "shopify", label: "My Store", status: "needs_reconnect" },
      ],
    });
    expect(res.rule).toBe(2);
    expect(res.title).toBe("Reconnect My Store");
    expect(res.ctaRoute).toBe("/add/connect");
  });

  it("Rule 2: triggers 'Reconnect {source}' on revoked status", () => {
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 12,
      connections: [
        { id: "g1", provider: "google_ads", label: "Google Ads: 123-456", status: "revoked" },
      ],
    });
    expect(res.rule).toBe(2);
    expect(res.title).toBe("Reconnect Google Ads: 123-456");
  });

  it("Rule 3: triggers 'Refresh your data' when data is older than staleThresholdDays", () => {
    const staleTime = baseNow - 15 * 24 * 60 * 60 * 1000; // 15 days ago > 14 days
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 15,
      lastRecordOrSyncMs: staleTime,
      unviewedRecommendationsCount: 2, // Rule 3 takes precedence over Rule 4
    });
    expect(res.rule).toBe(3);
    expect(res.title).toBe("Refresh your data");
    expect(res.ctaRoute).toBe("/add");
  });

  it("Rule 4: triggers '1 decision waiting' when an unviewed recommendation is ready", () => {
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 20,
      lastRecordOrSyncMs: freshRecordTime,
      unviewedRecommendationsCount: 1,
    });
    expect(res.rule).toBe(4);
    expect(res.title).toBe("1 decision waiting");
    expect(res.ctaRoute).toBe("/decide");
  });

  it("Rule 4: triggers 'N decisions waiting' for multiple unviewed recommendations", () => {
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 20,
      lastRecordOrSyncMs: freshRecordTime,
      unviewedRecommendationsCount: 3,
    });
    expect(res.rule).toBe(4);
    expect(res.title).toBe("3 decisions waiting");
    expect(res.ctaRoute).toBe("/decide");
  });

  it("Rule 5: shows up-to-date status and options when all data is fresh and no decisions waiting", () => {
    const res = evaluateHomeBanner({
      ...baseInput,
      totalRecords: 50,
      lastRecordOrSyncMs: freshRecordTime,
      unviewedRecommendationsCount: 0,
    });
    expect(res.rule).toBe(5);
    expect(res.title).toContain("Data up to date");
    expect(res.ctaRoute).toBe("/decide");
  });
});

