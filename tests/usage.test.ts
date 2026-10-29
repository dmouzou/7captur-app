import { describe, expect, it } from "vitest";
import { periodIds } from "../functions/src/recommendations/usage";
import { PLANS, proPlanForSpend } from "../shared/plans";

describe("pro spend bands", () => {
  it.each([[0, "pro_growth"], [14999, "pro_growth"], [15000, "pro_scale"], [29999, "pro_scale"],
    [30000, "pro_pro"], [49999, "pro_pro"], [50000, "custom"]])("%i -> %s", (spend, plan) => {
    expect(proPlanForSpend(spend)).toBe(plan);
  });
});

describe("plan config", () => {
  it("matches spec prices and free allowance", () => {
    expect(PLANS.free.recommendations.weekly).toBe(3);
    expect([PLANS.starter, PLANS.growth, PLANS.pro_growth, PLANS.pro_scale, PLANS.pro_pro].map((p) => p.priceMonthly))
      .toEqual([9, 39, 59, 79, 119]);
    expect(PLANS.custom.priceMonthlyFrom).toBe(199);
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
  it("Free 3, Starter 10, Growth 25, Pro bands 40/60/100", () => {
    expect([PLANS.free, PLANS.starter, PLANS.growth, PLANS.pro_growth, PLANS.pro_scale, PLANS.pro_pro]
      .map((p) => p.recommendations.weekly)).toEqual([3, 10, 25, 40, 60, 100]);
  });
});
