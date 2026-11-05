import { RecommendationsPanel } from "../recommendations/RecommendationsPanel";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import type { Recommendation } from "../../shared/recommendation";
import { computeDataHealth } from "../../shared/dataHealth";
import { EvidenceCard, FreshnessCard, SourcesCard, UnderstandHero, WeekCard, type Delta, type Level } from "./UnderstandSections";

interface UnderstandPanelProps {
  onNavigate: (route: string) => void;
  onOpenChat: () => void;
  onReportIssue?: (recId: string) => void;
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

export function UnderstandPanel({ onNavigate, onOpenChat, onReportIssue }: UnderstandPanelProps) {
  const ws = useWorkspace();
  const [sales, setSales] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);

  // Recommendation engine state
  const [recs, setRecs] = useState<(Recommendation & { id: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [safetyModal, setSafetyModal] = useState<{
    reason: "recent_recommendation" | "no_records" | "no_new_data" | "general";
    message: string;
    minutesAgo?: number;
  } | null>(null);


  // Listen to recommendations
  useEffect(() => {
    if (!ws.workspaceId) return;
    return onSnapshot(
      query(collection(db, `workspaces/${ws.workspaceId}/recommendations`), orderBy("createdAt", "desc"), limit(20)),
      (s) => setRecs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Recommendation) })))
    );
  }, [ws.workspaceId]);

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

  // One source of truth for data health: the same deterministic rules the assistant uses (shared/dataHealth.ts)
  const health = useMemo<TelemetryHealth>(() => {
    const h = computeDataHealth({ sales, promotions, leads, costs, posts }, Date.now());
    return {
      freshnessDays: h.freshnessDays, isStale: h.isStale, minDate: h.oldestDate, maxDate: h.newestDate,
      sources: h.sources, currencies: h.currencies,
      missingFieldsCount: h.salesWithoutAttribution + h.promotionsWithoutObjective + h.leadsWithoutSource,
      salesWithoutAttribution: h.salesWithoutAttribution, promosWithoutObjective: h.promotionsWithoutObjective, leadsWithoutSource: h.leadsWithoutSource,
      evidenceLevel: h.evidenceLevel, nextLevelUnlock: h.nextLevelUnlock,
    };
  }, [sales, costs, leads, promotions, posts]);

  // Connected platforms (for the logos)
  const [connected, setConnected] = useState<string[]>([]);
  useEffect(() => {
    if (!ws.workspaceId) return;
    return onSnapshot(collection(db, `workspaces/${ws.workspaceId}/connections`), (s) =>
      setConnected(s.docs.filter((d) => d.data().status === "connected").map((d) => String(d.data().provider))), () => undefined);
  }, [ws.workspaceId]);

  // What changed: the last 7 days against the 7 before, same currency only. Plain sums of real records.
  const week = useMemo(() => {
    const today = Date.now();
    const dayIdx = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : Math.floor((today - t) / 86400000); };
    const inWin = (i: number | null, w: 0 | 1) => i !== null && i >= w * 7 && i < w * 7 + 7;
    let skipped = 0;
    const sum = (rows: any[], dateKey: string, valKey: string | null): Delta => {
      const d: Delta = { now: 0, before: 0 };
      for (const r of rows) {
        const i = dayIdx(r[dateKey]);
        const w = inWin(i, 0) ? 0 : inWin(i, 1) ? 1 : -1;
        if (w < 0) continue;
        if (valKey && r.currency && r.currency !== ws.currency) { skipped++; continue; }
        const v = valKey ? Number(r[valKey]) || 0 : 1;
        if (w === 0) d.now += v; else d.before += v;
      }
      return d;
    };
    return {
      revenue: sum(sales, "date", "amount"), spend: sum(promotions, "startDate", "spend"),
      orders: sum(sales, "date", null), enquiries: sum(leads, "date", null), skipped,
    };
  }, [sales, promotions, leads, ws.currency]);

  const latest = recs[0] as (Recommendation & { id: string }) | undefined;
  const engineLevel = latest?.mode ? ((latest.mode[0].toUpperCase() + latest.mode.slice(1)) as Level) : null;
  const gates = latest?.evidence_quality?.gates ?? [];
  const failing = gates.find((g) => !g.passed);
  const unlock = engineLevel && failing ? `Get "${failing.label}" from ${failing.actual} to ${failing.required}.` : health.nextLevelUnlock;
  const provenance = useMemo(() => {
    const c: Record<string, number> = {};
    for (const set of [sales, promotions, leads, costs, posts]) for (const r of set) { const k = r.provenance || "manual"; c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [sales, promotions, leads, costs, posts]);
  const platforms = useMemo(() => {
    const set = new Set<string>(connected);
    for (const r of [...posts, ...promotions]) if (r.platform) set.add(String(r.platform));
    return [...set].filter((p) => ["shopify", "meta", "googleads", "woocommerce", "instagram"].includes(p.toLowerCase()));
  }, [connected, posts, promotions]);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", paddingBottom: 60 }}>
      <UnderstandHero busy={busy} onGenerate={() => triggerGenerate(false)} onAsk={onOpenChat} />

      {error && (
        <div role="alert" className="error" style={{ padding: "12px 18px", background: "var(--danger-bg)", borderRadius: 10, border: "1px solid rgba(239, 68, 68, 0.3)", marginBottom: 20, fontSize: 13.5 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, marginBottom: 20 }}>
        <EvidenceCard level={engineLevel ?? health.evidenceLevel} fromEngine={Boolean(engineLevel)} gates={gates} unlock={unlock} onAdd={() => onNavigate("/add")} />
        <FreshnessCard days={health.freshnessDays} min={health.minDate} max={health.maxDate} stale={health.isStale} onAdd={() => onNavigate("/add")} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <SourcesCard provenance={provenance} platforms={platforms} currencies={health.currencies.length ? health.currencies : [ws.currency]} gaps={health.missingFieldsCount} onFix={() => onNavigate("/data/sales")} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <WeekCard currency={ws.currency} revenue={week.revenue} spend={week.spend} orders={week.orders} enquiries={week.enquiries} skipped={week.skipped} onDigest={() => onNavigate("/reports")} />
      </div>

      {/* Recommendations: the former Recommendations tab, now part of Understand */}
      <RecommendationsPanel embedded onNavigate={(t) => onNavigate(t)} onReportIssue={onReportIssue} />

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

