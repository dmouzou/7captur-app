import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";
import type { WeeklyReport } from "../../shared/report";
import { Icon } from "../../components/Icon";

interface Prefs { weeklyEmail?: boolean; weeklyStatusOnly?: boolean }

export function ReportsPanel({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { user } = useAuth();
  const ws = useWorkspace();
  const plan = PLANS[ws.plan] ?? PLANS.starter;
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

  if (!plan?.weeklySummary) {
    return (
      <section>
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div className="empty-icon"><Icon name="trend" size={34} /></div>
          <h2 style={{ margin: "0 0 10px 0" }}>Weekly Summary is available on Growth and above</h2>
          <p className="muted" style={{ margin: "0 auto 20px", fontSize: 14, maxWidth: 500 }}>
            Growth and Custom plans include automated weekly health summaries, intelligent decision outcome reviews (Ready to review, Too early, Not enough data), and historical track record reporting.
          </p>
          <button
            type="button"
            className="btn btn-lime"
            onClick={() => onNavigate?.("billing")}
          >
            Upgrade to Growth
          </button>
        </div>
      </section>
    );
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
          <div className="empty-icon"><Icon name="calendar" size={34} /></div>
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
                  <Icon name="trend" size={15} inline />What Changed
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
                  <Icon name="signal" size={15} inline />Data Freshness
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
                  <Icon name="alert" size={15} inline />Data gaps
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

            {/* Decision Reviews: Ready to review, Too early, Not enough data */}
            {r.reviews && (
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "var(--ink)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span><Icon name="check" size={15} inline accent />Decision Outcomes Review (records and reviews outcomes)</span>
                  {r.reviews.trackRecord && (
                    <span className="badge badge-primary" style={{ fontWeight: 500, fontSize: 12 }}>
                      Track Record: {r.reviews.trackRecord}
                    </span>
                  )}
                </h4>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
                  {/* Group 1: Ready to review */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--accent-line)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span className="badge badge-primary" style={{ fontSize: 11 }}>Ready to review</span>
                      <strong style={{ fontSize: 13, color: "var(--ink)" }}>({r.reviews.ready.length})</strong>
                    </div>
                    {r.reviews.ready.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--body)" }}>
                        {r.reviews.ready.map((item) => (
                          <li key={item.id} style={{ marginBottom: 8 }}>
                            <strong>{item.action}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>{item.prompt}</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No decisions currently ready for outcome review.</p>
                    )}
                  </div>

                  {/* Group 2: Too early */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span className="badge" style={{ fontSize: 11 }}>Too early</span>
                      <strong style={{ fontSize: 13, color: "var(--ink)" }}>({r.reviews.tooEarly.length})</strong>
                    </div>
                    {r.reviews.tooEarly.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--body)" }}>
                        {r.reviews.tooEarly.map((item) => (
                          <li key={item.id} style={{ marginBottom: 8 }}>
                            <strong>{item.action}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>{item.reason} Review on {item.readyOn}.</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No decisions pending observation time.</p>
                    )}
                  </div>

                  {/* Group 3: Not enough data */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span className="badge badge-warning" style={{ fontSize: 11 }}>Not enough data</span>
                      <strong style={{ fontSize: 13, color: "var(--ink)" }}>({r.reviews.notEnoughData.length})</strong>
                    </div>
                    {r.reviews.notEnoughData.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--body)" }}>
                        {r.reviews.notEnoughData.map((item) => (
                          <li key={item.id} style={{ marginBottom: 8 }}>
                            <strong>{item.action}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>{item.whatToAdd}</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No decisions missing required records.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

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
