import { useEffect, useState, type FormEvent } from "react";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, where,
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
  const refRows = {
    posts: useRows("posts"), promotions: useRows("promotions"), leads: useRows("leads"),
    sales: [] as Row[], costs: [] as Row[],
  };

  useEffect(() => setValues(initial(cfg.fields, ws.currency)), [coll, cfg.fields, ws.currency]);

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
      await addDoc(collection(db, `workspaces/${ws.workspaceId}/${coll}`), {
        ...parsed.data, workspaceId: ws.workspaceId, businessId: ws.businessId,
        createdBy: user!.uid, createdAt: serverTimestamp(), provenance: "manual",
      });
      setValues(initial(cfg.fields, ws.currency));
    } catch { setError("Could not save. You may not have permission."); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <form className="card" onSubmit={submit} noValidate>
        <h2>Add to {cfg.title.toLowerCase()}</h2>
        <p className="muted">Saved as <span className="mono">manual</span>: you entered it, we have not verified it.</p>
        {cfg.fields.map((f) => (
          <div key={f.name}>
            {f.type === "checkbox" ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={Boolean(values[f.name])}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />
                {f.label}
              </label>
            ) : (<>
              <label htmlFor={`${coll}-${f.name}`}>{f.label}{f.required ? " *" : ""}</label>
              {f.type === "select" ? (
                <select id={`${coll}-${f.name}`} value={String(values[f.name])} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  {f.options!.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
              ) : f.type === "ref" ? (
                <select id={`${coll}-${f.name}`} value={String(values[f.name])} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  <option value="">None / not sure</option>
                  {refRows[f.refTo!].map((r) => <option key={r.id} value={r.id}>{PANELS[f.refTo!].summary(r)}</option>)}
                </select>
              ) : (
                <input id={`${coll}-${f.name}`} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  step={f.type === "number" ? "any" : undefined} min={f.type === "number" ? 0 : undefined}
                  value={String(values[f.name])} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              )}
            </>)}
          </div>
        ))}
        <button type="submit" disabled={busy}>Save</button>
        <div role="alert" className="error">{error}</div>
      </form>

      <h3>{cfg.title} ({rows.length})</h3>
      {rows.length === 0 && <p className="muted">Nothing here yet. Add your first entry above.</p>}
      <ul style={{ listStylePosition: "inside", padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ margin: "8px 0" }}>
            {cfg.summary(r)}{" "}
            <button type="button" className="link" onClick={() => deleteDoc(doc(db, `workspaces/${ws.workspaceId}/${coll}/${r.id}`))}>delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
