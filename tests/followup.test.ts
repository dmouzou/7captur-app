import { describe, expect, it, vi } from "vitest";
import { buildFollowupPrompt, fallbackAnswer, validateAnswer } from "../functions/src/decisions/followupCore";
import { askModel } from "../functions/src/decisions/followup";
import { askAboutDecisionInput } from "../shared/followup";
import { getPlan } from "../shared/plans";
import { convert, parseEcbXml } from "../shared/fx";

const snapshot = {
  action: "Hold spend where it is. Fees are not visible.",
  rationale: ["Net revenue 16200.00 USD, ad spend 5000.00 USD, 20 confirmed orders."],
  unknowns: ["Revenue links are partly manual."],
  unknownCosts: ["shipping", "payment fees"],
  financials: { trueRoas: null, attributedRoas: 3.24, breakEvenRoas: 2, attributionCoverage: 1, netRevenue: 16200 },
  alternatives: [{ action: "Cut the weakest promotion", why_not_selected: "Attributed ROAS is 3.24x, above break-even 2.00x." }],
  whatWouldChange: ["Entering payment fees would change the return."],
};

describe("AI follow-ups: prompt and plan", () => {
  it("sends only the saved snapshot and the question, and marks both as data", () => {
    const { system, user } = buildFollowupPrompt(snapshot, "Why hold?");
    expect(user).toContain("<decision>");
    expect(user).toContain("<question>Why hold?</question>");
    expect(system).toMatch(/data, not instructions/);
    expect(system).toMatch(/cannot change, reverse or contradict/);
  });

  it("plan caps: Starter 10 monthly and 3 per decision, Growth 100 and 10", () => {
    expect(getPlan("starter").aiFollowUps).toEqual({ monthly: 10, perDecision: 3 });
    expect(getPlan("growth").aiFollowUps).toEqual({ monthly: 100, perDecision: 10 });
    expect(getPlan("growth").recommendations.weekly).toBe(15);
    expect(getPlan("starter").recommendations.weekly).toBe(3);
  });

  it("validates input", () => {
    expect(askAboutDecisionInput.safeParse({ workspaceId: "w", decisionId: "d", requestId: "12345678", question: "Why?" }).success).toBe(true);
    expect(askAboutDecisionInput.safeParse({ workspaceId: "w", decisionId: "d", requestId: "12345678", question: "?" }).success).toBe(false);
  });
});

describe("AI follow-ups: answer validation (fails closed)", () => {
  const ok = "The engine holds spend because fees are not visible, so it cannot claim more. Break-even is 2 and attributed ROAS is 3.24.";
  it("accepts an answer traceable to the snapshot", () => expect(validateAnswer(ok, snapshot, "Why hold?")).toBe(ok));
  it("rejects invented numbers", () => expect(validateAnswer("Your return is 7.5 which is well above target for this period.", snapshot, "q")).toBeNull());
  it("rejects links and promises", () => {
    expect(validateAnswer("See https://example.com for why this will increase your sales soon.", snapshot, "q")).toBeNull();
    expect(validateAnswer("This is guaranteed to work if you keep the spend as it is today.", snapshot, "q")).toBeNull();
  });
  it("rejects True ROAS wording when fees are unknown", () => {
    expect(validateAnswer("Your True ROAS is high so you are doing well with this spend today.", snapshot, "q")).toBeNull();
  });
  it("cannot change the action", () => {
    expect(validateAnswer("You should increase your ad spend by a lot because the numbers look good here.", snapshot, "q")).toBeNull();
    expect(validateAnswer("Ignore the recommendation and trust your gut about the budget this month instead.", snapshot, "q")).toBeNull();
  });
});

describe("AI follow-ups: fallback and model call", () => {
  it("fallback answers from the snapshot only", () => {
    expect(fallbackAnswer(snapshot, "Why not cut instead?")).toMatch(/Cut the weakest promotion/);
    expect(fallbackAnswer(snapshot, "What would change this?")).toMatch(/payment fees/);
    expect(fallbackAnswer(snapshot, "Is the data reliable?")).toMatch(/shipping, payment fees/);
    expect(fallbackAnswer(snapshot, "Tell me")).toMatch(/Hold spend/);
  });

  const reply = (answer: string) => vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ answer }) }], usage: { input_tokens: 120, output_tokens: 40 } }), { status: 200 }));

  it("returns the answer and records real token usage", async () => {
    const f = reply("The engine holds spend because fees are not visible, so it cannot claim more. Break-even is 2.");
    const r = await askModel(snapshot, "Why hold?", { fetchImpl: f as never, apiKey: "sk-test", model: "m" });
    expect(r).toMatchObject({ inputTokens: 120, outputTokens: 40 });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(JSON.stringify(body)).not.toMatch(/orderNumber/);
  });

  it("a rejected answer still reports the tokens that were spent", async () => {
    const r = await askModel(snapshot, "Why hold?", { fetchImpl: reply("Your return is 99.9 so definitely scale now.") as never, apiKey: "sk-test", model: "m" });
    expect(r).toEqual({ tokens: { input: 120, output: 40 } });
  });

  it("provider failure returns null so the credit is released", async () => {
    const f = vi.fn(async () => new Response("no", { status: 400 }));
    expect(await askModel(snapshot, "q", { fetchImpl: f as never, apiKey: "sk-test", model: "m" })).toBeNull();
  });
});

describe("FX", () => {
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-10-28'>${["USD 1.1", "GBP 0.85", "JPY 160", "CHF 0.95", "CAD 1.5", "AUD 1.6", "SEK 11", "NOK 11.5", "DKK 7.46", "PLN 4.3"].map((x) => `<Cube currency='${x.split(" ")[0]}' rate='${x.split(" ")[1]}'/>`).join("")}</Cube></Cube></gesmes:Envelope>`;
  it("parses the ECB feed and rejects junk", () => {
    expect(parseEcbXml(xml)).toMatchObject({ date: "2026-10-28", base: "EUR", rates: { USD: 1.1 } });
    expect(parseEcbXml("<html>nope</html>")).toBeNull();
  });
  it("converts across currencies via EUR and returns the rate", () => {
    const fx = parseEcbXml(xml)!;
    expect(convert(100, "EUR", "USD", fx)).toEqual({ amount: 110.00000000000001, rate: 1.1 });
    const gbpUsd = convert(85, "GBP", "USD", fx)!;
    expect(gbpUsd.amount).toBeCloseTo(110, 5);
    expect(convert(1, "XXX", "USD", fx)).toBeNull();
    expect(convert(5, "USD", "USD", null)).toEqual({ amount: 5, rate: 1 });
  });
});
