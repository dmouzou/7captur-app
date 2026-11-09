import { z } from "zod";
import { PLATFORMS, recordSchemas, type RecordCollection } from "./records";
import { OBJECTIVES } from "./schemas";

export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 2000, maxColumns: 50 } as const;
export const DEFAULT_REJECTED_ROW_WARNING_THRESHOLD = 0.5; // 50% threshold for warning modal
export type DateFormat = "iso" | "mdy" | "dmy";
export type NumberFormat = "us" | "eu"; // us: 1,234.56  eu: 1.234,56
export interface ImportOptions {
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  defaults: { currency: string; objective: string; platform?: (typeof PLATFORMS)[number] };
}

// ---------- CSV parsing (RFC 4180 style: quotes, escaped quotes, newlines in cells, BOM) ----------

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 12);
  const totals: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const line of lines) {
    const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
    let quoted = false;
    for (const ch of line) { if (ch === '"') quoted = !quoted; else if (!quoted && ch in counts) counts[ch]++; }
    for (const d of Object.keys(counts)) totals[d] += counts[d];
  }
  let best = ",", bestCount = 0;
  for (const d of [",", "\t", ";"]) if (totals[d] > bestCount) { best = d; bestCount = totals[d]; }
  return best;
}

/** Decode a file's bytes. Handles UTF-8 (with or without BOM), UTF-16 (Google Ads and Excel "Unicode text") and Windows-1252. */
export function decodeFileBytes(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  // UTF-16 without a BOM: every other byte is zero for Latin text.
  if (u8.length >= 4 && u8[1] === 0 && u8[3] === 0 && u8[0] !== 0) return new TextDecoder("utf-16le").decode(u8);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(u8);
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1252").decode(u8);
}

export function parseCsv(input: string): { headers: string[]; rows: string[][]; delimiter: string; skippedPreamble: number; skippedTotals: number } {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      out.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); out.push(row); }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [], delimiter, skippedPreamble: 0, skippedTotals: 0 };
  // Ad platforms put report titles and date ranges above the header ("Campaign report", "October 1, 2026 - October 31, 2026").
  // The header is the first row that is about as wide as the widest of the first ten rows.
  const filled = (r: string[]) => r.length;
  const widest = Math.max(...nonEmpty.slice(0, 10).map(filled));
  const need = Math.max(2, Math.ceil(widest * 0.8));
  let headerIdx = nonEmpty.findIndex((r, i) => i < 10 && filled(r) >= need);
  if (headerIdx < 0) headerIdx = 0;
  const seen = new Map<string, number>();
  const headers = nonEmpty[headerIdx].map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
  // Report summaries ("Total: Account", "Grand total") are not records.
  const isTotals = (r: string[]) => /^(grand\s+)?totals?\s*(:|$)/i.test((r.find((c) => c.trim() !== "") ?? "").trim());
  const body = nonEmpty.slice(headerIdx + 1);
  const data = body.filter((r) => !isTotals(r));
  return { headers, rows: data, delimiter, skippedPreamble: headerIdx, skippedTotals: body.length - data.length };
}

/**
 * Turn spreadsheet cells (from an .xlsx) into CSV text so one pipeline handles every file type.
 * Dates become ISO dates and numbers keep their plain form, so the caller reads them with the "iso" and "us" settings.
 */
export function cellsToCsvText(rows: unknown[][]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
    const t = String(v);
    return `"${t.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

export function rowsToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- Field specs ----------

type Kind = "date" | "number" | "int" | "text" | "enum" | "bool";
export interface ImportField {
  name: string; label: string; kind: Kind; required?: boolean;
  aliases: string[];
  enumValues?: readonly string[];
  enumAliases?: Record<string, string>;
  /** Applied when the column is unmapped or the cell is empty. Shown to the user in the preview. */
  default?: (o: ImportOptions) => unknown;
  defaultLabel?: (o: ImportOptions) => string;
}

const count = (name: string, label: string, aliases: string[] = []): ImportField => ({ name, label, kind: "int", aliases: [name, ...aliases] });
const platformField = (defaultPlatform: (typeof PLATFORMS)[number] = "facebook"): ImportField => ({
  name: "platform", label: "Platform", kind: "enum", required: true, enumValues: PLATFORMS,
  aliases: ["platform", "channel", "network", "source", "publisher_platform", "platform_type", "ad_channel"],
  enumAliases: {
    ig: "instagram", insta: "instagram", fb: "facebook", meta: "facebook",
    meta_ads: "facebook", "meta ads": "facebook", "facebook ads": "facebook", fb_ads: "facebook",
    whatsapp: "whatsapp_dm", wa: "whatsapp_dm", dm: "whatsapp_dm", dms: "whatsapp_dm", direct_message: "whatsapp_dm",
    instore: "in_person", in_store: "in_person", store: "in_person", call: "phone", calls: "phone",
    tiktok_shop: "tiktok", tiktok_ads: "tiktok", "tiktok ads": "tiktok",
    google_ads: "google", "google ads": "google", adwords: "google", youtube: "google", "youtube ads": "google",
    etsy: "marketplace", amazon: "marketplace", amazon_ads: "marketplace", "amazon ads": "marketplace", amazon_advertising: "marketplace",
    linkedin: "other", linkedin_ads: "other", "linkedin ads": "other", x: "other", twitter: "other", pinterest: "other", snapchat: "other", bing: "other", microsoft_ads: "other",
    shopify: "other", woocommerce: "other", stripe: "other", paypal: "other",
  },
  default: (o) => o.defaults.platform ?? defaultPlatform,
  defaultLabel: (o) => `platform = ${o.defaults.platform ?? defaultPlatform}`,
});
const currencyField: ImportField = {
  name: "currency", label: "Currency", kind: "text", aliases: ["currency", "curr", "ccy", "currency_code", "order_currency", "order_currency_code", "presentment_currency"],
  default: (o) => o.defaults.currency, defaultLabel: (o) => `currency = ${o.defaults.currency}`,
};
const notes: ImportField = { name: "notes", label: "Notes", kind: "text", aliases: ["notes", "note", "comment", "description", "details", "memo"] };
const dateField = (name: string, label: string, aliases: string[], required = true): ImportField => ({ name, label, kind: "date", required, aliases: [name, ...aliases] });

export const IMPORT_SPECS: Record<RecordCollection, ImportField[]> = {
  posts: [
    platformField("instagram"),
    dateField("publishedAt", "Published on", ["published_at", "publishedAt", "date", "published", "post_date", "posted", "posted_on", "created_time", "publish_date"]),
    { name: "format", label: "Format", kind: "text", aliases: ["format", "type", "media_type", "post_type", "content_type"] },
    { name: "topic", label: "Topic", kind: "text", aliases: ["topic", "theme", "tag", "subject", "caption", "title"] },
    { name: "externalId", label: "External Post ID", kind: "text", aliases: ["external_id", "post_id", "id", "record_id"] },
    { name: "permalink", label: "Post URL / Link", kind: "text", aliases: ["permalink", "url", "link"] },
    { name: "promoted", label: "Promoted / Boosted", kind: "bool", aliases: ["promoted", "is_promoted", "boosted"] },
    count("reach", "Reach", ["accounts_reached", "total_reach"]),
    count("views", "Views", ["video_views", "plays", "impressions"]),
    count("likes", "Likes", ["reactions", "favorites"]),
    count("comments", "Comments", ["replies"]), count("shares", "Shares", ["reposts", "retweets"]), count("saves", "Saves", ["bookmarks"]),
    count("profileVisits", "Profile visits", ["profile_views", "account_visits"]), count("clicks", "Clicks", ["link_clicks", "outbound_clicks"]),
    notes,
  ],
  promotions: [
    platformField("facebook"),
    dateField("startDate", "Start date", ["start_date", "startDate", "start", "from", "begin", "reporting_starts", "date_start", "start_time", "date", "day", "stat_time", "stat_time_day", "by_day", "date_range_start"]),
    dateField("endDate", "End date", ["end_date", "endDate", "end", "to", "stop", "reporting_ends", "date_stop", "end_time"], false),
    { name: "spend", label: "Spend", kind: "number", required: true, aliases: ["spend", "cost", "amount_spent", "campaign_spend", "ad_spend", "budget_spent", "total_cost", "spent", "total_spent", "spend_usd", "cost_usd"] },
    { name: "budget", label: "Budget", kind: "number", aliases: ["budget", "target_budget", "daily_budget"] },
    { name: "externalId", label: "External promotion ID", kind: "text", aliases: ["external_id", "promotion_id", "campaign_id", "id", "record_id", "ad_set_id"] },
    { name: "postId", label: "Promoted post (ID)", kind: "text", aliases: ["post_id", "linked_post_id", "postId", "promoted_post", "promoted_post_id"] },
    currencyField,
    {
      name: "objective", label: "Objective", kind: "enum", enumValues: OBJECTIVES, aliases: ["objective", "goal", "campaign_objective"],
      enumAliases: {
        outcome_sales: "orders", outcome_leads: "qualified_enquiries", outcome_traffic: "awareness", outcome_awareness: "awareness",
        outcome_engagement: "awareness", outcome_app_promotion: "orders", product_sales: "orders",
        website_visits: "awareness", video_views: "awareness", engagement: "awareness",
        leads: "qualified_enquiries", enquiries: "qualified_enquiries", sales: "orders", conversions: "orders",
        traffic: "awareness", reach: "awareness", brand_awareness: "awareness", website_traffic: "awareness",
        lead_generation: "qualified_enquiries", catalog_sales: "orders",
      },
      default: (o) => o.defaults.objective, defaultLabel: (o) => `objective = ${o.defaults.objective}`,
    },
    count("impressions", "Impressions", ["total_impressions", "views", "impr"]),
    count("clicks", "Clicks", ["link_clicks", "ad_clicks", "outbound_clicks", "clicks_all", "clicks_destination"]),
    count("reach", "Reach", ["total_reach", "unique_impressions"]),
    notes,
  ],
  leads: [
    dateField("date", "Date", ["created", "enquiry_date", "received", "created_date", "created_at", "lead_date", "date"]),
    { name: "source", label: "Source / Channel", kind: "text", aliases: ["source", "channel", "origin", "platform", "lead_source", "medium", "referrer"] },
    { name: "qualified", label: "Qualified", kind: "bool", aliases: ["qualified", "is_qualified", "qualified_lead"], default: () => false, defaultLabel: () => "qualified = no" },
    {
      name: "status", label: "Status", kind: "enum", enumValues: ["new", "in_conversation", "won", "lost"], aliases: ["status", "stage", "lead_status"],
      enumAliases: {
        open: "new", fresh: "new", talking: "in_conversation", contacted: "in_conversation",
        in_conversation: "in_conversation", "in conversation": "in_conversation", in_progress: "in_conversation", engaged: "in_conversation",
        closed_won: "won", converted: "won", won: "won", success: "won",
        closed_lost: "lost", lost: "lost", dead: "lost", junk: "lost", disqualified: "lost",
      },
      default: () => "new", defaultLabel: () => "status = new",
    },
    { name: "externalId", label: "External lead ID", kind: "text", aliases: ["external_id", "lead_id", "id", "record_id", "enquiry_id"] },
    { name: "postId", label: "Linked post (ID)", kind: "text", aliases: ["post_id", "linked_post_id", "postId", "post_ref", "post_reference", "linked_post"] },
    { name: "promotionId", label: "Linked promotion (ID)", kind: "text", aliases: ["promotion_id", "linked_promotion_id", "promotionId", "promo_id", "promotion_ref", "linked_promotion", "campaign_id", "linked_campaign_id"] },
    { name: "value", label: "Value", kind: "number", aliases: ["value", "amount", "deal_value", "deal_size", "estimated_value"] },
    currencyField, notes,
  ],
  sales: [
    dateField("date", "Date", ["order_date", "sold_on", "created", "created_at", "paid_at", "order_time", "date"]),
    { name: "orderNumber", label: "Order / Invoice #", kind: "text", aliases: ["order_number", "orderNumber", "order_id", "order_no", "invoice", "invoice_number", "record_id", "id", "order_name", "transaction_id", "charge_id", "payment_id", "order", "name"] },
    { name: "amount", label: "Amount", kind: "number", required: true, aliases: ["amount", "total", "revenue", "order_total", "price", "gross", "subtotal", "total_sales", "total_paid", "amount_paid"] },
    { name: "quantity", label: "Quantity", kind: "int", aliases: ["quantity", "qty", "count", "items", "lineitem_quantity", "total_quantity", "item_qty", "number_of_items"] },
    currencyField,
    {
      name: "status", label: "Status", kind: "enum", enumValues: ["confirmed", "pending", "partially_refunded", "refunded"], aliases: ["status", "order_status", "financial_status", "payment_status"],
      enumAliases: {
        paid: "confirmed", complete: "confirmed", completed: "confirmed", fulfilled: "confirmed", delivered: "confirmed",
        succeeded: "confirmed", captured: "confirmed", settled: "confirmed", shipped: "confirmed", partially_shipped: "confirmed",
        awaiting_fulfillment: "confirmed", awaiting_shipment: "confirmed", awaiting_pickup: "confirmed", disputed: "confirmed",
        wc_completed: "confirmed", wc_processing: "confirmed",
        unpaid: "pending", authorized: "pending", open: "pending", processing: "pending", awaiting_payment: "pending",
        wc_pending: "pending", wc_on_hold: "pending", on_hold: "pending", pending_payment: "pending", created: "pending",
        wc_refunded: "refunded", wc_cancelled: "refunded", reversed: "refunded", canceled: "refunded",
        partial_refund: "partially_refunded", partially_refund: "partially_refunded", partially_refunded: "partially_refunded", "partially refunded": "partially_refunded", wc_partially_refunded: "partially_refunded",
        refund: "refunded", refunded: "refunded", returned: "refunded", cancelled: "refunded", voided: "refunded",
      },
      default: () => "confirmed", defaultLabel: () => "status = confirmed",
    },
    { name: "discountAmount", label: "Discount", kind: "number", aliases: ["discount_amount", "discountAmount", "discount", "discounts", "total_discount", "discount_total", "coupon_amount"] },
    { name: "refundAmount", label: "Refund amount", kind: "number", aliases: ["refund_amount", "refundAmount", "refundamount", "refund", "refunded_amount", "refund_value", "total_refunded", "return_amount", "amount_refunded", "order_total_refund"] },
    { name: "product", label: "Product or service", kind: "text", aliases: ["product", "item", "product_name", "service", "lineitem_name", "title", "item_title", "description"] },
    { name: "postId", label: "Linked post (ID)", kind: "text", aliases: ["post_id", "linked_post_id", "postId", "post_ref", "post_reference", "linked_post"] },
    { name: "promotionId", label: "Linked promotion (ID)", kind: "text", aliases: ["promotion_id", "linked_promotion_id", "promotionId", "promo_id", "promotion_ref", "linked_promotion", "campaign_id", "linked_campaign_id"] },
    { name: "leadId", label: "Linked lead (ID)", kind: "text", aliases: ["lead_id", "linked_lead_id", "leadId", "enquiry_id", "linked_lead"] },
    {
      name: "attribution", label: "Source certainty", kind: "enum", enumValues: ["unknown", "estimated", "manual_reported"], aliases: ["attribution", "source_certainty"],
      enumAliases: {
        manual_reported: "manual_reported", "manual reported": "manual_reported", manual: "manual_reported", self_reported: "manual_reported",
        estimated: "estimated", model: "estimated", analytics: "estimated",
        unknown: "unknown", none: "unknown", unattributed: "unknown",
      },
      default: () => "unknown", defaultLabel: () => "source certainty = unknown",
    },
    notes,
  ],
  costs: [
    {
      name: "category", label: "Category", kind: "enum", enumValues: ["cogs", "fees", "shipping", "returns", "disputes", "other"], aliases: ["category", "cost_type", "type_of_cost", "expense_type"],
      enumAliases: {
        cost_of_goods: "cogs", cost_of_goods_sold: "cogs", "cost of goods": "cogs", "cost of goods sold": "cogs", cogs: "cogs", goods: "cogs", inventory: "cogs",
        fee: "fees", payment_fees: "fees", processing: "fees", platform_fee: "fees",
        shipping: "shipping", delivery: "shipping", fulfillment: "shipping", postage: "shipping",
        return: "returns", returns: "returns", refund: "returns",
        chargeback: "disputes", chargebacks: "disputes", dispute: "disputes",
        operational: "other", overhead: "other", other: "other",
      },
      default: () => "other", defaultLabel: () => "category = other",
    },
    {
      name: "kind", label: "Amount or percentage", kind: "enum", enumValues: ["amount", "percentage"], aliases: ["kind", "unit", "amount_type"],
      enumAliases: {
        percent: "percentage", pct: "percentage", "%": "percentage",
        fixed: "amount", flat: "amount", fixed_amount: "amount", "fixed amount": "amount", amount: "amount",
      },
      default: () => "amount", defaultLabel: () => "type = amount",
    },
    {
      name: "scope", label: "Cost scope", kind: "enum", enumValues: ["business_level", "per_order", "per_unit"], aliases: ["scope", "level", "cost_scope"],
      enumAliases: { business: "business_level", general: "business_level", fixed: "business_level", order: "per_order", unit: "per_unit", per_item: "per_unit" },
    },
    { name: "amount", label: "Value", kind: "number", required: true, aliases: ["amount", "value", "cost", "expense_amount"] },
    currencyField,
    {
      name: "frequency", label: "How often", kind: "enum", enumValues: ["one_off", "monthly", "yearly"], aliases: ["frequency", "recurrence", "repeats"],
      enumAliases: {
        once: "one_off", "one-off": "one_off", one_off: "one_off", single: "one_off",
        month: "monthly", monthly: "monthly",
        year: "yearly", annual: "yearly", annually: "yearly",
      },
      default: () => "one_off", defaultLabel: () => "frequency = one off",
    },
    dateField("effectiveDate", "Effective from", ["effective_date", "effectiveDate", "effective", "date", "from", "start_date", "start"]),
    dateField("endDate", "Ends on", ["end_date", "endDate", "end", "until", "to"], false),
    notes,
  ],
};

// ---------- Cell parsing ----------

export const norm = (s: string): string =>
  s
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, "_")
    .replace(/^_+|_+$/g, "");

export function autoMap(headers: string[], coll: RecordCollection): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  const normalized = headers.map((h) => [h, norm(h)] as const);
  for (const f of IMPORT_SPECS[coll]) {
    // 1. Exact match on field name
    const exactName = norm(f.name);
    const exactHit = normalized.find(([h, n]) => !used.has(h) && n === exactName);
    if (exactHit) {
      mapping[f.name] = exactHit[0];
      used.add(exactHit[0]);
      continue;
    }
    // 2. Ordered alias matches
    const aliasHits = f.aliases.map((a) => norm(a));
    let hit: (readonly [string, string]) | undefined;
    for (const a of aliasHits) {
      hit = normalized.find(([h, n]) => !used.has(h) && n === a);
      if (hit) break;
    }
    if (hit) {
      mapping[f.name] = hit[0];
      used.add(hit[0]);
    }
  }
  return mapping;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "Oct 1, 2026", "October 01, 2026", "1 Oct 2026", "1-Oct-2026". Month names are unambiguous, so no format choice is needed. */
function parseNamedMonthDate(s: string): string | null {
  const a = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[T\s].*)?$/.exec(s);
  const b = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})(?:[T\s].*)?$/.exec(s);
  const parts = a ? [a[1], a[2], a[3]] : b ? [b[2], b[1], b[3]] : null;
  if (!parts) return null;
  const [mon, day, year] = parts;
  const m = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
  if (m === 0) return null;
  const y = +year, d = +day;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const named = parseNamedMonthDate(s);
  if (named) return named;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else {
    const g = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/.exec(s);
    if (!g || fmt === "iso") return null;
    [y, m, d] = fmt === "mdy" ? [+g[3], +g[1], +g[2]] : [+g[3], +g[2], +g[1]];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseNumber(raw: string, fmt: NumberFormat): number | null {
  let s = raw.trim().replace(/[\s ]/g, "").replace(/[^\d.,%()-]/g, "");
  if (/%/.test(s)) return null; // handled by caller as a clear error
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()-]/g, "");
  if (fmt === "us") s = s.replace(/,/g, "");
  else s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const TRUE = new Set(["yes", "y", "true", "1", "qualified", "x"]);
const FALSE = new Set(["no", "n", "false", "0", "unqualified"]);

export interface RowError { field?: string; message: string }
export interface NormalizedRow { record?: Record<string, unknown>; errors: RowError[]; defaultsApplied: string[] }

export function normalizeRow(
  coll: RecordCollection, row: Record<string, string>, mapping: Record<string, string>, opts: ImportOptions,
): NormalizedRow {
  const obj: Record<string, unknown> = {};
  const errors: RowError[] = [];
  const defaultsApplied: string[] = [];

  for (const f of IMPORT_SPECS[coll]) {
    const header = mapping[f.name];
    const raw = header ? (row[header] ?? "").trim() : "";
    if (raw === "") {
      if (f.default) { obj[f.name] = f.default(opts); defaultsApplied.push(f.defaultLabel?.(opts) ?? f.name); }
      else if (f.required) errors.push({ field: f.label, message: header ? "is empty" : "has no column selected" });
      continue;
    }
    switch (f.kind) {
      case "text": obj[f.name] = f.name === "currency" ? raw.toUpperCase() : raw; break;
      case "date": {
        const d = parseDate(raw, opts.dateFormat);
        if (d) obj[f.name] = d; else errors.push({ field: f.label, message: `"${raw}" is not a valid date for the chosen date format` });
        break;
      }
      case "number": case "int": {
        if (/%/.test(raw) && coll === "costs") { obj[f.name] = raw; errors.push({ field: f.label, message: "has a % sign. Set the type column to percentage and remove the sign" }); break; }
        const n = parseNumber(raw, opts.numberFormat);
        if (n === null) errors.push({ field: f.label, message: `"${raw}" is not a number` });
        else if (n < 0) errors.push({ field: f.label, message: "cannot be negative" });
        else if (f.kind === "int" && !Number.isInteger(n)) errors.push({ field: f.label, message: `"${raw}" must be a whole number` });
        else obj[f.name] = n;
        break;
      }
      case "bool": {
        const k = raw.toLowerCase();
        if (TRUE.has(k)) obj[f.name] = true; else if (FALSE.has(k)) obj[f.name] = false;
        else errors.push({ field: f.label, message: `"${raw}" should be yes or no` });
        break;
      }
      case "enum": {
        const k = raw.toLowerCase().trim().replace(/[\s\-/]+/g, "_");
        const rawTrim = raw.toLowerCase().trim();
        const v = f.enumValues!.includes(k) ? k : (f.enumAliases?.[k] ?? f.enumAliases?.[rawTrim]);
        if (v) obj[f.name] = v;
        else errors.push({ field: f.label, message: `"${raw}" is not recognised. Use one of: ${f.enumValues!.join(", ")}` });
        break;
      }
    }
  }
  if (errors.length > 0) return { errors, defaultsApplied };

  // A value without a currency in leads: default already applied above only when column empty.
  if (coll === "leads" && obj.value === undefined) delete obj.currency;
  if (coll === "sales" && obj.refundAmount === undefined && obj.status === "partially_refunded") {
    return { errors: [{ field: "Refund amount", message: "is required when status is partially refunded" }], defaultsApplied };
  }
  const parsed = (recordSchemas[coll] as z.ZodTypeAny).safeParse(obj);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })), defaultsApplied };
  }
  return { record: parsed.data as Record<string, unknown>, errors: [], defaultsApplied };
}

/** Headers that no field is mapped to. */
export function ignoredColumns(rows: Record<string, string>[], mapping: Record<string, string>): string[] {
  const used = new Set(Object.values(mapping));
  const all = new Set<string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) all.add(k);
  return [...all].filter((h) => !used.has(h));
}

const NON_SALE_STATUS = new Set(["failed", "declined", "denied", "abandoned", "expired", "draft", "incomplete", "wc_failed", "wc_checkout_draft", "checkout_draft", "uncaptured"]);
/** Transaction types in payment-provider exports that move money but are not sales. */
const NON_SALE_TYPE = /(withdraw|payout|transfer|deposit|conversion|reserve|fee|reversal|adjustment|dispute|chargeback|refund|hold|release|top.?up)/i;

/**
 * Rows in a sales export that are real rows of the file but not sales: extra line items of an order Shopify already
 * counted, failed payments, and refund, fee or payout lines from Stripe and PayPal. Returns a reason, or null to import.
 */
function salesRowSkipReason(row: Record<string, string>, mapping: Record<string, string>, opts: ImportOptions, prevOrder: string): string | null {
  const cell = (field: string) => (mapping[field] ? (row[mapping[field]] ?? "").trim() : "");
  const amount = cell("amount");
  const order = cell("orderNumber");
  if (amount === "" && order !== "" && order === prevOrder) return "extra product lines of an order (the order total is counted once)";
  const status = cell("status").toLowerCase().replace(/[\s-]+/g, "_");
  if (status && NON_SALE_STATUS.has(status)) return "failed, declined or unfinished payments";
  const typeHeader = Object.keys(row).find((h) => norm(h) === "type" || norm(h) === "transaction_type" || norm(h) === "balance_impact_type");
  if (typeHeader && !Object.values(mapping).includes(typeHeader) && NON_SALE_TYPE.test(row[typeHeader] ?? "")) return "refund, fee, transfer or payout lines (not sales)";
  if (amount !== "") {
    const n = parseNumber(amount, opts.numberFormat);
    if (n !== null && n < 0) return "negative amounts (refunds, fees or payouts)";
  }
  return null;
}

/** Stable JSON for duplicate detection. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export interface SkippedRows { reason: string; count: number; lines: number[] }
export interface ImportAnalysis {
  total: number;
  /** Rows left out on purpose (extra line items, refunds, fees, failed payments). Not errors. */
  skipped: SkippedRows[];
  /** Columns in the file that no field uses. They are not imported and not stored. */
  ignoredColumns: string[];
  valid: { line: number; record: Record<string, unknown>; key: string }[];
  invalid: { line: number; errors: RowError[] }[];
  duplicatesInFile: { line: number; firstLine: number }[];
  defaultsApplied: string[];
}

/** Whole-file analysis used for the preview and again, authoritatively, on the server. */
export function analyzeRows(
  coll: RecordCollection, rows: Record<string, string>[], mapping: Record<string, string>, opts: ImportOptions,
): ImportAnalysis {
  const a: ImportAnalysis = { total: rows.length, skipped: [], ignoredColumns: ignoredColumns(rows, mapping), valid: [], invalid: [], duplicatesInFile: [], defaultsApplied: [] };
  const skip = (reason: string, line: number) => {
    let s = a.skipped.find((x) => x.reason === reason);
    if (!s) { s = { reason, count: 0, lines: [] }; a.skipped.push(s); }
    s.count++; if (s.lines.length < 10) s.lines.push(line);
  };
  let prevOrder = "";
  const first = new Map<string, number>();
  const defaults = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    if (coll === "sales") {
      const why = salesRowSkipReason(row, mapping, opts, prevOrder);
      const order = mapping.orderNumber ? (row[mapping.orderNumber] ?? "").trim() : "";
      if (order) prevOrder = order;
      if (why) { skip(why, line); return; }
    }
    const r = normalizeRow(coll, row, mapping, opts);
    r.defaultsApplied.forEach((d) => defaults.add(d));
    if (!r.record) { a.invalid.push({ line, errors: r.errors }); return; }
    // An order number identifies an order: the same number twice is one order even when other columns were edited.
    const on = coll === "sales" ? String((r.record as Record<string, unknown>).orderNumber ?? "").trim().toLowerCase().replace(/^#/, "") : "";
    const key = on ? `order:${on}` : canonicalJson(r.record);
    const seen = first.get(key);
    if (seen !== undefined) { a.duplicatesInFile.push({ line, firstLine: seen }); return; }
    first.set(key, line);
    a.valid.push({ line, record: r.record, key });
  });
  a.defaultsApplied = [...defaults];
  return a;
}

export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  // Neutralize CSV formula injection: prefix =, +, -, @, \t, \r with single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildSafeCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(sanitizeCsvCell).join(",");
  const dataLines = rows.map((row) => row.map(sanitizeCsvCell).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export function buildTemplate(coll: RecordCollection): string {
  return IMPORT_SPECS[coll].map((f) => f.name).join(",") + "\n";
}

export interface DetectedFormat {
  /** Platform value to use when the file has no platform column. */
  platformEnum?: (typeof PLATFORMS)[number];
  isMultiType: boolean;
  typeColumn?: string;
  typeCounts?: Partial<Record<RecordCollection, number>>;
  partitions?: Partial<Record<RecordCollection, Record<string, string>[]>>;
  detectedCollection?: RecordCollection;
  detectedPlatform?: string;
  confidence: "high" | "medium" | "low";
}

const TYPE_MAP: Record<string, RecordCollection> = {
  post: "posts", posts: "posts", marketing_post: "posts", content: "posts", social: "posts",
  promotion: "promotions", promotions: "promotions", ad: "promotions", ads: "promotions", campaign: "promotions", campaigns: "promotions", paid_ad: "promotions",
  lead: "leads", leads: "leads", enquiry: "leads", enquiries: "leads", inquiry: "leads", inquiries: "leads", prospect: "leads", prospects: "leads",
  sale: "sales", sales: "sales", order: "sales", orders: "sales", revenue: "sales", transaction: "sales", transactions: "sales",
  cost: "costs", costs: "costs", expense: "costs", expenses: "costs", spend: "costs", cogs: "costs",
};

export function detectFileFormat(headers: string[], rows: Record<string, string>[]): DetectedFormat {
  if (headers.length === 0) {
    return { isMultiType: false, confidence: "low" };
  }

  // 1. Check for multi-type discriminator column
  const typeColHeader = headers.find((h) => {
    const n = norm(h);
    return n === "record_type" || n === "type" || n === "record_collection" || n === "collection" || n === "entity_type" || n === "row_type";
  });

  if (typeColHeader && rows.length > 0) {
    const partitions: Partial<Record<RecordCollection, Record<string, string>[]>> = {};
    const typeCounts: Partial<Record<RecordCollection, number>> = {};
    let recognizedRows = 0;

    for (const r of rows) {
      const val = norm(r[typeColHeader] ?? "");
      const coll = TYPE_MAP[val];
      if (coll) {
        if (!partitions[coll]) partitions[coll] = [];
        partitions[coll]!.push(r);
        typeCounts[coll] = (typeCounts[coll] ?? 0) + 1;
        recognizedRows++;
      }
    }

    const collsFound = Object.keys(partitions) as RecordCollection[];
    if (collsFound.length >= 2 || (collsFound.length === 1 && (norm(typeColHeader) === "record_type" || norm(typeColHeader) === "record_collection"))) {
      return {
        isMultiType: true,
        typeColumn: typeColHeader,
        typeCounts,
        partitions,
        detectedCollection: collsFound[0],
        confidence: "high",
      };
    }
  }

  // 2. Check for known platform exports (Meta Ads, Google Ads, TikTok Ads, Shopify, Stripe)
  const normHeaders = headers.map(norm);
  const set = new Set(normHeaders);

  const hit = (detectedCollection: RecordCollection, detectedPlatform: string, platformEnum?: (typeof PLATFORMS)[number]): DetectedFormat =>
    ({ isMultiType: false, detectedCollection, detectedPlatform, platformEnum, confidence: "high" });
  const has = (...names: string[]) => names.every((n) => set.has(n));

  // Ad platforms. More specific signatures first.
  if (has("campaign_group_name") || has("total_spent") || (has("campaign_name") && has("start_date") && (set.has("leads") || set.has("sends")))) return hit("promotions", "LinkedIn Ads", "other");
  if (set.has("7_day_total_sales") || set.has("14_day_total_sales") || set.has("advertised_sku") || set.has("acos") || set.has("total_advertising_cost_of_sales_acos")) return hit("promotions", "Amazon Ads", "marketplace");
  if (set.has("reporting_starts") || set.has("amount_spent") || (has("campaign_name", "link_clicks"))) return hit("promotions", "Meta Ads", "facebook");
  if (set.has("stat_time") || set.has("stat_time_day") || (has("cpc", "cpm") && !set.has("campaign_state")) || normHeaders.some((h) => h.includes("tiktok"))) return hit("promotions", "TikTok Ads", "tiktok");
  if (set.has("campaign_state") || set.has("search_keyword") || set.has("currency_code") && set.has("cost") && set.has("clicks") || (has("campaign", "cost", "clicks"))) return hit("promotions", "Google Ads", "google");

  // Store and payment exports.
  if (set.has("paid_at") || set.has("lineitem_name") || (set.has("financial_status") && set.has("fulfillment_status"))) return hit("sales", "Shopify Orders");
  if (set.has("amount_refunded") || set.has("converted_amount") || (set.has("charge_id") && set.has("amount")) || (set.has("created") && set.has("amount") && (set.has("fee") || set.has("captured") || set.has("customer_email")))) return hit("sales", "Stripe Payments");
  if (set.has("balance_impact") || (set.has("gross") && set.has("fee") && set.has("net"))) return hit("sales", "PayPal Transactions");
  if (set.has("order_currency") || set.has("order_total_amount") || set.has("order_shipping_amount") || set.has("payment_method_title") || normHeaders.some((h) => h.startsWith("billing_") && set.has("order_status"))) return hit("sales", "WooCommerce (WordPress) Orders");
  if (set.has("order_status") && (set.has("order_total") || set.has("order_total_inc_tax")) ) return hit("sales", "BigCommerce / store Orders");

  // 3. Fallback: Score each collection based on autoMap matches and required fields
  const scores: Record<RecordCollection, number> = { posts: 0, promotions: 0, leads: 0, sales: 0, costs: 0 };
  for (const coll of Object.keys(scores) as RecordCollection[]) {
    const m = autoMap(headers, coll);
    scores[coll] = Object.keys(m).length;
    const reqs = IMPORT_SPECS[coll].filter((f) => f.required);
    const hasAllReqs = reqs.every((f) => m[f.name]);
    if (hasAllReqs) scores[coll] += 5;
  }

  const sorted = (Object.keys(scores) as RecordCollection[]).sort((a, b) => scores[b] - scores[a]);
  const best = sorted[0];
  const confidence = scores[best] >= 3 ? "medium" : "low";

  return {
    isMultiType: false,
    detectedCollection: best,
    confidence,
  };
}

export const importBatchSchema = z.object({
  collection: z.enum(["posts", "promotions", "leads", "sales", "costs"]),
  mapping: z.record(z.string().max(100), z.string().max(200)),
  rows: z.array(z.record(z.string().max(200), z.string().max(2000))),
});

export const importRecordsInput = z.object({
  workspaceId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128),
  collection: z.enum(["posts", "promotions", "leads", "sales", "costs"]).default("sales"),
  requestId: z.string().min(8).max(64),
  fileName: z.string().max(200),
  dryRun: z.boolean().optional(),
  source: z.literal("csv").default("csv"),
  mapping: z.record(z.string().max(100), z.string().max(200)).optional().default({}),
  options: z.object({
    dateFormat: z.enum(["iso", "mdy", "dmy"]),
    numberFormat: z.enum(["us", "eu"]),
    /** Platform to use when the file has no platform column (set from the detected export). */
    platform: z.enum(PLATFORMS).optional(),
  }),
  rows: z.array(z.record(z.string().max(200), z.string().max(2000))).max(IMPORT_LIMITS.maxRows).optional().default([]),
  batches: z.array(importBatchSchema).optional(),
});


// ---------- Links between imported records ----------

/** Link fields and the collection each one points at. */
export const LINK_FIELDS: { field: "postId" | "promotionId" | "leadId"; target: RecordCollection }[] = [
  { field: "postId", target: "posts" },
  { field: "promotionId", target: "promotions" },
  { field: "leadId", target: "leads" },
];
