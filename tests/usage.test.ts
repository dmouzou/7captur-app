import { describe, expect, it } from "vitest";
import { periodIds } from "../functions/src/recommendations/usage";
import { PLANS } from "../shared/plans";

describe("plan config", () => {
  it("matches pricing v3 specification", () => {
    expect(PLANS.starter.priceMonthly).toBe(49);
    expect(PLANS.starter.priceAnnualMonthly).toBe(39);
    expect(PLANS.starter.priceAnnual).toBe(468);
    expect(PLANS.starter.trialDays).toBe(14);
    expect(PLANS.starter.maxConnections).toBe(2);
    expect(PLANS.starter.maxBusinesses).toBe(1);
    expect(PLANS.starter.importsPerMonth).toBe(5);
    expect(PLANS.starter.historyDays).toBe(30);
    expect(PLANS.starter.weeklySummary).toBe(false);
    expect(PLANS.starter.prioritySupport).toBe(false);

    expect(PLANS.growth.priceMonthly).toBe(199);
    expect(PLANS.growth.priceAnnualMonthly).toBe(159);
    expect(PLANS.growth.priceAnnual).toBe(1908);
    expect(PLANS.growth.trialDays).toBe(14);
    expect(PLANS.growth.maxConnections).toBe(5);
    expect(PLANS.growth.maxBusinesses).toBe(2);
    expect(PLANS.growth.importsPerMonth).toBe(50);
    expect(PLANS.growth.historyDays).toBe(365);
    expect(PLANS.growth.weeklySummary).toBe(true);
    expect(PLANS.growth.prioritySupport).toBe(true);

    expect(PLANS.custom.trialDays).toBe(14);
    expect(PLANS.custom.prioritySupport).toBe(true);
    expect(PLANS.custom.strategyCall).toBe(true);
  });
});

describe("periodIds", () => {
  it("uses ISO weeks, Monday start, in the workspace timezone", () => {
    // 2026-10-29 is a Thursday in ISO week 44; weekly reset is Monday 2026-11-02.
    const r = periodIds(new Date("2026-10-29T12:00:00Z"), "UTC");
    expect(r.weekId).toBe("2026-W44");
    expect(r.weeklyResetsOn).toBe("2026-11-02");
    expect(r.monthId).toBe("2026-10");
    expect(r.monthlyResetsOn).toBe("2026-11-01");
  });
  it("respects timezone at the week boundary", () => {
    // Sunday 23:30 UTC is already Monday in Kolkata.
    expect(periodIds(new Date("2026-11-01T23:30:00Z"), "UTC").weekId).toBe("2026-W44");
    expect(periodIds(new Date("2026-11-01T23:30:00Z"), "Asia/Kolkata").weekId).toBe("2026-W45");
  });
});

describe("locked weekly allowances", () => {
  it("Starter 3, Growth 30, Custom 999", () => {
    expect([PLANS.starter, PLANS.growth, PLANS.custom].map((p) => p.recommendations.weekly))
      .toEqual([3, 30, 999]);
  });
});
