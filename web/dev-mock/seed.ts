// Demo data for the screenshot harness (npm run dev:mock). Never imported by the real app.
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const ts = (n: number) => ({ __ts: Date.now() - n * 86400000 });

export function seed(): Record<string, Record<string, unknown>> {
  const d: Record<string, Record<string, unknown>> = {};
  const uid = "demo-user";
  d[`users/${uid}`] = { email: "mara@studiomara.example", displayName: "Mara Ellis", defaultWorkspaceId: "w1", status: "active", notificationPrefs: { weeklyEmail: true } };
  d["workspaces/w1"] = {
    name: "Studio Mara", ownerUid: uid, plan: "growth", billingStatus: "trialing", trialEndsAt: { __ts: Date.now() + 9 * 86400000 },
    timezone: "Asia/Kolkata", accountTimezone: "Asia/Kolkata", createdAt: ts(5), overLimit: false, country: "IN",
  };
  d["workspaces/w1/reports/2026-W44"] = { weekId: "2026-W44", kind: "update", periodStart: "2026-10-26", periodEnd: "2026-11-01", currency: "USD",
    metrics: { current: { posts: 2, spend: 0, enquiries: 5, qualifiedEnquiries: 2, orders: 3, revenue: 210 }, previous: { posts: 1, spend: 0, enquiries: 3, qualifiedEnquiries: 1, orders: 2, revenue: 120 } },
    changes: ["Enquiries rose from 3 to 5.", "Revenue rose from $120 to $210."], freshness: { latestRecordDate: "2026-11-01", daysSince: 5, stale: false },
    recommendations: { generated: 2, markedToTry: 1, dismissed: 0, outcomesRecorded: 0, awaitingOutcome: [] },
    reviews: { trackRecord: "1 of 2 worked", ready: [{ id: "r1", action: "Post a studio tour reel", suggestedOutcome: "better", prompt: "Enquiries went up after the post. Did it help?" }], tooEarly: [{ id: "r2", action: "Offer a spring bundle", readyOn: "2026-11-10", reason: "Needs 7 days of results." }], notEnoughData: [{ id: "r3", action: "Boost the best post", whatToAdd: "Add what you spent on the boost." }] },
    gaps: ["No costs recorded this week."], nextFocus: "Repeat the studio tour format and log what you spend on it.", engineVersion: "v2" };
  d["workspaces/w1/businesses/b1"] = { name: "Studio Mara", currency: "USD", objective: "more_enquiries", timezone: "Asia/Kolkata", convertCurrencies: true };
  d["workspaces/w1/connections/shopify"] = { provider: "shopify", label: "Shopify", status: "connected", lastSyncedAt: ts(1), businessId: "b1" };
  const usageMonth = new Date().toISOString().slice(0, 7);
  d[`accounts/${uid}/usage/${usageMonth}`] = { aiFollowUps: 3 };
  for (let i = 0; i < 14; i++) {
    d[`workspaces/w1/sales/s${i}`] = { businessId: "b1", date: day(i * 2 + 1), amount: 40 + (i * 17) % 90, currency: "USD", status: "paid", attribution: i % 3 ? "manual_reported" : "unknown", provenance: i % 4 === 0 ? "connected" : "manual", createdAt: ts(i * 2 + 1) };
  }
  for (let i = 0; i < 9; i++) {
    d[`workspaces/w1/leads/l${i}`] = { businessId: "b1", date: day(i * 3), source: i % 2 ? "Instagram" : "Website form", qualified: i % 3 === 0, status: i % 4 === 0 ? "won" : "new", provenance: "manual", createdAt: ts(i * 3) };
  }
  for (let i = 0; i < 6; i++) {
    d[`workspaces/w1/posts/p${i}`] = { businessId: "b1", platform: "instagram", publishedAt: day(i * 4), topic: ["Studio tour", "New spring set", "Behind the scenes"][i % 3], provenance: "manual", createdAt: ts(i * 4) };
  }
  d["workspaces/w1/promotions/pr1"] = { businessId: "b1", platform: "meta", startDate: day(12), endDate: day(5), spend: 180, currency: "USD", objective: "enquiries", provenance: "imported", createdAt: ts(12) };
  d["workspaces/w1/costs/c1"] = { businessId: "b1", category: "fees", name: "Payment fees", kind: "percentage", amount: 2.9, date: day(20), provenance: "manual", createdAt: ts(20) };
  d["workspaces/w1/recommendations/r1"] = {
    workspaceId: "w1", businessId: "b1", status: "generated", createdBy: uid, createdAt: ts(1), engineVersion: "rules-v4",
    category: "content", mode: "improve", objective: "more_enquiries",
    action: "Run a small, time-limited test on the studio tour video, which brought more enquiries per dollar spent. Do not raise the budget yet.",
    rationale: ["In the data entered, the studio tour video produced more enquiries for each dollar of promotion than the comparison post.", "That is an early signal for your goal of more enquiries."],
    unknowns: ["Enquiries are not yet linked to confirmed orders, so we cannot say which post earned more revenue.", "Shipping cost is not entered."],
    risk: "A small sample can mislead. Keep the test short and the budget fixed.",
    doNotActIf: "Enquiries stay flat after five days.",
    nextMeasurement: "Record sales that come from the next five days of enquiries.",
    evidence: { asOf: day(1), windowStart: day(28), windowEnd: day(0), sampleSize: { posts: 6, promotions: 1, leads: 9, sales: 14, costs: 1 }, provenance: { manual: 24, imported: 1, connected: 4 }, missing: ["Shipping cost"], warnings: [] },
    evidence_quality: { mode: "improve", status: "partial", warnings: [], unknownCosts: ["Shipping"], confidence: "medium", gates: [{ key: "days", label: "Days of records", actual: 22, required: 14, passed: true }, { key: "attribution", label: "Sales with a source", actual: 62, required: 70, passed: false }] },
    aiSummary: { text: "The studio tour video brought more enquiries per dollar than your other post. Try it again for a few days at the same budget, then record any sales it leads to.", model: "claude-sonnet-5-5", promptVersion: "explain-v2" },
  };
  d["workspaces/w1/decisions/d1"] = {
    recommendationId: "r1", createdAt: ts(1), response: "pending", executionState: "not_started", outcome: null,
    objective: "More enquiries", question: "Should you put more behind the studio tour video?", evidenceQuality: "partial", queueStatus: "act",
    headline: "Run a short, small test on the studio tour video before spending more.",
    decision: "Boost the studio tour video for five days at your current budget.",
    whyThisOption: ["It had the most enquiries per dollar in the last 28 days.", "A five-day test is cheap and easy to stop."],
    alternatives: [
      { id: "a1", label: "Boost the studio tour video", summary: "Five days, current budget.", expectedBenefit: "More enquiries if the early signal holds.", downside: "A small sample can mislead.", reversible: true, favoured: true },
      { id: "a2", label: "Raise the overall budget", summary: "Spend more across all posts.", reversible: true, favoured: false, whyNot: "The evidence is too thin to justify a larger spend." },
      { id: "a3", label: "Do nothing this week", summary: "Keep recording and decide later.", reversible: true, favoured: false, whyNot: "Costs you a week of learning." },
    ],
    evidenceUsed: { asOf: day(1), windowStart: day(28), windowEnd: day(0), provenance: { manual: 24, imported: 1, connected: 4 }, sampleSize: { posts: 6, promotions: 1, leads: 9, sales: 14, costs: 1 } },
    assumptions: ["Enquiries from the video are comparable to enquiries from other posts."],
    limitations: ["Enquiries are not linked to confirmed orders.", "Shipping cost is not entered."],
    guardrails: { watch: "Enquiries per day on the video.", stopIf: "Enquiries stay flat after five days." },
    nextStep: "Boost the video for five days, then record any sales it leads to.",
    costOfDelay: "A week of learning.", sensitivity: { mostLikelyToChange: "Whether enquiries turn into sales." },
    expectedOutcome: { metric: "enquiries", text: "More enquiries per dollar than your other posts." }, reviewOn: day(-6),
  };
  return d;
}
export const USER = { uid: "demo-user", email: "mara@studiomara.example", displayName: "Mara Ellis", emailVerified: true, providerData: [{ providerId: "google.com" }] };
