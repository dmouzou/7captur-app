import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../../services/firebase";
import { RecordsPanel } from "../records/RecordsPanel";
import { ImportPanel } from "../imports/ImportPanel";
import { ScreenshotPanel } from "../imports/ScreenshotPanel";
import { RecommendationsPanel } from "../recommendations/RecommendationsPanel";
import { PANELS } from "../records/config";
import { COLLECTIONS, type RecordCollection } from "../../shared/records";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";

type Tab = "recommendations" | RecordCollection | "import" | "screenshot";

export function HomePage() {
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("recommendations");
  const tabs: [Tab, string][] = [["recommendations", "Recommendations"], ...COLLECTIONS.map((c): [Tab, string] => [c, PANELS[c].title]), ["import", "Import CSV"], ["screenshot", "Import screenshot"]];
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
      {tab === "recommendations" ? <RecommendationsPanel /> : tab === "import" ? <ImportPanel /> : tab === "screenshot" ? <ScreenshotPanel /> : <RecordsPanel coll={tab} />}
    </main>
  );
}
