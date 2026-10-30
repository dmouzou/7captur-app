import { useEffect, useState, type FormEvent } from "react";
import {
  addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { recordSchemas, type RecordCollection } from "../../shared/records";
import { PANELS, type Field } from "./config";

type Row = Record<string, unknown> & { id: string };

function useRows(coll: RecordCollection) {
  const { workspaceId, businessId } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => onSnapshot(
    query(collection(db, `workspaces/${workspaceId}/${coll}`), where("businessId", "==", businessId), orderBy("createdAt", "desc")),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
  ), [workspaceId, businessId, coll]);
  return rows;
}

function initial(fields: Field[], currency: string) {
  const v: Record<string, string | boolean> = {};
  for (const f of fields) v[f.name] = f.defaultValue ?? (f.type === "checkbox" ? false : f.name === "currency" ? currency : "");
  return v;
}

export function RecordsPanel({ coll }: { coll: RecordCollection }) {
  const { user } = useAuth();
  const ws = useWorkspace();
  const cfg = PANELS[coll];
  const rows = useRows(coll);
  const [values, setValues] = useState(() => initial(cfg.fields, ws.currency));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const refRows = {
    posts: useRows("posts"), promotions: useRows("promotions"), leads: useRows("leads"),
    sales: [] as Row[], costs: [] as Row[],
  };

  useEffect(() => { setValues(initial(cfg.fields, ws.currency)); setEditingId(null); setShowForm(false); }, [coll, cfg.fields, ws.currency]);

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
      {/* Panel Top Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: "1.65rem" }}>{cfg.title}</h1>
            <span className="badge badge-primary">
              {rows.length} {rows.length === 1 ? "record" : "records"}
            </span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Track and manage business records to power weekly AI attribution and recommendations.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => {
              setShowForm((s) => !s);
              if (editingId) {
                setEditingId(null);
                setValues(initial(cfg.fields, ws.currency));
              }
            }}
            style={{
              borderRadius: 10,
              padding: "10px 18px",
              fontSize: 14,
              background: showForm || editingId ? "var(--surface-hover)" : "var(--accent-fill)",
              color: showForm || editingId ? "var(--ink)" : "var(--on-accent)",
              border: showForm || editingId ? "1px solid var(--border)" : "none",
            }}
          >
            {editingId ? "Cancel Editing" : showForm ? "Close Form" : `+ New ${cfg.title.replace(/s$/, "")}`}
          </button>
        </div>
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
              {editingId ? "Edit Entry" : `Record New ${cfg.title.replace(/s$/, "")}`}
            </h3>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {editingId ? "Changes keep the original source label." : <>Saved as <span className="badge mono">manual</span></>}
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
              {busy ? "Saving…" : editingId ? "Save Changes" : "Save Record"}
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
            background: "var(--surface-subtle)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>Recorded History</span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Displaying {rows.length} {rows.length === 1 ? "record" : "records"}
          </span>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
            <h4 style={{ margin: "0 0 6px 0" }}>No records yet</h4>
            <p className="muted" style={{ margin: 0, fontSize: 13.5, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
              Add your first {cfg.title.toLowerCase()} entry using the button above or import them in bulk via CSV.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "12px 20px", fontWeight: 600, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Summary / Details
                  </th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", width: 140 }}>
                    Source
                  </th>
                  <th style={{ padding: "12px 20px", fontWeight: 600, color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", width: 140, textAlign: "right" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
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
                              : prov === "screenshot_extracted"
                              ? "badge-warning"
                              : ""
                          }`}
                          style={{ fontSize: 11.5 }}
                        >
                          {prov.replace(/_/g, " ")}
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
