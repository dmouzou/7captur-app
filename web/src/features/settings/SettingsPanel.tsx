import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { reauthWithSocial } from "../../services/authProviders";
import { useAuth } from "../auth/AuthProvider";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { COLLECTIONS } from "../../shared/records";
import { EXPORT_COLUMNS, RECOMMENDATION_COLUMNS, toCsv } from "../../shared/export";
import { PANELS } from "../records/config";
import { SettingsArt } from "../../components/art";

type Exported = Record<string, unknown> & { truncated?: string[] };

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function SettingsPanel() {
  const ws = useWorkspace();
  const { user } = useAuth();
  const isOwner = ws.ownerUid === user?.uid;
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [delErr, setDelErr] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function exportAll(kind: "json" | "csv") {
    setError(""); setNote(""); setBusy(true);
    try {
      const res = await httpsCallable<unknown, Exported>(functions, "exportData")({ workspaceId: ws.workspaceId, businessId: ws.businessId });
      const data = res.data;
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "json") download(`7captur-export-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      else {
        for (const c of COLLECTIONS) download(`7captur-${c}-${stamp}.csv`, toCsv(EXPORT_COLUMNS[c], (data[c] as Record<string, unknown>[]) ?? []), "text/csv");
        download(`7captur-recommendations-${stamp}.csv`, toCsv(RECOMMENDATION_COLUMNS, (data.recommendations as Record<string, unknown>[]) ?? []), "text/csv");
      }
      setNote(data.truncated?.length ? `Large export: only the first 5,000 rows of ${data.truncated.join(", ")} were included.` : "Export downloaded.");
    } catch { setError("Could not export your data. Try again."); }
    finally { setBusy(false); }
  }

  async function requestDeletion() {
    if (!user) return;
    setDelErr(""); setDelBusy(true);
    try {
      const usesPassword = user.providerData.some((p) => p.providerId === "password");
      if (usesPassword) {
        if (!user.email || !password) { setDelErr("Enter your password to confirm."); return; }
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      } else await reauthWithSocial(user);
      await user.getIdToken(true);
      await httpsCallable(functions, "requestAccountDeletion")({ workspaceId: ws.workspaceId });
      setPassword(""); setConfirmText("");
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setDelErr(code.includes("wrong-password") || code.includes("invalid-credential") ? "Wrong password." : "Could not schedule deletion. Try again.");
    } finally { setDelBusy(false); }
  }
  async function cancelDeletion() {
    setDelErr(""); setDelBusy(true);
    try { await httpsCallable(functions, "cancelAccountDeletion")({ workspaceId: ws.workspaceId }); }
    catch { setDelErr("Could not cancel. Try again."); }
    finally { setDelBusy(false); }
  }

  return (
    <section>
      <div className="card" style={{ marginBottom: 16, padding: "24px 28px", background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ maxWidth: 580 }}>
            <span className="badge badge-primary">Settings</span>
            <h1 style={{ margin: "10px 0 8px", fontSize: "1.75rem", fontWeight: 500 }}>Your data is yours</h1>
            <p className="muted" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>
              Download everything you have added to 7Captur at any time, or delete your account. Nothing here changes your ad accounts or stores.
            </p>
          </div>
          <SettingsArt size={170} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: "0 0 6px", fontWeight: 500 }}>Download your data</h3>
        <p className="muted" style={{ margin: "0 0 14px" }}>
          Your business profile, {COLLECTIONS.map((c) => PANELS[c].title.toLowerCase()).join(", ")} and recommendations.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <div style={{ padding: "16px 18px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-subtle)" }}>
            <div style={{ color: "var(--ink)", marginBottom: 4 }}>CSV files</div>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>One file per record type. Opens safely in Excel and Google Sheets.</p>
            <button type="button" disabled={busy} onClick={() => exportAll("csv")} style={{ margin: 0 }}>Download CSV files</button>
          </div>
          <div style={{ padding: "16px 18px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-subtle)" }}>
            <div style={{ color: "var(--ink)", marginBottom: 4 }}>JSON file</div>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>Everything in one file, for backups or moving to another tool.</p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => exportAll("json")} style={{ margin: 0 }}>Download JSON</button>
          </div>
        </div>
        <div role="alert" className="error">{error}</div>
        <div role="status" className="muted">{note}</div>
      </div>

      {isOwner && (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--danger)" }}>
          <h3 style={{ margin: "0 0 6px", fontWeight: 500, color: "var(--danger)" }}>Delete account</h3>
          {ws.deletionScheduledMs ? (
            <>
              <p role="status">Deletion is scheduled for {new Date(ws.deletionScheduledMs).toLocaleDateString()}. Until then nothing is deleted and you can cancel.</p>
              <button type="button" disabled={delBusy} onClick={cancelDeletion}>Cancel deletion</button>
            </>
          ) : (
            <>
              <p className="muted">This permanently deletes your workspace, records, recommendations, reports and connections, and stops any subscription. There is a waiting period, and you can cancel during it. Download your data first.</p>
              {user?.providerData.some((p) => p.providerId === "password") && (
                <><label htmlFor="del-pw">Password</label><input id="del-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></>
              )}
              <label htmlFor="del-confirm">Type DELETE to confirm</label>
              <input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <button type="button" disabled={delBusy || confirmText !== "DELETE"} onClick={requestDeletion} style={{ background: "var(--danger)", color: "#fff" }}>Schedule deletion</button>
            </>
          )}
          <div role="alert" className="error">{delErr}</div>
        </div>
      )}
    </section>
  );
}
