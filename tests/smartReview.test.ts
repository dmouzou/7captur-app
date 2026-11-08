import { describe, expect, it } from "vitest";
import {
  checkDecisionSufficiency,
  computeSuggestedOutcome,
  groupDecisionsForReview,
  computeTrackRecord,
} from "../shared/sufficiency";
import { buildWeeklyReport, type ReportInput } from "../functions/src/reports/buildReport";
import type { DecisionForReview } from "../shared/decision";

describe("Smart Review Sufficiency Checks (Spec 6)", () => {
  const decision: DecisionForReview = {
    id: "dec_1",
    action: "Increase daily ad spend on Instagram",
    category: "paid_ads",
    status: "marked_to_try",
    markedToTryDate: "2026-10-01",
    reviewOn: "2026-10-15",
  };

  const records = {
    posts: [],
    promotions: [],
    leads: [
      { id: "l1", date: "2026-10-03", qualified: true, status: "new" as const },
      { id: "l2", date: "2026-10-08", qualified: true, status: "new" as const },
      { id: "l3", date: "2026-10-12", qualified: true, status: "new" as const },
    ],
    sales: [
      { id: "s1", date: "2026-10-14", amount: 120, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const },
    ],
    costs: [],
  };

  it("returns too_early if fewer than 14 days elapsed since markedToTryDate", () => {
    // Current date is 2026-10-10 (only 9 days elapsed)
    const result = checkDecisionSufficiency(decision, "2026-10-10", records as any, "USD");
    expect(result.status).toBe("too_early");
    expect(result.readyOn).toBe("2026-10-15");
    expect(result.reason).toContain("Review scheduled for 2026-10-15");
  });

  it("returns not_enough_data if 14 days elapsed but fewer than 3 records recorded", () => {
    const scarceRecords = {
      posts: [],
      promotions: [],
      leads: [{ id: "l1", date: "2026-10-05", qualified: true, status: "new" as const }],
      sales: [],
      costs: [],
    };
    // Current date is 2026-10-16 (15 days elapsed)
    const result = checkDecisionSufficiency(decision, "2026-10-16", scarceRecords as any, "USD");
    expect(result.status).toBe("not_enough_data");
    expect(result.whatToAdd).toContain("more commercial record");
  });

  it("returns not_enough_data if data gap exceeds 14 days between consecutive entries", () => {
    const gappedRecords = {
      posts: [],
      promotions: [],
      leads: [
        { id: "l1", date: "2026-10-02", qualified: true, status: "new" as const },
        { id: "l2", date: "2026-10-20", qualified: true, status: "new" as const }, // 18-day gap
        { id: "l3", date: "2026-10-22", qualified: true, status: "new" as const },
      ],
      sales: [],
      costs: [],
    };
    const result = checkDecisionSufficiency(decision, "2026-10-25", gappedRecords as any, "USD");
    expect(result.status).toBe("not_enough_data");
    expect(result.whatToAdd).toMatch(/data gap/i);
  });

  it("returns ready with suggested outcome when all thresholds are satisfied", () => {
    // Current date is 2026-10-16 (15 days elapsed, 4 records, no gaps > 14 days)
    const result = checkDecisionSufficiency(decision, "2026-10-16", records as any, "USD");
    expect(result.status).toBe("ready");
    expect(result.prompt).toContain("Review outcome");
    expect(["better", "as_expected", "worse"]).toContain(result.suggestedOutcome);
  });
});

describe("Outcome Suggestion Logic", () => {
  const dec: DecisionForReview = {
    id: "d_rev",
    action: "Test decision",
    category: "content",
    status: "marked_to_try",
    markedToTryDate: "2026-10-01",
    reviewOn: "2026-10-15",
  };

  it("suggests better when revenue grows after decision", () => {
    const records = {
      posts: [],
      promotions: [],
      leads: [],
      sales: [
        { id: "s1", date: "2026-09-20", amount: 100, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const },
        { id: "s2", date: "2026-10-05", amount: 300, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const },
      ],
      costs: [],
    };
    const outcome = computeSuggestedOutcome(dec, records as any, "USD", "2026-10-01", "2026-10-15");
    expect(outcome).toBe("better");
  });

  it("suggests worse when revenue drops by >15% after decision", () => {
    const records = {
      posts: [],
      promotions: [],
      leads: [],
      sales: [
        { id: "s1", date: "2026-09-20", amount: 500, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const },
        { id: "s2", date: "2026-10-05", amount: 100, currency: "USD", status: "confirmed" as const, attribution: "unknown" as const },
      ],
      costs: [],
    };
    const outcome = computeSuggestedOutcome(dec, records as any, "USD", "2026-10-01", "2026-10-15");
    expect(outcome).toBe("worse");
  });
});

describe("Decision Review Grouping and Unready Decision Invariant", () => {
  const dReady: DecisionForReview = {
    id: "d_ready",
    action: "Ready Decision Action",
    category: "content",
    status: "marked_to_try",
    markedToTryDate: "2026-10-01",
    reviewOn: "2026-10-15",
  };
  const dTooEarly: DecisionForReview = {
    id: "d_too_early",
    action: "Too Early Action",
    category: "pricing",
    status: "marked_to_try",
    markedToTryDate: "2026-10-10",
    reviewOn: "2026-10-24",
  };
  const dNotEnough: DecisionForReview = {
    id: "d_not_enough",
    action: "Not Enough Data Action",
    category: "timing",
    status: "marked_to_try",
    markedToTryDate: "2026-09-15",
    reviewOn: "2026-09-29",
  };

  const records = {
    posts: [
      { id: "p1", publishedAt: "2026-10-02" },
      { id: "p2", publishedAt: "2026-10-06" },
      { id: "p3", publishedAt: "2026-10-12" },
    ],
    promotions: [],
    leads: [],
    sales: [],
    costs: [],
  };

  it("groups decisions into ready, tooEarly, and notEnoughData", () => {
    const grouped = groupDecisionsForReview([dReady, dTooEarly, dNotEnough], "2026-10-18", records as any, "USD");
    expect(grouped.ready.map((r) => r.id)).toEqual(["d_ready"]);
    expect(grouped.tooEarly.map((r) => r.id)).toEqual(["d_too_early"]);
    expect(grouped.tooEarly[0].readyOn).toBe("2026-10-24");
    expect(grouped.notEnoughData.map((r) => r.id)).toEqual(["d_not_enough"]);
    expect(grouped.notEnoughData[0].whatToAdd).toBeDefined();
  });

  it("ensures weekly report nextFocus NEVER prompts for a review on an unready decision", () => {
    const emptyRecords = { posts: [], promotions: [], leads: [], sales: [], costs: [] };
    const inp: ReportInput = {
      records: emptyRecords,
      recommendations: [],
      events: [],
      decisions: [dTooEarly, dNotEnough], // neither is ready
      currency: "USD",
      today: "2026-10-18",
      weekId: "2026-W42",
      statusOnly: true,
    };
    const report = buildWeeklyReport(inp)!;
    expect(report.reviews?.ready).toHaveLength(0);
    // nextFocus must NEVER prompt "Record how this went" for an unready decision!
    expect(report.nextFocus).not.toContain("Record how this went: Too Early Action");
    expect(report.nextFocus).not.toContain("Record how this went: Not Enough Data Action");
  });
});

describe("Track Record Formatting (Spec 6)", () => {
  it("formats track record correctly over history window", () => {
    const decisions: DecisionForReview[] = [
      { id: "1", action: "A1", status: "completed", outcome: { result: "better" }, outcomeRecordedAt: "2026-10-10" },
      { id: "2", action: "A2", status: "completed", outcome: { result: "better" }, outcomeRecordedAt: "2026-10-12" },
      { id: "3", action: "A3", status: "completed", outcome: { result: "better" }, outcomeRecordedAt: "2026-10-14" },
      { id: "4", action: "A4", status: "completed", outcome: { result: "as_expected" }, outcomeRecordedAt: "2026-10-15" },
      { id: "5", action: "A5", status: "completed", outcome: { result: "worse" }, outcomeRecordedAt: "2026-10-16" },
      // Outside 30-day window
      { id: "6", action: "A6", status: "completed", outcome: { result: "better" }, outcomeRecordedAt: "2026-08-01" },
    ];

    const tr30 = computeTrackRecord(decisions, 30, "2026-10-20");
    expect(tr30).toBe("5 decisions: 3 better, 1 as expected, 1 worse");

    const tr365 = computeTrackRecord(decisions, 365, "2026-10-20");
    expect(tr365).toBe("6 decisions: 4 better, 1 as expected, 1 worse");
  });

  it("returns 'No outcomes recorded yet in this period' when empty", () => {
    expect(computeTrackRecord([], 30, "2026-10-20")).toBe("No outcomes recorded yet in this period");
  });
});

describe("Product Copy Invariant", () => {
  it("uses 'records and reviews outcomes' and never 'learns'", () => {
    const fs = require("node:fs");
    const path = require("node:path");

    const decisionCenter = fs.readFileSync(path.resolve(__dirname, "../web/src/features/decisions/DecisionCenter.tsx"), "utf8");
    const reportsPanel = fs.readFileSync(path.resolve(__dirname, "../web/src/features/reports/ReportsPanel.tsx"), "utf8");
    const sufficiency = fs.readFileSync(path.resolve(__dirname, "../shared/sufficiency.ts"), "utf8");

    for (const code of [decisionCenter, reportsPanel, sufficiency]) {
      // Must not contain "learns" as product copy claim
      expect(code).not.toMatch(/\blearns\b/i);
      expect(code).toMatch(/records and reviews outcomes/i);
    }
  });
});

describe("REVIEW-01: suggested outcome compares return after spend", () => {
  const dec = { id: "d", reviewOn: "2026-10-15", evidenceUsed: { windowStart: "2026-09-01", windowEnd: "2026-09-15" } } as never;
  const mk = (baseSpend: number, newSpend: number) => ({
    posts: [], leads: [], costs: [],
    promotions: [
      { startDate: "2026-09-05", spend: baseSpend, currency: "USD" },
      { startDate: "2026-09-25", spend: newSpend, currency: "USD" },
    ],
    sales: [
      { date: "2026-09-05", amount: 1000, currency: "USD", status: "confirmed" },
      { date: "2026-09-25", amount: 1200, currency: "USD", status: "confirmed" },
    ],
  });
  it("more revenue bought with more spend is worse, not better", () => {
    expect(computeSuggestedOutcome(dec, mk(100, 600) as never, "USD", "2026-09-15", "2026-09-29")).toBe("worse");
  });
  it("more revenue at the same spend is better", () => {
    expect(computeSuggestedOutcome(dec, mk(100, 100) as never, "USD", "2026-09-15", "2026-09-29")).toBe("better");
  });
});
