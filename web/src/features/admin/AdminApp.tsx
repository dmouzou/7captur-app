import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, signOut } from "firebase/auth";
import { reauthWithSocial } from "../../services/authProviders";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../../services/firebase";
import { AuthPage } from "../auth/AuthPage";
import { useAuth } from "../auth/AuthProvider";
import { Logo } from "../../components/Logo";
import { PLAN_IDS } from "../../shared/plans";
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
              <th key={k} scope="col" tabIndex={0} aria-sort={sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                onClick={() => setSort((s) => (s?.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 }))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSort((s) => (s?.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: 1 })); } }}>
                {humanHeader(k)}{sort?.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className={onRow ? "is-click" : ""} tabIndex={onRow ? 0 : undefined} onClick={onRow ? () => onRow(r) : undefined}
                onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
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

function extractError(e: unknown): string {
  if (!e) return "Failed";
  const err = e as { message?: string; details?: unknown; code?: string };
  if (err.message === "internal" || err.code === "functions/internal") {
    return "Internal server error. Deploy functions with invoker: public or check Cloud Logs.";
  }
  return err.message ?? "Failed";
}

/* ---------- loading helpers ---------- */
function useCallable<T>(name: string, data?: unknown) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const key = JSON.stringify(data ?? {});
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    call<T>(name, JSON.parse(key))
      .then((d) => setState({ data: d, loading: false }))
      .catch((e) => setState({ loading: false, error: extractError(e) }));
  }, [name, key]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
function Async<T>({ r, children }: { r: { data?: T; error?: string; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (r.loading && !r.data) return <div role="status" aria-label="Loading"><div className="adm-skel" style={{ width: "40%" }} /><div className="adm-skel" /><div className="adm-skel" style={{ width: "80%" }} /></div>;
  if (r.error) return <div role="alert"><p className="error">{r.error}</p><button type="button" className="btn-secondary" onClick={r.reload}>Try again</button></div>;
  return <>{r.data ? children(r.data) : null}</>;
}

/* ---------- cursor paging: "Load more" appends the next page from the server ---------- */
type PagedState = { rows: Row[]; next: string | null; loading: boolean; loadingMore: boolean; error?: string };
function usePaged(name: string, params: Record<string, unknown>) {
  const key = JSON.stringify(params);
  const [s, setS] = useState<PagedState>({ rows: [], next: null, loading: true, loadingMore: false });
  const load = useCallback((cursor?: string) => {
    setS((x) => (cursor ? { ...x, loadingMore: true, error: undefined } : { rows: [], next: null, loading: true, loadingMore: false }));
    call<{ items: Row[]; next?: string | null }>(name, { ...JSON.parse(key), before: cursor })
      .then((d) => setS((x) => ({ rows: cursor ? [...x.rows, ...d.items] : d.items, next: d.next ?? null, loading: false, loadingMore: false })))
      .catch((e) => setS((x) => ({ ...x, loading: false, loadingMore: false, error: extractError(e) })));
  }, [name, key]);
  useEffect(() => { load(); }, [load]);
  return { ...s, reload: () => load(), more: () => { if (s.next) load(s.next); } };
}
function PagedTable({ r, cols, onRow, empty }: { r: ReturnType<typeof usePaged>; cols?: string[]; onRow?: (row: Row) => void; empty?: string }) {
  if (r.loading) return <div role="status" aria-label="Loading"><div className="adm-skel" style={{ width: "40%" }} /><div className="adm-skel" /><div className="adm-skel" style={{ width: "80%" }} /></div>;
  if (r.error && !r.rows.length) return <div role="alert"><p className="error">{r.error}</p><button type="button" className="btn-secondary" onClick={r.reload}>Try again</button></div>;
  return (
    <>
      <Table rows={r.rows} cols={cols} onRow={onRow} empty={empty} />
      {r.error && <p className="error" role="alert">{r.error}</p>}
      {r.next && <button type="button" className="btn-secondary" style={{ marginTop: 10 }} disabled={r.loadingMore} onClick={r.more}>{r.loadingMore ? "Loading…" : "Load more"}</button>}
    </>
  );
}

/* ---------- re-authentication before sensitive actions (the server also demands a login from the last 5 minutes) ---------- */
async function reauth(password: string) {
  const user = auth.currentUser!;
  if (user.providerData.some((p) => p.providerId === "password")) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, password));
  else await reauthWithSocial(user);
  await user.getIdToken(true);
}

function Sensitive({ label, onRun, children }: { label: string; onRun: (reason: string) => Promise<void>; children?: ReactNode }) {
  const [reason, setReason] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false); const [armed, setArmed] = useState(false);
  const usesPw = auth.currentUser?.providerData.some((p) => p.providerId === "password");
  async function go() {
    if (!armed) { setArmed(true); setMsg(""); return; } // second click confirms
    setBusy(true); setMsg("");
    try { await reauth(pw); await onRun(reason); setMsg("Done."); setPw(""); setReason(""); }
    catch (e) { setMsg((e as { message?: string }).message ?? "Failed"); }
    finally { setBusy(false); setArmed(false); }
  }
  return (
    <div className="adm-card">
      {children}
      <label>Reason (saved in the audit log)<input value={reason} onChange={(e) => { setReason(e.target.value); setArmed(false); }} /></label>
      {usesPw && <label>Your password<input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={go}>{armed ? `Confirm: ${label}` : label}</button>
        {armed && !busy && <button type="button" className="btn-secondary" onClick={() => setArmed(false)}>Cancel</button>}
      </div>
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
function Overview({ go, can }: { go: (tab: string) => void; can: (tab: string) => boolean }) {
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
              <div className="adm-attn">{open.map(([label, v, tab]) => <button key={label} type="button" disabled={!can(tab)} onClick={() => go(tab)}><span>{label}</span><span className="num">{v}</span></button>)}</div>
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

const BILLING_STATUSES = ["active", "trialing", "trial_expired", "past_due", "canceling", "canceled", "restricted", "paused", "none"];

function WorkspaceDetail({ id, back, role }: { id: string; back: () => void; role: string }) {
  const r = useCallable<Row>("adminWorkspaceDetail", { workspaceId: id });
  const [plan, setPlan] = useState<string>(PLAN_IDS[0] ?? "starter");
  const [billingStatus, setBillingStatus] = useState("active");
  const [sec, setSec] = useState("overview");
  const isSuper = role === "super_admin";
  const canSuspend = isSuper || role === "ops";

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
        const override = d.planOverride as Row | null;
        const SECTIONS: [string, string][] = [["overview", "Overview"], ["connections", "Connections"], ["usage", "Usage"], ["activity", "Imports and recommendations"], ["actions", "Actions"]];
        return (
          <>
            <div className="adm-card">
              <div className="adm-card-head">
                <div><h2>{String(summary.name || id)}</h2><p className="adm-sub">{String(summary.ownerEmail ?? "No owner email")} · <span className="num">{id}</span></p>{Boolean(summary.ownerLastSignIn) && <p className="adm-sub">Owner last signed in {fmt(summary.ownerLastSignIn)}</p>}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Pill value={String(summary.plan)} /><Pill value={String(summary.billingStatus)} />{Boolean(summary.suspended) && <Pill value="suspended" />}{override && <Pill value="manual override" />}</div>
              </div>
              <div className="adm-kpis" style={{ marginBottom: 0 }}>{Object.entries(counts).map(([k, v]) => <Kpi key={k} label={humanHeader(k)} value={v} />)}</div>
            </div>
            <div className="adm-tabs" role="tablist">{SECTIONS.map(([k, name]) => <button key={k} type="button" role="tab" className="adm-tab" aria-selected={sec === k} onClick={() => setSec(k)}>{name}</button>)}</div>
            {sec === "overview" && (
              <div className="adm-card">
                {override && (
                  <div className="adm-notice" role="status">
                    Manual override active: {String(override.plan)} / {String(override.billingStatus)}, set by {String(override.byEmail ?? "an admin")} on {fmt(override.at)}. Reason: {String(override.reason)}. Paddle and the billing jobs will not change this workspace until a super admin clears the override.
                  </div>
                )}
                <h3>Subscription & Plan</h3>
                <div className="adm-planbox">
                  <div>Current plan: <strong>{String(summary.plan).toUpperCase()}</strong></div>
                  <div>Billing status: <Pill value={String(summary.billingStatus)} /></div>
                  {isSuper && <button type="button" className="btn-secondary" onClick={() => setSec("actions")} style={{ marginLeft: "auto", margin: 0 }}>Change plan or status</button>}
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
                {isSuper && (
                  <Sensitive
                    label="Set plan and status"
                    onRun={async (reason) => { await call("adminChangePlan", { workspaceId: id, plan, billingStatus, reason }); r.reload(); }}
                  >
                    <h3>Change plan and subscription status</h3>
                    <p className="muted">Super admin only. The change applies immediately and sticks: Paddle and the billing jobs will not overwrite it until you clear the override.</p>
                    <div className="adm-two">
                      <label>Plan
                        <select value={plan} onChange={(e) => setPlan(e.target.value)}>{PLAN_IDS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select>
                      </label>
                      <label>Billing status
                        <select value={billingStatus} onChange={(e) => setBillingStatus(e.target.value)}>{BILLING_STATUSES.map((b) => <option key={b} value={b}>{b.replace(/_/g, " ")}</option>)}</select>
                      </label>
                    </div>
                  </Sensitive>
                )}
                {isSuper && override && (
                  <Sensitive label="Clear override" onRun={async (reason) => { await call("adminClearPlanOverride", { workspaceId: id, reason }); r.reload(); }}>
                    <h3>Clear manual override</h3>
                    <p className="muted">Paddle and the billing jobs manage this workspace again from their next event. The workspace keeps its current plan until then, so set the plan you want first if it should change.</p>
                  </Sensitive>
                )}
                {canSuspend && (
                  <Sensitive label={summary.suspended ? "Reactivate workspace" : "Suspend workspace"} onRun={async (reason) => { await call("adminSetSuspension", { workspaceId: id, suspended: !summary.suspended, reason }); r.reload(); }}>
                    <h3>{summary.suspended ? "Reactivate" : "Suspend"}</h3>
                    <p className="muted">Suspended workspaces can read, export and disconnect, but cannot add data, import or generate recommendations.</p>
                  </Sensitive>
                )}
                {!isSuper && !canSuspend && <div className="adm-card"><p className="muted">Your role has no actions on a workspace.</p></div>}
              </>
            )}
          </>
        );
      }}</Async>
    </div>
  );
}

function Workspaces({ role }: { role: string }) {
  const [q, setQ] = useState(""); const [applied, setApplied] = useState(""); const [plan, setPlan] = useState(""); const [bill, setBill] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const r = usePaged("adminSearchWorkspaces", { query: applied || undefined, plan: plan || undefined, billingStatus: bill || undefined });
  if (open) return <WorkspaceDetail id={open} back={() => setOpen(null)} role={role} />;
  return (
    <div className="adm-card">
      <form className="adm-tools" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
        <label>Owner email or workspace id<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Empty shows the newest" /></label>
        <label>Plan<select value={plan} onChange={(e) => setPlan(e.target.value)} disabled={Boolean(applied)}><option value="">All plans</option>{PLAN_IDS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Billing<select value={bill} onChange={(e) => setBill(e.target.value)} disabled={Boolean(applied)}><option value="">Any</option>{BILLING_STATUSES.map((b) => <option key={b}>{b}</option>)}</select></label>
        <button type="submit">Search</button>
        {applied && <button type="button" className="btn-secondary" onClick={() => { setQ(""); setApplied(""); }}>Clear</button>}
      </form>
      <PagedTable r={r} cols={["name", "ownerEmail", "plan", "billingStatus", "suspended", "country", "ownerLastSignIn", "createdAt", "id"]} onRow={(row) => setOpen(String(row.id))} empty="No workspaces match." />
    </div>
  );
}

function RecDetail({ workspaceId, id }: { workspaceId: string; id: string }) {
  const d = useCallable<Row>("adminRecommendationDetail", { workspaceId, id });
  return <div style={{ marginTop: 18 }}><h3>Detail <span className="adm-sub">(viewing is audit-logged)</span></h3><Async r={d}>{(x) => <pre className="adm-json">{JSON.stringify(x, null, 2)}</pre>}</Async></div>;
}

function Recommendations() {
  const [status, setStatus] = useState(""); const [sel, setSel] = useState<Row | null>(null);
  const r = usePaged("adminListRecommendations", { status: status || undefined });
  return (
    <div className="adm-card">
      <div className="adm-tools">
        <label>Status<input list="rec-status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All, or type e.g. failed" /></label>
        <datalist id="rec-status"><option value="failed" /><option value="generated" /></datalist>
      </div>
      <PagedTable r={r} cols={["createdAt", "status", "mode", "category", "engineVersion", "workspaceId", "id"]} onRow={setSel} empty="No recommendations." />
      {sel && <RecDetail key={`${sel.workspaceId}/${sel.id}`} workspaceId={String(sel.workspaceId)} id={String(sel.id)} />}
    </div>
  );
}

function Imports() {
  const [status, setStatus] = useState("");
  const r = usePaged("adminListImports", { status: status || undefined });
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Imports</h3><button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button></div>
      <div className="adm-tools">
        <label>Status<input list="imp-status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All, or type e.g. failed" /></label>
        <datalist id="imp-status"><option value="failed" /><option value="partial" /><option value="complete" /></datalist>
      </div>
      <PagedTable r={r} empty="No imports." />
    </div>
  );
}

function Integrations() {
  const [status, setStatus] = useState("");
  const r = useCallable<{ items: Row[] }>("adminListIntegrations", { status: status || undefined });
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Integrations</h3><button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button></div>
      <div className="adm-tools">
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All (problems first)</option>{["needs_reconnect", "pending_account", "connected", "disconnected"].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select></label>
      </div>
      <Async r={r}>{(d) => <Table rows={d.items} empty="No connections." />}</Async>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState(""); const [applied, setApplied] = useState("");
  const r = usePaged("adminListAudit", { action: applied || undefined });
  return (
    <div className="adm-card">
      <div className="adm-card-head"><h3>Audit log</h3><button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button></div>
      <form className="adm-tools" onSubmit={(e) => { e.preventDefault(); setApplied(action.trim()); }}>
        <label>Action<input list="audit-actions" value={action} onChange={(e) => setAction(e.target.value)} placeholder="All, or e.g. change_plan" /></label>
        <datalist id="audit-actions">{["change_plan", "clear_plan_override", "suspend_workspace", "reactivate_workspace", "set_admin_role", "set_admin_role_failed", "update_ai_config", "update_feedback", "view_workspace", "view_feedback", "view_recommendation"].map((a) => <option key={a} value={a} />)}</datalist>
        <button type="submit">Filter</button>
        {applied && <button type="button" className="btn-secondary" onClick={() => { setAction(""); setApplied(""); }}>Clear</button>}
      </form>
      <PagedTable r={r} cols={["createdAt", "actorEmail", "actorRole", "action", "target", "reason", "before", "after"]} empty="No audit entries." />
    </div>
  );
}

function Jobs() {
  const r = useCallable<Record<string, Row[]>>("adminJobs");
  return <Async r={r}>{(d) => <>
    <div className="adm-card"><h3>Failed emails</h3><Table rows={d.failedMail} empty="No failed emails." /></div>
    <div className="adm-card"><h3>Overdue weekly reports</h3><Table rows={d.overdueReports} empty="No overdue reports." /></div>
    <div className="adm-card"><h3>Recent emails</h3><Table rows={d.mail} empty="Outbox is empty." /></div>
    <div className="adm-card"><h3>Deletion requests</h3><Table rows={d.deletions} empty="No deletion requests." /></div>
  </>}</Async>;
}
function Billing() {
  const r = useCallable<Record<string, Row[]>>("adminBilling");
  return <Async r={r}>{(d) => <>
    <div className="adm-card"><h3>Needs attention</h3><Table rows={d.workspaces} empty="No billing problems." /></div>
    <div className="adm-card"><h3>Manual plan overrides</h3><p className="muted" style={{ marginBottom: 12 }}>These workspaces ignore Paddle until a super admin clears the override.</p><Table rows={d.overrides} empty="No manual overrides." /></div>
    <div className="adm-card"><h3>Recent provider events</h3><Table rows={d.events} empty="No events." /></div>
  </>}</Async>;
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
      <p className="muted">Roles: super_admin (everything, including plan changes), ops, billing, support. Choose none to remove. The person must have a verified email and sign in again. You cannot change your own role.</p>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <select value={role} onChange={(e) => setRole(e.target.value)}>{["super_admin", "ops", "billing", "support", "none"].map((x) => <option key={x}>{x}</option>)}</select>
    </Sensitive>
  );
}

type AnalyticsData = {
  signups: { weekEnding: string; count: number }[];
  recsPerDay: { day: string; total: number; failed: number }[];
  plans: { byPlan: Record<string, number>; total: number; paidActive: number; trialing: number; canceling: number; canceled: number; pastDue: number; paidShare: number };
  timeToFirstRecommendation: { sample: number; withRecommendation: number; medianMinutes: number | null };
  costPerRecommendation: { tracked: boolean; note: string };
};
function minutesLabel(m: number | null) {
  if (m === null) return "No data";
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}
function Analytics() {
  const r = useCallable<AnalyticsData>("adminAnalytics");
  return <Async r={r}>{(d) => {
    const t = d.timeToFirstRecommendation;
    const maxSignup = Math.max(1, ...d.signups.map((s) => s.count));
    return (
      <>
        <div className="adm-kpis">
          <Kpi label="Paid and active" value={d.plans.paidActive} hint={`${d.plans.paidShare}% of ${d.plans.total} workspaces`} />
          <Kpi label="In trial" value={d.plans.trialing} />
          <Kpi label="Canceling" value={d.plans.canceling} tone={d.plans.canceling > 0 ? "warn" : undefined} />
          <Kpi label="Canceled" value={d.plans.canceled} />
          <Kpi label="Past due" value={d.plans.pastDue} tone={d.plans.pastDue > 0 ? "bad" : undefined} />
          <Kpi label="Median time to first recommendation" value={minutesLabel(t.medianMinutes)} hint={`${t.withRecommendation} of newest ${t.sample} got one`} />
          <Kpi label="Cost per recommendation" value="Not tracked" hint={d.costPerRecommendation.note} />
        </div>
        <div className="adm-grid">
          <div className="adm-card">
            <h3>Signups per week</h3>
            {d.signups.map((s) => (
              <div key={s.weekEnding}><div className="adm-legend-row"><span>Week ending {s.weekEnding}</span><span className="num">{s.count}</span></div><div className="adm-meter"><span style={{ width: `${pct(s.count, maxSignup)}%` }} /></div></div>
            ))}
          </div>
          <div className="adm-card">
            <h3>Recommendations per day (14 days)</h3>
            <Table search={false} rows={d.recsPerDay.map((x) => ({ day: x.day, total: x.total, failed: x.failed, failedPercent: pct(x.failed, x.total) }))} />
          </div>
        </div>
      </>
    );
  }}</Async>;
}

function Feedback() {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sel, setSel] = useState<Row | null>(null);
  const [newStatus, setNewStatus] = useState("in_progress");
  const [internalNote, setInternalNote] = useState("");
  const [customerReply, setCustomerReply] = useState("");
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState("");

  const r = usePaged("adminListFeedback", { status: status || undefined, type: type || undefined });

  async function openTicket(row: Row) {
    setMsg("");
    try {
      const d = await call<{ ticket: Row }>("adminFeedbackDetail", { ticketId: row.id });
      setSel(d.ticket); setNewStatus(String(d.ticket.status ?? "in_progress")); setInternalNote(""); setCustomerReply("");
    } catch (e) { setMsg((e as { message?: string }).message ?? "Could not open the ticket."); }
  }

  async function updateTicket() {
    if (!sel) return;
    setUpdating(true); setMsg("");
    try {
      await call("adminUpdateFeedback", { ticketId: sel.id, status: newStatus, internalNote: internalNote.trim() || undefined, customerReply: customerReply.trim() || undefined });
      setMsg("Ticket updated.");
      const d = await call<{ ticket: Row }>("adminFeedbackDetail", { ticketId: sel.id });
      setSel(d.ticket); setInternalNote(""); setCustomerReply("");
      r.reload();
    } catch (e) { setMsg((e as { message?: string }).message ?? "Update failed."); }
    finally { setUpdating(false); }
  }

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>Customer feedback and support</h3>
        <button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button>
      </div>
      <div className="adm-tools">
        <label>Filter status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label>Filter type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option><option value="bad_recommendation">Bad recommendation</option><option value="support_request">Support request</option><option value="product_feedback">Product feedback</option>
          </select>
        </label>
      </div>
      <PagedTable r={r} cols={["createdAt", "type", "status", "subject", "workspaceId", "recommendationId"]} onRow={openTicket} empty="No tickets." />
      {msg && !sel && <p className="error" role="alert">{msg}</p>}

      {sel && (
        <div className="adm-ticket">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <h4 style={{ margin: "0 0 4px", fontSize: 16 }}>{String(sel.subject)}</h4>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ticket {String(sel.id)} · User: {String(sel.userEmail ?? "none given")} · Workspace: {String(sel.workspaceId)}</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>Opening a ticket is audit-logged.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => setSel(null)}>Close</button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <span className="adm-label">Customer message</span>
            <p className="adm-msg">{String(sel.message)}</p>
          </div>

          {Boolean(sel.customerReply) && (
            <div style={{ marginBottom: 16 }}>
              <span className="adm-label">Last reply sent to the customer</span>
              <p className="adm-msg">{String((sel.customerReply as { text?: string }).text ?? "")}</p>
            </div>
          )}

          {Boolean(sel.recContext) && (
            <div style={{ marginBottom: 16 }}>
              <span className="adm-label">Attached recommendation context</span>
              <pre className="adm-json" style={{ marginTop: 6 }}>{JSON.stringify(sel.recContext, null, 2)}</pre>
            </div>
          )}

          {Array.isArray(sel.internalNotes) && sel.internalNotes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <span className="adm-label">Internal notes (admins only)</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {(sel.internalNotes as { by: string; note: string; at: string }[]).map((n, i) => (
                  <div key={i} className="adm-msg"><strong>{n.by}</strong> <span className="muted">({new Date(n.at).toLocaleString()}):</span> {n.note}</div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <label>Status
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
              </select>
            </label>
            <label>Internal note (admins only, never shown to the customer)
              <textarea rows={3} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label>Reply to the customer (they can see this)
              <textarea rows={3} value={customerReply} onChange={(e) => setCustomerReply(e.target.value)} placeholder="Leave empty to send no reply" style={{ width: "100%", marginTop: 4 }} />
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button type="button" onClick={updateTicket} disabled={updating}>{updating ? "Saving…" : "Save ticket"}</button>
              {msg && <span role="status" style={{ fontSize: 13, color: "var(--accent)" }}>{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const AI_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
function AiEngine() {
  const r = useCallable<{ configured: boolean; maskedKey: string; model: string; updatedAt: string | null; updatedBy: string | null }>("adminGetAiConfig");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string | undefined>(undefined);

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <h3>AI decision engine settings</h3>
        <button type="button" className="btn-secondary" onClick={r.reload}>Refresh</button>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        The Anthropic API key and model used by the 7Captur decision engine. The key is stored in the app configuration for now. Moving it to Secret Manager is planned.
      </p>

      <Async r={r}>
        {(d) => {
          const current = model ?? d.model;
          const options = AI_MODELS.includes(d.model) ? AI_MODELS : [d.model, ...AI_MODELS];
          return (
            <div>
              <div className="adm-kpis" style={{ marginBottom: 20 }}>
                <Kpi label="Engine status" value={d.configured ? "Configured" : "Not configured"} tone={d.configured ? undefined : "bad"} />
                <Kpi label="Active model" value={d.model} />
                <Kpi label="API key" value={<code>{d.maskedKey || "None"}</code>} />
              </div>

              {d.updatedAt && <p className="adm-sub" style={{ marginBottom: 20 }}>Last updated: {fmt(d.updatedAt)} by {d.updatedBy || "System"}</p>}

              <Sensitive
                label="Update AI configuration"
                onRun={async (reason) => {
                  await call("adminSetAiConfig", { apiKey: apiKey.trim(), model: current.trim() || undefined, reason });
                  setApiKey(""); setModel(undefined);
                  r.reload();
                }}
              >
                <h4 style={{ margin: "0 0 8px" }}>Update API key and model</h4>
                <label>
                  Anthropic API key
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
                </label>
                <label style={{ marginTop: 10 }}>
                  Model
                  <select value={current} onChange={(e) => setModel(e.target.value)}>
                    {options.map((m) => <option key={m} value={m}>{m}{m === d.model ? " (current)" : ""}</option>)}
                  </select>
                </label>
              </Sensitive>
            </div>
          );
        }}
      </Async>
    </div>
  );
}

/** UX only: which tabs each role sees. The server checks the real permission on every call. */
const TAB_ROLES: Record<string, string[]> = {
  overview: ["super_admin", "ops", "billing"], analytics: ["super_admin", "ops", "billing"], jobs: ["super_admin", "ops"],
  workspaces: ["super_admin", "ops", "billing", "support"], recs: ["super_admin", "ops", "support"], imports: ["super_admin", "ops", "support"],
  integrations: ["super_admin", "ops", "support"], billing: ["super_admin", "billing"], feedback: ["super_admin", "ops", "support"],
  ai: ["super_admin"], plans: ["super_admin", "ops", "billing"], audit: ["super_admin"], admins: ["super_admin"],
};
const NAV: { title: string; items: [string, string][] }[] = [
  { title: "Monitor", items: [["overview", "Overview"], ["analytics", "Analytics"], ["jobs", "Jobs"]] },
  { title: "Customers", items: [["workspaces", "Workspaces"], ["recs", "Recommendations"], ["imports", "Imports"], ["integrations", "Integrations"], ["billing", "Billing"], ["feedback", "Feedback & Support"]] },
  { title: "System", items: [["ai", "AI Decision Engine"], ["plans", "Plans"], ["audit", "Audit log"], ["admins", "Admins"]] },
];

type Me = { role: string | null; mfaEnforced: boolean | null; secondFactor: boolean | null };

export default function AdminApp() {
  const { user, loading } = useAuth();
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [tabState, setTab] = useState("overview");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => {
    if (!user) return;
    user.getIdToken(true).then(() => call<Me>("adminWhoAmI")).then(setMe).catch(() => setMe({ role: null, mfaEnforced: null, secondFactor: null }));
  }, [user]);
  if (loading) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  if (!user) return <AuthPage />;
  if (me === undefined) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  const role = me.role;
  if (!role) return <main className="page"><h1>Not found</h1><p className="muted">This page does not exist.</p></main>;

  const can = (id: string) => (TAB_ROLES[id] ?? []).includes(role);
  const visible = NAV.map((g) => ({ ...g, items: g.items.filter(([id]) => can(id)) })).filter((g) => g.items.length > 0);
  const firstTab = visible[0]?.items[0]?.[0] ?? "workspaces";
  const tab = can(tabState) ? tabState : firstTab;

  const screens: Record<string, () => ReactNode> = {
    overview: () => <Overview go={setTab} can={can} />, analytics: () => <Analytics />, workspaces: () => <Workspaces role={role} />, recs: () => <Recommendations />, imports: () => <Imports />, integrations: () => <Integrations />,
    billing: () => <Billing />, feedback: () => <Feedback />, jobs: () => <Jobs />, ai: () => <AiEngine />, plans: () => <Plans />, audit: () => <Audit />, admins: () => <Admins />,
  };
  const title = NAV.flatMap((g) => g.items).find(([id]) => id === tab)?.[1] ?? "";

  return (
    <div className="adm">
      <aside className="adm-side" aria-label="Admin sections">
        <div className="adm-group" style={{ padding: "0 6px 4px" }}><Logo size={30} subtitle="Admin" /></div>
        {visible.map((g) => (
          <nav key={g.title} className="adm-group" aria-label={g.title}>
            <div className="adm-group-title">{g.title}</div>
            {g.items.map(([id, name]) => (
              <button key={id} type="button" className="adm-nav" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{name}</button>
            ))}
          </nav>
        ))}
      </aside>
      <main className="adm-main">
        {me.mfaEnforced === false && (
          <div className="adm-banner" role="alert">
            Admin MFA is not enforced. Anyone who gets an admin password can act as that admin. Enroll a second factor for every admin, then set ADMIN_REQUIRE_MFA=true on the functions.
          </div>
        )}
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
