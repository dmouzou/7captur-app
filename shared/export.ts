import { IMPORT_SPECS } from "./importing";
import type { RecordCollection } from "./records";

/**
 * CSV cells that start with = + - @ (or tab/CR) can run as formulas when opened in Excel or Sheets.
 * Prefix such text with an apostrophe. Numbers are written as-is.
 */
export function neutralizeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvEscape).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(neutralizeCell(r[c]))).join(","));
  return lines.join("\n") + "\n";
}

export const EXPORT_COLUMNS: Record<RecordCollection, string[]> = Object.fromEntries(
  (Object.keys(IMPORT_SPECS) as RecordCollection[]).map((c) => [c, ["id", ...IMPORT_SPECS[c].map((f) => f.name), "provenance", "createdAt"]]),
) as Record<RecordCollection, string[]>;

export const RECOMMENDATION_COLUMNS = ["id", "createdAt", "status", "category", "mode", "action", "risk", "doNotActIf", "nextMeasurement", "engineVersion"];

export const exportDataInput = {
  // validated in the function with zod; kept here so web and server agree on names
  maxPerCollection: 5000,
} as const;
