import { cellsToCsvText } from "../../shared/importing";

export interface XlsxResult { csv: string; sheet: string; sheets: number }

/**
 * Read the first sheet that has data from an .xlsx file, in the browser. The library is loaded only when someone
 * picks an Excel file. Nothing is sent anywhere. Old .xls files and macro files are not supported.
 */
export async function xlsxToCsv(file: File): Promise<XlsxResult> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const withData = sheets.find((s) => s.data.length >= 2);
  if (!withData) throw new Error("empty");
  return { csv: cellsToCsvText(withData.data as unknown[][]), sheet: withData.sheet, sheets: sheets.length };
}
