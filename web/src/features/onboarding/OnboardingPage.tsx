import { useState, type FormEvent } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import {
  BUSINESS_TYPES, BUYING_METHODS, OBJECTIVES, createWorkspaceInput,
} from "../../shared/schemas";

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function OnboardingPage({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    businessName: "", businessType: "product_seller", country: "US",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, currency: "USD",
    objective: "qualified_enquiries", buyingMethod: "dm_whatsapp",
  });
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = createWorkspaceInput.safeParse({
      workspaceName: form.businessName, businessName: form.businessName, businessType: form.businessType,
      country: form.country, timezone: form.timezone, currency: form.currency,
      objective: form.objective, buyingMethods: [form.buyingMethod], requestId,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your answers."); return; }
    setBusy(true);
    try { await httpsCallable(functions, "createWorkspace")(parsed.data); onDone(); }
    catch { setError("Could not save your profile. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <main className="page">
      <h1>Tell us about your business</h1>
      <p className="muted">No website needed. You can add more detail later.</p>
      <form className="card" onSubmit={submit} noValidate>
        <label htmlFor="bn">Business name</label>
        <input id="bn" value={form.businessName} onChange={set("businessName")} required />
        <label htmlFor="bt">Business type</label>
        <select id="bt" value={form.businessType} onChange={set("businessType")}>
          {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <label htmlFor="ob">Main objective</label>
        <select id="ob" value={form.objective} onChange={set("objective")}>
          {OBJECTIVES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <label htmlFor="bm">How do customers buy?</label>
        <select id="bm" value={form.buyingMethod} onChange={set("buyingMethod")}>
          {BUYING_METHODS.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <label htmlFor="co">Country (2-letter code)</label>
        <input id="co" maxLength={2} value={form.country} onChange={set("country")} />
        <label htmlFor="tz">Timezone</label>
        <input id="tz" value={form.timezone} onChange={set("timezone")} />
        <label htmlFor="cu">Operating currency</label>
        <input id="cu" maxLength={3} value={form.currency} onChange={set("currency")} />
        <button type="submit" disabled={busy}>Continue</button>
        <div role="alert" className="error">{error}</div>
      </form>
    </main>
  );
}
