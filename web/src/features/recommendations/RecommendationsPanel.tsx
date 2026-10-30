import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import type { Recommendation } from "../../shared/recommendation";

type Rec = Recommendation & { id: string; status: string; aiSummary?: { text: string } };
const EVIDENCE_LABEL = { explore: "Explore: early signals only", improve: "Improve: partial evidence", optimize: "Optimize: spend, sales and costs" };

export function RecommendationsPanel() {
  const ws = useWorkspace();
  const plan = PLANS[ws.plan];
  const [recs, setRecs] = useState<Rec[]>([]);
  const [used, setUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen] = useState(() => new Set<string>());

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/recommendations`), orderBy("createdAt", "desc"), limit(20)),
    (s) => setRecs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Recommendation & { status: string }) }))),
  ), [ws.workspaceId]);

  // Usage doc id is the ISO week id in the workspace timezone (same helper the server uses).
  useEffect(() => {
    const { weekId } = periodIds(new Date(), ws.timezone);
    return onSnapshot(doc(db, `workspaces/${ws.workspaceId}/usage/${weekId}`), (s) => setUsed((s.data()?.recommendations as number | undefined) ?? 0));
  }, [ws.workspaceId, ws.timezone]);

  async function generate() {
    setError(""); setBusy(true);
    try {
      await httpsCallable(functions, "generateRecommendation")({
        workspaceId: ws.workspaceId, businessId: ws.businessId, requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const err = e as { code?: string; details?: { resetsOn?: string } };
      setError(err.code === "functions/resource-exhausted"
        ? `You have used this week's recommendations. They reset on ${err.details?.resetsOn ?? "Monday"}. You can still review your history.`
        : "Could not generate a recommendation. Your credit was not used.");
    } finally { setBusy(false); }
  }

  async function act(id: string, action: string) {
    setError("");
    try { await httpsCallable(functions, "recordRecommendationAction")({ workspaceId: ws.workspaceId, recommendationId: id, action }); }
    catch { setError("Could not save your choice."); }
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
            <h1 style={{ margin: 0, fontSize: "1.65rem" }}>Growth Recommendations</h1>
            <span className="badge badge-primary">AI Powered</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Weekly credits: <strong style={{ color: "var(--ink)" }}>{used} of {plan.recommendations.weekly} used</strong>. Credits reset every Monday.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            style={{
              padding: "10px 22px",
              fontSize: 14,
              borderRadius: 10,
            }}
          >
            {busy ? "Analyzing Telemetry…" : "Generate Recommendation ✨"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="error"
          style={{
            padding: "12px 18px",
            background: "var(--danger-bg)",
            borderRadius: 10,
            border: "1px solid rgba(239, 68, 68, 0.3)",
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {/* Recommendations Feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {recs.map((r) => {
          const modeColor =
            r.mode === "optimize" ? "badge-primary" : r.mode === "improve" ? "badge-pop" : "badge-warning";
          const statusLabel = r.status.replace(/_/g, " ");

          return (
            <article
              key={r.id}
              className="card"
              style={{
                padding: "26px 28px",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow)",
              }}
              onMouseEnter={() => {
                if (r.status === "generated" && !seen.has(r.id)) {
                  seen.add(r.id);
                  act(r.id, "viewed");
                }
              }}
            >
              {/* Header Badges */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 16,
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`badge ${modeColor}`}>{EVIDENCE_LABEL[r.mode]}</span>
                  <span className="badge" style={{ textTransform: "capitalize" }}>
                    Status: {statusLabel}
                  </span>
                </div>
                <span className="muted mono" style={{ fontSize: 12 }}>
                  ID: {r.id.slice(0, 8)}
                </span>
              </div>

              {/* AI Executive Summary Banner */}
              {r.aiSummary && (
                <div
                  style={{
                    padding: "14px 18px",
                    borderRadius: 10,
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent-line)",
                    marginBottom: 18,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 14 }}>✨</span>
                    <strong style={{ fontSize: 13, color: "var(--accent)" }}>AI Synthesized Takeaway</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>
                    {r.aiSummary.text}
                  </p>
                </div>
              )}

              {/* Next Move Callout Box */}
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: 12,
                  background: "var(--surface-hover)",
                  border: "1px solid var(--line-strong)",
                  marginBottom: 20,
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--muted)",
                    marginBottom: 6,
                  }}
                >
                  Recommended Next Move
                </span>
                <h3 style={{ margin: 0, fontSize: "1.25rem", color: "var(--ink)", lineHeight: 1.4 }}>
                  {r.action}
                </h3>
              </div>

              {/* 3-Column Structured Breakdown */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 16,
                  marginBottom: 20,
                }}
              >
                {/* Column 1: Strategic Rationale */}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--accent)" }}>
                    💡 Why this action?
                  </h4>
                  {r.rationale.map((t, i) => (
                    <p key={i} style={{ margin: "0 0 6px 0", fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                      • {t}
                    </p>
                  ))}
                </div>

                {/* Column 2: Risks & Contraindications */}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--gold)" }}>
                    ⚠️ Risk & Contraindications
                  </h4>
                  <p style={{ margin: "0 0 6px 0", fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                    <strong>Risk:</strong> {r.risk}
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                    <strong>Do not act if:</strong> {r.doNotActIf}
                  </p>
                </div>

                {/* Column 3: Measurement */}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--ink)" }}>
                    📊 What to measure next
                  </h4>
                  <p style={{ margin: "0 0 6px 0", fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                    {r.nextMeasurement}
                  </p>
                  {r.unknowns.length > 0 && (
                    <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                      Unknowns: {r.unknowns.join(", ")}
                    </p>
                  )}
                </div>
              </div>

              {/* Calculation & Telemetry Dropdown */}
              <details style={{ marginBottom: 20 }}>
                <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                  View technical calculation & source telemetry
                </summary>
                <div style={{ marginTop: 10, padding: 14, background: "var(--bg2)", borderRadius: 8, fontSize: 12.5 }}>
                  <p className="muted mono" style={{ margin: "0 0 4px" }}>
                    Window: {r.evidence.windowStart} to {r.evidence.windowEnd} · Engine {r.engineVersion}
                  </p>
                  <p className="muted mono" style={{ margin: "0 0 4px" }}>
                    Records: {JSON.stringify(r.evidence.sampleSize)} · Provenance: {JSON.stringify(r.evidence.provenance)}
                  </p>
                  {r.calculation && (
                    <p className="muted mono" style={{ margin: 0 }}>
                      Formula {r.calculation.formulaVersion}: Revenue {r.calculation.revenue} − Costs {r.calculation.costs} ÷ Spend {r.calculation.spend} = {r.calculation.adjustedReturn?.toFixed(2)} ({r.calculation.currency})
                    </p>
                  )}
                </div>
              </details>

              {/* Action Toolbar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <span className="muted" style={{ fontSize: 12.5 }}>
                  You decide. Recommendations never alter external ad campaigns automatically.
                </span>

                <div style={{ display: "flex", gap: 10 }}>
                  {["generated", "viewed", "deferred"].includes(r.status) && (
                    <>
                      <button
                        type="button"
                        onClick={() => act(r.id, "marked_to_try")}
                        style={{ padding: "8px 18px", fontSize: 13.5, borderRadius: 8 }}
                      >
                        ✓ I'll try this
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => act(r.id, "deferred")}
                        style={{ padding: "8px 16px", fontSize: 13.5, borderRadius: 8 }}
                      >
                        Later
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => act(r.id, "dismissed")}
                        style={{ padding: "8px 16px", fontSize: 13.5, borderRadius: 8 }}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  {r.status === "marked_to_try" && (
                    <button
                      type="button"
                      onClick={() => act(r.id, "completed")}
                      style={{ padding: "8px 20px", fontSize: 13.5, borderRadius: 8 }}
                    >
                      ✓ Mark Completed
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {recs.length === 0 && (
          <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>💡</div>
            <h3 style={{ margin: "0 0 8px 0" }}>No recommendations yet</h3>
            <p className="muted" style={{ margin: "0 0 20px 0", fontSize: 14, maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
              Enter commercial records (sales, spend, enquiries, posts) or click below to generate your first AI strategic move.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              style={{ borderRadius: 10, padding: "10px 22px" }}
            >
              {busy ? "Working…" : "Generate First Recommendation"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
