import { z } from "zod";
import { PLATFORMS, recordSchemas, type RecordCollection } from "./records";
import { OBJECTIVES } from "./schemas";

export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 2000, maxColumns: 50 } as const;

export type DateFormat = "iso" | "mdy" | "dmy";
export type NumberFormat = "us" | "eu"; // us: 1,234.56  eu: 1.234,56
export interface ImportOptions {
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  defaults: { currency: string; objective: string };
}

// ---------- CSV parsing (RFC 4180 style: quotes, escaped quotes, newlines in cells, BOM) ----------

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",", bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    let count = 0, quoted = false;
    for (const ch of firstLine) { if (ch === '"') quoted = !quoted; else if (ch === d && !quoted) count++; }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

export function parseCsv(input: string): { headers: string[]; rows: string[][]; delimiter: string } {
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
  if (nonEmpty.length === 0) return { headers: [], rows: [], delimiter };
  const seen = new Map<string, number>();
  const headers = nonEmpty[0].map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
  return { headers, rows: nonEmpty.slice(1), delimiter };
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
const platform: ImportField = {
  name: "platform", label: "Platform", kind: "enum", required: true, enumValues: PLATFORMS,
  aliases: ["platform", "channel", "network", "source"],
  enumAliases: {
    ig: "instagram", insta: "instagram", fb: "facebook", meta: "facebook", whatsapp: "whatsapp_dm", wa: "whatsapp_dm",
    dm: "whatsapp_dm", dms: "whatsapp_dm", direct_message: "whatsapp_dm", instore: "in_person", in_store: "in_person",
    store: "in_person", call: "phone", calls: "phone", tiktok_shop: "tiktok", etsy: "marketplace", amazon: "marketplace",
  },
};
const currencyField: ImportField = {
  name: "currency", label: "Currency", kind: "text", aliases: ["currency", "curr", "ccy"],
  default: (o) => o.defaults.currency, defaultLabel: (o) => `currency = ${o.defaults.currency}`,
};
const notes: ImportField = { name: "notes", label: "Notes", kind: "text", aliases: ["notes", "note", "comment", "description"] };
const dateField = (name: string, label: string, aliases: string[], required = true): ImportField => ({ name, label, kind: "date", required, aliases: [name, ...aliases] });

export const IMPORT_SPECS: Record<RecordCollection, ImportField[]> = {
  posts: [
    platform,
    dateField("publishedAt", "Published on", ["date", "published", "post_date", "posted", "posted_on"]),
    { name: "format", label: "Format", kind: "text", aliases: ["format", "type", "media_type", "post_type"] },
    { name: "topic", label: "Topic", kind: "text", aliases: ["topic", "theme", "tag", "subject"] },
    count("reach", "Reach", ["accounts_reached"]),
    count("views", "Views", ["video_views", "plays"]),
    count("likes", "Likes", ["reactions"]),
    count("comments", "Comments"), count("shares", "Shares", ["reposts"]), count("saves", "Saves", ["bookmarks"]),
    notes,
  ],
  promotions: [
    platform,
    dateField("startDate", "Start date", ["start", "date", "from", "begin"]),
    dateField("endDate", "End date", ["end", "to", "stop"], false),
    { name: "spend", label: "Spend", kind: "number", required: true, aliases: ["spend", "cost", "amount_spent", "ad_spend", "budget_spent"] },
    currencyField,
    {
      name: "objective", label: "Objective", kind: "enum", enumValues: OBJECTIVES, aliases: ["objective", "goal"],
      enumAliases: { leads: "qualified_enquiries", enquiries: "qualified_enquiries", sales: "orders", conversions: "orders", traffic: "awareness", reach: "awareness" },
      default: (o) => o.defaults.objective, defaultLabel: (o) => `objective = ${o.defaults.objective}`,
    },
    count("impressions", "Impressions"), count("clicks", "Clicks", ["link_clicks"]), count("reach", "Reach"),
    notes,
  ],
  leads: [
    dateField("date", "Date", ["created", "enquiry_date", "received"]),
    { name: "qualified", label: "Qualified", kind: "bool", aliases: ["qualified", "is_qualified", "qualified_lead"], default: () => false, defaultLabel: () => "qualified = no" },
    {
      name: "status", label: "Status", kind: "enum", enumValues: ["new", "in_conversation", "won", "lost"], aliases: ["status", "stage"],
      enumAliases: { open: "new", talking: "in_conversation", contacted: "in_conversation", closed_won: "won", converted: "won", closed_lost: "lost", dead: "lost" },
      default: () => "new", defaultLabel: () => "status = new",
    },
    { name: "value", label: "Value", kind: "number", aliases: ["value", "amount", "deal_value"] },
    currencyField, notes,
  ],
  sales: [
    dateField("date", "Date", ["order_date", "sold_on", "created"]),
    { name: "amount", label: "Amount", kind: "number", required: true, aliases: ["amount", "total", "revenue", "order_total", "price", "gross"] },
    currencyField,
    {
      name: "status", label: "Status", kind: "enum", enumValues: ["confirmed", "pending", "partially_refunded", "refunded"], aliases: ["status", "order_status"],
      enumAliases: { paid: "confirmed", complete: "confirmed", completed: "confirmed", fulfilled: "confirmed", delivered: "confirmed", unpaid: "pending", partial_refund: "partially_refunded", refund: "refunded", returned: "refunded" },
      default: () => "confirmed", defaultLabel: () => "status = confirmed",
    },
    { name: "refundAmount", label: "Refund amount", kind: "number", aliases: ["refundamount", "refund", "refunded_amount"] },
    { name: "product", label: "Product or service", kind: "text", aliases: ["product", "item", "product_name", "service"] },
    {
      name: "attribution", label: "Source certainty", kind: "enum", enumValues: ["unknown", "estimated", "manual_reported"], aliases: ["attribution"],
      default: () => "unknown", defaultLabel: () => "source certainty = unknown",
    },
    notes,
  ],
  costs: [
    {
      name: "category", label: "Category", kind: "enum", enumValues: ["cogs", "fees", "shipping", "returns", "other"], aliases: ["category", "cost_type", "type_of_cost"],
      enumAliases: { cost_of_goods: "cogs", cost_of_goods_sold: "cogs", goods: "cogs", fee: "fees", payment_fees: "fees", processing: "fees", delivery: "shipping", fulfillment: "shipping", return: "returns" },
      default: () => "other", defaultLabel: () => "category = other",
    },
    {
      name: "kind", label: "Amount or percentage", kind: "enum", enumValues: ["amount", "percentage"], aliases: ["kind", "unit", "amount_type"],
      enumAliases: { percent: "percentage", pct: "percentage", "%": "percentage", fixed: "amount", flat: "amount" },
      default: () => "amount", defaultLabel: () => "type = amount",
    },
    { name: "amount", label: "Value", kind: "number", required: true, aliases: ["amount", "value", "cost"] },
    currencyField,
    dateField("effectiveDate", "Effective from", ["effective", "date", "from", "start_date", "start"]),
    notes,
  ],
};

// ---------- Cell parsing ----------

const norm = (s: string) => s.trim().toLowerCase().replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-z0-9%]+/g, "_").replace(/^_+|_+$/g, "");

export function autoMap(headers: string[], coll: RecordCollection): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  const normalized = headers.map((h) => [h, norm(h)] as const);
  for (const f of IMPORT_SPECS[coll]) {
    const wanted = new Set([f.name, ...f.aliases].map((a) => norm(a)));
    const hit = normalized.find(([h, n]) => !used.has(h) && wanted.has(n));
    if (hit) { mapping[f.name] = hit[0]; used.add(hit[0]); }
  }
  return mapping;
}

function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
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
        const v = f.enumValues!.includes(k) ? k : f.enumAliases?.[k];
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

/** Stable JSON for duplicate detection. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export interface ImportAnalysis {
  total: number;
  valid: { line: number; record: Record<string, unknown>; key: string }[];
  invalid: { line: number; errors: RowError[] }[];
  duplicatesInFile: { line: number; firstLine: number }[];
  defaultsApplied: string[];
}

/** Whole-file analysis used for the preview and again, authoritatively, on the server. */
export function analyzeRows(
  coll: RecordCollection, rows: Record<string, string>[], mapping: Record<string, string>, opts: ImportOptions,
): ImportAnalysis {
  const a: ImportAnalysis = { total: rows.length, valid: [], invalid: [], duplicatesInFile: [], defaultsApplied: [] };
  const first = new Map<string, number>();
  const defaults = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const r = normalizeRow(coll, row, mapping, opts);
    r.defaultsApplied.forEach((d) => defaults.add(d));
    if (!r.record) { a.invalid.push({ line, errors: r.errors }); return; }
    const key = canonicalJson(r.record);
    const seen = first.get(key);
    if (seen !== undefined) { a.duplicatesInFile.push({ line, firstLine: seen }); return; }
    first.set(key, line);
    a.valid.push({ line, record: r.record, key });
  });
  a.defaultsApplied = [...defaults];
  return a;
}

export function buildTemplate(coll: RecordCollection): string {
  return IMPORT_SPECS[coll].map((f) => f.name).join(",") + "\n";
}

export const importRecordsInput = z.object({
  workspaceId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128),
  collection: z.enum(["posts", "promotions", "leads", "sales", "costs"]),
  requestId: z.string().min(8).max(64),
  fileName: z.string().max(200),
  dryRun: z.boolean().optional(),
  /** "screenshot" rows come from AI extraction and must be human-reviewed (spec AC-04). */
  source: z.enum(["csv", "screenshot"]).default("csv"),
  reviewConfirmed: z.boolean().optional(),
  uploadPath: z.string().max(300).optional(),
  mapping: z.record(z.string().max(100), z.string().max(200)),
  options: z.object({
    dateFormat: z.enum(["iso", "mdy", "dmy"]),
    numberFormat: z.enum(["us", "eu"]),
  }),
  rows: z.array(z.record(z.string().max(200), z.string().max(2000))).min(1).max(IMPORT_LIMITS.maxRows),
});

export const SCREENSHOT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 100 } as const;

export const extractScreenshotInput = z.object({
  workspaceId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128),
  collection: z.enum(["posts", "promotions", "leads", "sales", "costs"]),
  requestId: z.string().min(8).max(64),
  uploadPath: z.string().min(1).max(300),
});
