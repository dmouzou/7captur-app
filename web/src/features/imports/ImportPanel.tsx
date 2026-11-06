import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PANELS } from "../records/config";
import { COLLECTIONS, type RecordCollection } from "../../shared/records";
import {
  IMPORT_LIMITS, IMPORT_SPECS, analyzeRows, autoMap, buildTemplate, detectFileFormat, parseCsv, rowsToObjects,
  type DateFormat, type NumberFormat, type ImportAnalysis,
} from "../../shared/importing";

interface Report {
  counts?: { received: number; valid: number; invalid: number; duplicatesInFile: number; duplicatesSaved: number; toImport: number; imported: number };
  status?: string; defaultsApplied?: string[]; rowErrors?: { line: number; errors: string[] }[]; dryRun?: boolean;
  batchSummaries?: Record<string, { total: number; valid: number; invalid: number; imported: number }>;
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

  // Multi-type file support
  const [isMultiType, setIsMultiType] = useState(false);
  const [partitions, setPartitions] = useState<Partial<Record<RecordCollection, Record<string, string>[]>>>({});
  const [typeCounts, setTypeCounts] = useState<Partial<Record<RecordCollection, number>>>({});
  const [multiMappings, setMultiMappings] = useState<Partial<Record<RecordCollection, Record<string, string>>>>({});
  const [activeMultiColl, setActiveMultiColl] = useState<RecordCollection>("sales");
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/imports`), orderBy("createdAt", "desc"), limit(5)),
    (s) => setJobs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Job, "id">) }))),
  ), [ws.workspaceId]);

  const opts = useMemo(() => ({
    dateFormat, numberFormat, defaults: { currency: ws.currency, objective: ws.objective, platform: "facebook" as const },
  }), [dateFormat, numberFormat, ws.currency, ws.objective]);

  const analysis = useMemo(() => (!isMultiType && rows.length ? analyzeRows(coll, rows, mapping, opts) : null), [isMultiType, coll, rows, mapping, opts]);

  const multiAnalyses = useMemo(() => {
    if (!isMultiType || !partitions) return null;
    const res: Partial<Record<RecordCollection, ImportAnalysis>> = {};
    for (const [c, partRows] of Object.entries(partitions)) {
      const colKey = c as RecordCollection;
      if (partRows && partRows.length > 0) {
        res[colKey] = analyzeRows(colKey, partRows, multiMappings[colKey] || {}, opts);
      }
    }
    return res;
  }, [isMultiType, partitions, multiMappings, opts]);

  const multiAggregated = useMemo(() => {
    if (!multiAnalyses) return null;
    let total = 0, valid = 0, invalid = 0, duplicatesInFile = 0;
    const defaultsApplied = new Set<string>();
    const dates: string[] = [];
    const currencies = new Set<string>();

    for (const a of Object.values(multiAnalyses)) {
      if (!a) continue;
      total += a.total;
      valid += a.valid.length;
      invalid += a.invalid.length;
      duplicatesInFile += a.duplicatesInFile.length;
      a.defaultsApplied.forEach((d) => defaultsApplied.add(d));
      a.valid.forEach((v) => {
        const rec = v.record as Record<string, unknown>;
        const d = (rec.date || rec.startDate || rec.publishedAt || rec.effectiveDate) as string | undefined;
        if (d) dates.push(d);
        if (typeof rec.currency === "string" && rec.currency) currencies.add(rec.currency);
      });
    }
    dates.sort();
    return {
      total, valid, invalid, duplicatesInFile,
      defaultsApplied: Array.from(defaultsApplied),
      dateRange: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "No dates",
      currencies: currencies.size ? Array.from(currencies).join(", ") : ws.currency,
    };
  }, [multiAnalyses, ws.currency]);

  function reset() {
    setFileName(""); setHeaders([]); setRows([]); setMapping({}); setServerReport(null);
    setError(""); setRequestId(crypto.randomUUID()); setIsMultiType(false);
    setPartitions({}); setTypeCounts({}); setMultiMappings({}); setDetectedPlatform(null);
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { setError("Upload a .csv file. For Excel or Google Sheets, use File > Save/Download as CSV."); return; }
    if (file.size > IMPORT_LIMITS.maxBytes) { setError(`File is too large. The limit is ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.`); return; }
    const parsed = parseCsv(await file.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) { setError("The file has no data rows."); return; }
    if (parsed.headers.length > IMPORT_LIMITS.maxColumns) { setError(`Too many columns (limit ${IMPORT_LIMITS.maxColumns}).`); return; }
    if (parsed.rows.length > IMPORT_LIMITS.maxRows) { setError(`Too many rows (limit ${IMPORT_LIMITS.maxRows}). Split the file.`); return; }

    const parsedObjects = rowsToObjects(parsed.headers, parsed.rows);
    const detection = detectFileFormat(parsed.headers, parsedObjects);

    setFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsedObjects);

    if (detection.isMultiType && detection.partitions) {
      setIsMultiType(true);
      setPartitions(detection.partitions);
      setTypeCounts(detection.typeCounts ?? {});
      const autoMappings: Partial<Record<RecordCollection, Record<string, string>>> = {};
      const foundColls = Object.keys(detection.partitions) as RecordCollection[];
      foundColls.forEach((c) => {
        autoMappings[c] = autoMap(parsed.headers, c);
      });
      setMultiMappings(autoMappings);
      if (foundColls.length > 0) {
        setActiveMultiColl(foundColls[0]);
      }
    } else {
      setIsMultiType(false);
      const targetColl = detection.detectedCollection || coll;
      setColl(targetColl);
      setMapping(autoMap(parsed.headers, targetColl));
      if (detection.detectedPlatform) {
        setDetectedPlatform(detection.detectedPlatform);
      }
    }
  }

  function changeType(c: RecordCollection) {
    setColl(c);
    setMapping(headers.length ? autoMap(headers, c) : {});
    setServerReport(null);
  }

  async function run(dryRun: boolean) {
    setError(""); setBusy(true);
    try {
      let payload: Record<string, unknown>;
      if (isMultiType && partitions) {
        const batches = (Object.keys(partitions) as RecordCollection[]).map((c) => ({
          collection: c,
          mapping: multiMappings[c] || {},
          rows: partitions[c] || [],
        }));
        payload = {
          workspaceId: ws.workspaceId, businessId: ws.businessId, collection: coll, requestId, fileName,
          dryRun, batches, options: { dateFormat, numberFormat },
        };
      } else {
        payload = {
          workspaceId: ws.workspaceId, businessId: ws.businessId, collection: coll, requestId, fileName,
          dryRun, mapping, options: { dateFormat, numberFormat }, rows,
        };
      }

      const res = await httpsCallable<unknown, Report>(functions, "importRecords")(payload);
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
    if (isMultiType) return multiAggregated;
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
  }, [isMultiType, analysis, multiAggregated, ws.currency]);

  const activeSpec = isMultiType ? IMPORT_SPECS[activeMultiColl] : IMPORT_SPECS[coll];
  const activeMapping = isMultiType ? (multiMappings[activeMultiColl] || {}) : mapping;
  const required = activeSpec.filter((f) => f.required && !activeMapping[f.name]);

  const errorsCsv = () => {
    const errorRows: (string | number)[][] = [];
    if (isMultiType && multiAnalyses) {
      for (const [c, a] of Object.entries(multiAnalyses)) {
        (a?.invalid ?? []).forEach((r) => {
          r.errors.forEach((e) => {
            errorRows.push([r.line, c, e.field ?? "general", e.message]);
          });
        });
      }
      const csvContent = "Row Number,Collection,Field,Problem Reason\n" +
        errorRows.map((row) => row.map((c) => {
          let str = String(c);
          if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
          return `"${str.replace(/"/g, '""')}"`;
        }).join(",")).join("\n");
      download(`${fileName.replace(/\.csv$/i, "")}-import-errors.csv`, csvContent);
    } else {
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
    }
  };

  const done = serverReport && !serverReport.dryRun;

  function attemptImport() {
    if (isMultiType) {
      if (!multiAggregated) return;
      const rejectedRate = multiAggregated.invalid / (multiAggregated.total || 1);
      if (rejectedRate > 0.5) {
        setShowThresholdWarning(true);
        return;
      }
      void run(false);
      return;
    }
    if (!analysis) return;
    const rejectedRate = analysis.invalid.length / (analysis.total || 1);
    if (rejectedRate > 0.5) {
      setShowThresholdWarning(true);
      return;
    }
    void run(false);
  }

  const multiColls = isMultiType ? (Object.keys(partitions) as RecordCollection[]) : [];
  const currentActiveAnalysis = isMultiType ? multiAnalyses?.[activeMultiColl] : analysis;

  return (
    <section>
      <div className="card">
        <h2>Import a CSV</h2>
        <p className="muted">Imported rows are saved as <span className="mono">imported</span>. Nothing is saved until you confirm.</p>
        
        {!isMultiType ? (
          <>
            <label htmlFor="imp-type">What are you importing?</label>
            <select id="imp-type" value={coll} onChange={(e) => changeType(e.target.value as RecordCollection)}>
              {COLLECTIONS.map((c) => <option key={c} value={c}>{PANELS[c].title}</option>)}
            </select>
            {detectedPlatform && (
              <p style={{ margin: "4px 0 10px", fontSize: 13, color: "var(--accent, #6366f1)" }}>
                ✨ Detected format: <strong>{detectedPlatform}</strong>
              </p>
            )}
            <p><button type="button" className="link" onClick={() => download(`${coll}-template.csv`, buildTemplate(coll))}>Download the {PANELS[coll].title.toLowerCase()} template</button></p>
          </>
        ) : (
          <div style={{ padding: "10px 14px", background: "rgba(99, 102, 241, 0.1)", borderRadius: 8, margin: "12px 0", border: "1px solid rgba(99, 102, 241, 0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>✨ Multi-record dataset detected</strong>
                <p style={{ margin: "4px 0 0", fontSize: 13 }} className="muted">
                  Found {multiAggregated?.total} rows across {multiColls.length} record types in <span className="mono">{fileName}</span>.
                </p>
              </div>
              <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => setIsMultiType(false)}>
                Switch to single type
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {multiColls.map((c) => {
                const count = typeCounts[c] ?? 0;
                const a = multiAnalyses?.[c];
                const isValidAll = a && a.invalid.length === 0;
                const isActive = activeMultiColl === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveMultiColl(c)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: isActive ? "2px solid var(--accent, #6366f1)" : "1px solid var(--border)",
                      background: isActive ? "var(--accent, #6366f1)" : "var(--surface)",
                      color: isActive ? "#fff" : "var(--text)",
                      cursor: "pointer",
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>{PANELS[c].title}</span>
                    <span style={{ opacity: 0.85, fontSize: 11, background: "rgba(0,0,0,0.15)", padding: "2px 6px", borderRadius: 10 }}>
                      {count} rows {isValidAll ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label htmlFor="imp-file">CSV file (up to {IMPORT_LIMITS.maxBytes / 1024 / 1024} MB, max {IMPORT_LIMITS.maxRows} rows)</label>
        <input id="imp-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <div role="alert" className="error">{error}</div>
      </div>

      {(analysis || multiAggregated) && !done && (<>
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            {isMultiType ? `1. Match columns for ${PANELS[activeMultiColl].title}` : "1. Match your columns"}
          </h3>
          {isMultiType && (
            <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
              Review or adjust column mappings for <strong>{PANELS[activeMultiColl].title}</strong>. (Auto-matched from file headers).
            </p>
          )}
          {activeSpec.map((f) => (
            <div key={f.name}>
              <label htmlFor={`map-${f.name}`}>{f.label}{f.required ? " *" : ""}</label>
              <select
                id={`map-${f.name}`}
                value={activeMapping[f.name] ?? ""}
                onChange={(e) => {
                  if (isMultiType) {
                    const current = { ...(multiMappings[activeMultiColl] || {}) };
                    if (e.target.value) current[f.name] = e.target.value;
                    else delete current[f.name];
                    setMultiMappings({ ...multiMappings, [activeMultiColl]: current });
                  } else {
                    const m = { ...mapping };
                    if (e.target.value) m[f.name] = e.target.value;
                    else delete m[f.name];
                    setMapping(m);
                  }
                  setServerReport(null);
                }}
              >
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
          {isMultiType && multiAggregated ? (
            <p>
              {multiAggregated.total} rows across {multiColls.length} types in <span className="mono">{fileName}</span>:{" "}
              <strong>{multiAggregated.valid} valid rows ready to import</strong>, {multiAggregated.invalid} rejected rows, {multiAggregated.duplicatesInFile} duplicates.
            </p>
          ) : (
            analysis && (
              <p>
                {analysis.total} rows in <span className="mono">{fileName}</span>: <strong>{analysis.valid.length} valid rows ready</strong>, {analysis.invalid.length} rejected rows, {analysis.duplicatesInFile.length} duplicates.
              </p>
            )
          )}

          {previewMetadata && (
            <div style={{ padding: "8px 12px", background: "var(--surface-subtle)", borderRadius: 8, margin: "10px 0", fontSize: 13 }}>
              <span>Date range: <strong className="mono">{previewMetadata.dateRange}</strong></span> ·{" "}
              <span>Currencies found: <strong className="mono">{previewMetadata.currencies}</strong></span>
            </div>
          )}

          {isMultiType && currentActiveAnalysis ? (
            <>
              <h4 style={{ margin: "14px 0 6px" }}>Sample {PANELS[activeMultiColl].title} ({currentActiveAnalysis.valid.length} valid)</h4>
              {currentActiveAnalysis.valid.length > 0 ? (
                <ul style={{ paddingLeft: 18 }}>
                  {currentActiveAnalysis.valid.slice(0, 5).map((v) => <li key={v.line}>Line {v.line}: {PANELS[activeMultiColl].summary(v.record)}</li>)}
                </ul>
              ) : (
                <p className="muted">No valid rows in this section yet.</p>
              )}
              {currentActiveAnalysis.invalid.length > 0 && (
                <>
                  <h4 style={{ color: "var(--error, #ef4444)", margin: "14px 0 6px" }}>Issues in {PANELS[activeMultiColl].title}</h4>
                  <ul style={{ paddingLeft: 18 }}>
                    {currentActiveAnalysis.invalid.slice(0, 5).map((r) => <li key={r.line} className="error">Line {r.line}: {r.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()).join("; ")}</li>)}
                  </ul>
                </>
              )}
            </>
          ) : (
            analysis && (
              <>
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
              </>
            )
          )}

          {isMultiType && multiAggregated && multiAggregated.invalid > 0 && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="link" onClick={errorsCsv}>Download error report (CSV)</button>
            </div>
          )}

          {serverReport?.dryRun && serverReport.counts && (
            <p className="muted">Already saved earlier: {serverReport.counts.duplicatesSaved} row(s) will be skipped. New rows to import: {serverReport.counts.toImport}.</p>
          )}

          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              disabled={busy || required.length > 0 || (isMultiType ? (multiAggregated?.valid ?? 0) === 0 : (analysis?.valid.length ?? 0) === 0)}
              onClick={attemptImport}
            >
              {busy ? "Importing…" : isMultiType ? `Import all ${multiAggregated?.valid ?? 0} valid records (${multiColls.length} types)` : `Import ${analysis?.valid.length ?? 0} valid row(s)`}
            </button>{" "}
            <button
              type="button"
              disabled={busy || required.length > 0 || (isMultiType ? (multiAggregated?.valid ?? 0) === 0 : (analysis?.valid.length ?? 0) === 0)}
              onClick={() => run(true)}
              style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              Check for rows already saved
            </button>
          </div>
        </div>
      </>)}

      {/* 50% Rejected Row Warning Modal */}
      {showThresholdWarning && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 16,
          }}
          onClick={() => setShowThresholdWarning(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: 500, width: "100%", background: "var(--surface)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.35)", border: "1px solid var(--warning, #f59e0b)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(245, 158, 11, 0.15)", color: "var(--warning, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                ⚠️
              </div>
              <h3 style={{ margin: 0, fontSize: "1.2rem", color: "var(--ink)" }}>High Rejection Warning</h3>
            </div>

            <p style={{ margin: "0 0 14px", lineHeight: 1.5, color: "var(--ink)" }}>
              {isMultiType && multiAggregated ? (
                <><strong>{Math.round((multiAggregated.invalid / multiAggregated.total) * 100)}% of rows ({multiAggregated.invalid} of {multiAggregated.total})</strong> in <span className="mono">{fileName}</span> have validation errors and will be rejected.</>
              ) : analysis ? (
                <><strong>{Math.round((analysis.invalid.length / analysis.total) * 100)}% of rows ({analysis.invalid.length} of {analysis.total})</strong> in <span className="mono">{fileName}</span> have validation errors and will be rejected.</>
              ) : null}
            </p>

            <p className="muted" style={{ fontSize: 13, margin: "0 0 18px", lineHeight: 1.5 }}>
              Only valid rows will be persisted into your workspace records. Rejected rows will not be saved. You can download an error report CSV to inspect the invalid lines.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn-secondary" onClick={errorsCsv} style={{ margin: 0 }}>
                Download Error Report
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowThresholdWarning(false)} style={{ margin: 0 }}>
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
          {serverReport.batchSummaries && (
            <div style={{ margin: "10px 0", fontSize: 13 }}>
              {Object.entries(serverReport.batchSummaries).map(([bColl, sum]) => (
                <span key={bColl} style={{ marginRight: 12 }}>
                  <strong>{PANELS[bColl as RecordCollection]?.title || bColl}:</strong> {sum.imported} of {sum.total}
                </span>
              ))}
            </div>
          )}
          <button type="button" onClick={reset}>Import another file</button>
        </div>
      )}

      {jobs.length > 0 && (<>
        <h3>Recent imports</h3>
        <ul style={{ paddingLeft: 18 }}>
          {jobs.map((j) => (
            <li key={j.id}>
              {j.fileName} · {j.collection === "multi" ? "Multi-record" : (PANELS[j.collection as RecordCollection]?.title || j.collection)} · {j.status} · {j.counts?.imported ?? 0} imported
            </li>
          ))}
        </ul>
      </>)}
    </section>
  );
}
