import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, normalizeShop, verifyOAuthHmac, verifyWebhookHmac } from "../functions/src/integrations/shopify/crypto";
import { mapOrder, orderDocId, type ShopifyOrderNode } from "../functions/src/integrations/shopify/orders";

const key = Buffer.alloc(32, 7).toString("base64");
const order = (over: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode => ({
  id: "gid://shopify/Order/123", createdAt: "2026-10-29T23:30:00Z", updatedAt: "2026-10-30T01:00:00Z", cancelledAt: null, test: false,
  displayFinancialStatus: "PAID", subtotalPriceSet: { shopMoney: { amount: "80.00", currencyCode: "eur" } },
  totalRefundedSet: { shopMoney: { amount: "0.0", currencyCode: "EUR" } }, lineItems: { nodes: [{ title: "Mug" }, { title: "Cap" }] }, ...over,
});

describe("token encryption", () => {
  it("round-trips and uses a fresh iv", () => {
    const a = encryptToken("shpat_secret", key), b = encryptToken("shpat_secret", key);
    expect(a).not.toBe(b); expect(a).not.toContain("shpat"); expect(decryptToken(a, key)).toBe("shpat_secret");
  });
  it("rejects tampering and wrong keys", () => {
    const a = encryptToken("x", key);
    expect(() => decryptToken(a.slice(0, -2) + "AA", key)).toThrow();
    expect(() => decryptToken(a, Buffer.alloc(32, 9).toString("base64"))).toThrow();
    expect(() => encryptToken("x", "short")).toThrow();
  });
});

describe("HMAC verification", () => {
  const secret = "s3cret";
  it("verifies OAuth query", () => {
    const q = { code: "abc", shop: "a.myshopify.com", state: "n", timestamp: "1" };
    const hmac = createHmac("sha256", secret).update("code=abc&shop=a.myshopify.com&state=n&timestamp=1").digest("hex");
    expect(verifyOAuthHmac({ ...q, hmac }, secret)).toBe(true);
    expect(verifyOAuthHmac({ ...q, code: "evil", hmac }, secret)).toBe(false);
    expect(verifyOAuthHmac(q, secret)).toBe(false);
  });
  it("verifies webhook raw body", () => {
    const body = Buffer.from('{"a":1}');
    const h = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyWebhookHmac(body, h, secret)).toBe(true);
    expect(verifyWebhookHmac(Buffer.from('{"a":2}'), h, secret)).toBe(false);
    expect(verifyWebhookHmac(body, undefined, secret)).toBe(false);
  });
});

describe("normalizeShop", () => {
  it("accepts valid shop domains only", () => {
    expect(normalizeShop("My-Shop")).toBe("my-shop.myshopify.com");
    expect(normalizeShop("https://my-shop.myshopify.com/admin")).toBe("my-shop.myshopify.com");
    expect(normalizeShop("evil.com")).toBeNull();
    expect(normalizeShop("a.myshopify.com.evil.com")).toBeNull();
    expect(normalizeShop("")).toBeNull();
  });
});

describe("mapOrder", () => {
  it("maps a paid order using the business timezone date", () => {
    const m = mapOrder(order(), "Asia/Kolkata");
    expect(m.action).toBe("upsert");
    if (m.action === "upsert") expect(m.synced).toMatchObject({ date: "2026-10-30", amount: 80, currency: "EUR", status: "confirmed", product: "Mug, Cap" });
  });
  it("keeps refunds capped at the amount", () => {
    const m = mapOrder(order({ displayFinancialStatus: "PARTIALLY_REFUNDED", totalRefundedSet: { shopMoney: { amount: "500", currencyCode: "EUR" } } }), "UTC");
    if (m.action === "upsert") expect(m.synced).toMatchObject({ status: "partially_refunded", refundAmount: 80 });
  });
  it("skips test, cancelled and voided orders", () => {
    expect(mapOrder(order({ test: true }), "UTC").action).toBe("skip");
    expect(mapOrder(order({ cancelledAt: "2026-10-30T00:00:00Z" }), "UTC").action).toBe("skip");
    expect(mapOrder(order({ displayFinancialStatus: "VOIDED" }), "UTC").action).toBe("skip");
  });
  it("builds stable ids", () => expect(orderDocId("gid://shopify/Order/123")).toBe("shopify_123"));
});
