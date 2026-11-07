import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS, type PlanId } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import { getPriceId, loadPaddle, openCheckout } from "./paddle";
import { BillingArt } from "../../components/art";

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function Meter({ label, used, limit, note }: { label: string; used: number; limit: number; note?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const hot = pct >= 90;
  return (
    <div style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5 }}>
        <span style={{ color: "var(--ink)" }}>{label}</span>
        <span className="muted">{used} of {limit}</span>
      </div>
      <div role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} aria-label={label} style={{ height: 8, borderRadius: 99, background: "var(--border)", margin: "10px 0 6px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: hot ? "#e0a100" : "var(--accent-fill)" }} />
      </div>
      {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
    </div>
  );
}

function featureList(id: PlanId): { text: string; on: boolean }[] {
  const p = PLANS[id];
  if (id === "custom") {
    return [
      { text: "Platform and workspace limits set for you", on: true },
      { text: "Recommendation, import and AI volume set for you", on: true },
      { text: "Longer history", on: true },
      { text: "Monthly strategy call", on: true },
      { text: "Dedicated priority support", on: true },
    ];
  }
  return [
    { text: `${p.maxConnections} connected platforms${p.maxBusinesses > 1 ? " per workspace" : ""}`, on: true },
    { text: `${p.maxBusinesses} business workspace${p.maxBusinesses === 1 ? "" : "s"}`, on: true },
    { text: `${p.recommendations.weekly} recommendations a week${p.maxBusinesses > 1 ? ", shared" : ""}`, on: true },
    { text: `${p.importsPerMonth} imports a month`, on: true },
    { text: `${p.aiFollowUps.monthly} AI follow-up questions a month`, on: true },
    { text: `${p.historyDays} days of history`, on: true },
    { text: "Weekly summary and smart reviews", on: p.weeklySummary },
    { text: "Priority support", on: p.prioritySupport },
  ];
}

const subscribed = (s: string) => s === "active" || s === "canceling" || s === "past_due";

export function BillingPanel() {
  const { user } = useAuth();
  const ws = useWorkspace();
  const isOwner = ws.ownerUid === user?.uid;
  const plan = PLANS[ws.plan] ?? PLANS.starter;
  const [cycle, setCycle] = useState<"annual" | "monthly">("annual");
  const [usage, setUsage] = useState({ week: 0, imports: 0, ai: 0 });
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const ids = periodIds(new Date(), ws.accountTimezone);
    const u1 = onSnapshot(doc(db, `accounts/${ws.ownerUid}/usage/${ids.weekId}`), (s) =>
      setUsage((u) => ({ ...u, week: s.data()?.recommendations ?? 0 })), () => undefined
    );
    const u2 = onSnapshot(doc(db, `accounts/${ws.ownerUid}/usage/${ids.monthId}`), (s) =>
      setUsage((u) => ({ ...u, imports: s.data()?.imports ?? 0, ai: s.data()?.aiFollowUps ?? 0 })), () => undefined
    );
    return () => {
      u1();
      u2();
    };
  }, [ws.ownerUid, ws.accountTimezone]);

  useEffect(() => {
    if (waiting && ws.hasSubscription) setWaiting(false);
  }, [waiting, ws.hasSubscription]);

  const daysLeft = ws.daysLeft;

  async function subscribe(id: PlanId) {
    setError("");
    setNote("");
    const priceId = getPriceId(id, cycle);
    if (!priceId) {
      setError("This plan option is not available yet.");
      return;
    }
    try {
      await loadPaddle(() => {
        setWaiting(true);
        setNote("Payment received. Waiting for confirmation, this usually takes a few seconds.");
      });
      openCheckout(priceId, user?.email ?? null, ws.workspaceId);
    } catch {
      setError("Could not open checkout. Try again shortly.");
    }
  }

  async function change(id: PlanId | "cancel") {
    const msg =
      id === "cancel"
        ? "Cancel at the end of your current billing period? You keep your plan until then."
        : `Switch to ${PLANS[id].name}? Upgrades are charged pro rata now. Downgrades start billing the new price from your next billing date, and your allowance changes right away.`;
    if (!window.confirm(msg)) return;
    setError("");
    setNote("");
    setBusy(id);
    try {
      await httpsCallable(functions, "changeSubscriptionPlan")({
        workspaceId: ws.workspaceId,
        targetPlan: id,
      });
      setNote("Request sent. Your plan updates as soon as the payment provider confirms.");
    } catch (e) {
      setError((e as { message?: string }).message ?? "Could not change your plan.");
    } finally {
      setBusy("");
    }
  }

  async function portal() {
    setError("");
    setBusy("portal");
    try {
      const r = await httpsCallable<unknown, { url: string }>(functions, "createBillingPortalSession")({
        workspaceId: ws.workspaceId,
      });
      window.open(r.data.url, "_blank", "noopener");
    } catch {
      setError("Could not open the billing page.");
    } finally {
      setBusy("");
    }
  }

  const status = ws.billingStatus;

  const hasSub = ws.hasSubscription;
  const priceLine = ws.isTrialing
    ? `Free trial, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left. You have full Starter access`
    : plan.priceMonthly !== undefined ? `${money(plan.priceMonthly)} a month` : "Custom";

  const PlanCard = ({ id }: { id: PlanId }) => {
    const p = PLANS[id];
    const isCurrent = ws.plan === id && (hasSub || ws.billingStatus === "active");
    const featured = id === "growth";
    const price = cycle === "annual" ? p.priceAnnualMonthly : p.priceMonthly;
    return (
      <div className="card" style={{ margin: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", border: featured ? "1px solid var(--accent-line)" : undefined, background: featured ? "linear-gradient(180deg, var(--accent-soft), var(--surface) 40%)" : undefined }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h4 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 500 }}>{p.name}</h4>
            {isCurrent ? (
              <span className="badge badge-primary">Your plan</span>
            ) : (
              featured && <span className="badge badge-primary">Most popular</span>
            )}
          </div>
          {id === "custom" ? (
            <>
              <div style={{ fontSize: "1.7rem", fontWeight: 500 }}>On request</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Capacity and terms built around you</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: "1.7rem", fontWeight: 500 }}>
                {money(price ?? 0)}<span className="muted" style={{ fontSize: "0.9rem" }}> a month</span>
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {cycle === "annual" ? `${money(p.priceAnnual ?? 0)} billed once a year` : "Billed monthly"}
              </div>
            </>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: "16px 0", fontSize: 14, lineHeight: 1.9 }}>
            {featureList(id).map((f) => (
              <li key={f.text} className={f.on ? "" : "muted"} style={{ display: "flex", gap: 8 }}>
                <span aria-hidden style={{ color: f.on ? "var(--accent)" : "var(--muted)", width: 14 }}>{f.on ? "✓" : "–"}</span>
                <span>{f.on ? "" : "No "}{f.on ? f.text : f.text.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {id === "custom" ? (
            <a href="https://7captur.com/contact/" target="_blank" rel="noopener noreferrer" className="button btn-secondary" style={{ display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box", padding: "10px 16px", border: "1px solid var(--border)", borderRadius: 10 }}>
              Contact us
            </a>
          ) : isCurrent ? (
            <span className="muted" style={{ fontSize: 13.5, fontWeight: 500 }}>This is your current plan</span>
          ) : hasSub ? (
            <button type="button" className={featured ? "primary" : "btn-secondary"} style={{ width: "100%", margin: 0 }} disabled={!!busy || status === "past_due"} onClick={() => change(id)}>
              Switch to {p.name}
            </button>
          ) : (
            <button type="button" className={featured ? "primary" : "btn-secondary"} style={{ width: "100%", margin: 0 }} disabled={waiting} onClick={() => subscribe(id)}>
              {id === "starter" ? (ws.isTrialing ? "Keep Starter" : "Subscribe to Starter") : "Upgrade to Growth"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section>
      <div className="card" style={{ marginBottom: 16, padding: "24px 28px", background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ maxWidth: 580 }}>
            <span className="badge badge-primary">Plan and usage</span>
            <h1 style={{ margin: "10px 0 8px", fontSize: "1.75rem", fontWeight: 500 }}>{plan.name}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>
              {priceLine}. The same recommendation engine runs on every plan. Plans differ in how much you can do each week and how far back your history goes.
            </p>
            {hasSub && isOwner && (
              <button type="button" className="btn-secondary" style={{ marginTop: 16 }} disabled={!!busy} onClick={portal}>
                Payment method, invoices and cancellation
              </button>
            )}
          </div>
          <BillingArt size={170} />
        </div>
      </div>

      {ws.isTrialExpired && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid var(--danger)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px 0", color: "var(--danger)", fontSize: "1.05rem", fontWeight: 500 }}>Trial ended · view only</h3>
            <p className="muted" style={{ margin: 0 }}>Your history is safe. Subscribe to add data, generate recommendations and get updates again.</p>
          </div>
          {isOwner && <button type="button" className="primary" style={{ margin: 0 }} onClick={() => subscribe("starter")}>Subscribe now</button>}
        </div>
      )}

      {status === "past_due" && (
        <p className="card error" role="alert">
          Your last payment failed. Update your payment method{ws.restrictAtMs ? ` by ${fmtDate(ws.restrictAtMs)}` : ""} to keep your plan. Nothing is deleted if it lapses.
        </p>
      )}
      {status === "canceling" && (
        <p className="card" role="status">Your subscription ends on {fmtDate(ws.restrictAtMs)}. You keep your plan until then.</p>
      )}
      {(status === "restricted" || status === "canceled") && (
        <p className="card error" role="status">Your subscription has ended and this workspace is view only.</p>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontWeight: 500 }}>Your usage</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
          <Meter label="Recommendations this week" used={usage.week} limit={plan.recommendations.weekly} note="Resets every Monday" />
          <Meter label="Imports this month" used={usage.imports} limit={plan.importsPerMonth} note="Resets on the 1st" />
          <Meter label="AI follow-up questions this month" used={usage.ai} limit={plan.aiFollowUps.monthly} note="Used when you ask the assistant a free-form question" />
        </div>
        <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>
          Up to {plan.maxConnections} connected platforms per workspace and {plan.maxBusinesses} business workspace{plan.maxBusinesses === 1 ? "" : "s"}. Allowances are shared by all your workspaces and reset in {ws.accountTimezone} time.
        </p>
        {error && <div role="alert" className="error" style={{ marginTop: 8 }}>{error}</div>}
        {note && <div role="status" className="muted" style={{ marginTop: 8 }}>{note}</div>}
      </div>

      {!isOwner && <p className="muted" style={{ marginTop: 16 }}>Only the workspace owner can change the plan.</p>}

      {isOwner && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontWeight: 500 }}>Plans</h3>
            <div className="segmented-control">
              <button type="button" className={cycle === "annual" ? "active" : ""} onClick={() => setCycle("annual")}>Yearly (save about 20%)</button>
              <button type="button" className={cycle === "monthly" ? "active" : ""} onClick={() => setCycle("monthly")}>Monthly</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <PlanCard id="starter" />
            <PlanCard id="growth" />
            <PlanCard id="custom" />
          </div>
          {subscribed(status) && status !== "canceling" && (
            <div style={{ marginTop: 20 }}>
              <button type="button" className="link" disabled={!!busy} onClick={() => change("cancel")}>
                Cancel at the end of this billing period
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
