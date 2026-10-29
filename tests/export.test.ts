import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, neutralizeCell, toCsv } from "../functions/src/shared/export";

describe("CSV export", () => {
  it("neutralizes formula injection in text cells", () => {
    for (const evil of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=x", "\r=x"]) {
      expect(neutralizeCell(evil).startsWith("'")).toBe(true);
    }
    expect(neutralizeCell("normal")).toBe("normal");
    expect(neutralizeCell(-5)).toBe("-5"); // real numbers are safe
    expect(neutralizeCell(undefined)).toBe("");
  });
  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv(["a", "b"], [{ a: 'x,"y"', b: "l1\nl2" }]);
    expect(csv).toBe('a,b\n"x,""y""","l1\nl2"\n');
  });
  it("combines both: dangerous text with a comma stays quoted and prefixed", () => {
    expect(toCsv(["n"], [{ n: "=HYPERLINK(a,b)" }])).toBe("n\n\"'=HYPERLINK(a,b)\"\n");
  });
  it("exports id, fields, provenance and createdAt per collection", () => {
    expect(EXPORT_COLUMNS.sales).toEqual(expect.arrayContaining(["id", "amount", "currency", "provenance", "createdAt"]));
  });
});
