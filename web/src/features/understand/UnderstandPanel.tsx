import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { Icon } from "../../components/Icon";
import { PLANS } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import type { Recommendation } from "../../shared/recommendation";

interface UnderstandPanelProps {
  onNavigate: (route: string) => void;
  onOpenChat: () => void;
}

interface TelemetryHealth {
  freshnessDays: number | null;
  isStale: boolean;
  minDate: string | null;
  maxDate: string | null;
  sources: string[];
  currencies: string[];
  missingFieldsCount: number;
  salesWithoutAttribution: number;
  promosWithoutObjective: number;
  leadsWithoutSource: number;
  evidenceLevel: "Explore" | "Improve" | "Optimize";
  nextLevelUnlock: string;
}

export function UnderstandPanel({ onNavigate, onOpenChat }: UnderstandPanelProps) {
  const ws = useWorkspace();
  const [sales, setSales] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);

  // Recommendation engine state
  const [recs, setRecs] = useState<(Recommendation & { id: string })[]>([]);
  const [used, setUsed] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [safetyModal, setSafetyModal] = useState<{
    reason: "recent_recommendation" | "no_records" | "no_new_data" | "general";
    message: string;
    minutesAgo?: number;
  } | null>(null);

  const plan = PLANS[ws.plan] ?? PLANS.starter;
  const weeklyQuota = plan?.recommendations?.weekly ?? 1;

  // Listen to recommendations
  useEffect(() => {
    if (!ws.workspaceId) return;
    return onSnapshot(
      query(collection(db, `workspaces/${ws.workspaceId}/recommendations`), orderBy("createdAt", "desc"), limit(20)),
      (s) => setRecs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Recommendation) })))
    );
  }, [ws.workspaceId]);

  // Listen to weekly quota usage
  useEffect(() => {
    if (!ws.ownerUid) return;
    const { weekId } = periodIds(new Date(), ws.accountTimezone || ws.timezone);
    return onSnapshot(
      doc(db, `accounts/${ws.ownerUid}/usage/${weekId}`),
      (s) => {
        setUsed((s.data()?.recommendations as number | undefined) ?? 0);
      },
      () => undefined
    );
  }, [ws.ownerUid, ws.accountTimezone, ws.timezone]);

  async function triggerGenerate(override = false) {
    setError("");

    if (!override) {
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
      onNavigate("/decide");
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
          }. You can still review your history in Decision Center.`
        );
      } else {
        setError(err.message || "Could not generate a recommendation. Your credit was not used.");
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!ws.workspaceId || !ws.businessId) return;
    const bid = ws.businessId;
    const unsubs = [
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/sales`), where("businessId", "==", bid), limit(200)), (s) => setSales(s.docs.map((d) => d.data()))),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/costs`), where("businessId", "==", bid), limit(100)), (s) => setCosts(s.docs.map((d) => d.data()))),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/leads`), where("businessId", "==", bid), limit(200)), (s) => setLeads(s.docs.map((d) => d.data()))),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/promotions`), where("businessId", "==", bid), limit(200)), (s) => setPromotions(s.docs.map((d) => d.data()))),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/posts`), where("businessId", "==", bid), limit(200)), (s) => setPosts(s.docs.map((d) => d.data()))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [ws.workspaceId, ws.businessId]);

  const health = useMemo<TelemetryHealth>(() => {
    const allDates: string[] = [];
    const sourceSet = new Set<string>();
    const currencySet = new Set<string>();

    let salesNoAttr = 0;
    sales.forEach((s) => {
      if (s.date) allDates.push(s.date);
      if (s.provenance) sourceSet.add(s.provenance);
      if (s.currency) currencySet.add(s.currency);
      if (!s.attribution || s.attribution === "unknown") salesNoAttr++;
    });

    let promosNoObj = 0;
    promotions.forEach((p) => {
      if (p.startDate) allDates.push(p.startDate);
      if (p.platform) sourceSet.add(p.platform);
      if (p.currency) currencySet.add(p.currency);
      if (!p.objective) promosNoObj++;
    });

    let leadsNoSource = 0;
    leads.forEach((l) => {
      if (l.date) allDates.push(l.date);
      if (l.source) sourceSet.add(l.source);
      if (!l.source) leadsNoSource++;
    });

    costs.forEach((c) => {
      if (c.effectiveDate) allDates.push(c.effectiveDate);
      if (c.category) sourceSet.add(c.category);
    });

    posts.forEach((pt) => {
      if (pt.publishedAt) allDates.push(pt.publishedAt);
      if (pt.platform) sourceSet.add(pt.platform);
    });

    allDates.sort();
    const minDate = allDates[0] ?? null;
    const maxDate = allDates[allDates.length - 1] ?? null;

    let freshnessDays: number | null = null;
    let isStale = false;
    if (maxDate) {
      const maxMs = Date.parse(maxDate);
      if (!isNaN(maxMs)) {
        freshnessDays = Math.max(0, Math.floor((Date.now() - maxMs) / (24 * 60 * 60 * 1000)));
        isStale = freshnessDays > 14;
      }
    }

    const totalRecords = sales.length + costs.length + leads.length + promotions.length + posts.length;
    let evidenceLevel: "Explore" | "Improve" | "Optimize" = "Explore";
    let nextLevelUnlock = "Log at least 14 days of commercial data to unlock trend detection.";

    if (totalRecords >= 20 && freshnessDays !== null && freshnessDays <= 14) {
      if (sourceSet.has("connected") || totalRecords >= 50) {
        evidenceLevel = "Optimize";
        nextLevelUnlock = "Telemetry fully optimized for high-certainty algorithmic decisions.";
      } else {
        evidenceLevel = "Improve";
        nextLevelUnlock = "Connect a live platform (Shopify) or import cost-of-goods (COGS) to reach Optimize.";
      }
    }

    return {
      freshnessDays,
      isStale,
      minDate,
      maxDate,
      sources: Array.from(sourceSet),
      currencies: Array.from(currencySet),
      missingFieldsCount: salesNoAttr + promosNoObj + leadsNoSource,
      salesWithoutAttribution: salesNoAttr,
      promosWithoutObjective: promosNoObj,
      leadsWithoutSource: leadsNoSource,
      evidenceLevel,
      nextLevelUnlock,
    };
  }, [sales, costs, leads, promotions, posts]);

  // Weekly Changes Calculation (What Changed)
  const weeklySummary = useMemo(() => {
    const totalRev = sales.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const totalSpend = promotions.reduce((sum, p) => sum + (Number(p.spend) || 0), 0) + costs.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const roas = totalSpend > 0 ? (totalRev / totalSpend).toFixed(2) : "N/A";

    return {
      revenue: totalRev,
      spend: totalSpend,
      roas,
      leadsCount: leads.length,
      ordersCount: sales.length,
    };
  }, [sales, costs, promotions, leads]);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", paddingBottom: 60 }}>
      {/* Header */}
      <div
        className="card"
        style={{
          padding: "26px 28px",
          marginBottom: 24,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="badge badge-primary">Intelligence Telemetry</span>
              <span className="muted" style={{ fontSize: 13 }}>Workspace Health & Evidence</span>
            </div>
            <h1 style={{ margin: "0 0 8px 0", fontSize: "1.75rem", fontWeight: 500 }}>
              Understand Your Numbers
            </h1>
            <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 640 }}>
              Assess telemetry health, monitor data freshness across your channels, and track weekly movement in-app.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onOpenChat}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                fontSize: 13.5,
                borderRadius: 10,
                margin: 0,
              }}
            >
              <Icon name="help" size={17} />
              Ask 7Captur
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => triggerGenerate(false)}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                fontSize: 13.5,
                borderRadius: 10,
                margin: 0,
              }}
            >
              <Icon name="sparkle" size={17} />
              {busy ? "Analyzing Telemetry…" : "Generate Recommendation"}
            </button>
          </div>
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
            fontSize: 13.5,
          }}
        >
          {error}
        </div>
      )}

      {/* AI Strategy Engine Card */}
      <div
        className="card"
        style={{
          padding: "20px 24px",
          marginBottom: 24,
          background: "linear-gradient(135deg, rgba(235, 94, 40, 0.08) 0%, var(--surface) 100%)",
          border: "1px solid var(--accent-subtle, var(--border))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ maxWidth: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>Strategic Recommendations</span>
            <span className="badge badge-accent" style={{ fontSize: 11 }}>
              {weeklyQuota === 0 ? "Unlimited" : `${used} of ${weeklyQuota} used this week`}
            </span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
            Generate high-certainty algorithmic decisions calibrated against your current {health.evidenceLevel.toLowerCase()} evidence. Once generated, recommendations move straight to <span style={{ color: "var(--ink)" }}>Decide</span> for action.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onNavigate("/decide")}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              borderRadius: 8,
              margin: 0,
            }}
          >
            View Decisions →
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => triggerGenerate(false)}
            disabled={busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 20px",
              fontSize: 13,
              borderRadius: 8,
              margin: 0,
            }}
          >
            <Icon name="sparkle" size={16} />
            {busy ? "Analyzing Telemetry…" : "Generate Recommendation"}
          </button>
        </div>
      </div>

      {/* Grid: Evidence Level + Data Health Freshness */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginBottom: 24 }}>
        {/* Evidence Level Card */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>Evidence Level</span>
            <span
              className={`badge ${health.evidenceLevel === "Optimize" ? "badge-success" : health.evidenceLevel === "Improve" ? "badge-primary" : "badge-warning"}`}
              style={{ fontSize: 12 }}
            >
              {health.evidenceLevel}
            </span>
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 500, color: "var(--ink)", marginBottom: 8 }}>
            {health.evidenceLevel} Stage
          </div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 16px 0" }}>
            {health.evidenceLevel === "Explore" && "Initial evidence stage. Recommendations use conservative baselines."}
            {health.evidenceLevel === "Improve" && "Telemetry supports statistical trends across spend and sales."}
            {health.evidenceLevel === "Optimize" && "Fully calibrated telemetry. Decision certainty score is highest."}
          </p>

          <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
              Next Level Unlock
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.45 }}>
              {health.nextLevelUnlock}
            </div>
          </div>
        </div>

        {/* Data Health Freshness Card */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>Data Freshness</span>
            {health.isStale ? (
              <span className="badge badge-danger" style={{ fontSize: 11 }}>Stale (&gt;14 days)</span>
            ) : (
              <span className="badge badge-success" style={{ fontSize: 11 }}>Healthy</span>
            )}
          </div>

          <div style={{ fontSize: "1.6rem", fontWeight: 500, color: "var(--ink)", marginBottom: 8 }}>
            {health.freshnessDays === null
              ? "No records"
              : health.freshnessDays === 0
              ? "Updated today"
              : `${health.freshnessDays}d ago`}
          </div>

          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
            Date coverage: <span className="mono" style={{ color: "var(--ink)" }}>{health.minDate || "None"}</span> to{" "}
            <span className="mono" style={{ color: "var(--ink)" }}>{health.maxDate || "None"}</span>
          </div>

          {health.isStale && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onNavigate("/add")}
              style={{
                width: "100%",
                padding: "8px 14px",
                fontSize: 12.5,
                borderRadius: 8,
                color: "var(--accent)",
                borderColor: "var(--accent)",
                margin: 0,
              }}
            >
              Refresh Data in Add →
            </button>
          )}
        </div>
      </div>

      {/* Telemetry Coverage & Gaps */}
      <div className="card" style={{ padding: "24px 26px", marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: "1.15rem", fontWeight: 500 }}>
          Telemetry Health & Coverage
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Active Channels / Sources</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 500, color: "var(--ink)" }}>
              {health.sources.length ? health.sources.join(", ") : "None recorded"}
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Currencies Detected</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 500, color: "var(--ink)" }}>
              {health.currencies.length ? health.currencies.join(", ") : ws.currency}
            </div>
          </div>

          <div style={{ padding: 14, borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Missing Fields / Telemetry Gaps</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 500, color: health.missingFieldsCount > 0 ? "var(--warning)" : "var(--ink)" }}>
              {health.missingFieldsCount} gap{health.missingFieldsCount === 1 ? "" : "s"}
            </div>
            {health.missingFieldsCount > 0 && (
              <button
                type="button"
                className="link"
                onClick={() => onNavigate("/data/sales")}
                style={{ fontSize: 12, marginTop: 4, display: "inline-block" }}
              >
                Resolve in Your Data →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* What Changed: In-App Weekly Summary */}
      <div className="card" style={{ padding: "24px 26px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 500 }}>What Changed This Week</h3>
            <p className="muted" style={{ margin: "4px 0 0 0", fontSize: 13 }}>
              Aggregated marketing performance across active channels.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onNavigate("/reports")}
            style={{ padding: "6px 14px", fontSize: 12.5, borderRadius: 8, margin: 0 }}
          >
            View Full Weekly Digest →
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Total Revenue</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--ink)" }}>
              {ws.currency} {weeklySummary.revenue.toLocaleString()}
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Total Spend</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--ink)" }}>
              {ws.currency} {weeklySummary.spend.toLocaleString()}
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Blended ROAS</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--accent)" }}>
              {weeklySummary.roas}x
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Orders & Conversions</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--ink)" }}>
              {weeklySummary.ordersCount}
            </div>
          </div>
        </div>
      </div>

      {/* Safety Net Advisory Modal */}
      {safetyModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(4px)",
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
              maxWidth: 520,
              width: "100%",
              padding: 28,
              borderRadius: 14,
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.25)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span className="badge badge-warning" style={{ fontSize: 11 }}>Safety Check</span>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 500 }}>
                Recommendation Advisory
              </h3>
            </div>
            <p style={{ margin: "0 0 20px 0", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
              {safetyModal.message}
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSafetyModal(null);
                  onNavigate("/decide");
                }}
                style={{ padding: "9px 18px", fontSize: 13.5, borderRadius: 8, margin: 0 }}
              >
                Review Existing Decisions
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  setSafetyModal(null);
                  triggerGenerate(true);
                }}
                style={{
                  padding: "9px 18px",
                  fontSize: 13.5,
                  borderRadius: 8,
                  fontWeight: 500,
                  margin: 0,
                }}
              >
                {busy ? "Generating…" : "Generate Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

