import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import { FOLLOWUP_DISCLAIMER, type FollowUp } from "../../shared/followup";

/** AI follow-up questions on one saved decision. Uses AI credits, never recommendation credits. */
export function FollowUps({ decisionId }: { decisionId: string }) {
  const ws = useWorkspace();
  const caps = (PLANS[ws.plan] ?? PLANS.starter).aiFollowUps;
  const [items, setItems] = useState<FollowUp[]>([]);
  const [usedMonth, setUsedMonth] = useState(0);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const monthId = periodIds(new Date(), ws.accountTimezone).monthId;

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/decisions/${decisionId}/followups`), orderBy("createdAt", "asc")),
    (s) => setItems(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FollowUp, "id">) }))),
    () => setItems([]),
  ), [ws.workspaceId, decisionId]);

  useEffect(() => onSnapshot(
    doc(db, `accounts/${ws.ownerUid}/usage/${monthId}`),
    (s) => setUsedMonth(Number(s.data()?.aiFollowUps ?? 0)),
    () => setUsedMonth(0),
  ), [ws.ownerUid, monthId]);

  const usedHere = items.filter((i) => i.source === "ai").length;
  const leftDecision = Math.max(0, caps.perDecision - usedHere);
  const leftMonth = Math.max(0, caps.monthly - usedMonth);
  const blocked = leftDecision === 0 || leftMonth === 0;

  async function ask() {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setBusy(true); setError("");
    try {
      const requestId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      await httpsCallable(functions, "askAboutDecision")({ workspaceId: ws.workspaceId, decisionId, requestId, question: q });
      setQuestion("");
    } catch (e) {
      const msg = (e as { message?: string }).message;
      setError(msg && /follow-up|credits/i.test(msg) ? msg : "That question did not go through. Try again in a moment.");
    } finally { setBusy(false); }
  }

  return (
    <details style={{ marginTop: 14 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>
        Ask a follow-up question {items.length > 0 ? `(${items.length})` : ""}
      </summary>
      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{FOLLOWUP_DISCLAIMER}</p>
        {items.map((i) => (
          <div key={i.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px" }}>
            <strong style={{ color: "var(--ink)" }}>{i.question}</strong>
            <p style={{ margin: "6px 0 0" }}>{i.answer}</p>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
              {i.source === "ai" ? "AI answer. It can make mistakes." : "Answered from the saved decision, without AI. No credit used."}
            </p>
          </div>
        ))}
        <div>
          <label htmlFor={`fu-${decisionId}`}>Your question</label>
          <textarea id={`fu-${decisionId}`} rows={2} maxLength={500} value={question} disabled={blocked || busy}
            placeholder="For example: why not cut the weakest promotion instead?" onChange={(e) => setQuestion(e.target.value)} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            <button type="button" disabled={blocked || busy || question.trim().length < 3} onClick={ask}>{busy ? "Thinking" : "Ask"}</button>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {leftDecision} of {caps.perDecision} left for this decision. {leftMonth} of {caps.monthly} AI credits left this month.
              Follow-ups never use recommendation credits.
            </span>
          </div>
          {blocked && <p className="muted" style={{ marginTop: 6 }}>{leftDecision === 0 ? "You have used every follow-up for this decision." : "Your AI credits reset next month."}</p>}
          {error && <p className="error" style={{ marginTop: 6 }}>{error}</p>}
        </div>
      </div>
    </details>
  );
}
