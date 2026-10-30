import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../../services/firebase";
import { AuthPage } from "../auth/AuthPage";
import { useAuth } from "../auth/AuthProvider";

// UX only. Every call below is authorized again on the server by the custom claim.
const call = async <T,>(name: string, data?: unknown): Promise<T> => (await httpsCallable<unknown, T>(functions, name)(data ?? {})).data;
type Row = Record<string, unknown>;
const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function Table({ rows, cols, onRow }: { rows: Row[]; cols?: string[]; onRow?: (r: Row) => void }) {
  if (!rows.length) return <p className="muted">Nothing to show.</p>;
  const keys = cols ?? Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead><tr>{keys.map((k) => <th key={k} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>{k}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={onRow ? () => onRow(r) : undefined} style={{ cursor: onRow ? "pointer" : "default" }}>
              {keys.map((k) => <td key={k} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cell(r[k])}>{cell(r[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Loads data from a callable; shows loading and error states. */
function useCallable<T>(name: string, data?: unknown) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const key = JSON.stringify(data ?? {});
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    call<T>(name, JSON.parse(key)).then((d) => setState({ data: d, loading: false })).catch((e) => setState({ loading: false, error: (e as { message?: string }).message ?? "Failed" }));
  }, [name, key]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
function Async<T>({ r, children }: { r: { data?: T; error?: string; loading: boolean }; children: (d: T) => ReactNode }) {
  if (r.loading && !r.data) return <p className="muted" role="status">Loading…</p>;
  if (r.error) return <p className="error" role="alert">{r.error}</p>;
  return <>{r.data ? children(r.data) : null}</>;
}

/** Re-authentication before sensitive actions (the server also demands a login from the last 5 minutes). */
async function reauth(password: string) {
  const user = auth.currentUser!;
  if (user.providerData.some((p) => p.providerId === "password")) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, password));
  else await reauthenticateWithPopup(user, new GoogleAuthProvider());
  await user.getIdToken(true);
}

function Sensitive({ label, onRun, children }: { label: string; onRun: (reason: string) => Promise<void>; children?: ReactNode }) {
  const [reason, setReason] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const usesPw = auth.currentUser?.providerData.some((p) => p.providerId === "password");
  async function go() {
    setBusy(true); setMsg("");
    try { await reauth(pw); await onRun(reason); setMsg("Done."); setPw(""); setReason(""); }
    catch (e) { setMsg((e as { message?: string }).message ?? "Failed"); }
    finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ marginTop: 8 }}>
      {children}
      <label>Reason (saved in the audit log)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {usesPw && <label>Your password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
      <button type="button" disabled={busy || reason.trim().length < 5} onClick={go}>{label}</button>
      <div role="status" className="muted">{msg}</div>
    </div>
  );
}

function Overview() {
  const r = useCallable<Row & { byPlan: Row; activation: Row }>("adminOverview");
  return <Async r={r}>{(d) => (
    <div className="card">
      <h2>Overview</h2>
      <Table rows={[{ workspaces: d.workspaces, "new (30d)": d.new30, "recs (7d)": d.recs7, "failed recs (7d)": d.recsFailed7, "past due": d.pastDue, canceling: d.canceling, "needs reconnect": d.needsReconnect, "pending deletions": d.pendingDeletions, suspended: d.suspended }]} />
      <h3>Workspaces by plan</h3><Table rows={[d.byPlan]} />
      <h3>Activation (newest {String(d.activation.sample)} workspaces)</h3><Table rows={[d.activation]} />
    </div>
  )}</Async>;
}

function WorkspaceDetail({ id, back }: { id: string; back: () => void }) {
  const r = useCallable<Row>("adminWorkspaceDetail", { workspaceId: id });
  const plans = useCallable<{ plans: Record<string, unknown> }>("adminPlans");
  const [plan, setPlan] = useState("free");
  return (
    <div>
      <button type="button" className="link" onClick={back}>Back</button>
      <Async r={r}>{(d) => {
        const summary = d.summary as Row;
        return (
          <>
            <div className="card"><h2>{String(summary.name || id)}</h2><Table rows={[summary]} /></div>
            <div className="card"><h3>Counts</h3><Table rows={[d.counts as Row]} /><h3>Members</h3><Table rows={d.members as Row[]} /></div>
            <div className="card"><h3>Connections</h3><Table rows={d.connections as Row[]} /><h3>Billing</h3><Table rows={d.billing ? [d.billing as Row] : []} /></div>
            <div className="card"><h3>Usage</h3><Table rows={d.usage as Row[]} /><h3>Recent imports</h3><Table rows={d.imports as Row[]} /><h3>Recent recommendations</h3><Table rows={d.recommendations as Row[]} /></div>
            <Sensitive label={summary.suspended ? "Reactivate workspace" : "Suspend workspace"} onRun={async (reason) => { await call("adminSetSuspension", { workspaceId: id, suspended: !summary.suspended, reason }); r.reload(); }}>
              <h3>{summary.suspended ? "Reactivate" : "Suspend"}</h3>
              <p className="muted">Suspended workspaces can read, export and disconnect, but cannot add data, import or generate recommendations.</p>
            </Sensitive>
            <Sensitive label="Change plan" onRun={async (reason) => { await call("adminChangePlan", { workspaceId: id, plan, reason }); r.reload(); }}>
              <h3>Manual plan override</h3>
              <p className="muted">Refused if the workspace has a paid subscription.</p>
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>{Object.keys(plans.data?.plans ?? { free: 1 }).map((p) => <option key={p}>{p}</option>)}</select>
            </Sensitive>
          </>
        );
      }}</Async>
    </div>
  );
}

function Workspaces() {
  const [q, setQ] = useState(""); const [applied, setApplied] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const r = useCallable<{ items: Row[] }>("adminSearchWorkspaces", { query: applied || undefined });
  if (open) return <WorkspaceDetail id={open} back={() => setOpen(null)} />;
  return (
    <div className="card">
      <h2>Workspaces</h2>
      <form onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
        <label>Owner email or workspace id (empty = newest)<input value={q} onChange={(e) => setQ(e.target.value)} /></label><button type="submit">Search</button>
      </form>
      <Async r={r}>{(d) => <Table rows={d.items} cols={["id", "name", "ownerEmail", "plan", "billingStatus", "suspended", "createdAt"]} onRow={(row) => setOpen(String(row.id))} />}</Async>
    </div>
  );
}

function RecDetail({ workspaceId, id }: { workspaceId: string; id: string }) {
  const d = useCallable<Row>("adminRecommendationDetail", { workspaceId, id });
  return <><h3>Detail (viewing is audit-logged)</h3><Async r={d}>{(x) => <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(x, null, 2)}</pre>}</Async></>;
}

function Recommendations() {
  const [status, setStatus] = useState(""); const [sel, setSel] = useState<Row | null>(null);
  const r = useCallable<{ items: Row[] }>("adminListRecommendations", { status: status || undefined });
  return (
    <div className="card">
      <h2>Recommendations</h2>
      <label>Status filter<input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="e.g. failed" /></label>
      <Async r={r}>{(x) => <Table rows={x.items} onRow={setSel} />}</Async>
      {sel && <RecDetail key={`${sel.workspaceId}/${sel.id}`} workspaceId={String(sel.workspaceId)} id={String(sel.id)} />}
    </div>
  );
}

const simple = (title: string, fn: string, key: string, cols?: string[]) => function Simple() {
  const r = useCallable<Record<string, Row[]>>(fn);
  return <div className="card"><h2>{title}</h2><Async r={r}>{(d) => <Table rows={d[key]} cols={cols} />}</Async></div>;
};
const Imports = simple("Imports", "adminListImports", "items");
const Integrations = simple("Integrations", "adminListIntegrations", "items");
const Audit = simple("Audit log", "adminListAudit", "items", ["createdAt", "actorEmail", "actorRole", "action", "target", "reason", "before", "after"]);

function Jobs() {
  const r = useCallable<Record<string, Row[]>>("adminJobs");
  return <Async r={r}>{(d) => <div className="card"><h2>Jobs</h2><h3>Overdue weekly reports</h3><Table rows={d.overdueReports} /><h3>Email outbox</h3><Table rows={d.mail} /><h3>Deletion requests</h3><Table rows={d.deletions} /></div>}</Async>;
}
function Billing() {
  const r = useCallable<Record<string, Row[]>>("adminBilling");
  return <Async r={r}>{(d) => <div className="card"><h2>Billing</h2><h3>Needs attention</h3><Table rows={d.workspaces} /><h3>Recent provider events</h3><Table rows={d.events} /></div>}</Async>;
}
function Plans() {
  const r = useCallable<{ plans: Record<string, Row> }>("adminPlans");
  return <Async r={r}>{(d) => <div className="card"><h2>Plans (read-only)</h2><p className="muted">Plan limits are versioned in code (shared/plans.json) and ship through a reviewed deploy, so the app and website cannot drift.</p><pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(d.plans, null, 2)}</pre></div>}</Async>;
}
function Admins() {
  const [email, setEmail] = useState(""); const [role, setRole] = useState("ops");
  return (
    <Sensitive label="Apply role" onRun={async (reason) => { await call("adminSetRole", { email, role, reason }); }}>
      <h2>Admins</h2>
      <p className="muted">Roles: super_admin (everything), ops, billing, support (read-only). Choose none to remove. The person must have a verified email and sign in again.</p>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <select value={role} onChange={(e) => setRole(e.target.value)}>{["super_admin", "ops", "billing", "support", "none"].map((x) => <option key={x}>{x}</option>)}</select>
    </Sensitive>
  );
}

const TABS: [string, string, () => ReactNode][] = [
  ["overview", "Overview", () => <Overview />], ["workspaces", "Workspaces", () => <Workspaces />], ["recs", "Recommendations", () => <Recommendations />],
  ["imports", "Imports", () => <Imports />], ["integrations", "Integrations", () => <Integrations />], ["jobs", "Jobs", () => <Jobs />],
  ["billing", "Billing", () => <Billing />], ["plans", "Plans", () => <Plans />], ["audit", "Audit", () => <Audit />], ["admins", "Admins", () => <Admins />],
];

export default function AdminApp() {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    if (!user) return;
    user.getIdToken(true).then(() => call<{ role: string | null }>("adminWhoAmI")).then((r) => setRole(r.role)).catch(() => setRole(null));
  }, [user]);
  if (loading) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  if (!user) return <AuthPage />;
  if (role === undefined) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  if (!role) return <main className="page"><h1>Not found</h1><p className="muted">This page does not exist.</p></main>;
  return (
    <main className="page" style={{ maxWidth: 1000 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>7Captur admin</h1><span className="muted">{user.email} · {role} · <button type="button" className="link" onClick={() => signOut(auth)}>Sign out</button></span>
      </header>
      <nav aria-label="Admin sections" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {TABS.filter(([id]) => id !== "admins" || role === "super_admin").map(([id, name]) => (
          <button key={id} type="button" aria-current={tab === id} onClick={() => setTab(id)} style={{ margin: 0, background: tab === id ? "var(--lime)" : "transparent", color: tab === id ? "#0e1014" : "var(--text)", border: "1px solid var(--border)" }}>{name}</button>
        ))}
      </nav>
      {TABS.find(([id]) => id === tab)?.[2]()}
    </main>
  );
}
