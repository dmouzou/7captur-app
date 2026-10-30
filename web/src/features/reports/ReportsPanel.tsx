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
      {/* Top Header Card */}
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 18,
          marginBottom: 24,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-subtle) 100%)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: "1.65rem" }}>Weekly Executive Summaries</h1>
            <span className="badge badge-warning">Every Monday 8:00 AM</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Automated intelligence digest delivered according to your business timezone ({ws.timezone}).
          </p>
        </div>

        {/* Email Digest Settings */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--bg2)", padding: "12px 16px", borderRadius: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              style={{ width: "auto", margin: 0 }}
              checked={prefs.weeklyEmail !== false}
              onChange={(e) => setPref({ weeklyEmail: e.target.checked })}
            />
            Email me when summary is ready
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              style={{ width: "auto", margin: 0 }}
              checked={prefs.weeklyStatusOnly === true}
              onChange={(e) => setPref({ weeklyStatusOnly: e.target.checked })}
            />
            Send short status even if no data changed
          </label>
        </div>
      </div>

      {error && (
        <div role="alert" className="error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      {reports.length === 0 && (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
          <h3 style={{ margin: "0 0 8px 0" }}>No weekly summaries yet</h3>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
            Your first automated weekly health digest arrives next Monday at 8:00 AM once commercial records are logged.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {reports.map((r) => (
          <article
            key={r.weekId}
            className="card"
            style={{ padding: "26px 28px", border: "1px solid var(--border)" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                marginBottom: 18,
                borderBottom: "1px solid var(--border)",
                paddingBottom: 14,
              }}
            >
              <div>
                <span className="badge badge-primary" style={{ marginRight: 8 }}>
                  Weekly Digest
                </span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                  {r.periodStart} → {r.periodEnd}
                </span>
              </div>
              {r.kind === "status_only" && <span className="badge">Status Only</span>}
            </div>

            {/* Structured Insights Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 18,
                marginBottom: 20,
              }}
            >
              {/* Changes */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 10,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0", fontSize: 13, color: "var(--accent)" }}>
                  📈 What Changed
                </h4>
                {r.changes.length ? (
                  <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: "var(--body)" }}>
                    {r.changes.map((c, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    No changes in recorded figures.
                  </p>
                )}
              </div>

              {/* Data Freshness */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 10,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0", fontSize: 13, color: "var(--ink)" }}>
                  📡 Data Freshness
                </h4>
                <p style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--body)" }}>
                  {r.freshness.latestRecordDate
                    ? `Latest entry: ${r.freshness.latestRecordDate}`
                    : "No entries yet."}
                  {r.freshness.stale && " (stale > 2 weeks)"}
                </p>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {r.recommendations.generated} generated · {r.recommendations.markedToTry} tried · {r.recommendations.dismissed} dismissed
                </div>
              </div>

              {/* Gaps */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 10,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0", fontSize: 13, color: "var(--gold)" }}>
                  ⚠️ Telemetry Gaps
                </h4>
                {r.gaps.length > 0 ? (
                  <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: "var(--body)" }}>
                    {r.gaps.map((g, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {g}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    No missing critical gaps detected.
                  </p>
                )}
              </div>
            </div>

            {/* Next Focus */}
            <div
              style={{
                padding: "14px 18px",
                borderRadius: 10,
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-line)",
              }}
            >
              <strong style={{ fontSize: 12.5, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Target Focus For Upcoming Week:
              </strong>
              <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "var(--ink)" }}>
                {r.nextFocus}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
