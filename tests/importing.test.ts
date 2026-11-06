import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  analyzeRows, autoMap, buildTemplate, detectDelimiter, detectFileFormat, normalizeRow, norm, parseCsv, rowsToObjects, type ImportOptions,
} from "../functions/src/shared/importing";
import type { RecordCollection } from "../functions/src/shared/records";

const opts: ImportOptions = { dateFormat: "iso", numberFormat: "us", defaults: { currency: "USD", objective: "qualified_enquiries" } };

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, newlines in cells, CRLF and BOM", () => {
    const r = parseCsv('﻿name,note\r\n"A, B","said ""hi"""\r\nC,"line1\nline2"\r\n');
    expect(r.headers).toEqual(["name", "note"]);
    expect(r.rows).toEqual([["A, B", 'said "hi"'], ["C", "line1\nline2"]]);
  });
  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
  });
  it("skips blank lines and makes duplicate headers unique", () => {
    const r = parseCsv("a,a,\n1,2,3\n\n,,\n");
    expect(r.headers).toEqual(["a", "a_2", "column_3"]);
    expect(r.rows).toHaveLength(1);
  });
  it("empty file", () => expect(parseCsv("").headers).toEqual([]));
});

describe("autoMap", () => {
  it("maps common headers for sales", () => {
    const m = autoMap(["Order Date", "Total", "Currency", "Order Status", "Item"], "sales");
    expect(m).toMatchObject({ date: "Order Date", amount: "Total", currency: "Currency", status: "Order Status", product: "Item" });
  });
  it("maps posts headers incl. camelCase and platform aliases", () => {
    const m = autoMap(["publishedAt", "Channel", "Reach", "Likes"], "posts");
    expect(m).toMatchObject({ publishedAt: "publishedAt", platform: "Channel", reach: "Reach", likes: "Likes" });
  });
  it("does not map one column to two fields", () => {
    const m = autoMap(["Date"], "promotions");
    expect(Object.values(m).filter((h) => h === "Date")).toHaveLength(1);
  });
});

describe("normalizeRow", () => {
  const sale = (row: Record<string, string>, o = opts) =>
    normalizeRow("sales", row, { date: "d", amount: "a", currency: "c", status: "s" }, o);

  it("valid sale with defaults reported", () => {
    const r = normalizeRow("sales", { d: "2026-10-20", a: "$1,234.50" }, { date: "d", amount: "a" }, opts);
    expect(r.record).toMatchObject({ date: "2026-10-20", amount: 1234.5, currency: "USD", status: "confirmed", attribution: "unknown" });
    expect(r.defaultsApplied).toEqual(expect.arrayContaining(["currency = USD", "status = confirmed"]));
  });
  it("European number format", () => {
    expect(sale({ d: "2026-10-20", a: "1.234,50", c: "EUR", s: "paid" }, { ...opts, numberFormat: "eu" }).record)
      .toMatchObject({ amount: 1234.5, currency: "EUR", status: "confirmed" });
  });
  it("date formats are explicit, not guessed", () => {
    const row = { d: "03/04/2026", a: "10" };
    expect(sale(row, { ...opts, dateFormat: "mdy" }).record?.date).toBe("2026-03-04");
    expect(sale(row, { ...opts, dateFormat: "dmy" }).record?.date).toBe("2026-04-03");
    expect(sale(row, opts).errors[0].message).toMatch(/not a valid date/);
  });
  it("rejects impossible dates", () => expect(sale({ d: "2026-02-31", a: "10" }).errors).toHaveLength(1));
  it("rejects negative amounts and non-numbers", () => {
    expect(sale({ d: "2026-10-20", a: "-5" }).errors[0].message).toMatch(/negative/);
    expect(sale({ d: "2026-10-20", a: "abc" }).errors[0].message).toMatch(/not a number/);
  });
  it("required field missing or empty", () => {
    expect(sale({ d: "", a: "5" }).errors[0].message).toMatch(/empty/);
    expect(normalizeRow("sales", { a: "5" }, { amount: "a" }, opts).errors[0].message).toMatch(/no column/);
  });
  it("unknown enum value gives a clear error, aliases work", () => {
    expect(sale({ d: "2026-10-20", a: "5", s: "weird" }).errors[0].message).toMatch(/not recognised/);
    expect(sale({ d: "2026-10-20", a: "5", s: "Refunded" }).record?.status).toBe("refunded");
  });
  it("partially refunded needs a refund amount", () => {
    expect(sale({ d: "2026-10-20", a: "5", s: "partial refund" }).errors[0].message).toMatch(/refund/i);
  });
  it("posts: platform alias, whole-number counts", () => {
    const m = { platform: "p", publishedAt: "d", reach: "r" };
    expect(normalizeRow("posts", { p: "IG", d: "2026-10-20", r: "1500" }, m, opts).record).toMatchObject({ platform: "instagram", reach: 1500 });
    expect(normalizeRow("posts", { p: "IG", d: "2026-10-20", r: "1.5" }, m, opts).errors[0].message).toMatch(/whole number/);
  });
  it("costs: percentage with % in an amount-type row is an explicit error", () => {
    const m = { amount: "v", effectiveDate: "d" };
    expect(normalizeRow("costs", { v: "3%", d: "2026-10-01" }, m, opts).errors[0].message).toMatch(/percentage/);
    expect(normalizeRow("costs", { v: "3", k: "percent", d: "2026-10-01" }, { ...m, kind: "k" }, opts).record)
      .toMatchObject({ kind: "percentage", amount: 3 });
    expect(normalizeRow("costs", { v: "300", k: "percent", d: "2026-10-01" }, { ...m, kind: "k" }, opts).errors.length).toBe(1);
  });
  it("leads: no value means no currency stored", () => {
    const r = normalizeRow("leads", { d: "2026-10-20" }, { date: "d" }, opts);
    expect(r.record).toMatchObject({ qualified: false, status: "new" });
    expect(r.record).not.toHaveProperty("currency");
  });
});

describe("analyzeRows", () => {
  it("separates valid, invalid and in-file duplicates with line numbers", () => {
    const rows = rowsToObjects(["d", "a"], [["2026-10-20", "10"], ["2026-10-20", "10"], ["bad", "5"], ["2026-10-21", "7"]]);
    const a = analyzeRows("sales", rows, { date: "d", amount: "a" }, opts);
    expect(a.valid.map((v) => v.line)).toEqual([2, 5]);
    expect(a.duplicatesInFile).toEqual([{ line: 3, firstLine: 2 }]);
    expect(a.invalid.map((v) => v.line)).toEqual([4]);
    expect(a.total).toBe(4);
  });
  it("same content gives the same key regardless of column order", () => {
    const a1 = analyzeRows("sales", [{ d: "2026-10-20", a: "10" }], { date: "d", amount: "a" }, opts);
    const a2 = analyzeRows("sales", [{ a: "10", d: "2026-10-20" }], { amount: "a", date: "d" }, opts);
    expect(a1.valid[0].key).toBe(a2.valid[0].key);
  });
});

describe("templates", () => {
  it("header-only templates", () => expect(buildTemplate("sales").trim().split(",")).toContain("amount"));
});

describe("norm function", () => {
  it("converts camelCase and PascalCase to snake_case before lowercasing", () => {
    expect(norm("refundAmount")).toBe("refund_amount");
    expect(norm("RefundAmount")).toBe("refund_amount");
    expect(norm("startDate")).toBe("start_date");
    expect(norm("publishedAt")).toBe("published_at");
    expect(norm("externalId")).toBe("external_id");
  });

  it("strips trailing parenthesized units or currencies", () => {
    expect(norm("Amount spent (EUR)")).toBe("amount_spent");
    expect(norm("Spend (USD)")).toBe("spend");
  });

  it("preserves already snake_cased or separated headers", () => {
    expect(norm("refund_amount")).toBe("refund_amount");
    expect(norm("Refund Amount")).toBe("refund_amount");
    expect(norm("cost_of_goods")).toBe("cost_of_goods");
  });
});

describe("autoMap exact match priority & aliases", () => {
  it("maps refund_amount directly to refundAmount", () => {
    const m = autoMap(["date", "amount", "refund_amount", "status"], "sales");
    expect(m.refundAmount).toBe("refund_amount");
  });

  it("prioritizes exact field names over secondary aliases when both are present", () => {
    const headers = ["date", "value", "amount", "currency"];
    const costMap = autoMap(headers, "costs");
    expect(costMap.amount).toBe("amount");

    const leadMap = autoMap(headers, "leads");
    expect(leadMap.value).toBe("value");
  });

  it("maps start_date and end_date over generic date in promotions", () => {
    const m = autoMap(["date", "start_date", "end_date", "spend", "platform"], "promotions");
    expect(m.startDate).toBe("start_date");
    expect(m.endDate).toBe("end_date");
  });
});

describe("detectFileFormat", () => {
  it("detects Meta Ads export headers", () => {
    const d = detectFileFormat(["Campaign name", "Reporting starts", "Reporting ends", "Amount spent (EUR)", "Link clicks"], []);
    expect(d.isMultiType).toBe(false);
    expect(d.detectedCollection).toBe("promotions");
    expect(d.detectedPlatform).toBe("Meta Ads");
  });

  it("detects Google Ads export headers", () => {
    const d = detectFileFormat(["Campaign", "Ad group", "Cost", "Clicks", "Impressions", "Campaign state"], []);
    expect(d.isMultiType).toBe(false);
    expect(d.detectedCollection).toBe("promotions");
    expect(d.detectedPlatform).toBe("Google Ads");
  });

  it("detects TikTok Ads export headers", () => {
    const d = detectFileFormat(["Campaign name", "Stat time", "Cost", "Clicks", "CPC", "CPM"], []);
    expect(d.isMultiType).toBe(false);
    expect(d.detectedCollection).toBe("promotions");
    expect(d.detectedPlatform).toBe("TikTok Ads");
  });

  it("detects Shopify Orders export headers", () => {
    const d = detectFileFormat(["Name", "Paid at", "Financial Status", "Total", "Lineitem name"], []);
    expect(d.isMultiType).toBe(false);
    expect(d.detectedCollection).toBe("sales");
    expect(d.detectedPlatform).toBe("Shopify Orders");
  });

  it("detects Stripe Payments export headers", () => {
    const d = detectFileFormat(["id", "Created (UTC)", "Amount", "Amount Refunded", "Currency", "Status"], []);
    expect(d.isMultiType).toBe(false);
    expect(d.detectedCollection).toBe("sales");
    expect(d.detectedPlatform).toBe("Stripe Payments");
  });

  it("detects multi-type dataset with record_type column and partitions rows", () => {
    const rows = [
      { record_type: "post", date: "2026-10-10" },
      { record_type: "promotion", spend: "100" },
      { record_type: "sale", amount: "50" },
    ];
    const d = detectFileFormat(["record_type", "date", "spend", "amount"], rows);
    expect(d.isMultiType).toBe(true);
    expect(d.typeCounts).toMatchObject({ posts: 1, promotions: 1, sales: 1 });
    expect(d.partitions?.posts).toHaveLength(1);
    expect(d.partitions?.promotions).toHaveLength(1);
    expect(d.partitions?.sales).toHaveLength(1);
  });
});

describe("7captur 300-row demo dataset end-to-end", () => {
  const localDemoPath = path.join(__dirname, "../7captur_growth_demo_data_300_rows.csv");
  const uploadedPath = "/home/loading/.gemini/antigravity/brain/81f28509-8594-40f7-a26e-bf8bd2ecf31e/.user_uploaded/media_1793979645779_21d635f1.csv";
  const demoCsvPath = fs.existsSync(localDemoPath) ? localDemoPath : uploadedPath;

  it("successfully parses, partitions, and validates all 300 rows with 0 errors", () => {
    if (!fs.existsSync(demoCsvPath)) {
      console.warn("Demo CSV not found on disk, skipping real file test");
      return;
    }

    const csvContent = fs.readFileSync(demoCsvPath, "utf8");
    const parsed = parseCsv(csvContent);
    const rows = rowsToObjects(parsed.headers, parsed.rows);
    expect(rows).toHaveLength(300);

    const detected = detectFileFormat(parsed.headers, rows);
    expect(detected.isMultiType).toBe(true);
    expect(detected.typeCounts).toEqual({
      posts: 30,
      promotions: 60,
      leads: 70,
      sales: 100,
      costs: 40,
    });

    const demoOpts: ImportOptions = {
      dateFormat: "iso",
      numberFormat: "us",
      defaults: { currency: "INR", objective: "orders" },
    };

    let totalValid = 0;
    let totalInvalid = 0;

    for (const coll of ["posts", "promotions", "leads", "sales", "costs"] as RecordCollection[]) {
      const partRows = detected.partitions![coll]!;
      const mapping = autoMap(parsed.headers, coll);
      const analysis = analyzeRows(coll, partRows, mapping, demoOpts);

      expect(analysis.invalid).toHaveLength(0);
      expect(analysis.valid).toHaveLength(partRows.length);
      totalValid += analysis.valid.length;
      totalInvalid += analysis.invalid.length;

      // Check specific issue 3: partially refunded sales orders have refundAmount populated
      if (coll === "sales") {
        const partials = analysis.valid.filter((v) => (v.record as Record<string, unknown>).status === "partially_refunded");
        expect(partials.length).toBeGreaterThanOrEqual(3);
        partials.forEach((p) => {
          const rec = p.record as Record<string, unknown>;
          expect(rec.refundAmount).toBeDefined();
          expect(typeof rec.refundAmount).toBe("number");
          expect(rec.refundAmount).toBeGreaterThan(0);
        });
      }

      // Check specific issue 2: leads accept lead statuses (new, in_conversation, won, lost)
      if (coll === "leads") {
        const leadStatuses = new Set(analysis.valid.map((v) => (v.record as Record<string, unknown>).status));
        expect(leadStatuses).toContain("new");
        expect(leadStatuses).toContain("in_conversation");
        expect(leadStatuses).toContain("won");
        expect(leadStatuses).toContain("lost");
      }
    }

    expect(totalValid).toBe(300);
    expect(totalInvalid).toBe(0);
  });
});

import { IMPORT_LIMITS as LIMITS_FOR_CHECK } from "../shared/importing";
describe("import limits", () => {
  it("are 2 MB, 2,000 rows and 50 columns", () => {
    expect(LIMITS_FOR_CHECK).toEqual({ maxBytes: 2 * 1024 * 1024, maxRows: 2000, maxColumns: 50 });
  });
});
