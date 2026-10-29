import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { COLLECTIONS } from "../../shared/records";
import { EXPORT_COLUMNS, RECOMMENDATION_COLUMNS, toCsv } from "../../shared/export";
import { PANELS } from "../records/config";

type Exported = Record<string, unknown> & { truncated?: string[] };

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function SettingsPanel() {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function exportAll(kind: "json" | "csv") {
    setError(""); setNote(""); setBusy(true);
    try {
      const res = await httpsCallable<unknown, Exported>(functions, "exportData")({ workspaceId: ws.workspaceId, businessId: ws.businessId });
      const data = res.data;
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "json") download(`7captur-export-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      else {
        for (const c of COLLECTIONS) download(`7captur-${c}-${stamp}.csv`, toCsv(EXPORT_COLUMNS[c], (data[c] as Record<string, unknown>[]) ?? []), "text/csv");
        download(`7captur-recommendations-${stamp}.csv`, toCsv(RECOMMENDATION_COLUMNS, (data.recommendations as Record<string, unknown>[]) ?? []), "text/csv");
      }
      setNote(data.truncated?.length ? `Large export: only the first 5,000 rows of ${data.truncated.join(", ")} were included.` : "Export downloaded.");
    } catch { setError("Could not export your data. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <div className="card">
        <h2>Your data</h2>
        <p className="muted">Download your business profile, {COLLECTIONS.map((c) => PANELS[c].title.toLowerCase()).join(", ")} and recommendations. CSV files open safely in Excel and Sheets.</p>
        <button type="button" disabled={busy} onClick={() => exportAll("csv")}>Download CSV files</button>{" "}
        <button type="button" disabled={busy} onClick={() => exportAll("json")} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Download JSON</button>
        <div role="alert" className="error">{error}</div>
        <div role="status" className="muted">{note}</div>
      </div>
    </section>
  );
}
