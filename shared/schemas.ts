import { z } from "zod";

export const BUSINESS_TYPES = [
  "product_seller", "reseller", "service_provider", "restaurant_local", "creator_individual", "other",
] as const;
export const OBJECTIVES = [
  "qualified_enquiries", "orders", "content_testing", "reduced_waste", "profitability", "awareness",
] as const;
export const BUYING_METHODS = [
  "website", "dm_whatsapp", "phone", "booking", "marketplace", "in_person", "other",
] as const;

/** Provenance labels from spec 7.1 / 7.4. */
export const PROVENANCE = [
  "connected", "manual", "imported", "screenshot_extracted", "estimated", "unknown",
] as const;

/** Lifecycle states from spec 6.1. */
export const RECOMMENDATION_STATUS = [
  "draft", "ready", "generated", "viewed", "marked_to_try", "dismissed",
  "completed", "outcome_recorded", "superseded", "failed",
] as const;

export const EVIDENCE_MODES = ["explore", "improve", "optimize"] as const;

export const createWorkspaceInput = z.object({
  workspaceName: z.string().trim().min(1).max(80),
  businessName: z.string().trim().min(1).max(80),
  businessType: z.enum(BUSINESS_TYPES),
  country: z.string().trim().length(2).toUpperCase(),
  timezone: z.string().trim().min(1).max(64),
  currency: z.string().trim().length(3).toUpperCase(),
  objective: z.enum(OBJECTIVES).optional(),
  objectives: z.array(z.enum(OBJECTIVES)).min(1).max(3).optional(),
  buyingMethods: z.array(z.enum(BUYING_METHODS)).min(1).max(7),
  requestId: z.string().min(8).max(64),
  contactName: z.union([z.string().trim().max(100), z.literal(""), z.null(), z.undefined()]).optional(),
  contactEmail: z.union([z.string().trim().max(120), z.literal(""), z.null(), z.undefined()]).optional(),
  contactPhone: z.union([z.string().trim().max(30), z.literal(""), z.null(), z.undefined()]).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;
