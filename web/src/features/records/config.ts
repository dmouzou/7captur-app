import { PLATFORMS, type RecordCollection } from "../../shared/records";
import { OBJECTIVES } from "../../shared/schemas";

export type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "ref";
export interface Field {
  name: string; label: string; type: FieldType; options?: readonly string[]; refTo?: RecordCollection; required?: boolean; defaultValue?: string | boolean;
}
export interface PanelConfig { title: string; fields: Field[]; summary: (r: Record<string, unknown>) => string }

const today = () => new Date().toISOString().slice(0, 10);
const money = (r: Record<string, unknown>) => `${r.amount ?? r.spend ?? ""} ${r.currency ?? ""}`.trim();

export const PANELS: Record<RecordCollection, PanelConfig> = {
  posts: {
    title: "Posts",
    summary: (r) => `${r.publishedAt} · ${r.platform}${r.topic ? " · " + r.topic : ""} · reach ${r.reach ?? "?"}`,
    fields: [
      { name: "platform", label: "Platform", type: "select", options: PLATFORMS, required: true, defaultValue: "instagram" },
      { name: "publishedAt", label: "Published on", type: "date", required: true, defaultValue: today() },
      { name: "format", label: "Format (video, photo, story…)", type: "text" },
      { name: "topic", label: "Topic", type: "text" },
      { name: "reach", label: "Reach", type: "number" }, { name: "views", label: "Views", type: "number" },
      { name: "likes", label: "Likes", type: "number" }, { name: "comments", label: "Comments", type: "number" },
      { name: "shares", label: "Shares", type: "number" }, { name: "saves", label: "Saves", type: "number" },
      { name: "notes", label: "Notes", type: "text" },
    ],
  },
  promotions: {
    title: "Promotions",
    summary: (r) => `${r.startDate} · ${r.platform} · spend ${money(r)}`,
    fields: [
      { name: "platform", label: "Platform", type: "select", options: PLATFORMS, required: true, defaultValue: "instagram" },
      { name: "postId", label: "Promoted post (optional)", type: "ref", refTo: "posts" },
      { name: "startDate", label: "Start date", type: "date", required: true, defaultValue: today() },
      { name: "endDate", label: "End date", type: "date" },
      { name: "spend", label: "Spend", type: "number", required: true },
      { name: "currency", label: "Currency", type: "text", required: true },
      { name: "objective", label: "Objective", type: "select", options: OBJECTIVES, required: true, defaultValue: "qualified_enquiries" },
      { name: "impressions", label: "Impressions", type: "number" }, { name: "clicks", label: "Clicks", type: "number" },
    ],
  },
  leads: {
    title: "Enquiries",
    summary: (r) => `${r.date} · ${r.status}${r.qualified ? " · qualified" : ""}`,
    fields: [
      { name: "date", label: "Date", type: "date", required: true, defaultValue: today() },
      { name: "postId", label: "Came from post (if known)", type: "ref", refTo: "posts" },
      { name: "promotionId", label: "Came from promotion (if known)", type: "ref", refTo: "promotions" },
      { name: "qualified", label: "Qualified enquiry", type: "checkbox", defaultValue: false },
      { name: "status", label: "Status", type: "select", options: ["new", "in_conversation", "won", "lost"], required: true, defaultValue: "new" },
      { name: "value", label: "Value (optional)", type: "number" },
      { name: "currency", label: "Currency (if value)", type: "text" },
    ],
  },
  sales: {
    title: "Sales",
    summary: (r) => `${r.date} · ${money(r)} · ${r.status}`,
    fields: [
      { name: "date", label: "Date", type: "date", required: true, defaultValue: today() },
      { name: "amount", label: "Amount", type: "number", required: true },
      { name: "currency", label: "Currency", type: "text", required: true },
      { name: "status", label: "Status", type: "select", options: ["confirmed", "pending", "partially_refunded", "refunded"], required: true, defaultValue: "confirmed" },
      { name: "refundAmount", label: "Refund amount (if any)", type: "number" },
      { name: "product", label: "Product or service", type: "text" },
      { name: "postId", label: "Source post (if known)", type: "ref", refTo: "posts" },
      { name: "promotionId", label: "Source promotion (if known)", type: "ref", refTo: "promotions" },
      { name: "leadId", label: "From enquiry (if known)", type: "ref", refTo: "leads" },
      { name: "attribution", label: "How sure are you of the source?", type: "select", options: ["unknown", "estimated", "manual_reported"], required: true, defaultValue: "unknown" },
    ],
  },
  costs: {
    title: "Costs",
    summary: (r) => `${r.effectiveDate} · ${r.category} · ${r.kind === "percentage" ? r.amount + "%" : money(r)}`,
    fields: [
      { name: "category", label: "Category", type: "select", options: ["cogs", "fees", "shipping", "returns", "other"], required: true, defaultValue: "cogs" },
      { name: "kind", label: "Amount or percentage of revenue", type: "select", options: ["amount", "percentage"], required: true, defaultValue: "amount" },
      { name: "amount", label: "Value", type: "number", required: true },
      { name: "currency", label: "Currency (amounts only)", type: "text" },
      { name: "effectiveDate", label: "Effective from", type: "date", required: true, defaultValue: today() },
    ],
  },
};
