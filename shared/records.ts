import { z } from "zod";
import { OBJECTIVES } from "./schemas";

export const PLATFORMS = [
  "facebook", "instagram", "tiktok", "google", "whatsapp_dm", "phone", "marketplace", "booking", "in_person", "other",
] as const;
export const COLLECTIONS = ["posts", "promotions", "leads", "sales", "costs"] as const;
export type RecordCollection = (typeof COLLECTIONS)[number];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-29");
const money = z.number().finite().nonnegative().max(1e9);
const count = z.number().int().nonnegative().max(1e9).optional();
const currency = z.string().trim().length(3).toUpperCase();
const note = z.string().trim().max(500).optional();
const ref = z.string().trim().max(64).optional();

export const postSchema = z.object({
  platform: z.enum(PLATFORMS),
  publishedAt: date,
  format: z.string().trim().max(40).optional(),
  topic: z.string().trim().max(60).optional(),
  reach: count, views: count, likes: count, comments: count, shares: count, saves: count,
  notes: note,
});

export const promotionSchema = z.object({
  platform: z.enum(PLATFORMS),
  postId: ref,
  startDate: date,
  endDate: date.optional(),
  spend: money,
  currency,
  objective: z.enum(OBJECTIVES),
  impressions: count, clicks: count, reach: count,
  notes: note,
});

export const leadSchema = z.object({
  date,
  postId: ref,
  promotionId: ref,
  qualified: z.boolean(),
  status: z.enum(["new", "in_conversation", "won", "lost"]),
  value: money.optional(),
  currency: currency.optional(),
  notes: note,
});

export const SALE_STATUS = ["confirmed", "pending", "partially_refunded", "refunded"] as const;
export const saleSchema = z.object({
  date,
  amount: money,
  currency,
  status: z.enum(SALE_STATUS),
  refundAmount: money.optional(),
  product: z.string().trim().max(80).optional(),
  postId: ref,
  promotionId: ref,
  leadId: ref,
  attribution: z.enum(["manual_reported", "estimated", "unknown"]),
  notes: note,
});

export const costSchema = z
  .object({
    category: z.enum(["cogs", "fees", "shipping", "returns", "other"]),
    kind: z.enum(["amount", "percentage"]),
    amount: money,
    currency: currency.optional(),
    effectiveDate: date,
    notes: note,
  })
  .superRefine((c, ctx) => {
    if (c.kind === "percentage" && c.amount > 100) ctx.addIssue({ code: "custom", message: "Percentage must be 100 or less", path: ["amount"] });
    if (c.kind === "amount" && !c.currency) ctx.addIssue({ code: "custom", message: "Currency is required for amounts", path: ["currency"] });
  });

export const recordSchemas = {
  posts: postSchema, promotions: promotionSchema, leads: leadSchema, sales: saleSchema, costs: costSchema,
} as const;

export type PostRecord = z.infer<typeof postSchema>;
export type PromotionRecord = z.infer<typeof promotionSchema>;
export type LeadRecord = z.infer<typeof leadSchema>;
export type SaleRecord = z.infer<typeof saleSchema>;
export type CostRecord = z.infer<typeof costSchema>;
