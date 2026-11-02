import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../../services/firebase";
import { AuthPage } from "../auth/AuthPage";
import { useAuth } from "../auth/AuthProvider";
import { Logo } from "../../components/Logo";
import { ThemeToggle } from "../../components/ThemeContext";
import "./admin.css";

// UX only. Every call below is authorized again on the server by the custom claim.
const call = async <T,>(name: string, data?: unknown): Promise<T> => (await httpsCallable<unknown, T>(functions, name)(data ?? {})).data;
type Row = Record<string, unknown>;

/* ---------- formatting ---------- */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const humanHeader = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && ISO.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const GOOD = /^(active|ok|complete|completed|done|connected|generated|sent|paid|succeeded|delivered)$/i;
const WARN = /^(pending|canceling|trialing|queued|processing|partial|deferred|viewed)$/i;
const BAD = /^(failed|error|past_due|needs_reconnect|suspended|dead|cancelled|canceled|rejected|trial_expired)$/i;
const toneOf = (s: string) => (BAD.test(s) ? "is-bad" : WARN.test(s) ? "is-warn" : GOOD.test(s) ? "is-good" : "");
const STATUS_COLS = /^(status|billingStatus|mode|role|plan|provider|suspended|category|actorRole)$/;

function Pill({ value }: { value: string }) {
  return <span className={`adm-pill ${toneOf(value)}`}>{value.replace(/_/g, " ")}</span>;
}

/* ---------- data table: search, sort, readable headers ---------- */
function Table({ rows, cols, onRow, search = true, empty = "Nothing to show." }: { rows: Row[]; cols?: string[]; onRow?: (r: Row) => void; search?: boolean; empty?: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const keys = cols ?? (rows[0] ? Object.keys(rows[0]) : []);
  const shown = useMemo(() => {
    let r = rows;
    if (q.trim()) { const n = q.trim().toLowerCase(); r = r.filter((x) => keys.some((k) => fmt(x[k]).toLowerCase().includes(n))); }
    if (sort) r = [...r].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return fmt(av).localeCompare(fmt(bv), undefined, { numeric: true }) * sort.dir;
    });
    return r;
  }, [rows, q, sort, keys]);
  if (!rows.length) return <div className="adm-empty">{empty}</div>;
  return (
    <div>
      {search && rows.length > 6 && (
        <div className="adm-tools"><label>Filter rows<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter" /></label></div>
      )}
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>{keys.map((k) => (
              <th key={k} scope="col" aria-sort={sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                onClick={() => setSort((s) => (s?.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 }))}>
                {humanHeader(k)}{sort?.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={onRow ? "is-click" : ""} onClick={onRow ? () => onRow(r) : undefined}>
                {keys.map((k) => {
                  const v = r[k], text = fmt(v);
                  if (typeof v === "number") return <td key={k} className="is-num" title={text}>{text}</td>;
                  if (STATUS_COLS.test(k) && (typeof v === "string" || typeof v === "boolean") && text) return <td key={k}><Pill value={typeof v === "boolean" ? (v ? "yes" : "no") : String(v)} /></td>;
                  return <td key={k} title={text}>{text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="adm-count">{shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length} rows`}</p>
    </div>
  );
}

/* ---------- loading helpers ---------- */
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
function Async<T>({ r, children }: { r: { data?: T; error?: string; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (r.loading && !r.data) return <div role="status" aria-label="Loading"><div className="adm-skel" style={{ width: "40%" }} /><div className="adm-skel" /><div className="adm-skel" style={{ width: "80%" }} /></div>;
  if (r.error) return <div role="alert"><p className="error">{r.error}</p><button type="button" className="btn-secondary" onClick={r.reload}>Try again</button></div>;
  return <>{r.data ? children(r.data) : null}</>;
}

/* ---------- re-authentication before sensitive actions (the server also demands a login from the last 5 minutes) ---------- */
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
    <div className="adm-card">
      {children}
      <label>Reason (saved in the audit log)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {usesPw && <label>Your password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
      <button type="button" style={{ marginTop: 14 }} disabled={busy || reason.trim().length < 5} onClick={go}>{label}</button>
      <div role="status" className="muted" style={{ marginTop: 8 }}>{msg}</div>
    </div>
  );
}

/* ---------- small building blocks ---------- */
function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "warn" | "bad" }) {
  return <div className={`adm-kpi ${tone ? `is-${tone}` : ""}`}><div className="adm-kpi-label">{label}</div><div className="adm-kpi-value">{value}</div>{hint && <div className="adm-kpi-hint">{hint}</div>}</div>;
}
const PLAN_COLORS = ["#8fce3a", "#d8b14a", "#6aa8e0", "#c78ae0", "#e2685f", "#858078", "#4fc3a1"];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/* ---------- screens ---------- */
function Overview({ go }: { go: (tab: string) => void }) {
  const r = useCallable<Row & { byPlan: Record<string, number>; activation: Record<string, number> }>("adminOverview");
  return <Async r={r}>{(d) => {
    const n = (k: string) => Number(d[k] ?? 0);
    const plans = Object.entries(d.byPlan), total = plans.reduce((s, [, v]) => s + v, 0);
    const failRate = pct(n("recsFailed7"), n("recs7"));
    const act = d.activation;
    const attention: [string, number, string][] = [
      ["Past due payments", n("pastDue"), "billing"], ["Connections to reconnect", n("needsReconnect"), "integrations"],
      ["Failed recommendations (7 days)", n("recsFailed7"), "recs"], ["Pending deletion requests", n("pendingDeletions"), "jobs"], ["Suspended workspaces", n("suspended"), "workspaces"],
      ["Open support & feedback", n("openFeedback"), "feedback"],
    ];
    const open = attention.filter(([, v]) => v > 0);
    return (
      <>
        <div className="adm-kpis">
          <Kpi label="Workspaces" value={n("workspaces")} hint={`${n("new30")} new in 30 days`} />
          <Kpi label="Recommendations (7d)" value={n("recs7")} hint={`${failRate}% failed`} tone={failRate >= 10 ? "bad" : undefined} />
          <Kpi label="Open tickets" value={n("openFeedback")} tone={n("openFeedback") > 0 ? "warn" : undefined} />
          <Kpi label="Past due" value={n("pastDue")} tone={n("pastDue") > 0 ? "bad" : undefined} />
          <Kpi label="Canceling" value={n("canceling")} tone={n("canceling") > 0 ? "warn" : undefined} />
          <Kpi label="Needs reconnect" value={n("needsReconnect")} tone={n("needsReconnect") > 0 ? "warn" : undefined} />
          <Kpi label="Pending deletions" value={n("pendingDeletions")} tone={n("pendingDeletions") > 0 ? "warn" : undefined} />
        </div>
        <div className="adm-grid">
          <div className="adm-card">
            <h3>Needs attention</h3>
            {open.length === 0 ? <p className="adm-ok">Nothing needs attention.</p> : (
              <div className="adm-attn">{open.map(([label, v, tab]) => <button key={label} type="button" onClick={() => go(tab)}><span>{label}</span><span className="num">{v}</span></button>)}</div>
            )}
          </div>
          <div className="adm-card">
            <h3>Workspaces by plan</h3>
            <div className="adm-bar" role="img" aria-label="Plan mix">{plans.filter(([, v]) => v > 0).map(([p, v], i) => <span key={p} style={{ width: `${pct(v, total)}%`, background: PLAN_COLORS[i % PLAN_COLORS.length] }} />)}</div>
            <div className="adm-legend">{plans.map(([p, v], i) => <div key={p} className="adm-legend-row"><span><span className="adm-dot" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} />{p}</span><span className="num">{v} ({pct(v, total)}%)</span></div>)}</div>
          </div>
          <div className="adm-card">
            <h3>Activation</h3>
            <p className="adm-sub">Newest {act.sample} workspaces</p>
            <div className="adm-legend-row"><span>Saved any record</span><span className="num">{pct(act.withRecord, act.sample)}%</span></div>
            <div className="adm-meter"><span style={{ width: `${pct(act.withRecord, act.sample)}%` }} /></div>
            <div className="adm-legend-row"><span>Got a recommendation</span><span className="num">{pct(act.withRecommendation, act.sample)}%</span></div>
            <div className="adm-meter"><span style={{ width: `${pct(act.withRecommendation, act.sample)}%` }} /></div>
          </div>
        </div>
      </>
    );
  }}</Async>;
}

function WorkspaceDetail({ id, back }: { id: string; back: () => void }) {
  const r = useCallable<Row>("adminWorkspaceDetail", { workspaceId: id });
  const plans = useCallable<{ plans: Record<string, unknown> }>("adminPlans");
  const [plan, setPlan] = useState("starter");
  const [billingStatus, setBillingStatus] = useState("active");
  const [sec, setSec] = useState("overview");

  useEffect(() => {
    if (r.data?.summary) {
      const s = r.data.summary as Row;
      if (s.plan) setPlan(String(s.plan));
      if (s.billingStatus) setBillingStatus(String(s.billingStatus));
    }
  }, [r.data]);

  return (
    <div>
      <button type="button" className="btn-secondary" onClick={back} style={{ marginBottom: 14 }}>Back to workspaces</button>
      <Async r={r}>{(d) => {
        const summary = d.summary as Row; const counts = d.counts as Record<string, number>;
        const SECTIONS: [string, string][] = [["overview", "Overview"], ["connections", "Connections"], ["usage", "Usage"], ["activity", "Imports and recommendations"], ["actions", "Actions"]];
        return (
          <>
            <div className="adm-card">
              <div className="adm-card-head">
                <div><h2>{String(summary.name || id)}</h2><p className="adm-sub">{String(summary.ownerEmail ?? "No owner email")} · <span className="num">{id}</span></p></div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Pill value={String(summary.plan)} /><Pill value={String(summary.billingStatus)} />{Boolean(summary.suspended) && <Pill value="suspended" />}</div>
              </div>
              <div className="adm-kpis" style={{ marginBottom: 0 }}>{Object.entries(counts).map(([k, v]) => <Kpi key={k} label={humanHeader(k)} value={v} />)}</div>
            </div>
            <div className="adm-tabs" role="tablist">{SECTIONS.map(([k, name]) => <button key={k} type="button" role="tab" className="adm-tab" aria-selected={sec === k} onClick={() => setSec(k)}>{name}</button>)}</div>
            {sec === "overview" && (
              <div className="adm-card">
                <h3>Subscription & Plan</h3>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, background: "var(--surface-subtle)", padding: 12, borderRadius: 8 }}>
                  <div>Current Plan: <strong>{String(summary.plan).toUpperCase()}</strong></div>
                  <div>Billing Status: <Pill value={String(summary.billingStatus)} /></div>
                  <button type="button" className="btn-secondary" onClick={() => setSec("actions")} style={{ marginLeft: "auto", margin: 0 }}>Change Plan / Status</button>
                </div>
                <h3>Members</h3>
                <Table rows={d.members as Row[]} search={false} />
                <h3 style={{ marginTop: 18 }}>Billing</h3>
                <Table rows={d.billing ? [d.billing as Row] : []} search={false} empty="No subscription." />
              </div>
            )}
            {sec === "connections" && <div className="adm-card"><h3>Connections</h3><Table rows={d.connections as Row[]} empty="No connections." /></div>}
            {sec === "usage" && <div className="adm-card"><h3>Recommendation usage</h3><Table rows={d.usage as Row[]} empty="No usage yet." /></div>}
            {sec === "activity" && <div className="adm-card"><h3>Recent imports</h3><Table rows={d.imports as Row[]} empty="No imports." /><h3 style={{ marginTop: 18 }}>Recent recommendations</h3><Table rows={d.recommendations as Row[]} empty="No recommendations." /></div>}
            {sec === "actions" && (
              <>
                <Sensitive
                  label="Update Subscription & Plan"
                  onRun={async (reason) => {
                    await call("adminChangePlan", { workspaceId: id, plan, billingStatus, reason });
                    r.reload();
                  }}
                >
                  <h3>Change User Plan & Subscription Status</h3>
                  <p className="muted">Super admins can override user plan tiers (Starter, Growth, Custom) and adjust billing statuses immediately.</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
                    <label>
                      Plan Tier
                      <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                        {Object.keys(plans.data?.plans ?? { starter: 1, growth: 1, custom: 1 }).map((p) => (
                          <option key={p} value={p}>{p.toUpperCase()}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Billing Status
                      <select value={billingStatus} onChange={(e) => setBillingStatus(e.target.value)}>
                        {["active", "trialing", "trial_expired", "past_due", "canceling", "canceled", "restricted", "none"].map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </Sensitive>

                <Sensitive label={summary.suspended ? "Reactivate workspace" : "Suspend workspace"} onRun={async (reason) => { await call("adminSetSuspension", { workspaceId: id, suspended: !summary.suspended, reason }); r.reload(); }}>
                  <h3>{summary.suspended ? "Reactivate" : "Suspend"}</h3>
                  <p className="muted">Suspended workspaces can read, export and disconnect, but cannot add data, import or generate recommendations.</p>
                </Sensitive>
              </>
            )}
          </>
        );
      }}</Async>
    </div>
  );
}

function Workspaces() {
  const [q, setQ] = useState(""); const [applied, setApplied] = useState(""); const [plan, setPlan] = useState(""); const [bill, setBill] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const plans = useCallable<{ plans: Record<string, unknown> }>("adminPlans");
  const r = useCallable<{ items: Row[] }>("adminSearchWorkspaces", { query: applied || undefined, plan: plan || undefined, billingStatus: bill || undefined });
  if (open) return <WorkspaceDetail id={open} back={() => setOpen(null)} />;
  return (
    <div className="adm-card">
      <form className="adm-tools" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
        <label>Owner email or workspace id<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Empty shows the newest" /></label>
        <label>Plan<select value={plan} onChange={(e) => setPlan(e.target.value)} disabled={Boolean(applied)}><option value="">All plans</option>{Object.keys(plans.data?.plans ?? {}).map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Billing<select value={bill} onChange={(e) => setBill(e.target.value)} disabled={Boolean(applied)}><option value="">Any</option>{["active", "trialing", "trial_expired", "past_due", "canceling", "canceled", "restricted", "none"].map((b) => <option key={b}>{b}</option>)}</select></label>
        <button type="submit">Search</button>
        {applied && <button type="button" className="btn-secondary" onClick={() => { setQ(""); setApplied(""); }}>Clear</button>}
      </form>
      <Async r={r}>{(d) => <Table rows={d.items} cols={["name", "ownerEmail", "plan", "billingStatus", "suspended", "country", "createdAt", "id"]} onRow={(row) => setOpen(String(row.id))} />}</Async>
    </div>
  );
}

function RecDetail({ workspaceId, id }: { workspaceId: string; id: string }) {
  const d = useCallable<Row>("adminRecommendationDetail", { workspaceId, id });
  return <div style={{ marginTop: 18 }}><h3>Detail <span className="adm-sub">(viewing is audit-logged)</span></h3><Async r={d}>{(x) => <pre className="adm-json">{JSON.stringify(x, null, 2)}</pre>}</Async></div>;
}

function Recommendations() {
  const [status, setStatus] = useState(""); const [sel, setSel] = useState<Row | null>(null);
  const r = useCallable<{ items: Row[] }>("adminListRecommendations", { status: status || undefined });
  return (
    <div className="adm-card">
      <div className="adm-tools">
        <label>Status<input list="rec-status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All, or type e.g. failed" /></label>
        <datalist id="rec-status"><option value="failed" /><option value="generated" /></datalist>
      </div>
      <Async r={r}>{(x) => <Table rows={x.items} cols={["createdAt", "status", "mode", "category", "engineVersion", "workspaceId", "id"]} onRow={setSel} />}</Async>
      {sel && <RecDetail key={`${sel.workspaceId}/${sel.id}`} workspaceId={String(sel.workspaceId)} id={String(sel.id)} />}
    </div>
  );
}

const simple = (title: string, fn: string, key: string, cols?: string[]) => function Simple() {
  const r = useCallable<Record<string, Row[]>>(fn);
  return <div className="adm-card"><div className="adm-card-head"><h3>{title}</h3><button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button></div><Async r={r}>{(d) => <Table rows={d[key]} cols={cols} />}</Async></div>;
};
const Imports = simple("Imports", "adminListImports", "items");
const Integrations = simple("Integrations", "adminListIntegrations", "items");
const Audit = simple("Audit log", "adminListAudit", "items", ["createdAt", "actorEmail", "actorRole", "action", "target", "reason", "before", "after"]);

function Jobs() {
  const r = useCallable<Record<string, Row[]>>("adminJobs");
  return <Async r={r}>{(d) => <><div className="adm-card"><h3>Overdue weekly reports</h3><Table rows={d.overdueReports} empty="No overdue reports." /></div><div className="adm-card"><h3>Email outbox</h3><Table rows={d.mail} empty="Outbox is empty." /></div><div className="adm-card"><h3>Deletion requests</h3><Table rows={d.deletions} empty="No deletion requests." /></div></>}</Async>;
}
function Billing() {
  const r = useCallable<Record<string, Row[]>>("adminBilling");
  return <Async r={r}>{(d) => <><div className="adm-card"><h3>Needs attention</h3><Table rows={d.workspaces} empty="No billing problems." /></div><div className="adm-card"><h3>Recent provider events</h3><Table rows={d.events} empty="No events." /></div></>}</Async>;
}
function Plans() {
  const r = useCallable<{ plans: Record<string, Row> }>("adminPlans");
  return <Async r={r}>{(d) => <div className="adm-card"><h3>Plans (read-only)</h3><p className="muted" style={{ marginBottom: 12 }}>Plan limits are versioned in code (shared/plans.json) and ship through a reviewed deploy, so the app and website cannot drift.</p><pre className="adm-json">{JSON.stringify(d.plans, null, 2)}</pre></div>}</Async>;
}
function Admins() {
  const [email, setEmail] = useState(""); const [role, setRole] = useState("ops");
  return (
    <Sensitive label="Apply role" onRun={async (reason) => { await call("adminSetRole", { email, role, reason }); }}>
      <h3>Admins</h3>
      <p className="muted">Roles: super_admin (everything), ops, billing, support (read-only). Choose none to remove. The person must have a verified email and sign in again.</p>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <select value={role} onChange={(e) => setRole(e.target.value)}>{["super_admin", "ops", "billing", "support", "none"].map((x) => <option key={x}>{x}</option>)}</select>
    </Sensitive>
  );
}

function Feedback() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sel, setSel] = useState<Row | null>(null);
  const [newStatus, setNewStatus] = useState("in_progress");
  const [internalNote, setInternalNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState("");

  const r = useCallable<{ items: Row[] }>("adminListFeedback", {
    status: status || undefined,
    type: type || undefined,
  });

  async function updateTicket() {
    if (!sel) return;
    setUpdating(true);
    setMsg("");
    try {
      await call("adminUpdateFeedback", {
        ticketId: sel.id,
        status: newStatus,
        internalNote: internalNote.trim() || undefined,
      });
      setMsg("Ticket updated successfully.");
      setInternalNote("");
      r.reload();
    } catch (e) {
      setMsg((e as { message?: string }).message ?? "Update failed.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Customer Feedback & Support (Spec 10.2)</h3>
        <button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button>
      </div>
      <div className="adm-tools">
        <label>
          Filter Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label>
          Filter Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            <option value="bad_recommendation">Bad Recommendation</option>
            <option value="support_request">Support Request</option>
            <option value="product_feedback">Product Feedback</option>
          </select>
        </label>
      </div>
      <Async r={r}>
        {(x) => (
          <Table
            rows={x.items}
            cols={["createdAt", "type", "status", "subject", "userEmail", "workspaceId", "recommendationId"]}
            onRow={(row) => {
              setSel(row);
              setNewStatus(String(row.status ?? "in_progress"));
              setMsg("");
            }}
          />
        )}
      </Async>

      {sel && (
        <div style={{ marginTop: 24, padding: "18px 20px", background: "var(--surface-subtle)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <h4 style={{ margin: "0 0 4px", fontSize: 16 }}>{String(sel.subject)}</h4>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Ticket ID: {String(sel.id)} · User: {String(sel.userEmail ?? "anonymous")} · Workspace: {String(sel.workspaceId)}
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => setSel(null)}>Close</button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)" }}>User Message</span>
            <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap", color: "var(--ink)", background: "var(--surface)", padding: 12, borderRadius: 8 }}>
              {String(sel.message)}
            </p>
          </div>

          {Boolean(sel.recContext) && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--accent)" }}>Attached Recommendation Context</span>
              <pre className="adm-json" style={{ marginTop: 6 }}>{JSON.stringify(sel.recContext, null, 2)}</pre>
            </div>
          )}

          {Array.isArray(sel.internalNotes) && sel.internalNotes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)" }}>Previous Internal Notes</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {(sel.internalNotes as { by: string; note: string; at: string }[]).map((n, i) => (
                  <div key={i} style={{ fontSize: 13, background: "var(--surface)", padding: "8px 12px", borderRadius: 6 }}>
                    <strong>{n.by}</strong> <span className="muted">({new Date(n.at).toLocaleString()}):</span> {n.note}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ margin: 0 }}>
                Set Status:
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ marginLeft: 8 }}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </label>
            </div>
            <label>
              Add Operational / Resolution Note:
              <textarea rows={3} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="Type internal note or resolution response visible to customer..." style={{ width: "100%", marginTop: 4 }} />
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button type="button" onClick={updateTicket} disabled={updating}>
                {updating ? "Saving…" : "Save Ticket Updates"}
              </button>
              {msg && <span style={{ fontSize: 13, color: "var(--accent)" }}>{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AiEngine() {
  const r = useCallable<{ configured: boolean; maskedKey: string; model: string; updatedAt: string | null; updatedBy: string | null }>("adminGetAiConfig");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-3-5-sonnet-20241022");

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>AI Decision Engine Settings (Spec V3)</h3>
        <button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Configure the Anthropic Claude API key and active reasoning model used by the 7Captur decision engine to formulate structured recommendations.
      </p>

      <Async r={r}>
        {(d) => (
          <div>
            <div className="adm-kpis" style={{ marginBottom: 20 }}>
              <Kpi label="Engine Status" value={d.configured ? "Operational" : "Not Configured"} tone={d.configured ? undefined : "bad"} />
              <Kpi label="Active Model" value={d.model} />
              <Kpi label="Claude API Key" value={<code>{d.maskedKey || "None"}</code>} />
            </div>

            {d.updatedAt && (
              <p className="adm-sub" style={{ marginBottom: 20 }}>
                Last updated: {fmt(d.updatedAt)} by {d.updatedBy || "System"}
              </p>
            )}

            <Sensitive
              label="Update Claude AI Configuration"
              onRun={async (reason) => {
                await call("adminSetAiConfig", {
                  apiKey: apiKey.trim(),
                  model: model.trim() || undefined,
                  reason,
                });
                setApiKey("");
                r.reload();
              }}
            >
              <h4 style={{ margin: "0 0 8px" }}>Update Claude API Key</h4>
              <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Enter the secret Claude API key (e.g. <code>sk-ant-usr-...</code>). It will be encrypted and saved in secure backend configuration for the decision engine.
              </p>
              <label>
                Anthropic Claude API Key:
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-usr-..."
                  autoComplete="off"
                />
              </label>
              <label style={{ marginTop: 10 }}>
                Model:
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022 (Recommended Default)</option>
                  <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022 (Fast / Diagnostics)</option>
                  <option value="claude-3-opus-20240229">claude-3-opus-20240229 (High Reasoning)</option>
                </select>
              </label>
            </Sensitive>
          </div>
        )}
      </Async>
    </div>
  );
}

const NAV: { title: string; items: [string, string][] }[] = [
  { title: "Monitor", items: [["overview", "Overview"], ["jobs", "Jobs"]] },
  { title: "Customers", items: [["workspaces", "Workspaces"], ["recs", "Recommendations"], ["imports", "Imports"], ["integrations", "Integrations"], ["billing", "Billing"], ["feedback", "Feedback & Support"]] },
  { title: "System", items: [["ai", "AI Decision Engine"], ["plans", "Plans"], ["audit", "Audit log"], ["admins", "Admins"]] },
];

export default function AdminApp() {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState("overview");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => {
    if (!user) return;
    user.getIdToken(true).then(() => call<{ role: string | null }>("adminWhoAmI")).then((r) => setRole(r.role)).catch(() => setRole(null));
  }, [user]);
  if (loading) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  if (!user) return <AuthPage />;
  if (role === undefined) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  if (!role) return <main className="page"><h1>Not found</h1><p className="muted">This page does not exist.</p></main>;

  const screens: Record<string, () => ReactNode> = {
    overview: () => <Overview go={setTab} />, workspaces: () => <Workspaces />, recs: () => <Recommendations />, imports: () => <Imports />, integrations: () => <Integrations />,
    billing: () => <Billing />, feedback: () => <Feedback />, jobs: () => <Jobs />, ai: () => <AiEngine />, plans: () => <Plans />, audit: () => <Audit />, admins: () => <Admins />,
  };
  const title = NAV.flatMap((g) => g.items).find(([id]) => id === tab)?.[1] ?? "";

  return (
    <div className="adm">
      <aside className="adm-side" aria-label="Admin sections">
        <div className="adm-group" style={{ padding: "0 6px 4px" }}><Logo size={30} subtitle="Admin" /></div>
        {NAV.map((g) => (
          <nav key={g.title} className="adm-group" aria-label={g.title}>
            <div className="adm-group-title">{g.title}</div>
            {g.items.filter(([id]) => (id !== "admins" && id !== "ai") || role === "super_admin").map(([id, name]) => (
              <button key={id} type="button" className="adm-nav" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{name}</button>
            ))}
          </nav>
        ))}
      </aside>
      <main className="adm-main">
        <header className="adm-top">
          <div><h1>{title}</h1><p className="adm-sub">Internal administration. Every action is checked on the server and audit-logged.</p></div>
          <div className="adm-user">
            <ThemeToggle />
            <span>{user.email}</span><Pill value={role} />
            <button type="button" className="btn-secondary" onClick={() => setConfirmSignOut(true)}>Sign out</button>
          </div>
        </header>
        {screens[tab]?.()}
      </main>

      {confirmSignOut && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmSignOut(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
            <h3 style={{ fontSize: 18, marginBottom: 8, color: "var(--ink)" }}>Sign out of Admin?</h3>
            <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>Are you sure you want to end your admin session?</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button type="button" className="btn-secondary" onClick={() => setConfirmSignOut(false)} style={{ flex: 1, margin: 0 }}>Cancel</button>
              <button type="button" onClick={() => { setConfirmSignOut(false); signOut(auth); }} style={{ flex: 1, margin: 0, background: "var(--red, #e2685f)", borderColor: "var(--red, #e2685f)", color: "#fff" }}>Yes, sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
