import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { recordSchemas, type RecordCollection } from "../../shared/records";
import { PANELS, type Field } from "./config";
import { Icon } from "../../components/Icon";
import { AddArt, EmptyArt } from "../../components/art";

const HINT: Record<RecordCollection, string> = {
  leads: "Every message, call or form from someone interested. Log them even when they do not buy.",
  sales: "Every sale, with the date and amount. Link it to a post or promotion when you know which one brought it in.",
  costs: "What you spent on ads, tools, stock or time. Costs you leave out are treated as unknown, never as zero.",
  posts: "What you published and how it did. Reach, likes and saves help show what your audience responds to.",
  promotions: "Paid boosts and ad campaigns, with dates and spend. This is what lets 7Captur compare paid and unpaid results.",
};
const SOURCE_LABEL: Record<string, string> = { manual: "Entered by you", imported: "Imported", connected: "Connected" };

type Row = Record<string, unknown> & { id: string };

export const COMMERCIAL_TABS: { id: RecordCollection; label: string; icon: string }[] = [
  { id: "leads", label: "Enquiries & Leads", icon: "users" },
  { id: "sales", label: "Sales & Revenue", icon: "money" },
  { id: "costs", label: "Costs & Spend", icon: "card" },
  { id: "posts", label: "Marketing Posts", icon: "chat" },
  { id: "promotions", label: "Promotions & Ads", icon: "megaphone" },
];

function useRows(coll: RecordCollection) {
  const { workspaceId, businessId } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!workspaceId) return;
    const colRef = collection(db, `workspaces/${workspaceId}/${coll}`);
    let active = true;
    let fallbackUnsub: (() => void) | null = null;

    const qWithOrder = businessId
      ? query(colRef, where("businessId", "==", businessId), orderBy("createdAt", "desc"))
      : query(colRef, orderBy("createdAt", "desc"));

    const primaryUnsub = onSnapshot(
      qWithOrder,
      (s) => {
        if (!active) return;
        setRows(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn(`Query on ${coll} failed, falling back to local ordering:`, err);
        const qFallback = businessId ? query(colRef, where("businessId", "==", businessId)) : colRef;
        fallbackUnsub = onSnapshot(
          qFallback,
          (s) => {
            if (!active) return;
            const list: Row[] = s.docs.map((d) => ({ id: d.id, ...d.data() }));
            list.sort((a, b) => {
              const timeA = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() || (typeof a.date === "string" ? new Date(a.date).getTime() : 0);
              const timeB = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() || (typeof b.date === "string" ? new Date(b.date).getTime() : 0);
              return timeB - timeA;
            });
            setRows(list);
          },
          (fErr) => {
            console.error(`Fallback query on ${coll} also failed:`, fErr);
            if (active) setRows([]);
          }
        );
      }
    );

    return () => {
      active = false;
      primaryUnsub();
      if (fallbackUnsub) fallbackUnsub();
    };
  }, [workspaceId, businessId, coll]);
  return rows;
}

function initial(fields: Field[], currency: string) {
  const v: Record<string, string | boolean> = {};
  for (const f of fields) v[f.name] = f.defaultValue ?? (f.type === "checkbox" ? false : f.name === "currency" ? currency : "");
  return v;
}

export function RecordsPanel({
  coll,
  onSelectColl,
  counts,
}: {
  coll: RecordCollection;
  onSelectColl?: (coll: RecordCollection) => void;
  counts?: Partial<Record<RecordCollection, number | null>>;
}) {
  const { user } = useAuth();
  const ws = useWorkspace();
  const cfg = PANELS[coll];
  const rows = useRows(coll);
  const [values, setValues] = useState(() => initial(cfg.fields, ws.currency));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const refRows = {
    posts: useRows("posts"), promotions: useRows("promotions"), leads: useRows("leads"),
    sales: [] as Row[], costs: [] as Row[],
  };

  useEffect(() => {
    setValues(initial(cfg.fields, ws.currency));
    setEditingId(null);
    setShowForm(false);
    setSearch("");
  }, [coll, cfg.fields, ws.currency]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const sum = cfg.summary(r).toLowerCase();
      if (sum.includes(q)) return true;
      const prov = String(r.provenance ?? "").toLowerCase();
      if (prov.includes(q)) return true;
      for (const v of Object.values(r)) {
        if (v === null || v === undefined) continue;
        if (String(v).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [rows, search, cfg]);

  function startEdit(r: Row) {
    const v: Record<string, string | boolean> = {};
    for (const f of cfg.fields) v[f.name] = f.type === "checkbox" ? Boolean(r[f.name]) : r[f.name] === undefined || r[f.name] === null ? "" : String(r[f.name]);
    setValues(v); setEditingId(r.id); setShowForm(true); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const raw: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      const v = values[f.name];
      if (f.type === "checkbox") raw[f.name] = Boolean(v);
      else if (v === "" || v === undefined) continue;
      else raw[f.name] = f.type === "number" ? Number(v) : v;
    }
    const parsed = recordSchemas[coll].safeParse(raw);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      setError(`${i.path.join(".") || "Form"}: ${i.message}`);
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        // Provenance stays as originally recorded; the edit is tracked with updatedAt.
        const cleared = Object.fromEntries(cfg.fields.filter((f) => !(f.name in parsed.data)).map((f) => [f.name, deleteField()]));
        await updateDoc(doc(db, `workspaces/${ws.workspaceId}/${coll}/${editingId}`), { ...cleared, ...parsed.data, updatedAt: serverTimestamp() });
        setEditingId(null); setValues(initial(cfg.fields, ws.currency)); setShowForm(false);
        return;
      }
      await addDoc(collection(db, `workspaces/${ws.workspaceId}/${coll}`), {
        ...parsed.data, workspaceId: ws.workspaceId, businessId: ws.businessId,
        createdBy: user!.uid, createdAt: serverTimestamp(), provenance: "manual",
      });
      setValues(initial(cfg.fields, ws.currency));
      setShowForm(false);
    } catch { setError("Could not save. You may not have permission."); }
    finally { setBusy(false); }
  }

  return (
    <section>
      {/* Hero */}
      <div className="card" style={{ marginBottom: 16, padding: "24px 28px", background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ maxWidth: 580 }}>
            <span className="badge badge-primary">Add</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 0 8px" }}>
              <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 500 }}>{cfg.title}</h1>
              <span className="badge">{rows.length} {rows.length === 1 ? "record" : "records"}</span>
            </div>
            <p className="muted" style={{ margin: "0 0 16px", fontSize: 14.5, lineHeight: 1.55 }}>{HINT[coll]}</p>
            <button
              type="button"
              onClick={() => {
                setShowForm((s) => !s);
                if (editingId) { setEditingId(null); setValues(initial(cfg.fields, ws.currency)); }
              }}
              className={showForm || editingId ? "btn-secondary" : ""}
              style={{ borderRadius: 10, padding: "10px 18px", fontSize: 14 }}
            >
              {editingId ? "Cancel editing" : showForm ? "Close form" : `+ New ${cfg.title.replace(/s$/, "").toLowerCase()}`}
            </button>
          </div>
          <AddArt size={170} />
        </div>
      </div>

      {/* Record type pills */}
      <div role="tablist" aria-label="Record type" style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", paddingBottom: 2 }}>
        {COMMERCIAL_TABS.map((t) => {
          const isActive = coll === t.id;
          const countVal = counts?.[t.id] ?? (t.id === coll ? rows.length : null);
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? "" : "btn-secondary"}
              onClick={() => onSelectColl?.(t.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", fontSize: 13.5, borderRadius: 99, margin: 0, whiteSpace: "nowrap", border: isActive ? "1px solid transparent" : "1px solid var(--border)" }}
            >
              <Icon name={t.icon as never} size={15} />
              <span>{t.label}</span>
              {countVal !== null && countVal !== undefined && (
                <span className={`badge ${isActive ? "badge-pop" : ""}`} style={{ padding: "1px 7px", fontSize: 11, minWidth: 18, textAlign: "center" }}>{countVal}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Form Container (When Open or Editing) */}
      {(showForm || editingId) && (
        <form
          className="card"
          onSubmit={submit}
          noValidate
          style={{
            marginBottom: 28,
            border: "1px solid var(--accent-line)",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {editingId ? "Edit entry" : `New ${cfg.title.replace(/s$/, "").toLowerCase()}`}
            </h3>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {editingId ? "Changes keep the original source label." : <>Source: <span className="badge">Entered by you</span></>}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {cfg.fields.map((f) => (
              <div key={f.name}>
                {f.type === "checkbox" ? (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 24 }}>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={Boolean(values[f.name])}
                      onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
                    />
                    {f.label}
                  </label>
                ) : (
                  <>
                    <label htmlFor={`${coll}-${f.name}`} style={{ marginTop: 0 }}>
                      {f.label}{f.required ? " *" : ""}
                    </label>
                    {f.type === "select" ? (
                      <select
                        id={`${coll}-${f.name}`}
                        value={String(values[f.name])}
                        onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                      >
                        {f.options!.map((o) => (
                          <option key={o} value={o}>
                            {o.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "ref" ? (
                      <select
                        id={`${coll}-${f.name}`}
                        value={String(values[f.name])}
                        onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                      >
                        <option value="">None / not sure</option>
                        {refRows[f.refTo!].map((r) => (
                          <option key={r.id} value={r.id}>
                            {PANELS[f.refTo!].summary(r)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`${coll}-${f.name}`}
                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                        step={f.type === "number" ? "any" : undefined}
                        min={f.type === "number" ? 0 : undefined}
                        value={String(values[f.name])}
                        onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 22,
              paddingTop: 16,
              borderTop: "1px solid var(--border)",
              alignItems: "center",
            }}
          >
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Save record"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditingId(null);
                setValues(initial(cfg.fields, ws.currency));
                setShowForm(false);
              }}
            >
              Cancel
            </button>
          </div>
          {error && <div role="alert" className="error">{error}</div>}
        </form>
      )}

      {/* Polished Data Table Card */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            background: "var(--surface-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 240, maxWidth: 440 }}>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type="search"
                placeholder={`Search ${cfg.title.toLowerCase()} by date, channel, amount or notes`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: "8px 30px 8px 12px",
                  fontSize: 13,
                  borderRadius: 8,
                  width: "100%",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--muted)",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {search.trim() ? (
                <>Showing {filteredRows.length} of {rows.length} {rows.length === 1 ? "record" : "records"}</>
              ) : (
                <>Showing {rows.length} {rows.length === 1 ? "record" : "records"}</>
              )}
            </span>
            {search.trim() && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSearch("")}
                style={{ padding: "4px 10px", fontSize: 12, margin: 0, borderRadius: 6 }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <EmptyArt kind="data" size={150} />
            <h4 style={{ margin: "8px 0 6px 0", fontWeight: 500 }}>No {cfg.title.toLowerCase()} yet</h4>
            <p className="muted" style={{ margin: 0, fontSize: 13.5, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
              Add your first one with the button above, or bring many in at once by importing a CSV file.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div className="empty-icon"><Icon name="search" size={32} /></div>
            <h4 style={{ margin: "0 0 6px 0" }}>No matching records</h4>
            <p className="muted" style={{ margin: "0 0 16px 0", fontSize: 13.5 }}>
              No {cfg.title.toLowerCase()} matched your search for "{search}".
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSearch("")}
              style={{ margin: "0 auto", fontSize: 13 }}
            >
              Clear search
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "12px 20px", fontWeight: 500, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Details
                  </th>
                  <th style={{ padding: "12px 16px", fontWeight: 500, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", width: 140 }}>
                    Source
                  </th>
                  <th style={{ padding: "12px 20px", fontWeight: 500, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", width: 140, textAlign: "right" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const prov = String(r.provenance ?? "manual");
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.15s" }}>
                      <td style={{ padding: "14px 20px", color: "var(--ink)", fontWeight: 500 }}>
                        {cfg.summary(r)}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          className={`badge ${
                            prov === "connected"
                              ? "badge-primary"
                              : prov === "imported"
                              ? "badge-pop"
                              : ""
                          }`}
                          style={{ fontSize: 11.5 }}
                        >
                          {SOURCE_LABEL[prov] ?? prov.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ padding: "14px 20px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 8 }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: "5px 12px", fontSize: 12, borderRadius: 6 }}
                            onClick={() => startEdit(r)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, color: "var(--danger)" }}
                            onClick={() => {
                              if (confirm("Delete this record?")) {
                                deleteDoc(doc(db, `workspaces/${ws.workspaceId}/${coll}/${r.id}`));
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
