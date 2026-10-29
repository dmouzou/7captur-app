import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS, proPlanForSpend, type PlanId } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import { billingConfigured, loadPaddle, openCheckout, priceIds } from "./paddle";

const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "");
const price = (id: PlanId) => { const p = PLANS[id]; return p.priceMonthly !== undefined ? `$${p.priceMonthly}/month` : `from $${p.priceMonthlyFrom}/month`; };
const subscribed = (s: string) => s === "active" || s === "canceling" || s === "past_due";

export function BillingPanel() {
  const { user } = useAuth();
  const ws = useWorkspace();
  const isOwner = ws.ownerUid === user?.uid;
  const plan = PLANS[ws.plan];
  const [spend, setSpend] = useState("");
  const [usage, setUsage] = useState({ week: 0, imports: 0 });
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const ids = periodIds(new Date(), ws.timezone);
    const u1 = onSnapshot(doc(db, `workspaces/${ws.workspaceId}/usage/${ids.weekId}`), (s) => setUsage((u) => ({ ...u, week: s.data()?.recommendations ?? 0 })));
    const u2 = onSnapshot(doc(db, `workspaces/${ws.workspaceId}/usage/${ids.monthId}`), (s) => setUsage((u) => ({ ...u, imports: s.data()?.imports ?? 0 })));
    return () => { u1(); u2(); };
  }, [ws.workspaceId, ws.timezone]);
  useEffect(() => { if (waiting && ws.hasSubscription) setWaiting(false); }, [waiting, ws.hasSubscription]);

  const spendNum = Number(spend);
  const band = spend !== "" && Number.isFinite(spendNum) && spendNum >= 0 ? proPlanForSpend(spendNum) : null;
  const proId: PlanId = band && band !== "custom" ? band : "pro_growth";
  const choices: PlanId[] = ["starter", "growth", proId];

  async function subscribe(id: PlanId) {
    setError(""); setNote("");
    try {
      await loadPaddle(() => { setWaiting(true); setNote("Payment received. Waiting for confirmation, this usually takes a few seconds."); });
      openCheckout(priceIds[id], user?.email ?? null, ws.workspaceId);
    } catch { setError("Could not open checkout. Try again shortly."); }
  }
  async function change(id: PlanId | "free") {
    const msg = id === "free" ? "Cancel at the end of your current billing period? You keep your plan until then." : `Switch to ${PLANS[id].name}? Upgrades are charged pro rata now. Downgrades start billing the new price from your next billing date, and your allowance changes right away.`;
    if (!window.confirm(msg)) return;
    setError(""); setNote(""); setBusy(id);
    try { await httpsCallable(functions, "changeSubscriptionPlan")({ workspaceId: ws.workspaceId, targetPlan: id }); setNote("Request sent. Your plan updates as soon as the payment provider confirms."); }
    catch (e) { setError((e as { message?: string }).message ?? "Could not change your plan."); }
    finally { setBusy(""); }
  }
  async function saveSpend() {
    if (spend === "" || !Number.isFinite(spendNum) || spendNum < 0) { setError("Enter a spend of 0 or more."); return; }
    setError(""); setNote(""); setBusy("spend");
    try {
      const r = await httpsCallable<unknown, { decision: string; to: string | null }>(functions, "setReportedSpend")({ workspaceId: ws.workspaceId, monthlySpendUsd: spendNum });
      setNote(r.data.decision === "schedule" ? "Saved. Your Pro price band will change from your next billing date. We sent you a notice." : r.data.decision === "suggest_custom" ? "Saved. At this spend, Custom is a better fit. Contact us." : "Saved.");
    } catch (e) { setError((e as { message?: string }).message ?? "Could not save."); }
    finally { setBusy(""); }
  }
  async function portal() {
    setError(""); setBusy("portal");
    try { const r = await httpsCallable<unknown, { url: string }>(functions, "createBillingPortalSession")({ workspaceId: ws.workspaceId }); window.open(r.data.url, "_blank", "noopener"); }
    catch { setError("Could not open the billing page."); }
    finally { setBusy(""); }
  }

  const status = ws.billingStatus;
  return (
    <section>
      <div className="card">
        <h2>Billing</h2>
        <p><strong>{plan.name}</strong> · {ws.plan === "free" ? "$0" : price(ws.plan)}</p>
        {status === "past_due" && <p className="error" role="alert">Your last payment failed. Update your payment method{ws.restrictAtMs ? ` by ${fmtDate(ws.restrictAtMs)}` : ""} to keep your plan. Nothing is deleted if it lapses.</p>}
        {ws.pendingBand && <p role="status">Your price band changes to {PLANS[ws.pendingBand.to].name} ({price(ws.pendingBand.to)}) on {fmtDate(ws.pendingBand.effectiveMs)}. Nothing changes before then.</p>}
        {status === "canceling" && <p role="status">Your subscription ends on {fmtDate(ws.restrictAtMs)}. You keep your plan until then, then move to Free. Your data stays.</p>}
        {(status === "restricted" || status === "canceled" || status === "paused") && <p role="status">You are on the Free plan. Your history and records are kept.</p>}
        <p className="muted">This week: {usage.week} of {plan.recommendations.weekly} recommendations · This month: {usage.imports} of {plan.importsPerMonth} imports · Direct connections: up to {plan.maxConnections}</p>
        <p className="muted">Allowances reset every Monday in {ws.timezone}. Same recommendation engine on every plan; plans differ in capacity and history.</p>
        {ws.hasSubscription && isOwner && <button type="button" disabled={!!busy} onClick={portal}>Manage payment method, invoices and cancellation</button>}
        <div role="alert" className="error">{error}</div>
        <div role="status" className="muted">{note}</div>
      </div>

      {!isOwner && <p className="muted">Only the workspace owner can change the plan.</p>}
      {isOwner && !billingConfigured && <p className="muted">Paid plans are not available yet.</p>}
      {isOwner && billingConfigured && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Plans</h3>
          <label htmlFor="spend">Monthly ad spend (USD), as you report it. Only used to suggest a Pro price band.</label>
          <input id="spend" type="number" min={0} inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="Leave empty if you do not run paid ads" />
          {ws.plan.startsWith("pro_") && <button type="button" disabled={!!busy} onClick={saveSpend}>Save reported spend</button>}
          {band === "custom" && <p className="muted">At $50,000 a month or more, Custom fits better. <a href="https://7captur.com/contact/" target="_blank" rel="noopener noreferrer">Contact us</a>.</p>}
          <p className="muted">Pro bands: under $15,000 is $59, $15,000 to $30,000 is $79, $30,000 to $50,000 is $119. Band changes apply from your next billing date, with notice first.</p>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {choices.map((id) => (
              <li key={id} style={{ margin: "12px 0", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span><strong>{PLANS[id].name}</strong> · {price(id)}<br /><span className="muted">{PLANS[id].recommendations.weekly} recommendations/week · {PLANS[id].importsPerMonth} imports/month · up to {PLANS[id].maxConnections} connection(s)</span></span>
                {ws.plan === id ? <span className="muted">Current plan</span>
                  : !priceIds[id] ? <span className="muted">Not available yet</span>
                  : subscribed(status) && ws.hasSubscription ? <button type="button" style={{ margin: 0 }} disabled={!!busy || status === "past_due"} onClick={() => change(id)}>Switch</button>
                  : <button type="button" style={{ margin: 0 }} disabled={waiting} onClick={() => subscribe(id)}>Subscribe</button>}
              </li>
            ))}
            <li className="muted">Custom: from $199/month for tailored inputs, volume and support. <a href="https://7captur.com/contact/" target="_blank" rel="noopener noreferrer">Contact us</a>.</li>
          </ul>
          {subscribed(status) && status !== "canceling" && <button type="button" className="link" disabled={!!busy} onClick={() => change("free")}>Cancel at the end of the billing period</button>}
        </div>
      )}
    </section>
  );
}
