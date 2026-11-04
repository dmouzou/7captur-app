import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS, type PlanId } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import { getPriceId, loadPaddle, openCheckout } from "./paddle";

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

const subscribed = (s: string) => s === "active" || s === "canceling" || s === "past_due";

export function BillingPanel() {
  const { user } = useAuth();
  const ws = useWorkspace();
  const isOwner = ws.ownerUid === user?.uid;
  const plan = PLANS[ws.plan] ?? PLANS.starter;
  const [cycle, setCycle] = useState<"annual" | "monthly">("annual");
  const [usage, setUsage] = useState({ week: 0, imports: 0 });
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
      setUsage((u) => ({ ...u, imports: s.data()?.imports ?? 0 })), () => undefined
    );
    return () => {
      u1();
      u2();
    };
  }, [ws.ownerUid, ws.accountTimezone]);

  useEffect(() => {
    if (waiting && ws.hasSubscription) setWaiting(false);
  }, [waiting, ws.hasSubscription]);

  const daysLeft = ws.trialEndsAtMs
    ? Math.max(0, Math.ceil((ws.trialEndsAtMs - Date.now()) / (24 * 60 * 60 * 1000)))
    : 14;

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

  return (
    <section>
      {ws.isTrialing && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderLeft: "4px solid #3b82f6",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: "0 0 4px 0", fontSize: "1.05rem" }}>
              Starter Trial · {daysLeft} {daysLeft === 1 ? "day" : "days"} left
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              Full access to Starter features. Upgrade anytime to keep your access and unlock higher limits.
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              className="primary"
              style={{ margin: 0 }}
              onClick={() => subscribe("growth")}
            >
              Upgrade to Growth
            </button>
          )}
        </div>
      )}

      {ws.isTrialExpired && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderLeft: "4px solid #ef4444",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: "0 0 4px 0", color: "#f87171", fontSize: "1.05rem" }}>
              Trial expired · Read-only mode
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              Your 14-day trial has ended. Your history is preserved. Subscribe to resume imports, recommendations and updates.
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              className="primary"
              style={{ margin: 0 }}
              onClick={() => subscribe("starter")}
            >
              Subscribe now
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h2>Billing & Usage</h2>
        <p>
          <strong>{plan.name}</strong> ·{" "}
          {ws.isTrialing
            ? "Free 14-day trial"
            : plan.priceMonthly !== undefined
            ? `$${plan.priceMonthly}/month`
            : "Custom"}
        </p>
        {status === "past_due" && (
          <p className="error" role="alert">
            Your last payment failed. Update your payment method
            {ws.restrictAtMs ? ` by ${fmtDate(ws.restrictAtMs)}` : ""} to keep your plan. Nothing is deleted if it lapses.
          </p>
        )}
        {status === "canceling" && (
          <p role="status">
            Your subscription ends on {fmtDate(ws.restrictAtMs)}. You keep your plan until then.
          </p>
        )}
        {(status === "restricted" || status === "canceled") && (
          <p role="status" className="error">
            Your subscription has ended and this workspace is read-only.
          </p>
        )}
        <p className="muted">
          This week: {usage.week} of {plan.recommendations.weekly} recommendations · This month: {usage.imports} of{" "}
          {plan.importsPerMonth} imports · Connected platforms: up to {plan.maxConnections} per workspace · Business workspaces: up to {plan.maxBusinesses}
        </p>
        <p className="muted">
          Allowances are shared by all your business workspaces and reset every Monday in {ws.accountTimezone}. Same recommendation engine on every plan; plans differ in capacity and history.
        </p>
        {ws.hasSubscription && isOwner && (
          <button type="button" disabled={!!busy} onClick={portal}>
            Manage payment method, invoices and cancellation
          </button>
        )}
        {error && <div role="alert" className="error" style={{ marginTop: 8 }}>{error}</div>}
        {note && <div role="status" className="muted" style={{ marginTop: 8 }}>{note}</div>}
      </div>

      {!isOwner && <p className="muted" style={{ marginTop: 16 }}>Only the workspace owner can change the plan.</p>}

      {isOwner && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Available Plans</h3>
            <div className="segmented-control">
              <button
                type="button"
                className={cycle === "annual" ? "active" : ""}
                onClick={() => setCycle("annual")}
              >
                Billed annually (Save ~20%)
              </button>
              <button
                type="button"
                className={cycle === "monthly" ? "active" : ""}
                onClick={() => setCycle("monthly")}
              >
                Billed monthly
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            {/* Starter */}
            <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "1.2rem" }}>Starter</h4>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>
                  {cycle === "annual" ? "$39" : "$49"}
                  <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-muted)" }}>/month</span>
                </div>
                {cycle === "annual" && <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>$468 billed annually</div>}
                {cycle === "monthly" && <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>Billed monthly</div>}
                <ul style={{ listStyle: "none", padding: 0, margin: "16px 0", fontSize: "0.9rem", lineHeight: 1.6 }}>
                  <li>✓ 2 connected platforms</li>
                  <li>✓ 1 business workspace</li>
                  <li>✓ 3 recommendations a week</li>
                  <li>✓ 5 imports a month</li>
                  <li>✓ 30 days of history</li>
                  <li className="muted">✕ No weekly summary</li>
                </ul>
              </div>
              <div style={{ marginTop: 16 }}>
                {ws.plan === "starter" && ws.hasSubscription ? (
                  <span className="muted">Current plan</span>
                ) : ws.hasSubscription ? (
                  <button type="button" style={{ width: "100%", margin: 0 }} disabled={!!busy || status === "past_due"} onClick={() => change("starter")}>
                    Switch to Starter
                  </button>
                ) : (
                  <button type="button" style={{ width: "100%", margin: 0 }} disabled={waiting} onClick={() => subscribe("starter")}>
                    {ws.isTrialing ? "Keep Starter" : "Subscribe to Starter"}
                  </button>
                )}
              </div>
            </div>

            {/* Growth */}
            <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px solid rgba(59, 130, 246, 0.4)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "1.2rem" }}>Growth</h4>
                  <span style={{ background: "#2563eb", color: "#fff", fontSize: "0.7rem", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>POPULAR</span>
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>
                  {cycle === "annual" ? "$159" : "$199"}
                  <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-muted)" }}>/month</span>
                </div>
                {cycle === "annual" && <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>$1,908 billed annually</div>}
                {cycle === "monthly" && <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>Billed monthly</div>}
                <ul style={{ listStyle: "none", padding: 0, margin: "16px 0", fontSize: "0.9rem", lineHeight: 1.6 }}>
                  <li>✓ 7 connected platforms per workspace</li>
                  <li>✓ 3 business workspaces</li>
                  <li>✓ 15 recommendations a week, shared</li>
                  <li>✓ 50 imports a month</li>
                  <li>✓ 365 days of history</li>
                  <li>✓ Weekly summary & smart reviews</li>
                  <li>✓ Priority support</li>
                </ul>
              </div>
              <div style={{ marginTop: 16 }}>
                {ws.plan === "growth" && ws.hasSubscription ? (
                  <span className="muted">Current plan</span>
                ) : ws.hasSubscription ? (
                  <button type="button" className="primary" style={{ width: "100%", margin: 0 }} disabled={!!busy || status === "past_due"} onClick={() => change("growth")}>
                    Switch to Growth
                  </button>
                ) : (
                  <button type="button" className="primary" style={{ width: "100%", margin: 0 }} disabled={waiting} onClick={() => subscribe("growth")}>
                    Upgrade to Growth
                  </button>
                )}
              </div>
            </div>

            {/* Custom */}
            <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "1.2rem" }}>Custom</h4>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>
                  On request
                </div>
                <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 12 }}>Tailored capacity & terms</div>
                <ul style={{ listStyle: "none", padding: 0, margin: "16px 0", fontSize: "0.9rem", lineHeight: 1.6 }}>
                  <li>✓ Tailored platform limits</li>
                  <li>✓ Tailored workspace limits</li>
                  <li>✓ Tailored recommendation & import volume</li>
                  <li>✓ Extended history retention</li>
                  <li>✓ Monthly strategy call</li>
                  <li>✓ Dedicated priority support</li>
                </ul>
              </div>
              <div style={{ marginTop: 16 }}>
                <a
                  href="https://7captur.com/contact/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button"
                  style={{ display: "block", textAlign: "center", textDecoration: "none", width: "100%", boxSizing: "border-box" }}
                >
                  Contact Us
                </a>
              </div>
            </div>
          </div>

          {subscribed(status) && status !== "canceling" && (
            <div style={{ marginTop: 20 }}>
              <button type="button" className="link" disabled={!!busy} onClick={() => change("cancel")}>
                Cancel subscription at end of billing period
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
