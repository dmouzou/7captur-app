import { useEffect, useMemo, useState } from "react";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { functions, storage } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PANELS } from "../records/config";
import { COLLECTIONS, type RecordCollection } from "../../shared/records";
import { IMPORT_SPECS, SCREENSHOT_LIMITS, analyzeRows, normalizeRow, type ImportField } from "../../shared/importing";

type Row = Record<string, string>;
interface Draft { rows: Row[]; unreadable: boolean; defaultsApplied: string[] }
interface Result { counts?: { imported: number; duplicatesSaved: number; duplicatesInFile: number; invalid: number }; status?: string }

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function ScreenshotPanel() {
  const ws = useWorkspace();
  const [coll, setColl] = useState<RecordCollection>("sales");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadPath, setUploadPath] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState<Row[]>([]);
  const [draftInfo, setDraftInfo] = useState<Draft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => { if (!file) { setPreviewUrl(""); return; } const u = URL.createObjectURL(file); setPreviewUrl(u); return () => URL.revokeObjectURL(u); }, [file]);

  const opts = useMemo(() => ({ dateFormat: "iso" as const, numberFormat: "us" as const, defaults: { currency: ws.currency, objective: ws.objective } }), [ws.currency, ws.objective]);
  const mapping = useMemo(() => Object.fromEntries(IMPORT_SPECS[coll].map((f) => [f.name, f.name])), [coll]);
  const analysis = useMemo(() => (rows.length ? analyzeRows(coll, rows, mapping, opts) : null), [coll, rows, mapping, opts]);
  const rowCheck = useMemo(() => rows.map((r) => normalizeRow(coll, r, mapping, opts)), [coll, rows, mapping, opts]);

  async function cleanupUpload() { if (uploadPath) await deleteObject(ref(storage, uploadPath)).catch(() => undefined); }
  async function reset() { await cleanupUpload(); setFile(null); setUploadPath(""); setRows([]); setDraftInfo(null); setConfirmed(false); setResult(null); setError(""); setRequestId(crypto.randomUUID()); }

  function pick(f: File | undefined) {
    setError(""); setRows([]); setDraftInfo(null); setConfirmed(false); setResult(null);
    if (!f) { setFile(null); return; }
    if (!EXT[f.type]) { setError("Use a PNG, JPEG or WebP image."); setFile(null); return; }
    if (f.size > SCREENSHOT_LIMITS.maxBytes) { setError("Image is larger than 5 MB."); setFile(null); return; }
    setFile(f);
  }

  async function extract() {
    if (!file) return;
    setError(""); setBusy("Reading your screenshot…");
    try {
      const path = `workspaces/${ws.workspaceId}/uploads/${requestId}.${EXT[file.type]}`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type });
      setUploadPath(path);
      const res = await httpsCallable<unknown, Draft>(functions, "extractFromScreenshot")({
        workspaceId: ws.workspaceId, businessId: ws.businessId, collection: coll, requestId, uploadPath: path,
      });
      setDraftInfo(res.data); setRows(res.data.rows); setConfirmed(false);
      if (res.data.unreadable) setError("No readable data found in that image. Try a clearer or closer screenshot, or enter the data by hand.");
    } catch (e) {
      const err = e as { code?: string; details?: { resetsOn?: string } };
      setError(err.code === "functions/resource-exhausted"
        ? `You have used this month's imports. They reset on ${err.details?.resetsOn ?? "the 1st"}.`
        : "Could not read that screenshot. Your import was not used. Try again, or enter the data by hand.");
    } finally { setBusy(""); }
  }

  async function save() {
    setError(""); setBusy("Saving…");
    try {
      const res = await httpsCallable<unknown, Result>(functions, "importRecords")({
        workspaceId: ws.workspaceId, businessId: ws.businessId, collection: coll, requestId, fileName: file?.name ?? "screenshot",
        source: "screenshot", reviewConfirmed: confirmed, uploadPath, mapping, options: { dateFormat: "iso", numberFormat: "us" }, rows,
      });
      setResult(res.data); setUploadPath("");
    } catch { setError("Could not save. Nothing was lost: you can try again."); }
    finally { setBusy(""); }
  }

  const setCell = (i: number, name: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [name]: v } : r)));
  const cell = (i: number, f: ImportField) => {
    const v = rows[i][f.name] ?? "";
    const id = `shot-${i}-${f.name}`;
    return f.kind === "enum" ? (
      <select id={id} aria-label={f.label} value={v} onChange={(e) => setCell(i, f.name, e.target.value)}>
        <option value="">{f.default ? "(default)" : "—"}</option>
        {f.enumValues!.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
      </select>
    ) : (
      <input id={id} aria-label={f.label} value={v} style={{ minWidth: f.kind === "date" ? 120 : 90 }} onChange={(e) => setCell(i, f.name, e.target.value)} />
    );
  };

  if (result?.counts) {
    return (
      <div className="card" role="status">
        <h3 style={{ marginTop: 0 }}>{result.status === "completed" ? "Saved" : result.status === "partial" ? "Saved with some rows skipped" : "Nothing was saved"}</h3>
        <p>{result.counts.imported} saved as <span className="mono">screenshot extracted</span> · {result.counts.duplicatesSaved + result.counts.duplicatesInFile} skipped as duplicates · {result.counts.invalid} skipped with problems. The screenshot has been deleted.</p>
        <button type="button" onClick={reset}>Import another screenshot</button>
      </div>
    );
  }

  const specs = IMPORT_SPECS[coll];
  return (
    <section>
      <div className="card">
        <h2>Import from a screenshot</h2>
        <p className="muted">We read the image with AI and show you a draft. <strong>Nothing is saved until you check it and confirm.</strong> The image is deleted after you save.</p>
        <label htmlFor="shot-type">What does the screenshot show?</label>
        <select id="shot-type" value={coll} disabled={rows.length > 0} onChange={(e) => setColl(e.target.value as RecordCollection)}>
          {COLLECTIONS.map((c) => <option key={c} value={c}>{PANELS[c].title}</option>)}
        </select>
        <label htmlFor="shot-file">Screenshot (PNG, JPEG or WebP, up to 5 MB)</label>
        <input id="shot-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={rows.length > 0} onChange={(e) => pick(e.target.files?.[0])} />
        <p className="muted">Crop out anything private that is not needed, such as customer names and contact details.</p>
        {file && rows.length === 0 && <button type="button" disabled={!!busy} onClick={extract}>{busy || "Read screenshot"}</button>}
        <div role="alert" className="error">{error}</div>
      </div>

      {rows.length > 0 && analysis && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Check what we read</h3>
          <p className="muted">Compare each row with your screenshot below. Fix anything wrong, empty cells that should have a value, or remove rows.</p>
          {previewUrl && <img src={previewUrl} alt="Your uploaded screenshot" style={{ maxWidth: "100%", maxHeight: 320, border: "1px solid var(--border)", borderRadius: 8 }} />}
          {draftInfo && draftInfo.defaultsApplied.length > 0 && <p className="muted">Where a value was not visible we used: {draftInfo.defaultsApplied.join(", ")}.</p>}
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th /><th scope="col" className="muted" style={{ textAlign: "left" }}>#</th>{specs.map((f) => <th key={f.name} scope="col" className="muted" style={{ textAlign: "left", padding: "4px 6px" }}>{f.label}{f.required ? " *" : ""}</th>)}</tr></thead>
              <tbody>
                {rows.map((_, i) => (
                  <tr key={i} style={{ verticalAlign: "top", borderTop: "1px solid var(--border)" }}>
                    <td><button type="button" className="link" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((__, j) => j !== i))}>remove</button></td>
                    <td>{i + 1}</td>
                    {specs.map((f) => <td key={f.name} style={{ padding: "4px 6px" }}>{cell(i, f)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rowCheck.some((r) => r.errors.length) && (
            <ul style={{ paddingLeft: 18 }}>
              {rowCheck.map((r, i) => r.errors.length ? <li key={i} className="error">Row {i + 1}: {r.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()).join("; ")}</li> : null)}
            </ul>
          )}
          <p><strong>{analysis.valid.length} ready</strong>, {analysis.invalid.length} with problems (skipped), {analysis.duplicatesInFile.length} repeated.</p>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I checked these values against my screenshot
          </label>
          <button type="button" disabled={!confirmed || analysis.valid.length === 0 || !!busy} onClick={save}>{busy || `Save ${analysis.valid.length} row(s)`}</button>{" "}
          <button type="button" onClick={reset} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Cancel</button>
        </div>
      )}
    </section>
  );
}
