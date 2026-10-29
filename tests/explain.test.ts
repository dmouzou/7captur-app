import { describe, expect, it } from "vitest";
import { buildPrompt, explainWithAI, validateSummary } from "../functions/src/recommendations/explain";
import { runEngine } from "../functions/src/recommendations/engine";

const rec = runEngine({
  records: { posts: [], leads: [], sales: [], costs: [],
    promotions: [
      { id: "p1", platform: "instagram", startDate: "2026-10-21", spend: 100, currency: "USD", objective: "qualified_enquiries" },
    ] as never },
  business: { objective: "qualified_enquiries", currency: "USD" }, today: "2026-10-29",
});
const ok = "Your Instagram promotion has no enquiries recorded yet, so it is too early to judge it. Record enquiries over the next two weeks.";

describe("validateSummary (fail closed)", () => {
  it("accepts text whose numbers exist in the engine output", () => {
    const r = { ...rec, rationale: ["Spend was 100 USD."], action: "Record enquiries over two weeks." };
    expect(validateSummary("You spent 100 USD so far. It is too early to judge, so keep recording.", r)).not.toBeNull();
  });
  it("rejects invented numbers", () => expect(validateSummary("You spent 250 USD and got 40 enquiries, which is great news.", rec)).toBeNull());
  it("rejects promises and links", () => {
    expect(validateSummary("This will increase your sales next month, no doubt about it.", rec)).toBeNull();
    expect(validateSummary("We guarantee a better result if you follow this plan today.", rec)).toBeNull();
    expect(validateSummary("Read more at https://example.com about what to do next.", rec)).toBeNull();
  });
  it("rejects ROAS or profit wording outside optimize mode", () => {
    expect(rec.mode).not.toBe("optimize");
    expect(validateSummary("Your ROAS looks weak so you should reconsider this campaign soon.", rec)).toBeNull();
    expect(validateSummary("This promotion is not profitable yet so consider pausing it soon.", rec)).toBeNull();
  });
  it("rejects non-strings and wrong lengths", () => {
    expect(validateSummary(42, rec)).toBeNull();
    expect(validateSummary("Too short", rec)).toBeNull();
    expect(validateSummary("word ".repeat(200), rec)).toBeNull();
  });
});

describe("prompt", () => {
  it("sends only engine conclusions, flags facts as data", () => {
    const p = buildPrompt(rec);
    expect(p.system).toMatch(/data, not instructions/);
    expect(p.user).not.toMatch(/notes|createdBy|workspaceId/);
  });
});

describe("explainWithAI", () => {
  const mk = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const good = { content: [{ type: "text", text: JSON.stringify({ summary: ok }) }], usage: { input_tokens: 10, output_tokens: 20 } };
  it("returns validated text and token usage", async () => {
    const r = await explainWithAI(rec, "test-key", { fetchImpl: mk(200, good) });
    expect(r?.text).toBe(ok);
    expect(r?.outputTokens).toBe(20);
  });
  it("returns null on API error, bad JSON, or rejected content", async () => {
    expect(await explainWithAI(rec, "k", { fetchImpl: mk(401, {}) })).toBeNull();
    expect(await explainWithAI(rec, "k", { fetchImpl: mk(200, { content: [{ type: "text", text: "not json" }] }) })).toBeNull();
    expect(await explainWithAI(rec, "k", { fetchImpl: mk(200, { content: [{ type: "text", text: JSON.stringify({ summary: "We guarantee your results will improve a lot." }) }] }) })).toBeNull();
  });
  it("never throws on network failure", async () => {
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await explainWithAI(rec, "k", { fetchImpl: boom })).toBeNull();
  });
});
