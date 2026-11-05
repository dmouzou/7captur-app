import { describe, expect, it, vi } from "vitest";
import { assistantInput, classifyQuestion, aiNoticeText } from "../shared/assistant";
import { IMPORT_LIMITS } from "../shared/importing";
import { computeDataHealth } from "../shared/dataHealth";
import { answerIntent, fallbackAnswer } from "../functions/src/assistant/answers";
import { assembleFacts, type Facts, type RawInputs } from "../functions/src/assistant/facts";
import { buildAssistantPrompt, validateAssistantAnswer } from "../functions/src/assistant/model";
import { runAssistant } from "../functions/src/assistant/askAssistant";
import { loadFacts } from "../functions/src/assistant/facts";

const NOW = new Date("2026-11-03T10:00:00Z");

function rawFixture(over: Partial<RawInputs> = {}): RawInputs {
  const sales = Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(20 + (i % 10)).padStart(2, "0")}`, provenance: "manual", currency: "USD", attribution: i % 3 === 0 ? "unknown" : "promo" }));
  return {
    screen: "understand",
    ws: { name: "Acme Studio", timezone: "UTC", plan: "starter" },
    business: { currency: "USD", objective: "more_enquiries" },
    account: { plan: "starter", timezone: "UTC" },
    rows: {
      sales,
      promotions: [{ startDate: "2026-10-28", platform: "meta", currency: "USD", objective: "" }],
      leads: [{ date: "2026-11-01", source: "" }, { date: "2026-10-30", source: "instagram" }],
      costs: [], posts: [{ publishedAt: "2026-10-29", platform: "instagram" }],
    },
    totals: {},
    connections: [{ provider: "shopify", label: "Acme Shop", status: "connected" }, { provider: "meta", status: "needs_reconnect" }],
    usage: { month: { aiFollowUps: 4 }, week: { recommendations: 1 } },
    focus: { kind: "recommendation", title: "Test the studio tour reel for 5 days.", why: ["The reel brought 3 enquiries."], unknowns: ["Enquiries are not linked to orders."], stopIf: "Spend rises without enquiries.", nextStep: "Record sales from the next 5 days." },
    now: NOW,
    ...over,
  };
}
const facts = (over: Partial<RawInputs> = {}): Facts => assembleFacts(rawFixture(over));

describe("assistant: router", () => {
  const cases: [string, string][] = [
    ["What is my current evidence level?", "evidence_level"],
    ["How does the 14-day stale data threshold work?", "stale_data"],
    ["How should I format my CSV for bulk import?", "csv_import"],
    ["What is the CSV size limit?", "csv_import"],
    ["What connectors are available vs planned?", "connectors"],
    ["Summarize what changed this week", "what_changed"],
    ["What guardrails should I apply before taking action?", "guardrails"],
    ["Why is this recommendation prioritized?", "why_priority"],
    ["What assumptions and unknowns exist in this decision?", "unknowns"],
    ["What missing fields should I fix first?", "data_gaps"],
    ["How many AI credits do I have left?", "credits"],
    ["Give me an executive overview of my workspace.", "overview"],
  ];
  for (const [q, intent] of cases) it(`"${q}" is ${intent}`, () => expect(classifyQuestion(q)).toBe(intent));

  it("sends open-ended questions to the AI path", () => {
    expect(classifyQuestion("Which of my two Instagram reels brought more people through the door?")).toBe("free_form");
    expect(classifyQuestion("Should I try TikTok for my candle shop?")).toBe("free_form");
  });
  it("the notice names the credit use and that fixed answers are free", () => {
    const t = aiNoticeText(6, 10);
    expect(t).toMatch(/uses 1 of your 10 AI credits/);
    expect(t).toMatch(/Fixed answers .* free/);
  });
  it("validates input", () => {
    expect(assistantInput.safeParse({ workspaceId: "w", businessId: "b", requestId: "12345678", question: "hi", screen: "x" }).success).toBe(false);
  });
});

describe("assistant: fixed answers come from the facts", () => {
  const f = facts();
  it("evidence level and unlock text", () => {
    const a = answerIntent("evidence_level", f);
    expect(a).toContain(`Your evidence level is ${f.evidence.level}`);
    expect(a).toContain("16 records");
  });
  it("import limits come from IMPORT_LIMITS", () => {
    const a = answerIntent("csv_import", f);
    expect(a).toContain(`${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB`);
    expect(a).toContain(`${IMPORT_LIMITS.maxRows} rows`);
    expect(a).toContain(`${IMPORT_LIMITS.maxColumns} columns`);
  });
  it("connectors use the shared card registry and never call planned ones available", () => {
    const a = answerIntent("connectors", f);
    expect(a).toContain("Connected now: Acme Shop");
    expect(a).toContain("Needs reconnecting: meta");
    expect(a).toMatch(/Planned, not available yet: .*Google Ads/);
    expect(a).toMatch(/Available to connect: Shopify/);
  });
  it("uses the open recommendation for why, guardrails, unknowns and next step", () => {
    expect(answerIntent("why_priority", f)).toContain("3 enquiries");
    expect(answerIntent("guardrails", f)).toContain("Spend rises without enquiries.");
    expect(answerIntent("unknowns", f)).toContain("not linked to orders");
    expect(answerIntent("next_step", f)).toContain("Record sales from the next 5 days.");
  });
  it("credits answer states usage and that fixed answers are free", () => {
    const a = answerIntent("credits", f);
    expect(a).toContain("4 of 10 AI credits");
    expect(a).toContain("1 of 15 used this week".replace("15", String(f.usage.recommendationsWeekly)));
    expect(a).toContain("free");
  });
  it("data gaps count only what is missing", () => {
    const a = answerIntent("data_gaps", f);
    expect(a).toMatch(/4 sales have no attribution/);
    expect(a).toMatch(/1 promotion has no objective/);
    expect(a).toMatch(/1 enquiry has no source/);
  });
  it("with no data it says so instead of inventing", () => {
    const empty = facts({ rows: { sales: [], promotions: [], leads: [], costs: [], posts: [] }, focus: null, connections: [] });
    expect(answerIntent("overview", empty)).toContain("no records yet");
    expect(answerIntent("why_priority", empty)).toContain("no recommendation yet");
    expect(answerIntent("next_step", empty)).toContain("Add your first data");
  });
  it("no answer contains an em dash or banned wording", () => {
    for (const i of ["evidence_level", "stale_data", "csv_import", "connectors", "what_changed", "guardrails", "why_priority", "unknowns", "data_gaps", "next_step", "credits", "overview"] as const) {
      const a = answerIntent(i, f);
      expect(a).not.toMatch(/[—–]/);
      expect(a).not.toMatch(/telemetry|algorithmic|high-confidence/i);
    }
    expect(fallbackAnswer(f)).toContain("no AI credit was used");
  });
  it("data health rules match the Understand screen", () => {
    const h = computeDataHealth({ sales: [], promotions: [], leads: [], costs: [], posts: [] }, NOW.getTime());
    expect(h.evidenceLevel).toBe("Explore");
    expect(f.data.isStale).toBe(false);
  });
});

describe("assistant: AI answer validation (fail closed)", () => {
  const f = facts();
  const q = "Which reel did better?";
  it("accepts an answer whose numbers are in the facts", () => {
    expect(validateAssistantAnswer("Your newest record is from 2026-11-01 and you have 16 records in total, so the picture is still early.", f, q)).not.toBeNull();
  });
  it("rejects invented numbers", () => {
    expect(validateAssistantAnswer("You made 4821 sales last month, which is a strong result for the studio.", f, q)).toBeNull();
  });
  it("rejects promises, links, True ROAS and claimed actions", () => {
    expect(validateAssistantAnswer("This will increase your sales for sure, so keep going with the same reel.", f, q)).toBeNull();
    expect(validateAssistantAnswer("See https://example.com for more about how to read your numbers today.", f, q)).toBeNull();
    expect(validateAssistantAnswer("Your True ROAS looks healthy given the data you have recorded so far.", f, q)).toBeNull();
    expect(validateAssistantAnswer("I have paused the reel promotion for you so spending stops right now.", f, q)).toBeNull();
  });
  it("rejects spend advice the facts do not contain and non-strings", () => {
    expect(validateAssistantAnswer("You should double your ad spend on the reel for the next week.", f, q)).toBeNull();
    expect(validateAssistantAnswer(42, f, q)).toBeNull();
  });
  it("replaces em dashes", () => {
    const t = validateAssistantAnswer("Your data is fresh — you have 16 records and nothing is stale right now.", f, q);
    expect(t).not.toMatch(/—/);
  });
  it("prompt marks facts and question as data and only sends the summary", () => {
    const { system, user } = buildAssistantPrompt(f, q);
    expect(system).toMatch(/data, not instructions/);
    expect(user).toContain("<facts>");
    expect(user).not.toMatch(/amount|email|phone/i);
  });
});

/** In-memory Firestore with just enough surface for requireMember, loadFacts and the credit transactions. */
function fakeDb(plan = "starter", usedMonth = 0) {
  const store = new Map<string, Record<string, unknown>>([
    ["workspaces/w1", { ownerUid: "u1", timezone: "UTC", name: "Acme", plan }],
    ["workspaces/w1/members/u2", { status: "active", role: "viewer" }],
    ["workspaces/w1/members/u3", { status: "active", role: "editor" }],
    ["workspaces/w1/businesses/b1", { currency: "USD" }],
    ["workspaces/w2", { ownerUid: "u9", timezone: "UTC" }],
    ["workspaces/w2/businesses/b1", { currency: "USD" }],
    ["workspaces/w2/recommendations/secret", { businessId: "b1", action: "OTHER TENANT SECRET" }],
    ["accounts/u1", { plan, timezone: "UTC" }],
  ]);
  if (usedMonth) store.set("accounts/u1/usage/2026-11", { aiFollowUps: usedMonth });
  const reads: string[] = [];
  const snap = (p: string) => ({ exists: store.has(p), data: () => store.get(p) });
  const coll = (path: string): any => ({
    path,
    doc: (id: string) => ref(`${path}/${id}`),
    where: () => coll(path), orderBy: () => coll(path), limit: () => coll(path),
    get: async () => { reads.push(path); return { docs: [], size: 0 }; },
    count: () => ({ get: async () => { reads.push(path + "#count"); return { data: () => ({ count: 0 }) }; } }),
  });
  const ref = (path: string): any => ({
    path, collection: (n: string) => coll(`${path}/${n}`),
    get: async () => { reads.push(path); return snap(path); },
    update: async (v: Record<string, unknown>) => { store.set(path, { ...(store.get(path) ?? {}), ...v }); },
    set: async (v: Record<string, unknown>, o?: { merge?: boolean }) => { store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...v } : v); },
  });
  const db: any = {
    doc: ref, collection: coll,
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (r: { path: string }) => snap(r.path),
      set: (r: { path: string }, v: Record<string, unknown>, o?: { merge?: boolean }) => store.set(r.path, o?.merge ? { ...(store.get(r.path) ?? {}), ...v } : v),
      update: (r: { path: string }, v: Record<string, unknown>) => store.set(r.path, { ...(store.get(r.path) ?? {}), ...v }),
    }),
  };
  return { db, store, reads };
}

const base = { workspaceId: "w1", businessId: "b1", screen: "understand" };
const freeQ = "Which of my reels brought more people through the door?";
const month = (store: Map<string, Record<string, unknown>>) => store.get("accounts/u1/usage/2026-11");
const okAi = { text: "You have 16 records so far, which is early. Keep adding sales and enquiries so the next recommendation has more to go on.", model: "claude-sonnet-5-5", tokens: { input: 300, output: 60 } };

describe("assistant: credits and routing end to end", () => {
  const deps = (over: Record<string, unknown> = {}) => ({ now: NOW, loadFacts: async () => facts(), ...over });

  it("fixed answers are free: no credit, no model call", async () => {
    const { db, store } = fakeDb();
    const askModel = vi.fn();
    const r = await runAssistant(db, "u1", { ...base, requestId: "req-00001", question: "What is my evidence level?" }, deps({ askModel }));
    expect(r).toMatchObject({ source: "engine", creditsUsed: 0, intent: "evidence_level" });
    expect(askModel).not.toHaveBeenCalled();
    expect(month(store)).toBeUndefined();
  });

  it("a free-form question uses exactly one credit and never touches per-decision counters", async () => {
    const { db, store } = fakeDb();
    const r = await runAssistant(db, "u1", { ...base, requestId: "req-00002", question: freeQ }, deps({ askModel: async () => okAi }));
    expect(r).toMatchObject({ source: "ai", creditsUsed: 1, creditsMonthly: 10, creditsLeft: 9 });
    expect(month(store)?.aiFollowUps).toBe(1);
    expect(store.get("workspaces/w1/usageRequests/as_req-00002")).toMatchObject({ state: "consumed", kind: "assistant" });
    expect([...store.keys()].some((k) => k.includes("followupCounts"))).toBe(false);
  });

  it("the Starter chat can use all 10 monthly credits (no per-decision cap)", async () => {
    const { db } = fakeDb();
    for (let i = 0; i < 10; i++) {
      const r = await runAssistant(db, "u1", { ...base, requestId: `req-1000${i}`, question: freeQ }, deps({ askModel: async () => okAi }));
      expect(r.source).toBe("ai");
    }
    await expect(runAssistant(db, "u1", { ...base, requestId: "req-10010", question: freeQ }, deps({ askModel: async () => okAi }))).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("gives the credit back when the model fails, and answers with a fixed summary", async () => {
    const { db, store } = fakeDb();
    const r = await runAssistant(db, "u1", { ...base, requestId: "req-00003", question: freeQ }, deps({ askModel: async () => null }));
    expect(r).toMatchObject({ source: "engine", creditsUsed: 0, creditReturned: true, creditsLeft: 10 });
    expect(r.answer).toContain("no AI credit was used");
    expect(month(store)?.aiFollowUps).toBe(0);
    expect(store.get("workspaces/w1/usageRequests/as_req-00003")?.state).toBe("released");
  });

  it("gives the credit back when the answer is rejected, but still records the tokens spent", async () => {
    const { db, store } = fakeDb();
    const r = await runAssistant(db, "u1", { ...base, requestId: "req-00004", question: freeQ }, deps({ askModel: async () => ({ text: null, model: "m", tokens: { input: 200, output: 40 } }) }));
    expect(r.creditReturned).toBe(true);
    expect(month(store)?.aiFollowUps).toBe(0);
    expect(month(store)?.aiInputTokens).toBeDefined();
  });

  it("gives the credit back when the model call throws", async () => {
    const { db, store } = fakeDb();
    await expect(runAssistant(db, "u1", { ...base, requestId: "req-00005", question: freeQ }, deps({ askModel: async () => { throw new Error("boom"); } }))).rejects.toMatchObject({ code: "internal" });
    expect(month(store)?.aiFollowUps).toBe(0);
  });

  it("out of credits: AI is refused with a friendly message, fixed answers still work", async () => {
    const { db } = fakeDb("starter", 10);
    const askModel = vi.fn();
    await expect(runAssistant(db, "u1", { ...base, requestId: "req-00006", question: freeQ }, deps({ askModel }))).rejects.toMatchObject({
      code: "resource-exhausted", message: expect.stringContaining("Fixed answers about your data and 7Captur still work"),
    });
    expect(askModel).not.toHaveBeenCalled();
    const r = await runAssistant(db, "u1", { ...base, requestId: "req-00007", question: "What is my evidence level?" }, deps());
    expect(r.source).toBe("engine");
  });

  it("is idempotent on requestId: a retry returns the stored answer and charges once", async () => {
    const { db, store } = fakeDb();
    const askModel = vi.fn(async () => okAi);
    const a = await runAssistant(db, "u1", { ...base, requestId: "req-00008", question: freeQ }, deps({ askModel }));
    const b = await runAssistant(db, "u1", { ...base, requestId: "req-00008", question: freeQ }, deps({ askModel }));
    expect(b.answer).toBe(a.answer);
    expect(b.duplicate).toBe(true);
    expect(askModel).toHaveBeenCalledTimes(1);
    expect(month(store)?.aiFollowUps).toBe(1);
  });

  it("the shared pool is the account's: Growth gives 100", async () => {
    const { db } = fakeDb("growth");
    const r = await runAssistant(db, "u1", { ...base, requestId: "req-00009", question: freeQ }, deps({ loadFacts: async () => facts({ account: { plan: "growth", timezone: "UTC" } }), askModel: async () => okAi }));
    expect(r.creditsMonthly).toBe(100);
  });
});

describe("assistant: permissions and workspace scoping", () => {
  const deps = (over: Record<string, unknown> = {}) => ({ now: NOW, loadFacts: async () => facts(), ...over });

  it("a non-member gets nothing", async () => {
    const { db } = fakeDb();
    await expect(runAssistant(db, "stranger", { ...base, requestId: "req-00020", question: "What is my evidence level?" }, deps())).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("a viewer gets fixed answers but cannot spend AI credits", async () => {
    const { db, store } = fakeDb();
    const ok = await runAssistant(db, "u2", { ...base, requestId: "req-00021", question: "What is my evidence level?" }, deps());
    expect(ok.source).toBe("engine");
    await expect(runAssistant(db, "u2", { ...base, requestId: "req-00022", question: freeQ }, deps({ askModel: async () => okAi }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(month(store)).toBeUndefined();
  });
  it("facts are built for the requested workspace only", async () => {
    const { db } = fakeDb();
    const spy = vi.fn(async () => facts());
    await runAssistant(db, "u1", { ...base, requestId: "req-00023", question: "What is my evidence level?", context: { kind: "recommendation", id: "secret" } }, { now: NOW, loadFacts: spy });
    expect(spy).toHaveBeenCalledWith(db, expect.objectContaining({ workspaceId: "w1", businessId: "b1" }));
  });
  it("loadFacts never reads another workspace, even when the open item id exists there", async () => {
    const { db, reads } = fakeDb();
    const f = await loadFacts(db, { ...base, context: { kind: "recommendation", id: "secret" }, now: NOW });
    expect(f.focus).toBeNull();
    expect(JSON.stringify(f)).not.toContain("OTHER TENANT SECRET");
    for (const p of reads) expect(p.startsWith("workspaces/w1") || p.startsWith("accounts/u1")).toBe(true);
    expect(reads.some((p) => p.includes("w2"))).toBe(false);
  });
  it("loadFacts refuses a business that is not in the workspace", async () => {
    const { db } = fakeDb();
    await expect(loadFacts(db, { workspaceId: "w1", businessId: "nope", screen: "understand", now: NOW })).rejects.toMatchObject({ code: "not-found" });
  });
});
