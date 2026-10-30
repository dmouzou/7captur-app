import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { PLANS, PLAN_IDS } from "../shared/plans";
import { ADMIN_ROLES, audit, plain, requireAdmin } from "./auth";

const db = () => getFirestore();
const LIMIT = 50;
const wsId = z.object({ workspaceId: z.string().min(1).max(160) });
const reason = z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500);

const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;

/** Who am I: lets the admin UI decide what to show. The server still checks every call. */
export const adminWhoAmI = onCall(async (request) => {
  const role = request.auth?.token.role as string | undefined;
  return { role: ADMIN_ROLES.includes(role as never) ? role : null };
});

export const adminOverview = onCall(async (request) => {
  const admin = requireAdmin(request, "read_overview");
  const now = Date.now();
  const since7 = Timestamp.fromMillis(now - 7 * 86400000), since30 = Timestamp.fromMillis(now - 30 * 86400000);
  const byPlan: Record<string, number> = {};
  await Promise.all(PLAN_IDS.map(async (p) => { byPlan[p] = await count(db().collection("workspaces").where("plan", "==", p)); }));
  const [workspaces, new30, recs7, recsFailed7, pastDue, canceling, needsReconnect, pendingDeletions, suspended] = await Promise.all([
    count(db().collection("workspaces")),
    count(db().collection("workspaces").where("createdAt", ">=", since30)),
    count(db().collectionGroup("recommendations").where("createdAt", ">=", since7)),
    count(db().collectionGroup("recommendations").where("status", "==", "failed").where("createdAt", ">=", since7)),
    count(db().collection("workspaces").where("billingStatus", "==", "past_due")),
    count(db().collection("workspaces").where("billingStatus", "==", "canceling")),
    count(db().collectionGroup("connections").where("status", "==", "needs_reconnect")),
    count(db().collection("deletionRequests").where("status", "==", "pending")),
    count(db().collection("workspaces").where("suspended", "==", true)),
  ]);
  // Activation sample: of the 50 newest workspaces, how many saved any record / got a recommendation.
  const recent = await db().collection("workspaces").orderBy("createdAt", "desc").limit(50).get();
  let withRecord = 0, withRec = 0;
  await Promise.all(recent.docs.map(async (w) => {
    const [r, s, p] = await Promise.all([
      w.ref.collection("recommendations").limit(1).get(), w.ref.collection("promotions").limit(1).get(), w.ref.collection("sales").limit(1).get(),
    ]);
    if (!r.empty) withRec++;
    if (!p.empty || !s.empty || !r.empty) withRecord++;
  }));
  await audit(admin, "view_overview", "system");
  return { workspaces, new30, byPlan, recs7, recsFailed7, pastDue, canceling, needsReconnect, pendingDeletions, suspended, activation: { sample: recent.size, withRecord, withRecommendation: withRec } };
});

async function summarize(id: string, d: FirebaseFirestore.DocumentData) {
  const owner = await getAuth().getUser(d.ownerUid).catch(() => null);
  return { id, name: d.name ?? "", ownerEmail: owner?.email ?? null, plan: d.plan, billingStatus: d.billingStatus ?? "none", country: d.country ?? null, suspended: Boolean(d.suspended), createdAt: plain(d.createdAt), deletionScheduledFor: plain(d.deletionScheduledFor) ?? null };
}

export const adminSearchWorkspaces = onCall(async (request) => {
  const admin = requireAdmin(request, "read_workspaces");
  const p = z.object({ query: z.string().trim().max(200).optional(), plan: z.string().optional(), billingStatus: z.string().optional() }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid search.");
  const { query, plan, billingStatus } = p.data;
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] | FirebaseFirestore.DocumentSnapshot[] = [];
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
    docs = (await q.orderBy("createdAt", "desc").limit(LIMIT).get()).docs;
  }
  await audit(admin, "search_workspaces", "workspaces", { meta: { hasQuery: Boolean(query), plan: plan ?? null, billingStatus: billingStatus ?? null } });
  return { items: await Promise.all(docs.map((d) => summarize(d.id, d.data()!))) };
});

/** Support context: metadata and counts only. No tokens, no payment data, no raw customer records. */
export const adminWorkspaceDetail = onCall(async (request) => {
  const admin = requireAdmin(request, "read_workspaces");
  const p = wsId.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "Workspace not found.");
  const [conns, usage, imports, recs, billing, members, ...counts] = await Promise.all([
    ref.collection("connections").get(),
    ref.collection("usage").orderBy("__name__", "desc").limit(6).get(),
    ref.collection("imports").orderBy("createdAt", "desc").limit(10).get(),
    ref.collection("recommendations").orderBy("createdAt", "desc").limit(10).get(),
    ref.collection("billing").doc("subscription").get(),
    ref.collection("members").get(),
    ...["posts", "promotions", "leads", "sales", "costs"].map((c) => count(ref.collection(c))),
  ]);
  await audit(admin, "view_workspace", p.data.workspaceId);
  const b = billing.data();
  return {
    summary: await summarize(w.id, w.data()!),
    workspace: plain({ ...w.data(), ownerUid: undefined }),
    members: members.docs.map((m) => ({ uid: m.id, role: m.data().role, status: m.data().status })),
    counts: { posts: counts[0], promotions: counts[1], leads: counts[2], sales: counts[3], costs: counts[4] },
    connections: conns.docs.map((c) => plain({ id: c.id, provider: c.data().provider, status: c.data().status, shop: c.data().shop, customerId: c.data().customerId, lastSyncedAt: c.data().lastSyncedAt, lastError: c.data().lastError, scopes: c.data().scopes })),
    usage: usage.docs.map((u) => plain({ id: u.id, ...u.data() })),
    imports: imports.docs.map((i) => plain({ id: i.id, status: i.data().status, collection: i.data().collection, counts: i.data().counts, createdAt: i.data().createdAt })),
    recommendations: recs.docs.map((r) => plain({ id: r.id, status: r.data().status, mode: r.data().mode, category: r.data().category, createdAt: r.data().createdAt })),
    billing: b ? plain({ status: b.status, plan: b.plan, currentPeriodEndsAt: b.currentPeriodEndsAt, subscriptionId: b.subscriptionId }) : null,
  };
});

export const adminSetSuspension = onCall(async (request) => {
  const admin = requireAdmin(request, "suspend_workspace", { fresh: true });
  const p = wsId.extend({ suspended: z.boolean(), reason }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "Workspace not found.");
  const before = Boolean(w.data()!.suspended);
  if (p.data.suspended) await ref.update({ suspended: true, suspendedAt: FieldValue.serverTimestamp(), suspendedReason: p.data.reason });
  else await ref.update({ suspended: FieldValue.delete(), suspendedAt: FieldValue.delete(), suspendedReason: FieldValue.delete() });
  await audit(admin, p.data.suspended ? "suspend_workspace" : "reactivate_workspace", p.data.workspaceId, { reason: p.data.reason, before: { suspended: before }, after: { suspended: p.data.suspended } });
  return { ok: true };
});

/** Manual plan override (e.g. a comped Custom customer). Refused while a Paddle subscription exists: billing owns the plan then. */
export const adminChangePlan = onCall(async (request) => {
  const admin = requireAdmin(request, "change_plan", { fresh: true });
  const p = wsId.extend({ plan: z.enum(PLAN_IDS as [string, ...string[]]), reason }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const ref = db().doc(`workspaces/${p.data.workspaceId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "Workspace not found.");
  if (w.data()!.paddleSubscriptionId) throw new HttpsError("failed-precondition", "This workspace has a paid subscription. Change it through billing, not manually.");
  const before = w.data()!.plan;
  await ref.update({ plan: p.data.plan, planOverride: { by: admin.uid, reason: p.data.reason, at: FieldValue.serverTimestamp() } });
  await audit(admin, "change_plan", p.data.workspaceId, { reason: p.data.reason, before: { plan: before }, after: { plan: p.data.plan } });
  return { ok: true };
});

export const adminListRecommendations = onCall(async (request) => {
  const admin = requireAdmin(request, "read_recommendations");
  const p = z.object({ workspaceId: z.string().max(160).optional(), status: z.string().max(40).optional() }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  let q: FirebaseFirestore.Query = p.data.workspaceId ? db().collection(`workspaces/${p.data.workspaceId}/recommendations`) : db().collectionGroup("recommendations");
  if (p.data.status) q = q.where("status", "==", p.data.status);
  const snap = await q.orderBy("createdAt", "desc").limit(LIMIT).get();
  await audit(admin, "list_recommendations", p.data.workspaceId ?? "all", { meta: { status: p.data.status ?? null } });
  return { items: snap.docs.map((d) => plain({ id: d.id, workspaceId: d.ref.parent.parent!.id, status: d.data().status, mode: d.data().mode, category: d.data().category, engineVersion: d.data().engineVersion ?? d.data().version, createdAt: d.data().createdAt })) };
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
  const snap = await db().collectionGroup("imports").orderBy("createdAt", "desc").limit(LIMIT).get();
  await audit(admin, "list_imports", "all");
  return { items: snap.docs.map((d) => plain({ id: d.id, workspaceId: d.ref.parent.parent!.id, status: d.data().status, collection: d.data().collection, counts: d.data().counts, rowErrors: (d.data().rowErrors ?? []).slice(0, 5), createdAt: d.data().createdAt })) };
});

export const adminListIntegrations = onCall(async (request) => {
  const admin = requireAdmin(request, "read_integrations");
  const snap = await db().collectionGroup("connections").where("status", "in", ["connected", "needs_reconnect", "pending_account"]).limit(200).get();
  await audit(admin, "list_integrations", "all");
  return { items: snap.docs.map((d) => plain({ id: d.id, workspaceId: d.ref.parent.parent!.id, provider: d.data().provider, status: d.data().status, shop: d.data().shop, customerId: d.data().customerId, lastSyncedAt: d.data().lastSyncedAt, lastError: d.data().lastError, partialSync: d.data().partialSync })) };
});

export const adminJobs = onCall(async (request) => {
  const admin = requireAdmin(request, "read_jobs");
  const overdue = await db().collection("workspaces").where("reportNextRunAt", "<", Timestamp.fromMillis(Date.now() - 2 * 3600000)).limit(LIMIT).get();
  const mails = await db().collection("mail").limit(LIMIT).get();
  const deletions = await db().collection("deletionRequests").orderBy("requestedAt", "desc").limit(20).get();
  await audit(admin, "view_jobs", "system");
  return {
    overdueReports: overdue.docs.map((d) => ({ workspaceId: d.id, reportNextRunAt: plain(d.data().reportNextRunAt), attempts: d.data().reportAttempts ?? 0 })),
    mail: mails.docs.map((m) => plain({ id: m.id, kind: m.data().meta?.kind, state: m.data().delivery?.state ?? "queued", error: m.data().delivery?.error ?? null, attempts: m.data().delivery?.attempts ?? null })),
    deletions: deletions.docs.map((d) => plain({ workspaceId: d.id, status: d.data().status, requestedAt: d.data().requestedAt, scheduledFor: d.data().scheduledFor })),
  };
});

export const adminBilling = onCall(async (request) => {
  const admin = requireAdmin(request, "read_billing");
  const [problem, events] = await Promise.all([
    db().collection("workspaces").where("billingStatus", "in", ["past_due", "canceling", "restricted"]).limit(LIMIT).get(),
    db().collection("billingEvents").orderBy("receivedAt", "desc").limit(LIMIT).get(),
  ]);
  await audit(admin, "view_billing", "system");
  return {
    workspaces: await Promise.all(problem.docs.map((d) => summarize(d.id, d.data()))),
    events: events.docs.map((e) => plain({ id: e.id, type: e.data().type, workspaceId: e.data().workspaceId, outcome: e.data().outcome, receivedAt: e.data().receivedAt })),
  };
});

export const adminPlans = onCall(async (request) => {
  const admin = requireAdmin(request, "read_plans");
  await audit(admin, "view_plans", "system");
  return { plans: PLANS };
});

export const adminListAudit = onCall(async (request) => {
  requireAdmin(request, "read_audit");
  const p = z.object({ action: z.string().max(60).optional() }).safeParse(request.data ?? {});
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  let q: FirebaseFirestore.Query = db().collection("auditEvents");
  if (p.data.action) q = q.where("action", "==", p.data.action);
  const snap = await q.orderBy("createdAt", "desc").limit(100).get();
  return { items: snap.docs.map((d) => plain({ id: d.id, ...d.data() })) };
});

/** Grant or remove an admin role. Super admin only, fresh login, cannot change your own role, always audited. */
export const adminSetRole = onCall(async (request) => {
  const admin = requireAdmin(request, "manage_admins", { fresh: true });
  const p = z.object({ email: z.string().email(), role: z.enum([...ADMIN_ROLES, "none"] as [string, ...string[]]), reason }).safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid request.");
  const user = await getAuth().getUserByEmail(p.data.email).catch(() => null);
  if (!user) throw new HttpsError("not-found", "No user with that email.");
  if (user.uid === admin.uid) throw new HttpsError("failed-precondition", "You cannot change your own role.");
  if (!user.emailVerified) throw new HttpsError("failed-precondition", "That email is not verified.");
  const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
  const before = claims.role ?? null;
  if (p.data.role === "none") delete claims.role; else claims.role = p.data.role;
  await getAuth().setCustomUserClaims(user.uid, claims);
  await getAuth().revokeRefreshTokens(user.uid);
  await audit(admin, "set_admin_role", user.uid, { reason: p.data.reason, before: { role: before }, after: { role: p.data.role === "none" ? null : p.data.role }, meta: { email: p.data.email } });
  return { ok: true };
});
