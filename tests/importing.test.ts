import { describe, expect, it } from "vitest";
import {
  analyzeRows, autoMap, buildTemplate, detectDelimiter, normalizeRow, parseCsv, rowsToObjects, type ImportOptions,
} from "../functions/src/shared/importing";

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

describe("Meta Ads Manager export headers", () => {
  it("maps reporting dates and amount spent with currency suffix", () => {
    const m = autoMap(["Campaign name", "Reporting starts", "Reporting ends", "Amount spent (EUR)", "Impressions", "Reach", "Link clicks"], "promotions");
    expect(m.startDate).toBe("Reporting starts");
    expect(m.endDate).toBe("Reporting ends");
    expect(m.spend).toBe("Amount spent (EUR)");
    expect(m.clicks).toBe("Link clicks");
  });
});
