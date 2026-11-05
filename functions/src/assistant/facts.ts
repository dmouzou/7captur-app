import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { CARDS } from "../shared/cards";
import { computeDataHealth, STALE_DAYS, type DataHealth, type HealthInput } from "../shared/dataHealth";
import { IMPORT_LIMITS, DEFAULT_REJECTED_ROW_WARNING_THRESHOLD } from "../shared/importing";
import { getPlan } from "../shared/plans";
import { addDays, localToday, periodIds } from "../shared/periods";

/**
 * The FACTS BUNDLE: everything the assistant may say, built on the server from the workspace's own data.
 * Nothing in it comes from the browser except the screen name (which only picks what is relevant) and an
 * optional open item id, which is looked up inside this workspace and this business only.
 */
export interface Focus {
  kind: "recommendation" | "decision";
  title: string;
  why: string[];
  unknowns: string[];
  risk?: string;
  watch?: string;
  stopIf?: string;
  nextStep?: string;
  reviewOn?: string;
}

export interface Facts {
  screen: string;
  workspace: { name: string; plan: string; currency: string; objective: string | null; timezone: string };
  limits: { importMaxMb: number; importMaxRows: number; importMaxColumns: number; rejectedWarningPercent: number; staleDays: number };
  data: {
    totalRecords: number;
    counts: DataHealth["counts"];
    newestDate: string | null;
    freshnessDays: number | null;
    isStale: boolean;
    sources: string[];
    currencies: string[];
    salesWithoutAttribution: number;
    promotionsWithoutObjective: number;
    leadsWithoutSource: number;
  };
  evidence: { level: string; nextLevelUnlock: string };
  week: { last7: number; previous7: number; last7ByType: Record<string, number> };
  connections: { connected: string[]; needsAttention: string[] };
  connectors: { available: string[]; importOnly: string[]; planned: string[] };
  usage: { aiCreditsUsed: number; aiCreditsMonthly: number; monthlyResetsOn: string; recommendationsUsed: number; recommendationsWeekly: number };
  focus: Focus | null;
}

const LOAD_LIMIT = 300;
const COLLS = ["sales", "promotions", "leads", "costs", "posts"] as const;
type Coll = (typeof COLLS)[number];
const DATE_FIELD: Record<Coll, string | null> = { sales: "date", promotions: "startDate", leads: "date", costs: null, posts: "publishedAt" };
const day = (v: unknown): string | undefined => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : undefined);

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function focusFromDecision(d: Record<string, unknown>): Focus {
  const g = (d.guardrails ?? {}) as { watch?: unknown; stopIf?: unknown };
  return {
    kind: "decision",
    title: str(d.headline) ?? str(d.decision) ?? "Decision",
    why: list(d.whyThisOption),
    unknowns: [...list(d.assumptions), ...list(d.limitations)],
    watch: str(g.watch), stopIf: str(g.stopIf), nextStep: str(d.nextStep), reviewOn: str(d.reviewOn),
  };
}

export function focusFromRecommendation(r: Record<string, unknown>): Focus {
  return {
    kind: "recommendation",
    title: str(r.action) ?? "Recommendation",
    why: list(r.rationale), unknowns: list(r.unknowns),
    risk: str(r.risk), stopIf: str(r.doNotActIf), nextStep: str(r.nextMeasurement),
  };
}

export interface RawInputs {
  screen: string;
  ws: Record<string, unknown>;
  business: Record<string, unknown>;
  account: Record<string, unknown> | null;
  rows: Record<Coll, Record<string, unknown>[]>;
  totals: Partial<Record<Coll, number>>;
  connections: { provider?: string; label?: string; status?: string }[];
  usage: { month: Record<string, unknown> | null; week: Record<string, unknown> | null };
  focus: Focus | null;
  now: Date;
}

/** Pure: turns loaded data into the facts bundle. */
export function assembleFacts(raw: RawInputs): Facts {
  const timezone = (raw.account?.timezone as string | undefined) ?? (raw.ws.timezone as string | undefined) ?? "UTC";
  const plan = (raw.account?.plan as string | undefined) ?? (raw.ws.plan as string | undefined) ?? "starter";
  const planCfg = getPlan(plan);
  const r = raw.rows;
  const health = computeDataHealth(r as unknown as HealthInput, raw.now.getTime());

  const total = COLLS.reduce((n, c) => n + (raw.totals[c] ?? r[c].length), 0);
  const today = localToday(raw.now, timezone);
  const d7 = addDays(today, -6), d14 = addDays(today, -13);
  const last7ByType: Record<string, number> = {};
  let last7 = 0, prev7 = 0;
  for (const c of COLLS) {
    const f = DATE_FIELD[c];
    if (!f) continue;
    for (const row of r[c]) {
      const dt = day(row[f]);
      if (!dt) continue;
      if (dt >= d7 && dt <= today) { last7++; last7ByType[c] = (last7ByType[c] ?? 0) + 1; }
      else if (dt >= d14 && dt < d7) prev7++;
    }
  }

  const conn = raw.connections;
  const name = (c: { provider?: string; label?: string }) => c.label || c.provider || "a source";
  const connectors = CARDS.filter((c) => c.parent === "add.connect" && c.id !== "connect.other");
  const ids = periodIds(raw.now, timezone);

  return {
    screen: raw.screen,
    workspace: {
      name: String(raw.ws.name ?? raw.ws.workspaceName ?? "your workspace"),
      plan,
      currency: String(raw.business.currency ?? raw.ws.currency ?? "USD"),
      objective: str(raw.business.objective) ?? list(raw.business.objectives)[0] ?? null,
      timezone,
    },
    limits: {
      importMaxMb: IMPORT_LIMITS.maxBytes / 1024 / 1024,
      importMaxRows: IMPORT_LIMITS.maxRows,
      importMaxColumns: IMPORT_LIMITS.maxColumns,
      rejectedWarningPercent: Math.round(DEFAULT_REJECTED_ROW_WARNING_THRESHOLD * 100),
      staleDays: STALE_DAYS,
    },
    data: {
      totalRecords: total,
      counts: { sales: raw.totals.sales ?? health.counts.sales, promotions: raw.totals.promotions ?? health.counts.promotions, leads: raw.totals.leads ?? health.counts.leads, costs: raw.totals.costs ?? health.counts.costs, posts: raw.totals.posts ?? health.counts.posts },
      newestDate: health.newestDate,
      freshnessDays: health.freshnessDays,
      isStale: health.isStale,
      sources: health.sources,
      currencies: health.currencies,
      salesWithoutAttribution: health.salesWithoutAttribution,
      promotionsWithoutObjective: health.promotionsWithoutObjective,
      leadsWithoutSource: health.leadsWithoutSource,
    },
    evidence: { level: health.evidenceLevel, nextLevelUnlock: health.nextLevelUnlock },
    week: { last7, previous7: prev7, last7ByType },
    connections: {
      connected: conn.filter((c) => c.status === "connected").map(name),
      needsAttention: conn.filter((c) => ["needs_reconnect", "revoked", "error"].includes(String(c.status))).map(name),
    },
    connectors: {
      available: connectors.filter((c) => c.status === "available").map((c) => c.label),
      importOnly: connectors.filter((c) => c.status === "import").map((c) => c.label),
      planned: connectors.filter((c) => c.status === "planned").map((c) => c.label),
    },
    usage: {
      aiCreditsUsed: Number(raw.usage.month?.aiFollowUps ?? 0),
      aiCreditsMonthly: planCfg.aiFollowUps.monthly,
      monthlyResetsOn: ids.monthlyResetsOn,
      recommendationsUsed: Number(raw.usage.week?.recommendations ?? 0),
      recommendationsWeekly: planCfg.recommendations.weekly,
    },
    focus: raw.focus,
  };
}

/**
 * Loads everything from Firestore. Every path is under workspaces/{workspaceId}, so a question can never see
 * another workspace. The business must exist in this workspace, and an open item must belong to this business.
 */
export async function loadFacts(
  db: Firestore,
  args: { workspaceId: string; businessId: string; screen: string; context?: { kind: "recommendation" | "decision"; id: string }; now?: Date },
): Promise<Facts> {
  const now = args.now ?? new Date();
  const wsRef = db.doc(`workspaces/${args.workspaceId}`);
  const [wsSnap, bizSnap] = await Promise.all([wsRef.get(), db.doc(`workspaces/${args.workspaceId}/businesses/${args.businessId}`).get()]);
  if (!wsSnap.exists || !bizSnap.exists) throw new HttpsError("not-found", "Business not found.");
  const ws = wsSnap.data()!;
  const ownerUid = ws.ownerUid as string | undefined;
  const acctSnap = ownerUid ? await db.doc(`accounts/${ownerUid}`).get() : null;
  const account = acctSnap?.exists ? (acctSnap.data() as Record<string, unknown>) : null;
  const timezone = (account?.timezone as string | undefined) ?? (ws.timezone as string | undefined) ?? "UTC";
  const ids = periodIds(now, timezone);

  const rows = {} as Record<Coll, Record<string, unknown>[]>;
  const totals: Partial<Record<Coll, number>> = {};
  await Promise.all(COLLS.map(async (c) => {
    const base = db.collection(`workspaces/${args.workspaceId}/${c}`).where("businessId", "==", args.businessId);
    const f = DATE_FIELD[c];
    const q = f ? base.orderBy(f, "desc") : base.orderBy(FieldPath.documentId());
    const [snap, count] = await Promise.all([
      q.limit(LOAD_LIMIT).get().catch(() => null),
      base.count().get().then((s) => s.data().count).catch(() => undefined),
    ]);
    rows[c] = snap ? snap.docs.map((d) => d.data()) : [];
    if (typeof count === "number") totals[c] = count;
  }));

  const [connSnap, monthSnap, weekSnap] = await Promise.all([
    db.collection(`workspaces/${args.workspaceId}/connections`).get().catch(() => null),
    ownerUid ? db.doc(`accounts/${ownerUid}/usage/${ids.monthId}`).get() : null,
    ownerUid ? db.doc(`accounts/${ownerUid}/usage/${ids.weekId}`).get() : null,
  ]);

  // Open item: looked up by path inside this workspace, then checked against the business.
  let focus: Focus | null = null;
  const ctx = args.context;
  if (ctx) {
    const coll = ctx.kind === "decision" ? "decisions" : "recommendations";
    const snap = await db.doc(`workspaces/${args.workspaceId}/${coll}/${ctx.id}`).get().catch(() => null);
    const data = snap?.exists ? (snap.data() as Record<string, unknown>) : null;
    if (data && (data.businessId === undefined || data.businessId === args.businessId)) {
      focus = ctx.kind === "decision" ? focusFromDecision(data) : focusFromRecommendation(data);
    }
  }
  if (!focus) {
    const latest = await db.collection(`workspaces/${args.workspaceId}/recommendations`).orderBy("createdAt", "desc").limit(5).get().catch(() => null);
    const hit = latest?.docs.map((d) => d.data()).find((d) => d.businessId === args.businessId && d.status !== "failed");
    if (hit) focus = focusFromRecommendation(hit);
  }

  return assembleFacts({
    screen: args.screen,
    ws, business: bizSnap.data()!, account, rows, totals,
    connections: connSnap ? connSnap.docs.map((d) => d.data()) : [],
    usage: { month: monthSnap?.data() ?? null, week: weekSnap?.data() ?? null },
    focus, now,
  });
}
