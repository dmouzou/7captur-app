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

  const required = IMPORT_SPECS[coll].filter((f) => f.required && !mapping[f.name]);
  const errorsCsv = () => download("import-errors.csv", "line,problems\n" + (analysis?.invalid ?? []).map((r) => `${r.line},"${r.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()).join("; ").replace(/"/g, '""')}"`).join("\n"));
  const done = serverReport && !serverReport.dryRun;

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
        <label htmlFor="imp-file">CSV file (max {IMPORT_LIMITS.maxRows} rows, 2 MB)</label>
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
          <p>{analysis.total} rows in <span className="mono">{fileName}</span>: <strong>{analysis.valid.length} ready</strong>, {analysis.invalid.length} with problems, {analysis.duplicatesInFile.length} repeated inside the file.</p>
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
            <button type="button" className="link" onClick={errorsCsv}>Download all problems as CSV</button>
          </>)}
          {serverReport?.dryRun && serverReport.counts && (
            <p className="muted">Already saved earlier: {serverReport.counts.duplicatesSaved} row(s) will be skipped. New rows to import: {serverReport.counts.toImport}.</p>
          )}
          <button type="button" disabled={busy || required.length > 0 || analysis.valid.length === 0} onClick={() => run(false)}>
            {busy ? "Importing…" : `Import ${analysis.valid.length} row(s)`}
          </button>{" "}
          <button type="button" disabled={busy || required.length > 0 || analysis.valid.length === 0} onClick={() => run(true)}
            style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Check for rows already saved</button>
        </div>
      </>)}

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
