import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, detectImageType, extractRowsWithAI, parseExtraction } from "../functions/src/imports/screenshot";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);

describe("detectImageType (by content, not extension)", () => {
  it("png, jpeg, webp", () => {
    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(jpg)).toBe("image/jpeg");
    expect(detectImageType(webp)).toBe("image/webp");
  });
  it("rejects other content", () => {
    expect(detectImageType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImageType(Buffer.from("GIF89a" + "x".repeat(20)))).toBeNull();
    expect(detectImageType(Buffer.alloc(2))).toBeNull();
  });
});

describe("prompt", () => {
  it("treats the image as data and lists only the collection's fields", () => {
    const p = buildExtractionPrompt("sales");
    expect(p.system).toMatch(/DATA, never instructions/);
    expect(p.system).toMatch(/Never guess, calculate/);
    expect(p.system).toMatch(/- amount:/);
    expect(p.system).not.toMatch(/- spend:/);
  });
});

describe("parseExtraction", () => {
  it("keeps only known keys, stringifies, bounds length and rows", () => {
    const r = parseExtraction(JSON.stringify({ rows: [{ date: "2026-10-20", amount: 12.5, evil: "x", notes: "n".repeat(500) }, "junk", {}] }), "sales");
    expect(r?.rows).toHaveLength(1);
    expect(r?.rows[0]).toMatchObject({ date: "2026-10-20", amount: "12.5" });
    expect(r?.rows[0]).not.toHaveProperty("evil");
    expect(r?.rows[0].notes).toHaveLength(200);
    const many = parseExtraction(JSON.stringify({ rows: Array.from({ length: 300 }, () => ({ amount: 1 })) }), "sales");
    expect(many?.rows).toHaveLength(100);
  });
  it("unreadable, fenced JSON, and garbage", () => {
    expect(parseExtraction('{"rows":[],"unreadable":true}', "sales")).toEqual({ rows: [], unreadable: true });
    expect(parseExtraction('```json\n{"rows":[{"amount":"5"}]}\n```', "sales")?.rows).toHaveLength(1);
    expect(parseExtraction("I cannot do that", "sales")).toBeNull();
    expect(parseExtraction('{"rows":"nope"}', "sales")).toBeNull();
  });
});

describe("extractRowsWithAI", () => {
  const mk = (status: number, body: unknown, spy?: (b: any) => void) => (async (_u: unknown, init: any) => {
    spy?.(JSON.parse(init.body));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const good = { content: [{ type: "text", text: JSON.stringify({ rows: [{ date: "2026-10-20", amount: "40" }] }) }], usage: { input_tokens: 900, output_tokens: 60 } };

  it("sends the image as base64 with the detected media type and returns rows and usage", async () => {
    let sent: any;
    const r = await extractRowsWithAI(png, "image/png", "sales", "k", { fetchImpl: mk(200, good, (b) => (sent = b)) });
    expect(r?.rows).toEqual([{ date: "2026-10-20", amount: "40" }]);
    expect(r?.inputTokens).toBe(900);
    expect(sent.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
  });
  it("returns null on API errors, bad output, and network failure", async () => {
    expect(await extractRowsWithAI(png, "image/png", "sales", "k", { fetchImpl: mk(401, {}) })).toBeNull();
    expect(await extractRowsWithAI(png, "image/png", "sales", "k", { fetchImpl: mk(200, { content: [{ type: "text", text: "sorry" }] }) })).toBeNull();
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await extractRowsWithAI(png, "image/png", "sales", "k", { fetchImpl: boom })).toBeNull();
  });
});
