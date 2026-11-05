import { seed } from "./seed";
const store = new Map<string, any>();
const revive = (v: any): any => {
  if (v && typeof v === "object" && "__ts" in v) return new Timestamp(v.__ts);
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  return v;
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export class Timestamp {
  constructor(public ms: number) {}
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d: Date) { return new Timestamp(d.getTime()); }
}
for (const [p, v] of Object.entries(seed())) store.set(p, revive(v));
export const serverTimestamp = () => Timestamp.now();
export const getFirestore = () => ({});
export const connectFirestoreEmulator = () => undefined;

const join = (...a: unknown[]) => a.filter((x) => typeof x === "string").join("/");
export const collection = (_d: unknown, ...segs: string[]) => ({ kind: "col", path: join(...segs) });
export const doc = (a: any, ...segs: string[]) => (a?.kind === "col" ? { kind: "doc", path: `${a.path}/${segs[0] ?? Math.random().toString(36).slice(2)}` } : { kind: "doc", path: join(...segs) });
export const where = (f: string, op: string, v: unknown) => ({ t: "where", f, op, v });
export const orderBy = (f: string, dir = "asc") => ({ t: "order", f, dir });
export const limit = (n: number) => ({ t: "limit", n });
export const query = (col: any, ...c: any[]) => ({ kind: "query", col, c });

const snapDoc = (path: string) => ({ id: path.split("/").pop()!, ref: { kind: "doc", path }, exists: () => store.has(path), data: () => store.get(path) });
const cmp = (a: any, b: any) => { const x = a?.toMillis ? a.toMillis() : a, y = b?.toMillis ? b.toMillis() : b; return x < y ? -1 : x > y ? 1 : 0; };
function runQuery(q: any) {
  const col = q.kind === "col" ? q : q.col; const cons = q.kind === "col" ? [] : q.c;
  const depth = col.path.split("/").length + 1;
  let paths = [...store.keys()].filter((p) => p.startsWith(col.path + "/") && p.split("/").length === depth);
  for (const c of cons) if (c.t === "where") paths = paths.filter((p) => { const x = store.get(p)?.[c.f]; return c.op === "==" ? x === c.v : c.op === ">=" ? cmp(x, c.v) >= 0 : c.op === "<=" ? cmp(x, c.v) <= 0 : c.op === "in" ? c.v.includes(x) : true; });
  for (const c of [...cons].reverse()) if (c.t === "order") paths.sort((a, b) => (c.dir === "desc" ? -1 : 1) * cmp(store.get(a)?.[c.f], store.get(b)?.[c.f]));
  for (const c of cons) if (c.t === "limit") paths = paths.slice(0, c.n);
  const docs = paths.map(snapDoc);
  return { docs, size: docs.length, empty: !docs.length, forEach: (f: any) => docs.forEach(f) };
}
export const getDoc = async (r: any) => snapDoc(r.path);
export const getDocs = async (q: any) => runQuery(q);
export const setDoc = async (r: any, v: any, o?: any) => { store.set(r.path, o?.merge ? { ...(store.get(r.path) ?? {}), ...v } : v); notify(); };
export const updateDoc = async (r: any, v: any) => { store.set(r.path, { ...(store.get(r.path) ?? {}), ...v }); notify(); };
export const deleteDoc = async (r: any) => { store.delete(r.path); notify(); };
export const onSnapshot = (r: any, cb: (s: any) => void) => {
  const fire = () => cb(r.kind === "doc" ? snapDoc(r.path) : runQuery(r));
  const l = () => fire(); listeners.add(l); setTimeout(fire, 0);
  return () => { listeners.delete(l); };
};
export const Timestamp_ = Timestamp;
export const addDoc = async (c: any, v: any) => { const r = doc(c); store.set(r.path, v); notify(); return r; };
export const deleteField = () => undefined;
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: async () => undefined });
export const runTransaction = async (_d: unknown, f: any) => f({ get: async (r: any) => snapDoc(r.path), set() {}, update() {} });
export const increment = (n: number) => n;
export const arrayUnion = (...a: unknown[]) => a;
export const startAfter = () => ({ t: "noop" });
export const getCountFromServer = async (q: any) => ({ data: () => ({ count: runQuery(q).size }) });
export const documentId = () => "__name__";
export type QueryDocumentSnapshot = any;
export type DocumentData = any;
