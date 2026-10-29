import { describe, expect, it } from "vitest";
import { nextWeeklyRun, tzOffsetMinutes, zonedTimeToUtc, addDays, daysBetween } from "../functions/src/reports/time";
import { buildWeeklyReport, type ReportInput } from "../functions/src/reports/buildReport";

describe("time helpers", () => {
  it("offsets incl. half-hour zones and DST", () => {
    expect(tzOffsetMinutes(Date.UTC(2026, 9, 29, 12), "Asia/Kolkata")).toBe(330);
    expect(tzOffsetMinutes(Date.UTC(2026, 6, 1, 12), "America/New_York")).toBe(-240); // EDT
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 15, 12), "America/New_York")).toBe(-300); // EST
  });
  it("zonedTimeToUtc", () => {
    expect(new Date(zonedTimeToUtc(2026, 11, 2, 8, 0, "Asia/Kolkata")).toISOString()).toBe("2026-11-02T02:30:00.000Z");
    expect(new Date(zonedTimeToUtc(2026, 11, 2, 8, 0, "America/New_York")).toISOString()).toBe("2026-11-02T13:00:00.000Z"); // EST after Nov 1
  });
  it("next Monday 08:00 local, strictly in the future", () => {
    // Thu 29 Oct 2026 -> Mon 2 Nov 08:00 IST
    expect(nextWeeklyRun(new Date("2026-10-29T12:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-11-02T02:30:00.000Z");
    // Mon 2 Nov 01:00Z is before 08:00 IST (02:30Z): same day
    expect(nextWeeklyRun(new Date("2026-11-02T01:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-11-02T02:30:00.000Z");
    // Mon after 08:00 local: next week
    expect(nextWeeklyRun(new Date("2026-11-02T03:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-11-09T02:30:00.000Z");
    // DST change in New York on 1 Nov: Monday 2 Nov is EST
    expect(nextWeeklyRun(new Date("2026-10-30T12:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-02T13:00:00.000Z");
  });
  it("date arithmetic", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-29")).toBe(28);
  });
});

const empty = (): ReportInput["records"] => ({ posts: [], promotions: [], leads: [], sales: [], costs: [] });
const base = (o: Partial<ReportInput> = {}): ReportInput => ({
  records: empty(), recommendations: [], events: [], currency: "USD", today: "2026-11-02", weekId: "2026-W44", statusOnly: false, ...o,
});
const lead = (id: string, date: string, o = {}) => ({ id, date, qualified: false, status: "new" as const, ...o });
const sale = (id: string, date: string, amount: number, o = {}) => ({ id, date, amount, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const, ...o });

describe("buildWeeklyReport", () => {
  it("period is the 7 days before today; compares with the week before", () => {
    const r = buildWeeklyReport(base({ records: { ...empty(), leads: [lead("a", "2026-10-27"), lead("b", "2026-10-28"), lead("c", "2026-10-20")] } }))!;
    expect(r.periodStart).toBe("2026-10-26");
    expect(r.periodEnd).toBe("2026-11-01");
    expect(r.metrics.current.enquiries).toBe(2);
    expect(r.metrics.previous.enquiries).toBe(1);
    expect(r.changes).toContain("Enquiries: 2, up from 1 the week before.");
    expect(r.kind).toBe("update");
  });
  it("suppresses a no-change week unless status-only is on", () => {
    expect(buildWeeklyReport(base())).toBeNull();
    const s = buildWeeklyReport(base({ statusOnly: true }))!;
    expect(s.kind).toBe("status_only");
    expect(s.changes).toEqual([]);
  });
  it("same numbers both weeks is not a change", () => {
    const records = { ...empty(), leads: [lead("a", "2026-10-28"), lead("b", "2026-10-21")] };
    expect(buildWeeklyReport(base({ records }))).toBeNull();
  });
  it("revenue counts confirmed orders net of refunds and ignores other currencies", () => {
    const records = { ...empty(), sales: [
      sale("a", "2026-10-28", 100), sale("b", "2026-10-29", 50, { status: "partially_refunded", refundAmount: 20 }),
      sale("c", "2026-10-29", 999, { status: "refunded" }), sale("d", "2026-10-29", 500, { currency: "EUR" }),
    ] };
    const r = buildWeeklyReport(base({ records }))!;
    expect(r.metrics.current.revenue).toBe(130);
    expect(r.metrics.current.orders).toBe(2);
  });
  it("flags stale data and missing costs; never invents advice", () => {
    const records = { ...empty(), promotions: [{ id: "p", platform: "instagram" as const, startDate: "2026-10-27", spend: 10, currency: "USD", objective: "orders" as const }] };
    const r = buildWeeklyReport(base({ records }))!;
    expect(r.gaps.join()).toMatch(/No costs entered/);
    const stale = buildWeeklyReport(base({ statusOnly: true, records: { ...empty(), leads: [lead("a", "2026-09-01")] } }))!;
    expect(stale.freshness.stale).toBe(true);
    expect(stale.gaps.join()).toMatch(/days ago/);
  });
  it("recommendation activity makes a report and sets next focus to the outcome", () => {
    const r = buildWeeklyReport(base({
      recommendations: [{ id: "r1", action: "Repeat the video post", status: "marked_to_try", createdDate: "2026-10-28" }],
      events: [{ type: "marked_to_try", date: "2026-10-29" }],
    }))!;
    expect(r.recommendations).toMatchObject({ generated: 1, markedToTry: 1 });
    expect(r.nextFocus).toBe("Record how this went: Repeat the video post");
  });
});
