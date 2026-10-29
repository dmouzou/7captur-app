import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import type { WeeklyReport } from "../../shared/report";

interface Prefs { weeklyEmail?: boolean; weeklyStatusOnly?: boolean }

export function ReportsPanel() {
  const { user } = useAuth();
  const ws = useWorkspace();
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [error, setError] = useState("");

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/reports`), orderBy("periodStart", "desc"), limit(12)),
    (s) => setReports(s.docs.map((d) => d.data() as WeeklyReport)),
  ), [ws.workspaceId]);
  useEffect(() => onSnapshot(doc(db, "users", user!.uid), (s) => setPrefs((s.data()?.notificationPrefs ?? {}) as Prefs)), [user]);

  async function setPref(p: Partial<Prefs>) {
    setError("");
    try { await updateDoc(doc(db, "users", user!.uid), { notificationPrefs: { ...prefs, ...p } }); }
    catch { setError("Could not save your preference."); }
  }

  return (
    <section>
      <div className="card">
        <h2>Weekly summary</h2>
        <p className="muted">Every Monday at 8:00 ({ws.timezone}) we summarise last week: what changed, how fresh your data is, your recommendation choices and what is missing. Weeks with no change are skipped. Summaries never use up recommendations.</p>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={prefs.weeklyEmail !== false} onChange={(e) => setPref({ weeklyEmail: e.target.checked })} />
          Email me when a summary is ready
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={prefs.weeklyStatusOnly === true} onChange={(e) => setPref({ weeklyStatusOnly: e.target.checked })} />
          Also send a short status summary in weeks with no change
        </label>
        <div role="alert" className="error">{error}</div>
      </div>

      {reports.length === 0 && <p className="muted">No summaries yet. Your first arrives on the next Monday morning if something changed.</p>}
      {reports.map((r) => (
        <article key={r.weekId} className="card" style={{ marginTop: 16 }}>
          <p className="muted mono">{r.periodStart} to {r.periodEnd}{r.kind === "status_only" ? " · status only" : ""}</p>
          <h3 style={{ marginTop: 0 }}>What changed</h3>
          {r.changes.length ? <ul>{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p>No change in what you recorded.</p>}
          <h4>Your data</h4>
          <p>{r.freshness.latestRecordDate ? `Latest entry: ${r.freshness.latestRecordDate}${r.freshness.stale ? " (older than two weeks)" : ""}.` : "No entries yet."}</p>
          <h4>Recommendations</h4>
          <p>{r.recommendations.generated} new · {r.recommendations.markedToTry} marked to try · {r.recommendations.dismissed} dismissed · {r.recommendations.outcomesRecorded} outcomes recorded</p>
          {r.gaps.length > 0 && (<><h4>What is missing</h4><ul>{r.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></>)}
          <h4>Next focus</h4>
          <p>{r.nextFocus}</p>
        </article>
      ))}
    </section>
  );
}
