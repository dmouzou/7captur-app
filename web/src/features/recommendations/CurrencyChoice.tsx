import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import type { Recommendation } from "../../shared/recommendation";

type Mismatch = NonNullable<Recommendation["evidence"]["currencyMismatch"]>;

/**
 * Shown when some records are in a different currency than the workspace's. Nothing is converted until the owner
 * chooses. Converting uses ECB reference rates and the rate date is always shown on the result.
 */
export function CurrencyChoice({ mismatch }: { mismatch: Mismatch }) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const entries = Object.entries(mismatch.excluded).sort((a, b) => b[1] - a[1]);
  const main = entries[0]?.[0];
  const total = entries.reduce((n, [, c]) => n + c, 0);

  async function choose(patch: { convertCurrencies?: boolean; currency?: string }, message: string) {
    setBusy(true); setError("");
    try {
      await httpsCallable(functions, "updateWorkspaceDetails")({ workspaceId: ws.workspaceId, businessId: ws.businessId, ...patch });
      setDone(message);
    } catch {
      setError("Could not save your choice. Try again.");
    } finally { setBusy(false); }
  }

  if (done) return <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>{done}</p>;
  return (
    <div style={{ margin: "12px 0 0", padding: 12, border: "1px solid var(--border)", borderRadius: 10 }}>
      <strong style={{ fontSize: 14 }}>{total} record(s) are in {entries.map(([c, n]) => `${c} (${n})`).join(", ")}, but this workspace reports in {mismatch.reportingCurrency}.</strong>
      <p className="muted" style={{ margin: "6px 0 10px", fontSize: 13 }}>
        They are left out of every figure until you choose. Nothing has been converted.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={() => choose({ convertCurrencies: true }, `Conversion is on. Generate a new recommendation to include them, converted to ${mismatch.reportingCurrency} with ECB rates (the rate date is shown).`)}>
          Convert to {mismatch.reportingCurrency}
        </button>
        {main && (
          <button type="button" className="ghost" disabled={busy} onClick={() => choose({ currency: main, convertCurrencies: false }, `Reporting currency is now ${main}. Generate a new recommendation. Records in ${mismatch.reportingCurrency} are now the ones left out.`)}>
            Report in {main} instead
          </button>
        )}
        <button type="button" className="ghost" disabled={busy} onClick={() => choose({ convertCurrencies: false }, "Okay. They stay out of the figures. You can change this in Preferences.")}>
          Keep them out
        </button>
      </div>
      {error && <p className="error" style={{ margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
