import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PANELS } from "../records/config";
import { COLLECTIONS, type RecordCollection } from "../../shared/records";
import {
  IMPORT_LIMITS, IMPORT_SPECS, analyzeRows, autoMap, buildTemplate, parseCsv, rowsToObjects,
  type DateFormat, type NumberFormat,
} from "../../shared/importing";

interface Report {
  counts?: { received: number; valid: number; invalid: number; duplicatesInFile: number; duplicatesSaved: number; toImport: number; imported: number };
  status?: string; defaultsApplied?: string[]; rowErrors?: { line: number; errors: string[] }[]; dryRun?: boolean;
}
interface Job extends Report { id: string; collection: string; fileName: string }

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function ImportPanel() {
  const ws = useWorkspace();
  const [coll, setColl] = useState<RecordCollection>("sales");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("iso");
  const [numberFormat, setNumberFormat] = useState<NumberFormat>("us");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverReport, setServerReport] = useState<Report | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/imports`), orderBy("createdAt", "desc"), limit(5)),
    (s) => setJobs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Job, "id">) }))),
  ), [ws.workspaceId]);

  const opts = useMemo(() => ({ dateFormat, numberFormat, defaults: { currency: ws.currency, objective: ws.objective } }), [dateFormat, numberFormat, ws.currency, ws.objective]);
  const analysis = useMemo(() => (rows.length ? analyzeRows(coll, rows, mapping, opts) : null), [coll, rows, mapping, opts]);

  function reset() { setFileName(""); setHeaders([]); setRows([]); setMapping({}); setServerReport(null); setError(""); setRequestId(crypto.randomUUID()); }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { setError("Upload a .csv file. For Excel or Google Sheets, use File > Save/Download as CSV."); return; }
    if (file.size > IMPORT_LIMITS.maxBytes) { setError(`File is too large. The limit is ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.`); return; }
    const parsed = parseCsv(await file.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) { setError("The file has no data rows."); return; }
    if (parsed.headers.length > IMPORT_LIMITS.maxColumns) { setError(`Too many columns (limit ${IMPORT_LIMITS.maxColumns}).`); return; }
    if (parsed.rows.length > IMPORT_LIMITS.maxRows) { setError(`Too many rows (limit ${IMPORT_LIMITS.maxRows}). Split the file.`); return; }
    setFileName(file.name); setHeaders(parsed.headers);
    setRows(rowsToObjects(parsed.headers, parsed.rows)); setMapping(autoMap(parsed.headers, coll));
  }

  function changeType(c: RecordCollection) { setColl(c); setMapping(headers.length ? autoMap(headers, c) : {}); setServerReport(null); }

  async function run(dryRun: boolean) {
    setError(""); setBusy(true);
    try {
      const res = await httpsCallable<unknown, Report>(functions, "importRecords")({
        workspaceId: ws.workspaceId, businessId: ws.businessId, collection: coll, requestId, fileName,
        dryRun, mapping, options: { dateFormat, numberFormat }, rows,
      });
      setServerReport(res.data);
    } catch (e) {
      const err = e as { code?: string; details?: { resetsOn?: string } };
      setError(err.code === "functions/resource-exhausted"
        ? `You have used this month's imports. They reset on ${err.details?.resetsOn ?? "the 1st"}. You can still add records by hand.`
        : "Import failed. Nothing was lost: you can retry the same file and saved rows will be skipped.");
    } finally { setBusy(false); }
  }

  const [showThresholdWarning, setShowThresholdWarning] = useState(false);

  const previewMetadata = useMemo(() => {
    if (!analysis || analysis.valid.length === 0) return null;
    const dates: string[] = [];
    const currencies = new Set<string>();
    analysis.valid.forEach((v) => {
      const rec = v.record as Record<string, unknown>;
      const d = (rec.date || rec.startDate || rec.publishedAt || rec.effectiveDate) as string | undefined;
      if (d) dates.push(d);
      if (typeof rec.currency === "string" && rec.currency) currencies.add(rec.currency);
    });
    dates.sort();
    return {
      dateRange: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "No dates",
      currencies: currencies.size ? Array.from(currencies).join(", ") : ws.currency,
    };
  }, [analysis, ws.currency]);

  const required = IMPORT_SPECS[coll].filter((f) => f.required && !mapping[f.name]);
  const errorsCsv = () => {
    const errorRows: (string | number)[][] = [];
    (analysis?.invalid ?? []).forEach((r) => {
      r.errors.forEach((e) => {
        errorRows.push([r.line, e.field ?? "general", e.message]);
      });
    });
    const csvContent = "Row Number,Field,Problem Reason\n" +
      errorRows.map((row) => row.map((c) => {
        let str = String(c);
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")).join("\n");
    download(`${coll}-import-errors.csv`, csvContent);
  };
  const done = serverReport && !serverReport.dryRun;

  function attemptImport() {
    if (!analysis) return;
    const rejectedRate = analysis.invalid.length / (analysis.total || 1);
    if (rejectedRate > 0.5) {
      setShowThresholdWarning(true);
      return;
    }
    void run(false);
  }

  return (
    <section>
      <div className="card">
        <h2>Import a CSV</h2>
        <p className="muted">Imported rows are saved as <span className="mono">imported</span>. Nothing is saved until you confirm.</p>
        <label htmlFor="imp-type">What are you importing?</label>
        <select id="imp-type" value={coll} onChange={(e) => changeType(e.target.value as RecordCollection)}>
          {COLLECTIONS.map((c) => <option key={c} value={c}>{PANELS[c].title}</option>)}
        </select>
        <p><button type="button" className="link" onClick={() => download(`${coll}-template.csv`, buildTemplate(coll))}>Download the {PANELS[coll].title.toLowerCase()} template</button></p>
        <label htmlFor="imp-file">CSV file (up to {IMPORT_LIMITS.maxBytes / 1024 / 1024} MB, max {IMPORT_LIMITS.maxRows} rows)</label>
        <input id="imp-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <div role="alert" className="error">{error}</div>
      </div>

      {analysis && !done && (<>
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>1. Match your columns</h3>
          {IMPORT_SPECS[coll].map((f) => (
            <div key={f.name}>
              <label htmlFor={`map-${f.name}`}>{f.label}{f.required ? " *" : ""}</label>
              <select id={`map-${f.name}`} value={mapping[f.name] ?? ""}
                onChange={(e) => { const m = { ...mapping }; if (e.target.value) m[f.name] = e.target.value; else delete m[f.name]; setMapping(m); setServerReport(null); }}>
                <option value="">{f.default ? "Not in my file (use default)" : "Not in my file"}</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
          <label htmlFor="imp-date">Date format in your file</label>
          <select id="imp-date" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
            <option value="iso">2026-10-29 (year first)</option>
            <option value="mdy">10/29/2026 (month first)</option>
            <option value="dmy">29/10/2026 (day first)</option>
          </select>
          <label htmlFor="imp-num">Number format</label>
          <select id="imp-num" value={numberFormat} onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}>
            <option value="us">1,234.56</option><option value="eu">1.234,56</option>
          </select>
          {required.length > 0 && <p className="error">Select a column for: {required.map((f) => f.label).join(", ")}.</p>}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>2. Check the preview</h3>
          <p>{analysis.total} rows in <span className="mono">{fileName}</span>: <strong>{analysis.valid.length} valid rows ready</strong>, {analysis.invalid.length} rejected rows, {analysis.duplicatesInFile.length} duplicates.</p>
          {previewMetadata && (
            <div style={{ padding: "8px 12px", background: "var(--surface-subtle)", borderRadius: 8, margin: "10px 0", fontSize: 13 }}>
              <span>Date range: <strong className="mono">{previewMetadata.dateRange}</strong></span> ·{" "}
              <span>Currencies found: <strong className="mono">{previewMetadata.currencies}</strong></span>
            </div>
          )}
          {analysis.defaultsApplied.length > 0 && <p className="muted">Defaults applied where a cell is empty or the column is missing: {analysis.defaultsApplied.join(", ")}.</p>}
          {analysis.valid.length > 0 && (
            <ul style={{ paddingLeft: 18 }}>{analysis.valid.slice(0, 5).map((v) => <li key={v.line}>Line {v.line}: {PANELS[coll].summary(v.record)}</li>)}</ul>
          )}
          {analysis.invalid.length > 0 && (<>
            <h4>Rows with problems (they will be skipped)</h4>
            <ul style={{ paddingLeft: 18 }}>
              {analysis.invalid.slice(0, 10).map((r) => <li key={r.line} className="error">Line {r.line}: {r.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()).join("; ")}</li>)}
            </ul>
            {analysis.invalid.length > 10 && <p className="muted">…and {analysis.invalid.length - 10} more.</p>}
            <button type="button" className="link" onClick={errorsCsv}>Download error report (CSV)</button>
          </>)}
          {serverReport?.dryRun && serverReport.counts && (
            <p className="muted">Already saved earlier: {serverReport.counts.duplicatesSaved} row(s) will be skipped. New rows to import: {serverReport.counts.toImport}.</p>
          )}
          <div style={{ marginTop: 14 }}>
            <button type="button" disabled={busy || required.length > 0 || analysis.valid.length === 0} onClick={attemptImport}>
              {busy ? "Importing…" : `Import ${analysis.valid.length} valid row(s)`}
            </button>{" "}
            <button type="button" disabled={busy || required.length > 0 || analysis.valid.length === 0} onClick={() => run(true)}
              style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Check for rows already saved</button>
          </div>
        </div>
      </>)}

      {/* 50% Rejected Row Warning Modal */}
      {showThresholdWarning && analysis && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShowThresholdWarning(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: 500,
              width: "100%",
              background: "var(--surface)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
              border: "1px solid var(--warning, #f59e0b)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "var(--warning, #f59e0b)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                ⚠️
              </div>
              <h3 style={{ margin: 0, fontSize: "1.2rem", color: "var(--ink)" }}>High Rejection Warning</h3>
            </div>

            <p style={{ margin: "0 0 14px", lineHeight: 1.5, color: "var(--ink)" }}>
              <strong>{Math.round((analysis.invalid.length / analysis.total) * 100)}% of rows ({analysis.invalid.length} of {analysis.total})</strong> in <span className="mono">{fileName}</span> have validation errors and will be rejected.
            </p>

            <p className="muted" style={{ fontSize: 13, margin: "0 0 18px", lineHeight: 1.5 }}>
              Only the {analysis.valid.length} valid rows will be persisted into your workspace records. Rejected rows will not be saved. You can download an error report CSV to inspect the invalid lines.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={errorsCsv}
                style={{ margin: 0 }}
              >
                Download Error Report
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowThresholdWarning(false)}
                style={{ margin: 0 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setShowThresholdWarning(false);
                  void run(false);
                }}
                style={{ margin: 0 }}
              >
                Proceed with Valid Rows
              </button>
            </div>
          </div>
        </div>
      )}

      {done && serverReport.counts && (
        <div className="card" style={{ marginTop: 16 }} role="status">
          <h3 style={{ marginTop: 0 }}>{serverReport.status === "completed" ? "Import complete" : serverReport.status === "partial" ? "Imported with some skipped rows" : "Nothing was imported"}</h3>
          <p>{serverReport.counts.imported} imported · {serverReport.counts.duplicatesSaved + serverReport.counts.duplicatesInFile} skipped as duplicates · {serverReport.counts.invalid} skipped with problems.</p>
          <button type="button" onClick={reset}>Import another file</button>
        </div>
      )}

      {jobs.length > 0 && (<>
        <h3>Recent imports</h3>
        <ul style={{ paddingLeft: 18 }}>
          {jobs.map((j) => <li key={j.id}>{j.fileName} · {j.collection} · {j.status} · {j.counts?.imported ?? 0} imported</li>)}
        </ul>
      </>)}
    </section>
  );
}
