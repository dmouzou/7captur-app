import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import type { Recommendation } from "../../shared/recommendation";
import { Icon } from "../../components/Icon";

type Rec = Recommendation & { id: string; status: string; aiSummary?: { text: string } };

const EVIDENCE_LABEL = {
  explore: "Explore: early signals only",
  improve: "Improve: partial evidence",
  optimize: "Optimize: spend, sales and costs",
};

const MODE_ACTION_BADGE: Record<string, string> = {
  optimize: "Your next move · optimize",
  improve: "Your next move · improve",
  explore: "Your next move · explore",
};

export function RecommendationsPanel({
  onNavigate,
  onReportIssue,
  embedded = false,
}: {
  onNavigate?: (tab: string) => void;
  onReportIssue?: (recId: string) => void;
  /** Rendered inside the Understand tab: compact header with the Beginner / Advanced toggle, no page title. */
  embedded?: boolean;
}) {
  const ws = useWorkspace();
  const plan = PLANS[ws.plan] ?? PLANS.starter;
  const [recs, setRecs] = useState<Rec[]>([]);
  const [used, setUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seen] = useState(() => new Set<string>());

  // Progressive disclosure mode (Spec 5.3): beginner vs advanced
  const [viewMode, setViewMode] = useState<"beginner" | "advanced">("beginner");

  // Filters (Spec 6.0)
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  // Outcome recording state (Spec 6.1 & 9.3)
  const [outcomeTarget, setOutcomeTarget] = useState<Rec | null>(null);
  const [outcomeNote, setOutcomeNote] = useState("");
  const [outcomeAssessment, setOutcomeAssessment] = useState<"positive" | "neutral" | "negative">("positive");
  const [recordingOutcome, setRecordingOutcome] = useState(false);
  const [safetyModal, setSafetyModal] = useState<{
    reason: "recent_recommendation" | "no_records" | "no_new_data" | "general";
    message: string;
    minutesAgo?: number;
  } | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, `workspaces/${ws.workspaceId}/recommendations`), orderBy("createdAt", "desc"), limit(30)),
      (s) => setRecs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Recommendation & { status: string }) })))
    );
  }, [ws.workspaceId]);

  // Usage doc id is the ISO week id in the workspace timezone
  useEffect(() => {
    const { weekId } = periodIds(new Date(), ws.accountTimezone);
    return onSnapshot(doc(db, `accounts/${ws.ownerUid}/usage/${weekId}`), (s) =>
      setUsed((s.data()?.recommendations as number | undefined) ?? 0), () => undefined
    );
  }, [ws.ownerUid, ws.accountTimezone]);

  async function triggerGenerate(override = false) {
    setError("");

    if (!override) {
      // Client-side quick check: if newest rec is <30 min old
      if (recs.length > 0) {
        let maxMs = 0;
        for (const r of recs) {
          const rawTs = (r as any).createdAt;
          const ms = rawTs?.toMillis ? rawTs.toMillis() : rawTs ? new Date(rawTs).getTime() : 0;
          if (ms > maxMs) maxMs = ms;
        }
        if (maxMs > 0 && Date.now() - maxMs < 30 * 60 * 1000) {
          const diffMinutes = Math.max(0, Math.round((Date.now() - maxMs) / 60000));
          setSafetyModal({
            reason: "recent_recommendation",
            message: `A recommendation was generated ${diffMinutes <= 1 ? "just now" : `${diffMinutes} minutes ago`}. We recommend reviewing your existing recommendations before generating another.`,
            minutesAgo: diffMinutes,
          });
          return;
        }
      }
    }

    setBusy(true);
    setSafetyModal(null);
    try {
      await httpsCallable(functions, "generateRecommendation")({
        workspaceId: ws.workspaceId,
        businessId: ws.businessId,
        requestId: crypto.randomUUID(),
        overrideSafetyNet: override,
      });
    } catch (e: any) {
      const err = e as { code?: string; details?: { resetsOn?: string; reason?: string }; message?: string };
      if (err.code === "functions/failed-precondition") {
        setSafetyModal({
          reason: (err.details?.reason as any) || "general",
          message: err.message || "A safety check prevented generation. You can still insist to generate a new recommendation.",
        });
      } else if (err.code === "functions/resource-exhausted") {
        setError(
          `You have used this week's recommendations. They reset on ${
            err.details?.resetsOn ?? "Monday"
          }. You can still review your history.`
        );
      } else {
        setError(err.message || "Could not generate a recommendation. Your credit was not used.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: string, reason?: string, note?: string) {
    setError("");
    try {
      await httpsCallable(functions, "recordRecommendationAction")({
        workspaceId: ws.workspaceId,
        recommendationId: id,
        action,
        reason: reason || undefined,
        outcomeNote: note || undefined,
      });
    } catch (e: any) {
      console.error("Failed to record recommendation action:", e);
      setError(e?.message || "Could not save your choice.");
    }
  }

  async function handleRecordOutcome() {
    if (!outcomeTarget) return;
    setRecordingOutcome(true);
    try {
      await act(outcomeTarget.id, "outcome_recorded", outcomeAssessment, outcomeNote);
      setOutcomeTarget(null);
      setOutcomeNote("");
    } finally {
      setRecordingOutcome(false);
    }
  }

  const filteredRecs = useMemo(() => {
    const getMs = (r: Rec) => {
      const c = (r as any).createdAt;
      if (!c) return Date.now();
      if (typeof c?.toMillis === "function") return c.toMillis();
      if (typeof c?.toDate === "function") return c.toDate().getTime();
      if (c?.seconds) return c.seconds * 1000 + (c.nanoseconds ? c.nanoseconds / 1e6 : 0);
      if (typeof c === "string") {
        const ms = new Date(c).getTime();
        return isNaN(ms) ? 0 : ms;
      }
      if (typeof c === "number") return c;
      return 0;
    };

    return recs
      .filter((r) => {
        if (filterMode !== "all" && r.mode !== filterMode) return false;
        if (filterStatus !== "all" && r.status !== filterStatus) return false;
        if (filterCategory !== "all" && r.category !== filterCategory) return false;
        return true;
      })
      .sort((a, b) => getMs(b) - getMs(a));
  }, [recs, filterMode, filterStatus, filterCategory]);

  return (
    <section>
      {/* Top Header Card (stand-alone) or compact bar (inside Understand) */}
      {embedded ? (
        <div
          id="recommendations"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, margin: "8px 0 18px" }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Your recommendations</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
              Credits this week: <strong style={{ color: "var(--ink)" }}>{used} of {plan.recommendations.weekly} used</strong>. They reset every Monday.
            </p>
          </div>
          {/* Progressive Disclosure Toggle (Spec 5.3) */}
          <div className="segmented-control">
            <button
              type="button"
              className={viewMode === "beginner" ? "active" : ""}
              onClick={() => setViewMode("beginner")}
            >
              Beginner view
            </button>
            <button
              type="button"
              className={viewMode === "advanced" ? "active" : ""}
              onClick={() => setViewMode("advanced")}
            >
              Advanced view
            </button>
          </div>

        </div>
      ) : (
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 18,
          marginBottom: 20,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-subtle) 100%)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: "1.65rem" }}>Growth Recommendations</h1>
            <span className="badge badge-primary">Evidence Calibrated</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Weekly credits: <strong style={{ color: "var(--ink)" }}>{used} of {plan.recommendations.weekly} used</strong>. Credits reset every Monday.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Progressive Disclosure Toggle (Spec 5.3) */}
          <div className="segmented-control">
            <button
              type="button"
              className={viewMode === "beginner" ? "active" : ""}
              onClick={() => setViewMode("beginner")}
            >
              Beginner view
            </button>
            <button
              type="button"
              className={viewMode === "advanced" ? "active" : ""}
              onClick={() => setViewMode("advanced")}
            >
              Advanced view
            </button>
          </div>

          <button
            type="button"
            onClick={() => triggerGenerate(false)}
            disabled={busy}
            style={{
              padding: "10px 22px",
              fontSize: 14,
              borderRadius: 10,
            }}
          >
            {busy ? "Working it out…" : "Generate Recommendation"}
          </button>
        </div>
      </div>
      )}

      {/* Filter toolbar (Spec 6.0) */}
      <div
        className="card"
        style={{
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 13, borderRadius: 6 }}
          >
            <option value="all">All Statuses</option>
            <option value="generated">Generated</option>
            <option value="viewed">Viewed</option>
            <option value="marked_to_try">Marked to Try</option>
            <option value="completed">Completed</option>
            <option value="outcome_recorded">Outcome Recorded</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>Mode:</span>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 13, borderRadius: 6 }}
          >
            <option value="all">All Modes</option>
            <option value="explore">Explore</option>
            <option value="improve">Improve</option>
            <option value="optimize">Optimize</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>Category:</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 13, borderRadius: 6 }}
          >
            <option value="all">All Categories</option>
            <option value="content">Content</option>
            <option value="promotion">Promotion</option>
            <option value="budget">Budget</option>
            <option value="audience_offer">Audience & Offer</option>
            <option value="lead_sales_process">Leads & Sales</option>
            <option value="measurement">Measurement</option>
          </select>
        </div>

        {(filterStatus !== "all" || filterMode !== "all" || filterCategory !== "all") && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setFilterStatus("all");
              setFilterMode("all");
              setFilterCategory("all");
            }}
            style={{ fontSize: 12.5, padding: 0 }}
          >
            Reset filters
          </button>
        )}
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

      {/* Outcome Recording Dialog (Spec 6.1 & 9.3) */}
      {outcomeTarget && (
        <div
          className="card"
          style={{
            padding: "20px 24px",
            marginBottom: 24,
            border: "2px solid var(--accent)",
            background: "var(--surface)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: "1.15rem", color: "var(--ink)" }}>
              <Icon name="check" size={18} inline accent /> Record Outcome for Recommendation
            </h3>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOutcomeTarget(null)}
              style={{ padding: "4px 10px", fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--body)" }}>
            <strong>Action tested:</strong> {outcomeTarget.action}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                What was the result?
              </span>
              <select
                value={outcomeAssessment}
                onChange={(e) => setOutcomeAssessment(e.target.value as "positive" | "neutral" | "negative")}
                style={{ width: "100%", maxWidth: 360 }}
              >
                <option value="positive">Positive: saw more qualified leads, lower cost, or sales</option>
                <option value="neutral">Neutral: results inconclusive / need longer test</option>
                <option value="negative">Negative: did not produce expected results</option>
              </select>
            </label>

            <label>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                Notes on what happened (optional)
              </span>
              <textarea
                rows={3}
                placeholder="e.g. Spent $30 on Instagram reel test, got 4 direct messages and 1 order. Enquiries improved relative to previous static post."
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                style={{ width: "100%", resize: "vertical" }}
              />
            </label>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={handleRecordOutcome}
                disabled={recordingOutcome}
                style={{ padding: "8px 20px", fontSize: 13.5 }}
              >
                {recordingOutcome ? "Saving outcome…" : "Save Outcome to History"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOutcomeTarget(null)}
                style={{ padding: "8px 16px", fontSize: 13.5 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations Feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {filteredRecs.map((r) => {
          const modeColor =
            r.mode === "optimize" ? "badge-primary" : r.mode === "improve" ? "badge-pop" : "badge-warning";
          const statusLabel = r.status.replace(/_/g, " ");
          const badgeText = MODE_ACTION_BADGE[r.mode] ?? MODE_ACTION_BADGE.optimize;

          return (
            <article
              key={r.id}
              className="card recommendation-card recommendation-text"
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
                  <span className="badge" style={{ textTransform: "capitalize" }}>
                    Category: {r.category.replace(/_/g, " ")}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="muted mono" style={{ fontSize: 12 }}>
                    ID: {r.id.slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onReportIssue?.(r.id)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      margin: 0,
                      borderRadius: 6,
                    }}
                    title="Report inaccurate numbers or poor advice"
                  >
                    <Icon name="alert" size={13} inline /> Report issue
                  </button>
                </div>
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
                    <Icon name="sparkle" size={15} accent />
                    <strong style={{ fontSize: 13, color: "var(--accent)" }}>AI Synthesized Takeaway</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>
                    {r.aiSummary.text}
                  </p>
                </div>
              )}

              {/* Distinctive Next Move Action Directive (Spec Item 9) */}
              <div className={`action-directive-card mode-${r.mode}`}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div className={`action-directive-badge mode-${r.mode}`}>
                    <span>⚡ {badgeText}</span>
                  </div>
                  <span className="action-directive-sub">
                    What to do next
                  </span>
                </div>
                <h3 className="action-directive-text">
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
                    <Icon name="bulb" size={15} inline />Why this action?
                  </h4>
                  {r.rationale.map((t, i) => (
                    <p key={i} style={{ margin: "0 0 6px 0", fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                      • {t}
                    </p>
                  ))}
                </div>

                {/* Column 2: Risks & Guardrails */}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--gold)" }}>
                    <Icon name="alert" size={15} inline />Risk & Low-Risk Guardrails
                  </h4>
                  <p style={{ margin: "0 0 6px 0", fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                    <strong>Risk:</strong> {r.risk}
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                    <strong>Do not act if:</strong> {r.doNotActIf}
                  </p>
                </div>

                {/* Column 3: What to Measure Next */}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--ink)" }}>
                    <Icon name="bars" size={15} inline />What to measure next
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

              {/* Advanced view details (Spec 5.3) */}
              {viewMode === "advanced" && (
                <div
                  style={{
                    marginBottom: 20,
                    padding: "16px 18px",
                    background: "var(--bg2)",
                    borderRadius: 10,
                    fontSize: 13,
                    border: "1px solid var(--border)",
                  }}
                >
                  <h4 style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--ink)" }}>
                    <Icon name="signal" size={15} inline /> Advanced view: the numbers behind this
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                    <div>
                      <span className="muted" style={{ fontSize: 12 }}>Time Window:</span>
                      <p className="mono" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
                        {r.evidence.windowStart} to {r.evidence.windowEnd}
                      </p>
                    </div>
                    <div>
                      <span className="muted" style={{ fontSize: 12 }}>Deterministic Rule Engine:</span>
                      <p className="mono" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
                        Version {r.engineVersion}
                      </p>
                    </div>
                    <div>
                      <span className="muted" style={{ fontSize: 12 }}>Sample Sizes:</span>
                      <p className="mono" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
                        {Object.entries(r.evidence.sampleSize)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(", ")}
                      </p>
                    </div>
                  </div>

                  {r.calculation && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Reproducible Calculation ({r.calculation.formulaVersion}):</span>
                      <p className="mono" style={{ margin: "4px 0 0", fontSize: 13, color: "var(--accent)" }}>
                        Revenue {r.calculation.revenue} − Costs {r.calculation.costs} ÷ Spend {r.calculation.spend} ={" "}
                        {r.calculation.adjustedReturn?.toFixed(2)} {r.calculation.currency}
                      </p>
                    </div>
                  )}

                  {r.metrics && r.metrics.length > 0 && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Numbers behind this ({r.decisionBasis?.metric ?? "metrics"}):</span>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                        {r.metrics.map((m, i) => <li key={i}>{m.name}: <span className="mono">{m.value}</span></li>)}
                      </ul>
                    </div>
                  )}
                  {r.evidence_quality?.gates && (
                    <div style={{ marginTop: 10 }}>
                      <span className="muted" style={{ fontSize: 12 }}>Data checks (a failed check limits what the engine will suggest)
                        {r.evidence_quality.confidence ? `. Confidence: ${r.evidence_quality.confidence}` : ""}:</span>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                        {r.evidence_quality.gates.map((g) => (
                          <li key={g.key}>{g.passed ? "Passed" : "Not yet"}: {g.label}, {g.key === "attribution" ? `${Math.round(g.actual * 100)}% of ${Math.round(g.required * 100)}%` : `${g.actual} of ${g.required}`}</li>
                        ))}
                      </ul>
                      {r.evidence_quality.unknownCosts && r.evidence_quality.unknownCosts.length > 0 && (
                        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Not entered (unknown, not zero): {r.evidence_quality.unknownCosts.join(", ")}.</p>
                      )}
                    </div>
                  )}
                  {r.evidence.fx && (
                    <p className="muted" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                      {r.evidence.fx.convertedRecords} record(s) converted to {r.evidence.fx.reportingCurrency} using ECB rates dated {r.evidence.fx.rateDate}.
                    </p>
                  )}

                  {r.evidence.warnings && r.evidence.warnings.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <span className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>Evidence Warnings:</span>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--muted)" }}>
                        {r.evidence.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

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

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {onNavigate && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onNavigate("decisions")}
                      style={{
                        padding: "8px 16px",
                        fontSize: 13.5,
                        borderRadius: 8,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                      title="Review and track this decision in the Decision Center"
                    >
                      <Icon name="compass" size={14} inline /> Investigate Decision →
                    </button>
                  )}

                  {["generated", "viewed", "deferred"].includes(r.status) && (
                    <>
                      <button
                        type="button"
                        onClick={() => act(r.id, "marked_to_try")}
                        style={{ padding: "8px 18px", fontSize: 13.5, borderRadius: 8 }}
                      >
                        <Icon name="check" size={14} inline />I'll try this
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
                    <>
                      <button
                        type="button"
                        onClick={() => setOutcomeTarget(r)}
                        style={{ padding: "8px 18px", fontSize: 13.5, borderRadius: 8 }}
                      >
                        <Icon name="clipboard" size={14} inline />Record Outcome
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => act(r.id, "completed")}
                        style={{ padding: "8px 18px", fontSize: 13.5, borderRadius: 8 }}
                      >
                        <Icon name="check" size={14} inline />Mark Completed
                      </button>
                    </>
                  )}

                  {r.status === "completed" && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setOutcomeTarget(r)}
                      style={{ padding: "8px 18px", fontSize: 13.5, borderRadius: 8 }}
                    >
                      <Icon name="clipboard" size={14} inline />Add Outcome Notes
                    </button>
                  )}

                  {r.status === "outcome_recorded" && (
                    <span className="badge badge-primary" style={{ padding: "6px 12px", fontSize: 12 }}>
                      ✓ Outcome Logged
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {filteredRecs.length === 0 && recs.length > 0 && (
          <div className="card" style={{ padding: "36px 20px", textAlign: "center" }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              No recommendations match the selected filters.
            </p>
          </div>
        )}

        {recs.length === 0 && (
          <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div className="empty-icon"><Icon name="bulb" size={34} /></div>
            <h3 style={{ margin: "0 0 8px 0" }}>No recommendations yet</h3>
            <p className="muted" style={{ margin: "0 0 20px 0", fontSize: 14, maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
              Enter commercial records (sales, spend, enquiries, posts) or click below to generate your first AI strategic move.
            </p>
            <button
              type="button"
              onClick={() => triggerGenerate(false)}
              disabled={busy}
              style={{ borderRadius: 10, padding: "10px 22px" }}
            >
              {busy ? "Working…" : "Generate First Recommendation"}
            </button>
          </div>
        )}
      </div>

      {/* Safety Net Confirmation Modal (Spec Item 2) */}
      {safetyModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSafetyModal(null);
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 480,
              width: "100%",
              padding: "28px 24px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              border: "1px solid var(--line-strong)",
              borderRadius: 16,
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "rgba(245, 158, 11, 0.15)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fbbf24",
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.2rem", color: "var(--ink)" }}>
                  {safetyModal.reason === "recent_recommendation"
                    ? "Recent Recommendation Active"
                    : safetyModal.reason === "no_records"
                    ? "No Recent Records Found"
                    : "No New Data Since Last Run"}
                </h3>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Safety Check Triggered
                </span>
              </div>
            </div>

            <p style={{ margin: "0 0 20px 0", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
              {safetyModal.message}
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSafetyModal(null)}
                style={{ padding: "9px 18px", fontSize: 13.5, borderRadius: 8 }}
              >
                Review Current Recommendations
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSafetyModal(null);
                  triggerGenerate(true);
                }}
                style={{
                  padding: "9px 18px",
                  fontSize: 13.5,
                  borderRadius: 8,
                  background: "var(--accent-fill)",
                  color: "var(--on-accent)",
                  fontWeight: 600,
                }}
              >
                {busy ? "Generating…" : "Generate Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
