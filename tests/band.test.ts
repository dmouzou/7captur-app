import { describe, expect, it } from "vitest";
import { decideBandChange } from "../functions/src/billing/band";

describe("decideBandChange", () => {
  it("ignores non-Pro plans", () => expect(decideBandChange("growth", 40000, null)).toEqual({ action: "none" }));
  it("keeps the band when spend matches", () => expect(decideBandChange("pro_growth", 1000, null)).toEqual({ action: "none" }));
  it("schedules a higher band", () => expect(decideBandChange("pro_growth", 20000, null)).toEqual({ action: "schedule", to: "pro_scale" }));
  it("does not reschedule the same target", () => expect(decideBandChange("pro_growth", 20000, "pro_scale")).toEqual({ action: "none" }));
  it("clears a pending change when spend returns to the current band", () => expect(decideBandChange("pro_growth", 1000, "pro_scale")).toEqual({ action: "clear" }));
  it("suggests Custom at $50k+", () => expect(decideBandChange("pro_pro", 50000, null)).toEqual({ action: "suggest_custom" }));
});
