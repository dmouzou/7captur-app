import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import type { DecisionContent, CustomerResponse, ExecutionState } from "../../shared/decision";
import { CUSTOMER_RESPONSES, EXECUTION_STATES, FOLLOW_THROUGH, OUTCOME_LABELS } from "../../shared/decision";
import { checkDecisionSufficiency, computeTrackRecord, type ReviewRecords } from "../../shared/sufficiency";
import { localToday } from "../../shared/periods";
import { PLANS } from "../../shared/plans";
import { FollowUps } from "./FollowUps";

type Decision = DecisionContent & {
  id: string;
  recommendationId: string;
  response: CustomerResponse | "pending";
  executionState: ExecutionState;
  suggestedOutcome?: string | null;
  outcome: { followThrough: string; outcome: string; suggestedOutcome?: string | null; note: string | null } | null;
};
type RecStub = { id: string; action: string; mode: string; status: string };

const LABEL: Record<string, string> = {
  accepted: "Accept", modified: "Accept with changes", rejected: "Reject", deferred: "Decide later", not_acted: "Did not act",
  not_started: "Not started", in_progress: "In progress", done: "Done", abandoned: "Stopped",
  followed_fully: "Followed fully", followed_partly: "Followed partly", chose_other: "Chose another approach", did_not_act: "Did not act",
  better: "Better than expected", as_expected: "As expected", worse: "Worse than expected", too_early: "Too early to say", insufficient_info: "Not enough information",
};
const QUEUE_TITLE = { act: "Act", investigate: "Investigate", monitor: "Monitor" } as const;
const QUEUE_HINT = {
  act: "Enough evidence to take the step.",
  investigate: "Close the gap in the evidence first.",
  monitor: "Hold steady and watch the numbers.",
} as const;
const QUALITY_BADGE = { sufficient: "badge badge-primary", partial: "badge badge-warning", insufficient: "badge" } as const;

export function DecisionCenter() {
  const ws = useWorkspace();
  const plan = PLANS[ws.plan] ?? PLANS.starter;
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [recs, setRecs] = useState<RecStub[]>([]);
  const [records, setRecords] = useState<ReviewRecords>({ posts: [], promotions: [], leads: [], sales: [], costs: [] });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const today = useMemo(() => localToday(new Date(), ws.timezone), [ws.timezone]);

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/decisions`), orderBy("createdAt", "desc"), limit(50)),
    (s) => setDecisions(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Decision, "id">) }))),
  ), [ws.workspaceId]);

  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${ws.workspaceId}/recommendations`), orderBy("createdAt", "desc"), limit(20)),
    (s) => setRecs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RecStub, "id">) }))),
  ), [ws.workspaceId]);

  // Load records to evaluate sufficiency
  useEffect(() => {
    if (!ws.workspaceId || !ws.businessId) return;
    const bid = ws.businessId;
    const unsubPosts = onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/posts`), where("businessId", "==", bid), limit(200)), (s) => {
      setRecords((r) => ({ ...r, posts: s.docs.map((d) => d.data() as any) }));
    });
    const unsubPromos = onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/promotions`), where("businessId", "==", bid), limit(200)), (s) => {
      setRecords((r) => ({ ...r, promotions: s.docs.map((d) => d.data() as any) }));
    });
    const unsubLeads = onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/leads`), where("businessId", "==", bid), limit(200)), (s) => {
      setRecords((r) => ({ ...r, leads: s.docs.map((d) => d.data() as any) }));
    });
    const unsubSales = onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/sales`), where("businessId", "==", bid), limit(200)), (s) => {
      setRecords((r) => ({ ...r, sales: s.docs.map((d) => d.data() as any) }));
    });
    const unsubCosts = onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/costs`), where("businessId", "==", bid), limit(100)), (s) => {
      setRecords((r) => ({ ...r, costs: s.docs.map((d) => d.data() as any) }));
    });
    return () => { unsubPosts(); unsubPromos(); unsubLeads(); unsubSales(); unsubCosts(); };
  }, [ws.workspaceId, ws.businessId]);

  const pending = useMemo(() => {
    const have = new Set(decisions.map((d) => d.recommendationId));
    return recs.filter((r) => !have.has(r.id) && r.status !== "failed" && r.status !== "dismissed");
  }, [decisions, recs]);

  const groups = useMemo(() => {
    const by = { act: [] as Decision[], investigate: [] as Decision[], monitor: [] as Decision[] };
    for (const d of decisions) by[d.queueStatus].push(d);
    for (const k of Object.keys(by) as (keyof typeof by)[]) by[k].sort((a, b) => b.priority.score - a.priority.score);
    return by;
  }, [decisions]);

  const trackRecord = useMemo(() => {
    return computeTrackRecord(decisions, plan?.historyDays ?? 30, today);
  }, [decisions, plan?.historyDays, today]);

  async function call(name: string, payload: object, key: string) {
    setError(""); setBusy(key);
    try { await httpsCallable(functions, name)({ workspaceId: ws.workspaceId, ...payload }); }
    catch { setError("That did not save. Check your connection and try again."); }
    finally { setBusy(""); }
  }

  return (
    <section>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div>
            <h1 style={{ marginBottom: 6 }}>Decision Center</h1>
            <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
              Each decision compares your options, states what is unknown and sets a review date. Nothing here changes an ad account.
              You decide, and you do the work yourself. 7Captur records and reviews outcomes.
            </p>
          </div>
          <div style={{ padding: "8px 14px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)", fontSize: 13 }}>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>Track Record ({plan?.historyDays ?? 30}d):</span>{" "}
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>{trackRecord}</span>
          </div>
        </div>
      </div>

      {error && <p className="card error">{error}</p>}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Ready to turn into decisions</h3>
          <p className="muted" style={{ marginBottom: 12 }}>This uses no extra recommendation credit.</p>
          {pending.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 240px", color: "var(--ink)" }}>{r.action}</span>
              <button type="button" disabled={busy === r.id} onClick={() => call("createDecision", { recommendationId: r.id }, r.id)}>
                {busy === r.id ? "Working" : "Create decision"}
              </button>
            </div>
          ))}
        </div>
      )}

      {decisions.length === 0 && pending.length === 0 && (
        <div className="card"><p className="muted">No decisions yet. Generate a recommendation first, then it appears here.</p></div>
      )}

      {(["act", "investigate", "monitor"] as const).map((k) => groups[k].length > 0 && (
        <div key={k} style={{ marginBottom: 24 }}>
          <h2 style={{ marginBottom: 2 }}>{QUEUE_TITLE[k]} <span className="muted">({groups[k].length})</span></h2>
          <p className="muted" style={{ marginBottom: 12 }}>{QUEUE_HINT[k]}</p>
          <div style={{ display: "grid", gap: 14 }}>
            {groups[k].map((d) => (
              <DecisionCard
                key={d.id}
                d={d}
                records={records}
                today={today}
                currency={ws.currency}
                busy={busy}
                call={call}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function DecisionCard({
  d,
  records,
  today,
  currency,
  busy,
  call,
}: {
  d: Decision;
  records: ReviewRecords;
  today: string;
  currency: string;
  busy: string;
  call: (n: string, p: object, k: string) => Promise<void>;
}) {
  const [follow, setFollow] = useState("followed_fully");
  const [note, setNote] = useState("");
  const base = { decisionId: d.id };
  const accepted = d.response === "accepted" || d.response === "modified";

  const sufficiency = useMemo(() => {
    return checkDecisionSufficiency(
      {
        id: d.id,
        decision: d.decision,
        headline: d.headline,
        reviewOn: d.reviewOn,
        evidenceUsed: d.evidenceUsed,
        expectedOutcome: d.expectedOutcome,
        outcome: d.outcome,
      },
      today,
      records,
      currency
    );
  }, [d, today, records, currency]);

  // Pre-select suggested outcome when ready
  const defaultOutcome = sufficiency.status === "ready" ? sufficiency.suggestedOutcome : "as_expected";
  const [outcome, setOutcome] = useState(defaultOutcome);

  useEffect(() => {
    if (sufficiency.status === "ready") {
      setOutcome(sufficiency.suggestedOutcome);
    }
  }, [sufficiency]);

  return (
    <article className="card">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span className={QUALITY_BADGE[d.evidenceQuality]}>Evidence: {d.evidenceQuality}</span>
        <span className="badge">Review by {d.reviewOn}</span>
        {d.response !== "pending" && <span className="badge badge-primary">{LABEL[d.response]}</span>}
      </div>
      <h3 style={{ marginBottom: 8 }}>{d.headline}</h3>
      <p><strong style={{ color: "var(--ink)" }}>Next step:</strong> {d.nextStep}</p>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}>Why, options and limits</summary>
        <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
          <div>
            <h4>Why this option</h4>
            <ul style={{ paddingLeft: 18 }}>{d.whyThisOption.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
          <div>
            <h4>Options compared</h4>
            <div style={{ display: "grid", gap: 10 }}>
              {d.alternatives.map((a) => (
                <div key={a.id} style={{ border: `1px solid ${a.favoured ? "var(--accent-line)" : "var(--line)"}`, background: a.favoured ? "var(--accent-soft)" : "transparent", borderRadius: 10, padding: "10px 14px" }}>
                  <strong style={{ color: "var(--ink)" }}>{a.label}{a.favoured ? " (suggested)" : ""}</strong>
                  <p className="muted" style={{ marginTop: 2 }}>{a.summary}</p>
                  <p className="muted">{a.expectedBenefit ? `Upside: ${a.expectedBenefit} ` : ""}{a.downside ? `Downside: ${a.downside} ` : ""}{a.reversible ? "Reversible." : "Hard to reverse."}</p>
                  {a.whyNot && <p className="muted">Not now: {a.whyNot}</p>}
                </div>
              ))}
            </div>
          </div>
          <div><h4>What we assume</h4><ul style={{ paddingLeft: 18 }}>{d.assumptions.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
          {d.limitations.length > 0 && <div><h4>Known gaps</h4><ul style={{ paddingLeft: 18 }}>{d.limitations.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          <div>
            <h4>Guardrails</h4>
            <p>Watch: {d.guardrails.watch}</p>
            <p>Stop or reassess if: {d.guardrails.stopIf}</p>
          </div>
          <div>
            <h4>What could change the answer</h4>
            <p>{d.sensitivity.mostLikelyToChange}</p>
            <p className="muted">Cost of waiting: {d.costOfDelay}</p>
          </div>
          <div>
            <h4>Expected outcome</h4>
            <p>{d.expectedOutcome.text}</p>
          </div>
          <p className="muted">
            Evidence window {d.evidenceUsed.windowStart} to {d.evidenceUsed.windowEnd}. Saved as it was known on {d.evidenceUsed.asOf}; it does not change when new data arrives.
          </p>
        </div>
      </details>

      <FollowUps decisionId={d.id} />

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {CUSTOMER_RESPONSES.map((r) => (
          <button key={r} type="button" className={d.response === r ? "" : "btn-secondary"} disabled={busy === `${d.id}:${r}`}
            onClick={() => call("recordDecisionUpdate", { ...base, type: "response", response: r }, `${d.id}:${r}`)}>
            {LABEL[r]}
          </button>
        ))}
      </div>

      {accepted && (
        <div style={{ marginTop: 14 }}>
          <label htmlFor={`ex-${d.id}`}>Your progress (you do the work, 7Captur changes nothing)</label>
          <select id={`ex-${d.id}`} value={d.executionState}
            onChange={(e) => call("recordDecisionUpdate", { ...base, type: "execution", executionState: e.target.value }, `${d.id}:ex`)}>
            {EXECUTION_STATES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select>
        </div>
      )}

      {/* Review Section: Never prompt on a decision that is not ready */}
      {d.response !== "pending" && !d.outcome && (
        <div style={{ marginTop: 16 }}>
          {sufficiency.status === "too_early" && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span className="badge" style={{ fontSize: 11 }}>Too early for outcome review</span>
                <span className="muted" style={{ fontSize: 12 }}>Review scheduled for {sufficiency.readyOn}</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{sufficiency.reason}</p>
            </div>
          )}

          {sufficiency.status === "not_enough_data" && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span className="badge badge-warning" style={{ fontSize: 11 }}>Not enough data for review</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{sufficiency.whatToAdd}</p>
            </div>
          )}

          {sufficiency.status === "ready" && (
            <details open style={{ padding: "14px 16px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--accent-line)" }}>
              <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}>
                Ready to review outcome · Suggested: {LABEL[sufficiency.suggestedOutcome]}
              </summary>
              <div style={{ margin: "10px 0 12px", fontSize: 13, color: "var(--ink)" }}>
                {sufficiency.prompt}
              </div>
              <label htmlFor={`ft-${d.id}`}>What did you do?</label>
              <select id={`ft-${d.id}`} value={follow} onChange={(e) => setFollow(e.target.value)}>
                {FOLLOW_THROUGH.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
              </select>
              <label htmlFor={`oc-${d.id}`}>How did it go? (pre-selected based on recorded data)</label>
              <select id={`oc-${d.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as "better" | "as_expected" | "worse")}>
                {OUTCOME_LABELS.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
              </select>
              <label htmlFor={`nt-${d.id}`}>Anything else (optional)</label>
              <textarea id={`nt-${d.id}`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} rows={2} />
              <p className="muted" style={{ margin: "8px 0" }}>Records and reviews outcomes. It is not proof that the decision caused the result.</p>
              <button type="button" disabled={busy === `${d.id}:oc`}
                onClick={() => call("recordDecisionUpdate", { ...base, type: "outcome", followThrough: follow, outcome, suggestedOutcome: sufficiency.suggestedOutcome, note: note || undefined }, `${d.id}:oc`)}>
                Save outcome
              </button>
            </details>
          )}
        </div>
      )}

      {d.outcome && (
        <p className="muted" style={{ marginTop: 14 }}>
          You reported: {LABEL[d.outcome.followThrough]}, {LABEL[d.outcome.outcome].toLowerCase()}.{" "}
          {d.outcome.suggestedOutcome ? `(Engine suggested: ${LABEL[d.outcome.suggestedOutcome]}). ` : ""}
          Customer reported, not verified.
        </p>
      )}
    </article>
  );
}
