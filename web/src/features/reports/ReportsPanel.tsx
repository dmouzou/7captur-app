import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";
import type { WeeklyReport } from "../../shared/report";
import { Icon } from "../../components/Icon";
import { ReportArt } from "../../components/art";

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
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <ReportArt size={190} />
          <h2 style={{ margin: "12px 0 10px 0", fontWeight: 500 }}>Weekly Summary is on Growth and Custom</h2>
          <p className="muted" style={{ margin: "0 auto 20px", fontSize: 14.5, maxWidth: 500, lineHeight: 1.55 }}>
            Every Monday you get a short summary of what changed, what data is missing, and which decisions are ready to review. It also keeps a track record of what worked.
          </p>
          <button type="button" className="btn btn-lime" onClick={() => onNavigate?.("billing")}>
            Upgrade to Growth
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="card" style={{ marginBottom: 20, padding: "24px 28px", background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ maxWidth: 540 }}>
            <span className="badge badge-primary">Every Monday, 8:00 AM</span>
            <h1 style={{ margin: "10px 0 8px", fontSize: "1.75rem", fontWeight: 500 }}>Weekly summary</h1>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.55 }}>
              What changed this week, what is missing, and which decisions are ready to review. Delivered on {ws.timezone} time.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={prefs.weeklyEmail !== false} onChange={(e) => setPref({ weeklyEmail: e.target.checked })} />
                Email me when my summary is ready
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0, fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={prefs.weeklyStatusOnly === true} onChange={(e) => setPref({ weeklyStatusOnly: e.target.checked })} />
                Send a short note even in weeks with no new data
              </label>
            </div>
          </div>
          <ReportArt size={180} />
        </div>
      </div>

      {error && (
        <div role="alert" className="error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      {reports.length === 0 && (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <ReportArt size={170} />
          <h3 style={{ margin: "8px 0 8px 0", fontWeight: 500 }}>No weekly summaries yet</h3>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
            Your first summary arrives next Monday at 8:00 AM, once you have added some records.
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
                  This week
                </span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                  {r.periodStart} → {r.periodEnd}
                </span>
              </div>
              {r.kind === "status_only" && <span className="badge">Short note</span>}
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
                  <Icon name="trend" size={15} inline />What changed
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
                    Nothing changed in your recorded numbers.
                  </p>
                )}
              </div>

              {/* How fresh your data is */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 10,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ margin: "0 0 10px 0", fontSize: 13, color: "var(--ink)" }}>
                  <Icon name="signal" size={15} inline />How fresh your data is
                </h4>
                <p style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--body)" }}>
                  {r.freshness.latestRecordDate
                    ? `Latest entry: ${r.freshness.latestRecordDate}`
                    : "No entries yet."}
                  {r.freshness.stale && " (more than 2 weeks old)"}
                </p>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {r.recommendations.generated} recommended · {r.recommendations.markedToTry} tried · {r.recommendations.dismissed} dismissed
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
                  <Icon name="alert" size={15} inline />What is missing
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
                    Nothing important is missing.
                  </p>
                )}
              </div>
            </div>

            {/* Decision Reviews: Ready to review, Too early, Not enough data */}
            {r.reviews && (
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: 14, color: "var(--ink)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span><Icon name="check" size={15} inline accent />How your decisions turned out <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 7Captur records and reviews outcomes with you</span></span>
                  {r.reviews.trackRecord && (
                    <span className="badge badge-primary" style={{ fontWeight: 500, fontSize: 12 }}>
                      Track record: {r.reviews.trackRecord}
                    </span>
                  )}
                </h4>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
                  {/* Group 1: Ready to review */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--accent-line)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span className="badge badge-primary" style={{ fontSize: 11 }}>Ready to review</span>
                      <span style={{ fontSize: 13, color: "var(--ink)" }}>({r.reviews.ready.length})</span>
                    </div>
                    {r.reviews.ready.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--body)" }}>
                        {r.reviews.ready.map((item) => (
                          <li key={item.id} style={{ marginBottom: 8 }}>
                            <span style={{ color: "var(--ink)" }}>{item.action}</span>
                            <div className="muted" style={{ fontSize: 12 }}>{item.prompt}</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No decisions are ready to review yet.</p>
                    )}
                  </div>

                  {/* Group 2: Too early */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span className="badge" style={{ fontSize: 11 }}>Too early</span>
                      <span style={{ fontSize: 13, color: "var(--ink)" }}>({r.reviews.tooEarly.length})</span>
                    </div>
                    {r.reviews.tooEarly.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--body)" }}>
                        {r.reviews.tooEarly.map((item) => (
                          <li key={item.id} style={{ marginBottom: 8 }}>
                            <span style={{ color: "var(--ink)" }}>{item.action}</span>
                            <div className="muted" style={{ fontSize: 12 }}>{item.reason} Review on {item.readyOn}.</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No decisions are waiting on more time.</p>
                    )}
                  </div>

                  {/* Group 3: Not enough data */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span className="badge badge-warning" style={{ fontSize: 11 }}>Not enough data</span>
                      <span style={{ fontSize: 13, color: "var(--ink)" }}>({r.reviews.notEnoughData.length})</span>
                    </div>
                    {r.reviews.notEnoughData.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--body)" }}>
                        {r.reviews.notEnoughData.map((item) => (
                          <li key={item.id} style={{ marginBottom: 8 }}>
                            <span style={{ color: "var(--ink)" }}>{item.action}</span>
                            <div className="muted" style={{ fontSize: 12 }}>{item.whatToAdd}</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>No decisions are missing records.</p>
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
              <strong style={{ fontSize: 12.5, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
                Focus for next week
              </strong>
              <p className="action-directive-text" style={{ margin: "4px 0 0 0", fontSize: 15 }}>
                {r.nextFocus}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
