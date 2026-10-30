import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../../services/firebase";
import { RecordsPanel } from "../records/RecordsPanel";
import { ImportPanel } from "../imports/ImportPanel";
import { ScreenshotPanel } from "../imports/ScreenshotPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { ReportsPanel } from "../reports/ReportsPanel";
import { BillingPanel } from "../billing/BillingPanel";
import { NotificationsPanel, useUnreadCount } from "../notifications/NotificationsPanel";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
import { RecommendationsPanel } from "../recommendations/RecommendationsPanel";
import { PANELS } from "../records/config";
import { COLLECTIONS, type RecordCollection } from "../../shared/records";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";

type Tab = "recommendations" | RecordCollection | "import" | "screenshot" | "settings" | "reports" | "billing" | "notifications" | "connections";

export function HomePage() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>(() => ((new URLSearchParams(window.location.search).has("shopify") || new URLSearchParams(window.location.search).has("googleads")) ? "connections" : "recommendations"));
  const unread = useUnreadCount();
  const tabs: [Tab, string][] = [["recommendations", "Recommendations"], ["reports", "Weekly summary"], ...COLLECTIONS.map((c): [Tab, string] => [c, PANELS[c].title]), ["connections", "Connections"], ["import", "Import CSV"], ["screenshot", "Import screenshot"], ["notifications", unread ? `Notifications (${unread})` : "Notifications"], ["billing", "Billing"], ["settings", "Settings"]];
  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>7Captur</h1>
        <span className="muted">{PLANS[ws.plan].name} plan · <button type="button" className="link" onClick={() => signOut(auth)}>Sign out</button></span>
      </header>
      <nav aria-label="Sections" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {tabs.map(([id, name]) => (
          <button key={id} type="button" aria-current={tab === id} onClick={() => setTab(id)}
            style={{ margin: 0, background: tab === id ? "var(--lime)" : "transparent", color: tab === id ? "#0e1014" : "var(--text)", border: "1px solid var(--border)" }}>
            {name}
          </button>
        ))}
      </nav>
      {ws.billingStatus === "past_due" && tab !== "billing" && (
        <p className="card error" role="alert">Your last payment failed. <button type="button" className="link" onClick={() => setTab("billing")}>Update your payment method</button> to keep your plan.</p>
      )}
      {ws.deletionScheduledMs && tab !== "settings" && (
        <p className="card error" role="alert">This workspace will be permanently deleted on {new Date(ws.deletionScheduledMs).toLocaleDateString()}. <button type="button" className="link" onClick={() => setTab("settings")}>Cancel deletion</button></p>
      )}
      {tab === "recommendations" ? <RecommendationsPanel /> : tab === "import" ? <ImportPanel /> : tab === "screenshot" ? <ScreenshotPanel /> : tab === "settings" ? <SettingsPanel /> : tab === "reports" ? <ReportsPanel /> : tab === "billing" ? <BillingPanel /> : tab === "notifications" ? <NotificationsPanel /> : tab === "connections" ? <ConnectionsPanel /> : <RecordsPanel coll={tab} />}
    </main>
  );
}
