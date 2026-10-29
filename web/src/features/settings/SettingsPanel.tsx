import { useState } from "react";
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from "firebase/auth";
import { useAuth } from "../auth/AuthProvider";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { COLLECTIONS } from "../../shared/records";
import { EXPORT_COLUMNS, RECOMMENDATION_COLUMNS, toCsv } from "../../shared/export";
import { PANELS } from "../records/config";

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
      } else await reauthenticateWithPopup(user, new GoogleAuthProvider());
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
      <div className="card">
        <h2>Your data</h2>
        <p className="muted">Download your business profile, {COLLECTIONS.map((c) => PANELS[c].title.toLowerCase()).join(", ")} and recommendations. CSV files open safely in Excel and Sheets.</p>
        <button type="button" disabled={busy} onClick={() => exportAll("csv")}>Download CSV files</button>{" "}
        <button type="button" disabled={busy} onClick={() => exportAll("json")} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Download JSON</button>
        <div role="alert" className="error">{error}</div>
        <div role="status" className="muted">{note}</div>
      </div>

      {isOwner && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Delete account</h2>
          {ws.deletionScheduledMs ? (
            <>
              <p role="status">Deletion is scheduled for {new Date(ws.deletionScheduledMs).toLocaleDateString()}. Until then nothing is deleted and you can cancel.</p>
              <button type="button" disabled={delBusy} onClick={cancelDeletion}>Cancel deletion</button>
            </>
          ) : (
            <>
              <p className="muted">Permanently deletes your workspace, records, recommendations, reports and connections, and stops any subscription. There is a waiting period you can cancel in. Download your data first.</p>
              {user?.providerData.some((p) => p.providerId === "password") && (
                <><label htmlFor="del-pw">Password</label><input id="del-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></>
              )}
              <label htmlFor="del-confirm">Type DELETE to confirm</label>
              <input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <button type="button" disabled={delBusy || confirmText !== "DELETE"} onClick={requestDeletion}>Schedule deletion</button>
            </>
          )}
          <div role="alert" className="error">{delErr}</div>
        </div>
      )}
    </section>
  );
}
