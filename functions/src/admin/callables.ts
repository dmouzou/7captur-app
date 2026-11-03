import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { PLANS, PLAN_IDS } from "../shared/plans";
import { ADMIN_ROLES, audit, auditInBatch, hasSecondFactor, mfaEnforced, plain, requireAdmin } from "./auth";
import { getActiveAiConfig, maskApiKey, DEFAULT_AI_MODEL } from "../config/aiConfig";

const db = () => getFirestore();
const LIMIT = 50;
const DAY = 86400000;
const wsId = z.object({ workspaceId: z.string().min(1).max(160) });
const reason = z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500);
const before = z.string().max(40).optional();
const BILLING_STATUSES = ["active", "trialing", "trial_expired", "past_due", "canceling", "canceled", "restricted", "paused", "none"] as const;

const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;

/** Cursor paging on createdAt (newest first). The cursor is seconds_nanos of the last row, never a guessed offset. */
const cursorOf = (ts: Timestamp) => `${ts.seconds}_${ts.nanoseconds}`;
function parseCursor(c?: string): Timestamp | undefined {
  if (!c) return undefined;
  const m = /^(\d+)_(\d+)$/.exec(c);
  if (!m) throw new HttpsError("invalid-argument", "Invalid page.");
  return new Timestamp(Number(m[1]), Number(m[2]));
}
const paged = (q: FirebaseFirestore.Query, cursor?: string) => {
  const ts = parseCursor(cursor);
  return (ts ? q.orderBy("createdAt", "desc").startAfter(ts) : q.orderBy("createdAt", "desc")).limit(LIMIT);
};
const nextCursor = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
  if (docs.length < LIMIT) return null;
  const ts = docs[docs.length - 1]!.data().createdAt;
  return ts instanceof Timestamp ? cursorOf(ts) : null;
};

/** Who am I: lets the admin UI decide what to show. The server still checks every call. */
export const adminWhoAmI = onCall(async (request) => {
  const role = request.auth?.token.role as string | undefined;
  const isAdmin = ADMIN_ROLES.includes(role as never);
  return {
    role: isAdmin ? role : null,
    // Only admins learn the MFA state. The UI shows a warning banner while MFA is not enforced.
    mfaEnforced: isAdmin ? mfaEnforced() : null,
    secondFactor: isAdmin ? hasSecondFactor(request.auth?.token as unknown as Record<string, unknown>) : null,
  };
});

export const adminOverview = onCall(async (request) => {
  requireAdmin(request, "read_overview");
  const now = Date.now();
  const since7 = Timestamp.fromMillis(now - 7 * DAY), since30 = Timestamp.fromMillis(now - 30 * DAY);
  const byPlan: Record<string, number> = {};
  await Promise.all(PLAN_IDS.map(async (p) => { byPlan[p] = await count(db().collection("workspaces").where("plan", "==", p)); }));
  const [workspaces, new30, recs7, recsFailed7, pastDue, canceling, needsReconnect, pendingDeletions, suspended, openFeedback] = await Promise.all([
    count(db().collection("workspaces")),
    count(db().collection("workspaces").where("createdAt", ">=", since30)),
    count(db().collectionGroup("recommendations").where("createdAt", ">=", since7)),
    count(db().collectionGroup("recommendations").where("status", "==", "failed").where("createdAt", ">=", since7)),
    count(db().collection("workspaces").where("billingStatus", "==", "past_due")),
    count(db().collection("workspaces").where("billingStatus", "==", "canceling")),
    count(db().collectionGroup("connections").where("status", "==", "needs_reconnect")),
    count(db().collection("deletionRequests").where("status", "==", "pending")),
    count(db().collection("workspaces").where("suspended", "==", true)),
    count(db().collection("supportTickets").where("status", "==", "open")),
  ]);
  // Activation sample: of the 25 newest workspaces, how many saved any record / got a recommendation.
  const recent = await db().collection("workspaces").orderBy("createdAt", "desc").limit(25).get();
  let withRecord = 0, withRec = 0;
  await Promise.all(recent.docs.map(async (w) => {
    const [r, s, p] = await Promise.all([
      w.ref.collection("recommendations").limit(1).get(), w.ref.collection("promotions").limit(1).get(), w.ref.collection("sales").limit(1).get(),
    ]);
    if (!r.empty) withRec++;
    if (!p.empty || !s.empty || !r.empty) withRecord++;
  }));
  // Aggregate numbers only: not audit-logged, so the audit log is not flooded by every page load.
  return { workspaces, new30, byPlan, recs7, recsFailed7, pastDue, canceling, needsReconnect, pendingDeletions, suspended, openFeedback, activation: { sample: recent.size, withRecord, withRecommendation: withRec } };
});

/** Business analytics from data that exists today. Cost per recommendation is NOT tracked yet and is reported as such. */
export const adminAnalytics = onCall(async (request) => {
  requireAdmin(request, "read_analytics");
  const now = Date.now();
  const weekStart = (i: number) => Timestamp.fromMillis(now - (i + 1) * 7 * DAY);
  const weekEnd = (i: number) => Timestamp.fromMillis(now - i * 7 * DAY);
  const dayStart = (i: number) => Timestamp.fromMillis(now - (i + 1) * DAY);
  const dayEnd = (i: number) => Timestamp.fromMillis(now - i * DAY);

  const signups = await Promise.all(Array.from({ length: 8 }, (_, i) => i).map(async (i) => ({
    weekEnding: weekEnd(i).toDate().toISOString().slice(0, 10),
    count: await count(db().collection("workspaces").where("createdAt", ">=", weekStart(i)).where("createdAt", "<", weekEnd(i))),
  })));
  const recsPerDay = await Promise.all(Array.from({ length: 14 }, (_, i) => i).map(async (i) => {
    const range = db().collectionGroup("recommendations").where("createdAt", ">=", dayStart(i)).where("createdAt", "<", dayEnd(i));
    const [total, failed] = await Promise.all([count(range), count(range.where("status", "==", "failed"))]);
    return { day: dayEnd(i).toDate().toISOString().slice(0, 10), total, failed };
  }));

  const byPlan: Record<string, number> = {};
  await Promise.all(PLAN_IDS.map(async (p) => { byPlan[p] = await count(db().collection("workspaces").where("plan", "==", p)); }));
  const total = Object.values(byPlan).reduce((s, v) => s + v, 0);
  const [activePaid, trialing, canceling, canceled, pastDue] = await Promise.all(
    (["active", "trialing", "canceling", "canceled", "past_due"] as const).map((s) => count(db().collection("workspaces").where("billingStatus", "==", s))),
  );

  // Time to first recommendation, from the 100 newest workspaces.
  const recent = await db().collection("workspaces").orderBy("createdAt", "desc").limit(100).get();
  const minutes: number[] = [];
  await Promise.all(recent.docs.map(async (w) => {
    const first = await w.ref.collection("recommendations").orderBy("createdAt", "asc").limit(1).get();
    const a = w.data().createdAt, b = first.docs[0]?.data().createdAt;
    if (a instanceof Timestamp && b instanceof Timestamp) minutes.push(Math.max(0, Math.round((b.toMillis() - a.toMillis()) / 60000)));
  }));
  minutes.sort((x, y) => x - y);
  const median = minutes.length ? minutes[Math.floor(minutes.length / 2)]! : null;

  return {
    signups: signups.reverse(),
    recsPerDay: recsPerDay.reverse(),
    plans: { byPlan, total, paidActive: activePaid, trialing, canceling, canceled, pastDue, paidShare: total ? Math.round((activePaid / total) * 100) : 0 },
    timeToFirstRecommendation: { sample: recent.size, withRecommendation: minutes.length, medianMinutes: median },
    costPerRecommendation: { tracked: false, note: "AI cost is not recorded per recommendation yet. Add token usage to each recommendation to enable this." },
  };
});

type OwnerInfo = { email: string | null; lastSignIn: string | null };
/** One batched Auth lookup (up to 100 per call) instead of one call per row. */
async function ownerMap(uids: string[]): Promise<Map<string, OwnerInfo>> {
  const out = new Map<string, OwnerInfo>();
  const unique = [...new Set(uids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const res = await getAuth().getUsers(unique.slice(i, i + 100).map((uid) => ({ uid }))).catch(() => null);
    res?.users.forEach((u) => out.set(u.uid, { email: u.email ?? null, lastSignIn: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null }));
  }
  return out;
}

function summarize(id: string, d: FirebaseFirestore.DocumentData, owners: Map<string, OwnerInfo>) {
  const o = owners.get(d.ownerUid);
  return { id, name: d.name ?? "", ownerEmail: o?.email ?? null, ownerLastSignIn: o?.lastSignIn ?? null, plan: d.plan, billingStatus: d.billingStatus ?? "none", country: d.country ?? null, suspended: Boolean(d.suspended), createdAt: plain(d.createdAt), deletionScheduledFor: plain(d.deletionScheduledFor) ?? null };
}
const summarizeAll = async (docs: FirebaseFirestore.DocumentSnapshot[]) => {
  const owners = await ownerMap(docs.map((d) => d.data()!.ownerUid as string));
  return docs.map((d) => summarize(d.id, d.data()!, owners));
};

export const adminSearchWorkspaces = onCall(async (request) => {
  const admin = requireAdmin(request, "read_workspaces");
  const p = z.object({ query: z.string().trim().max(200).optional(), plan: z.string().optional(), billingStatus: z.string().optional(), before }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid search.");
  const { query, plan, billingStatus } = p.data;
  let docs: FirebaseFirestore.DocumentSnapshot[] = [];
  let next: string | null = null;
  if (query?.includes("@")) {
    const u = await getAuth().getUserByEmail(query).catch(() => null);
    if (u) docs = (await db().collection("workspaces").where("ownerUid", "==", u.uid).limit(LIMIT).get()).docs;
  } else if (query) {
    const one = await db().doc(`workspaces/${query}`).get();
    docs = one.exists ? [one] : [];
  } else {
    let q: FirebaseFirestore.Query = db().collection("workspaces");
    if (plan) q = q.where("plan", "==", plan);
    if (billingStatus) q = q.where("billingStatus", "==", billingStatus);
    const snap = await paged(q, p.data.before).get();
    docs = snap.docs;
    next = nextCursor(snap.docs);
  }
  if (!p.data.before) await audit(admin, "search_workspaces", "workspaces", { meta: { hasQuery: Boolean(query), plan: plan ?? null, billingStatus: billingStatus ?? null } });
  return { items: await summarizeAll(docs), next };
});

/** Support context: metadata and counts only. No tokens, no payment data, no raw customer records. */
export const adminWorkspaceDetail = onCall(async (request) => {
  const admin = requireAdmin(request, "read_workspaces");
  const p = wsId.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "Workspace not found.");
  const [conns, usage, imports, recs, billing, members, override, ...counts] = await Promise.all([
    ref.collection("connections").get(),
    ref.collection("usage").orderBy("__name__", "desc").limit(6).get(),
    ref.collection("imports").orderBy("createdAt", "desc").limit(10).get(),
    ref.collection("recommendations").orderBy("createdAt", "desc").limit(10).get(),
    ref.collection("billing").doc("subscription").get(),
    ref.collection("members").get(),
    db().doc(`planOverrides/${p.data.workspaceId}`).get(),
    ...["posts", "promotions", "leads", "sales", "costs"].map((c) => count(ref.collection(c))),
  ]);
  await audit(admin, "view_workspace", p.data.workspaceId);
  const b = billing.data();
  const o = override.data();
  const [summary] = await summarizeAll([w]);
  return {
    summary,
    workspace: plain({ ...w.data(), ownerUid: undefined }),
    members: members.docs.map((m) => ({ uid: m.id, role: m.data().role, status: m.data().status })),
    counts: { posts: counts[0], promotions: counts[1], leads: counts[2], sales: counts[3], costs: counts[4] },
    connections: conns.docs.map((c) => plain({ id: c.id, provider: c.data().provider, status: c.data().status, shop: c.data().shop, customerId: c.data().customerId, lastSyncedAt: c.data().lastSyncedAt, lastError: c.data().lastError, scopes: c.data().scopes })),
    usage: usage.docs.map((u) => plain({ id: u.id, ...u.data() })),
    imports: imports.docs.map((i) => plain({ id: i.id, status: i.data().status, collection: i.data().collection, counts: i.data().counts, createdAt: i.data().createdAt })),
    recommendations: recs.docs.map((r) => plain({ id: r.id, status: r.data().status, mode: r.data().mode, category: r.data().category, createdAt: r.data().createdAt })),
    billing: b ? plain({ status: b.status, plan: b.plan, currentPeriodEndsAt: b.currentPeriodEndsAt, subscriptionId: b.subscriptionId }) : null,
    planOverride: o ? plain({ plan: o.plan, billingStatus: o.billingStatus, reason: o.reason, byEmail: o.byEmail, at: o.at }) : null,
  };
});

export const adminSetSuspension = onCall(async (request) => {
  const admin = requireAdmin(request, "suspend_workspace", { fresh: true });
  const p = wsId.extend({ suspended: z.boolean(), reason }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "Workspace not found.");
  const was = Boolean(w.data()!.suspended);
  const batch = db().batch();
  if (p.data.suspended) batch.update(ref, { suspended: true, suspendedAt: FieldValue.serverTimestamp(), suspendedReason: p.data.reason });
  else batch.update(ref, { suspended: FieldValue.delete(), suspendedAt: FieldValue.delete(), suspendedReason: FieldValue.delete() });
  // The change and its audit entry commit together or not at all.
  auditInBatch(batch, admin, p.data.suspended ? "suspend_workspace" : "reactivate_workspace", p.data.workspaceId, { reason: p.data.reason, before: { suspended: was }, after: { suspended: p.data.suspended } });
  await batch.commit();
  return { ok: true };
});

/**
 * Super admin only. Sets a workspace's plan and billing status by hand.
 * The override is recorded in planOverrides/{workspaceId} (server-only: never readable by customers) and STICKS:
 * the Paddle webhook, enforceBilling and trialLifecycle leave an overridden workspace alone until a super admin
 * clears the override with adminClearPlanOverride.
 */
export const adminChangePlan = onCall(async (request) => {
  const admin = requireAdmin(request, "change_plan", { fresh: true });
  const p = wsId.extend({
    plan: z.enum(PLAN_IDS as [string, ...string[]]),
    billingStatus: z.enum(BILLING_STATUSES).optional(),
    reason,
  }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "Workspace not found.");

  const beforePlan = w.data()!.plan;
  const beforeStatus = w.data()!.billingStatus ?? "none";
  const nextStatus = p.data.billingStatus ?? beforeStatus;
  const updates: Record<string, unknown> = { plan: p.data.plan, billingStatus: nextStatus };
  if (nextStatus === "active" || nextStatus === "trialing") updates.restrictAt = FieldValue.delete();

  const batch = db().batch();
  batch.update(ref, updates);
  batch.set(db().doc(`planOverrides/${p.data.workspaceId}`), {
    plan: p.data.plan, billingStatus: nextStatus, reason: p.data.reason, by: admin.uid, byEmail: admin.email, at: FieldValue.serverTimestamp(),
  });
  auditInBatch(batch, admin, "change_plan", p.data.workspaceId, {
    reason: p.data.reason, before: { plan: beforePlan, billingStatus: beforeStatus }, after: { plan: p.data.plan, billingStatus: nextStatus, overrideSticks: true },
  });
  await batch.commit();
  return { ok: true };
});

/** Super admin only. Removes the override so Paddle and the billing jobs manage the workspace again from their next event. */
export const adminClearPlanOverride = onCall(async (request) => {
  const admin = requireAdmin(request, "change_plan", { fresh: true });
  const p = wsId.extend({ reason }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const oRef = db().doc(`planOverrides/${p.data.workspaceId}`);
  const o = await oRef.get();
  if (!o.exists) throw new HttpsError("failed-precondition", "No override to clear.");
  const batch = db().batch();
  batch.delete(oRef);
  auditInBatch(batch, admin, "clear_plan_override", p.data.workspaceId, { reason: p.data.reason, before: { plan: o.data()!.plan, billingStatus: o.data()!.billingStatus } });
  await batch.commit();
  return { ok: true };
});

/** Super admin only. The key stays where it is today; moving it to Secret Manager is a separate, planned change. */
export const adminGetAiConfig = onCall(async (request) => {
  requireAdmin(request, "manage_ai");
  const snap = await db().doc("config/ai").get();
  const data = (snap.data() || {}) as { anthropicApiKey?: string; model?: string; updatedAt?: string; updatedBy?: string };
  const { apiKey, model } = await getActiveAiConfig();
  return {
    configured: Boolean(data.anthropicApiKey || apiKey),
    maskedKey: maskApiKey(data.anthropicApiKey || apiKey),
    model: data.model || model,
    updatedAt: data.updatedAt ?? null,
    updatedBy: data.updatedBy ?? null,
  };
});

export const adminSetAiConfig = onCall(async (request) => {
  const admin = requireAdmin(request, "manage_ai", { fresh: true });
  const p = z.object({
    apiKey: z.string().trim().min(10, "API key too short").max(200),
    model: z.string().trim().min(3).max(80).optional(),
    reason: z.string().trim().min(5).max(300),
  }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");

  const model = p.data.model || DEFAULT_AI_MODEL;
  const batch = db().batch();
  batch.set(db().doc("config/ai"), {
    anthropicApiKey: p.data.apiKey,
    model,
    updatedAt: new Date().toISOString(),
    updatedBy: admin.email || admin.uid,
  }, { merge: true });
  auditInBatch(batch, admin, "update_ai_config", "system", { reason: p.data.reason, after: { model, maskedKey: maskApiKey(p.data.apiKey) } });
  await batch.commit();

  return { ok: true, maskedKey: maskApiKey(p.data.apiKey), model };
});

export const adminListRecommendations = onCall(async (request) => {
  const admin = requireAdmin(request, "read_recommendations");
  const p = z.object({ workspaceId: z.string().max(160).optional(), status: z.string().max(40).optional(), before }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  let q: FirebaseFirestore.Query = p.data.workspaceId ? db().collection(`workspaces/${p.data.workspaceId}/recommendations`) : db().collectionGroup("recommendations");
  if (p.data.status) q = q.where("status", "==", p.data.status);
  const snap = await paged(q, p.data.before).get();
  if (!p.data.before) await audit(admin, "list_recommendations", p.data.workspaceId ?? "all", { meta: { status: p.data.status ?? null } });
  return { items: snap.docs.map((d) => plain({ id: d.id, workspaceId: d.ref.parent.parent!.id, status: d.data().status, mode: d.data().mode, category: d.data().category, engineVersion: d.data().engineVersion ?? d.data().version, createdAt: d.data().createdAt })), next: nextCursor(snap.docs) };
});

export const adminRecommendationDetail = onCall(async (request) => {
  const admin = requireAdmin(request, "read_recommendations");
  const p = wsId.extend({ id: z.string().min(1).max(160) }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}/recommendations/${p.data.id}`);
  const [r, ev] = await Promise.all([ref.get(), db().collection(`workspaces/${p.data.workspaceId}/recommendationEvents`).where("recommendationId", "==", p.data.id).limit(50).get()]);
  if (!r.exists) throw new HttpsError("not-found", "Recommendation not found.");
  await audit(admin, "view_recommendation", `${p.data.workspaceId}/${p.data.id}`);
  return { recommendation: plain({ id: r.id, ...r.data() }), events: ev.docs.map((e) => plain({ id: e.id, ...e.data() })) };
});

export const adminListImports = onCall(async (request) => {
  const admin = requireAdmin(request, "read_imports");
  const p = z.object({ workspaceId: z.string().max(160).optional(), status: z.string().max(40).optional(), before }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  let q: FirebaseFirestore.Query = p.data.workspaceId ? db().collection(`workspaces/${p.data.workspaceId}/imports`) : db().collectionGroup("imports");
  if (p.data.status) q = q.where("status", "==", p.data.status);
  const snap = await paged(q, p.data.before).get();
  if (!p.data.before) await audit(admin, "list_imports", p.data.workspaceId ?? "all", { meta: { status: p.data.status ?? null } });
  return { items: snap.docs.map((d) => plain({ id: d.id, workspaceId: d.ref.parent.parent!.id, status: d.data().status, collection: d.data().collection, counts: d.data().counts, rowErrors: (d.data().rowErrors ?? []).slice(0, 5), createdAt: d.data().createdAt })), next: nextCursor(snap.docs) };
});

const CONNECTION_STATUSES = ["connected", "needs_reconnect", "pending_account", "disconnected"];
export const adminListIntegrations = onCall(async (request) => {
  const admin = requireAdmin(request, "read_integrations");
  const p = z.object({ status: z.enum(CONNECTION_STATUSES as [string, ...string[]]).optional() }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const q = db().collectionGroup("connections");
  const snap = await (p.data.status ? q.where("status", "==", p.data.status) : q.where("status", "in", CONNECTION_STATUSES)).limit(200).get();
  await audit(admin, "list_integrations", "all", { meta: { status: p.data.status ?? null } });
  // Problems first, so a broken connection is never buried under healthy ones.
  const rank = (s: string) => (s === "needs_reconnect" ? 0 : s === "pending_account" ? 1 : s === "connected" ? 2 : 3);
  const items = snap.docs.map((d) => plain({ id: d.id, workspaceId: d.ref.parent.parent!.id, provider: d.data().provider, status: d.data().status, shop: d.data().shop, customerId: d.data().customerId, scopes: d.data().scopes, lastSyncedAt: d.data().lastSyncedAt, lastError: d.data().lastError, partialSync: d.data().partialSync }) as Record<string, unknown>)
    .sort((a, b) => rank(String(a.status)) - rank(String(b.status)));
  return { items };
});

export const adminJobs = onCall(async (request) => {
  const admin = requireAdmin(request, "read_jobs");
  const [overdue, failedMail, recentMail, deletions] = await Promise.all([
    db().collection("workspaces").where("reportNextRunAt", "<", Timestamp.fromMillis(Date.now() - 2 * 3600000)).limit(LIMIT).get(),
    db().collection("mail").where("delivery.state", "==", "ERROR").limit(LIMIT).get(),
    db().collection("mail").orderBy("delivery.startTime", "desc").limit(LIMIT).get(),
    db().collection("deletionRequests").orderBy("requestedAt", "desc").limit(20).get(),
  ]);
  await audit(admin, "view_jobs", "system");
  const mailRow = (m: FirebaseFirestore.QueryDocumentSnapshot) => plain({ id: m.id, kind: m.data().meta?.kind, state: m.data().delivery?.state ?? "queued", error: m.data().delivery?.error ?? null, attempts: m.data().delivery?.attempts ?? null, startedAt: m.data().delivery?.startTime ?? null });
  return {
    overdueReports: overdue.docs.map((d) => ({ workspaceId: d.id, reportNextRunAt: plain(d.data().reportNextRunAt), attempts: d.data().reportAttempts ?? 0 })),
    failedMail: failedMail.docs.map(mailRow),
    mail: recentMail.docs.map(mailRow),
    deletions: deletions.docs.map((d) => plain({ workspaceId: d.id, status: d.data().status, requestedAt: d.data().requestedAt, scheduledFor: d.data().scheduledFor })),
  };
});

export const adminBilling = onCall(async (request) => {
  const admin = requireAdmin(request, "read_billing");
  const [problem, events, overrides] = await Promise.all([
    db().collection("workspaces").where("billingStatus", "in", ["past_due", "canceling", "restricted"]).limit(LIMIT).get(),
    db().collection("billingEvents").orderBy("receivedAt", "desc").limit(100).get(),
    db().collection("planOverrides").limit(100).get(),
  ]);
  await audit(admin, "view_billing", "system");
  return {
    workspaces: await summarizeAll(problem.docs),
    events: events.docs.map((e) => plain({ id: e.id, type: e.data().type, workspaceId: e.data().workspaceId, outcome: e.data().outcome, receivedAt: e.data().receivedAt })),
    overrides: overrides.docs.map((o) => plain({ workspaceId: o.id, plan: o.data().plan, billingStatus: o.data().billingStatus, reason: o.data().reason, by: o.data().byEmail, at: o.data().at })),
  };
});

export const adminPlans = onCall(async (request) => {
  requireAdmin(request, "read_plans");
  return { plans: PLANS };
});

export const adminListAudit = onCall(async (request) => {
  const admin = requireAdmin(request, "read_audit");
  const p = z.object({ action: z.string().max(60).optional(), before }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  let q: FirebaseFirestore.Query = db().collection("auditEvents");
  if (p.data.action) q = q.where("action", "==", p.data.action);
  const snap = await paged(q, p.data.before).get();
  if (!p.data.before) await audit(admin, "view_audit", "auditEvents", { meta: { action: p.data.action ?? null } });
  return { items: snap.docs.map((d) => plain({ id: d.id, ...d.data() })), next: nextCursor(snap.docs) };
});

/** Grant or remove an admin role. Super admin only, fresh login, cannot change your own role, audited before AND after. */
export const adminSetRole = onCall(async (request) => {
  const admin = requireAdmin(request, "manage_admins", { fresh: true });
  const p = z.object({ email: z.string().email(), role: z.enum([...ADMIN_ROLES, "none"] as [string, ...string[]]), reason }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const user = await getAuth().getUserByEmail(p.data.email).catch(() => null);
  if (!user) throw new HttpsError("not-found", "No user with that email.");
  // Because you cannot change your own role and only a super admin can call this, at least one super admin always remains.
  if (user.uid === admin.uid) throw new HttpsError("failed-precondition", "You cannot change your own role.");
  if (!user.emailVerified) throw new HttpsError("failed-precondition", "That email is not verified.");
  const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
  const was = claims.role ?? null;
  const now = p.data.role === "none" ? null : p.data.role;
  const meta = { email: p.data.email };
  // Fail closed: if the intent cannot be logged, nothing changes.
  await audit(admin, "set_admin_role_attempt", user.uid, { reason: p.data.reason, before: { role: was }, after: { role: now }, meta });
  try {
    if (now === null) delete claims.role; else claims.role = now;
    await getAuth().setCustomUserClaims(user.uid, claims);
    await getAuth().revokeRefreshTokens(user.uid);
  } catch {
    await audit(admin, "set_admin_role_failed", user.uid, { reason: p.data.reason, before: { role: was }, after: { role: now }, meta }).catch(() => undefined);
    throw new HttpsError("internal", "Could not change the role. Nothing was applied.");
  }
  await audit(admin, "set_admin_role", user.uid, { reason: p.data.reason, before: { role: was }, after: { role: now }, meta });
  return { ok: true };
});

/** List view: no customer message or email. Opening a ticket goes through adminFeedbackDetail, which is audit-logged. */
export const adminListFeedback = onCall(async (request) => {
  const admin = requireAdmin(request, "read_feedback");
  const p = z.object({
    status: z.string().max(40).optional(),
    type: z.string().max(40).optional(),
    workspaceId: z.string().max(160).optional(),
    before,
  }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");

  let q: FirebaseFirestore.Query = db().collection("supportTickets");
  if (p.data.status) q = q.where("status", "==", p.data.status);
  if (p.data.type) q = q.where("type", "==", p.data.type);
  if (p.data.workspaceId) q = q.where("workspaceId", "==", p.data.workspaceId);

  const snap = await paged(q, p.data.before).get();
  if (!p.data.before) await audit(admin, "list_feedback", p.data.workspaceId ?? "all");
  return {
    items: snap.docs.map((d) => plain({ id: d.id, createdAt: d.data().createdAt, type: d.data().type, status: d.data().status, subject: d.data().subject, workspaceId: d.data().workspaceId, recommendationId: d.data().recommendationId ?? null })),
    next: nextCursor(snap.docs),
  };
});

export const adminFeedbackDetail = onCall(async (request) => {
  const admin = requireAdmin(request, "read_feedback");
  const p = z.object({ ticketId: z.string().min(1).max(160) }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const snap = await db().doc(`supportTickets/${p.data.ticketId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Ticket not found.");
  await audit(admin, "view_feedback", p.data.ticketId, { meta: { workspaceId: snap.data()!.workspaceId ?? null } });
  return { ticket: plain({ id: snap.id, ...snap.data() }) };
});

/**
 * internalNote stays on supportTickets ONLY (admin-only). The workspace copy is readable by every member of the customer's
 * workspace, so it only ever gets the status and the optional customerReply, never internal notes.
 */
export const adminUpdateFeedback = onCall(async (request) => {
  const admin = requireAdmin(request, "update_feedback");
  const p = z.object({
    ticketId: z.string().min(1).max(160),
    status: z.enum(["open", "in_progress", "resolved", "dismissed"]),
    internalNote: z.string().trim().max(1000).optional(),
    customerReply: z.string().trim().max(1000).optional(),
  }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");

  const ticketRef = db().doc(`supportTickets/${p.data.ticketId}`);
  const snap = await ticketRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Ticket not found.");
  const current = snap.data()!;

  const at = new Date().toISOString();
  const by = admin.email || admin.uid;
  const batch = db().batch();
  batch.update(ticketRef, {
    status: p.data.status,
    updatedAt: FieldValue.serverTimestamp(),
    ...(p.data.internalNote ? { internalNotes: FieldValue.arrayUnion({ by, note: p.data.internalNote, at }) } : {}),
    ...(p.data.customerReply ? { customerReply: { text: p.data.customerReply, at } } : {}),
  });
  if (current.workspaceId) {
    const wsRef = db().doc(`workspaces/${current.workspaceId}/feedback/${p.data.ticketId}`);
    // Only touch the customer copy if it exists; a missing copy must not fail the whole update.
    if ((await wsRef.get()).exists) {
      batch.update(wsRef, { status: p.data.status, updatedAt: FieldValue.serverTimestamp(), ...(p.data.customerReply ? { customerReply: { text: p.data.customerReply, at } } : {}) });
    }
  }
  auditInBatch(batch, admin, "update_feedback", p.data.ticketId, {
    before: { status: current.status },
    after: { status: p.data.status, internalNote: p.data.internalNote ?? null, customerReply: p.data.customerReply ?? null },
  });
  await batch.commit();
  return { ok: true };
});
