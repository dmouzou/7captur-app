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
      <div className="card">
        <h2>Recommendations</h2>
        <p className="muted">This week: {used} of {plan.recommendations.weekly} used. Unused recommendations do not carry over.</p>
        <button type="button" onClick={generate} disabled={busy}>{busy ? "Working…" : "Get a recommendation"}</button>
        <div role="alert" className="error">{error}</div>
      </div>
      {recs.map((r) => (
        <article key={r.id} className="card" style={{ marginTop: 16 }}
          onMouseEnter={() => { if (r.status === "generated" && !seen.has(r.id)) { seen.add(r.id); act(r.id, "viewed"); } }}>
          <p className="muted mono">{EVIDENCE_LABEL[r.mode]} · {r.status.replace(/_/g, " ")}</p>
          {r.aiSummary && (<>
            <p>{r.aiSummary.text}</p>
            <p className="muted">Summary written by AI from the facts below. The facts and numbers come from your data.</p>
          </>)}
          <h3 style={{ marginTop: 0 }}>Your next move</h3>
          <p>{r.action}</p>
          <h4>Why</h4>
          {r.rationale.map((t, i) => <p key={i}>{t}</p>)}
          <h4>What we don't know</h4>
          <ul>{r.unknowns.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <h4>Risk</h4><p>{r.risk}</p>
          <h4>Do not act if</h4><p>{r.doNotActIf}</p>
          <h4>What to measure next</h4><p>{r.nextMeasurement}</p>
          {r.evidence.warnings.map((w, i) => <p key={i} className="error">{w}</p>)}
          <details>
            <summary className="muted">Evidence and calculation</summary>
            <p className="muted mono">Window {r.evidence.windowStart} to {r.evidence.windowEnd} · {r.engineVersion}</p>
            <p className="muted mono">Records used: {JSON.stringify(r.evidence.sampleSize)} · Sources: {JSON.stringify(r.evidence.provenance)}</p>
            {r.calculation && <p className="muted mono">{r.calculation.formulaVersion}: revenue {r.calculation.revenue} − costs {r.calculation.costs} ÷ spend {r.calculation.spend} = {r.calculation.adjustedReturn?.toFixed(2)} ({r.calculation.currency}, business-level)</p>}
          </details>
          <p className="muted">You decide. Nothing here changes your ads or posts.</p>
          {["generated", "viewed", "deferred"].includes(r.status) && (<>
            <button type="button" onClick={() => act(r.id, "marked_to_try")}>I'll try this</button>{" "}
            <button type="button" onClick={() => act(r.id, "deferred")} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Later</button>{" "}
            <button type="button" onClick={() => act(r.id, "dismissed")} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Dismiss</button>
          </>)}
          {r.status === "marked_to_try" && <button type="button" onClick={() => act(r.id, "completed")}>I did this</button>}
        </article>
      ))}
      {recs.length === 0 && <p className="muted">No recommendations yet. Enter a few posts or enquiries first, or ask for one now to see what to record.</p>}
    </section>
  );
}
