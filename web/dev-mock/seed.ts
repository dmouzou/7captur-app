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
  return d;
}
export const USER = { uid: "demo-user", email: "mara@studiomara.example", displayName: "Mara Ellis", emailVerified: true, providerData: [{ providerId: "google.com" }] };
