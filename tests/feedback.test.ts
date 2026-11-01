import { describe, expect, it } from "vitest";
import { submitFeedbackInput, adminUpdateFeedbackInput } from "../shared/schemas";
import { postSchema, leadSchema, saleSchema, costSchema } from "../shared/records";

describe("Feedback schemas (Spec 6.0 & 10.2)", () => {
  it("validates bad_recommendation feedback with recommendation ID", () => {
    const input = {
      workspaceId: "ws_123",
      type: "bad_recommendation",
      recommendationId: "rec_abc456",
      subject: "Arithmetic calculation mismatch in ROI",
      message: "The calculated return showed 1.4x but our revenue was $500 on $1000 spend.",
      contactEmail: "owner@brand.com",
      meta: { issueReason: "inaccurate_math" },
    };
    const parsed = submitFeedbackInput.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("validates support_request without recommendation ID", () => {
    const input = {
      workspaceId: "ws_456",
      type: "support_request",
      subject: "Help importing Shopify CSV",
      message: "I exported my orders CSV from Shopify and need assistance with the mapping.",
      contactEmail: "admin@store.ca",
    };
    const parsed = submitFeedbackInput.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("validates product_feedback", () => {
    const input = {
      workspaceId: "ws_789",
      type: "product_feedback",
      subject: "Feature request: TikTok direct API",
      message: "We get 80% of our orders from TikTok and would love direct connector support.",
    };
    const parsed = submitFeedbackInput.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid feedback input with short message", () => {
    const input = {
      workspaceId: "ws_123",
      type: "support_request",
      subject: "Help",
      message: "Short",
    };
    const parsed = submitFeedbackInput.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it("validates adminUpdateFeedbackInput statuses", () => {
    const valid = adminUpdateFeedbackInput.safeParse({
      ticketId: "fb_123",
      status: "resolved",
      internalNote: "Advised customer on correct column mapping in CSV.",
    });
    expect(valid.success).toBe(true);

    const invalid = adminUpdateFeedbackInput.safeParse({
      ticketId: "fb_123",
      status: "closed_forever", // not in enum
    });
    expect(invalid.success).toBe(false);
  });
});

describe("Canonical Record Schemas (Spec 7.1)", () => {
  it("validates postSchema with optional canonical fields", () => {
    const post = postSchema.safeParse({
      platform: "instagram",
      publishedAt: "2026-10-29",
      format: "video",
      topic: "product_launch",
      externalId: "ig_post_999",
      permalink: "https://instagram.com/p/abc123xyz",
      promoted: true,
      reach: 5400,
      views: 6200,
      likes: 420,
      comments: 35,
      shares: 18,
      saves: 50,
      profileVisits: 120,
      clicks: 45,
    });
    expect(post.success).toBe(true);
  });

  it("validates leadSchema with optional source channel", () => {
    const lead = leadSchema.safeParse({
      date: "2026-10-29",
      source: "instagram_dm",
      qualified: true,
      status: "in_conversation",
      value: 150,
      currency: "USD",
      notes: "Enquired about custom bundle after seeing reel",
    });
    expect(lead.success).toBe(true);
  });

  it("validates saleSchema with orderNumber and quantity", () => {
    const sale = saleSchema.safeParse({
      date: "2026-10-29",
      orderNumber: "ORD-2026-8812",
      quantity: 3,
      amount: 149.97,
      currency: "USD",
      status: "confirmed",
      product: "Ceramic Mug Set",
      attribution: "manual_reported",
    });
    expect(sale.success).toBe(true);
  });

  it("validates costSchema with scope", () => {
    const cost = costSchema.safeParse({
      category: "shipping",
      kind: "amount",
      scope: "per_order",
      amount: 8.5,
      currency: "USD",
      effectiveDate: "2026-10-01",
    });
    expect(cost.success).toBe(true);
  });
});
