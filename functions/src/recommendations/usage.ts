import { Firestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getPlan } from "../shared/plans";

import { localDate, localToday, periodIds } from "../shared/periods";
export { localDate, localToday, periodIds };

export interface WsData { ownerUid?: string; plan?: string; timezone?: string }

/**
 * Allowances (recommendations, imports, AI follow-ups) are shared by all workspaces of an account, so the
 * counters live at accounts/{ownerUid}/usage/{periodId}. The plan and the reset timezone come from the account.
 * Callers run ensureAccountForWorkspace first, so the account exists for workspaces that pre-date accounts.
 */
export async function accountOfTx(db: Firestore, tx: FirebaseFirestore.Transaction, ws: WsData) {
  if (!ws.ownerUid) throw new Error("workspace has no owner");
  const accountRef = db.doc(`accounts/${ws.ownerUid}`);
  const acct = await tx.get(accountRef);
  if (!acct.exists) throw new Error("account not found");
  const a = acct.data() as { plan?: string; timezone?: string };
  return { accountRef, accountId: ws.ownerUid, plan: a.plan ?? "starter", timezone: a.timezone ?? ws.timezone ?? "UTC" };
}

/** Where a reservation's counters live. Reservations made before accounts existed used the workspace. */
export function usageBase(db: Firestore, workspaceId: string, accountId?: string) {
  return db.doc(accountId ? `accounts/${accountId}` : `workspaces/${workspaceId}`);
}

export type ReserveResult =
  | { ok: true; reservationId: string; duplicate: boolean }
  | { ok: false; reason: "weekly_limit" | "monthly_limit"; resetsOn: string };

/**
 * Atomically reserve one recommendation credit. Idempotent on requestId, so retries
 * and parallel calls cannot double count or bypass the cap. Call confirmReservation after
 * the recommendation is stored, or releaseReservation if generation fails.
 */
export async function reserveRecommendation(
  db: Firestore, workspaceId: string, requestId: string, now = new Date()
): Promise<ReserveResult> {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(requestId);

  return db.runTransaction(async (tx) => {
    const [ws, existing] = await Promise.all([tx.get(wsRef), tx.get(reqRef)]);
    if (!ws.exists) throw new Error("workspace not found");
    if (existing.exists && existing.data()!.state !== "released") {
      return { ok: true as const, reservationId: requestId, duplicate: true };
    }

    const { accountRef, accountId, plan, timezone } = await accountOfTx(db, tx, ws.data() as WsData);
    const caps = getPlan(plan).recommendations;
    const ids = periodIds(now, timezone);
    const weekRef = accountRef.collection("usage").doc(ids.weekId);
    const monthRef = accountRef.collection("usage").doc(ids.monthId);
    const [week, month] = await Promise.all([tx.get(weekRef), tx.get(monthRef)]);
    const weekCount = (week.data()?.recommendations as number | undefined) ?? 0;
    const monthCount = (month.data()?.recommendations as number | undefined) ?? 0;

    if (weekCount >= caps.weekly) return { ok: false as const, reason: "weekly_limit" as const, resetsOn: ids.weeklyResetsOn };
    if (caps.monthly !== null && monthCount >= caps.monthly) {
      return { ok: false as const, reason: "monthly_limit" as const, resetsOn: ids.monthlyResetsOn };
    }

    tx.set(weekRef, { kind: "week", recommendations: weekCount + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(monthRef, { kind: "month", recommendations: monthCount + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(reqRef, { state: "reserved", accountId, weekId: ids.weekId, monthId: ids.monthId, createdAt: Timestamp.fromDate(now) });
    return { ok: true as const, reservationId: requestId, duplicate: false };
  });
}

/** Failed generation: give the credit back. Safe to call twice. */
export async function releaseReservation(db: Firestore, workspaceId: string, requestId: string) {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(requestId);
  await db.runTransaction(async (tx) => {
    const req = await tx.get(reqRef);
    if (!req.exists || req.data()!.state !== "reserved") return;
    const { weekId, monthId, accountId } = req.data() as { weekId: string; monthId: string; accountId?: string };
    const base = usageBase(db, workspaceId, accountId);
    const weekRef = base.collection("usage").doc(weekId);
    const monthRef = base.collection("usage").doc(monthId);
    const [w, m] = await Promise.all([tx.get(weekRef), tx.get(monthRef)]);
    tx.update(weekRef, { recommendations: Math.max(0, ((w.data()?.recommendations as number) ?? 1) - 1) });
    tx.update(monthRef, { recommendations: Math.max(0, ((m.data()?.recommendations as number) ?? 1) - 1) });
    tx.update(reqRef, { state: "released" });
  });
}

/** Recommendation stored successfully: the credit is final. */
export async function confirmReservation(db: Firestore, workspaceId: string, requestId: string) {
  await db.doc(`workspaces/${workspaceId}/usageRequests/${requestId}`).update({ state: "consumed" });
}

export type ImportReserve =
  | { ok: true; duplicate: boolean }
  | { ok: false; limit: number; resetsOn: string };

/** Monthly import-job quota. Atomic and idempotent on requestId, like recommendation credits. */
export async function reserveImport(db: Firestore, workspaceId: string, requestId: string, now = new Date()): Promise<ImportReserve> {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`import_${requestId}`);
  return db.runTransaction(async (tx) => {
    const [ws, existing] = await Promise.all([tx.get(wsRef), tx.get(reqRef)]);
    if (!ws.exists) throw new Error("workspace not found");
    if (existing.exists && existing.data()!.state !== "released") return { ok: true as const, duplicate: true };
    const { accountRef, accountId, plan, timezone } = await accountOfTx(db, tx, ws.data() as WsData);
    const limit = getPlan(plan).importsPerMonth;
    const ids = periodIds(now, timezone);
    const monthRef = accountRef.collection("usage").doc(ids.monthId);
    const month = await tx.get(monthRef);
    const used = (month.data()?.imports as number | undefined) ?? 0;
    if (used >= limit) return { ok: false as const, limit, resetsOn: ids.monthlyResetsOn };
    tx.set(monthRef, { kind: "month", imports: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(reqRef, { state: "reserved", accountId, monthId: ids.monthId, createdAt: Timestamp.fromDate(now) });
    return { ok: true as const, duplicate: false };
  });
}

export async function releaseImport(db: Firestore, workspaceId: string, requestId: string) {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`import_${requestId}`);
  await db.runTransaction(async (tx) => {
    const req = await tx.get(reqRef);
    if (!req.exists || req.data()!.state !== "reserved") return;
    const { monthId, accountId } = req.data() as { monthId: string; accountId?: string };
    const monthRef = usageBase(db, workspaceId, accountId).collection("usage").doc(monthId);
    const m = await tx.get(monthRef);
    tx.update(monthRef, { imports: Math.max(0, ((m.data()?.imports as number) ?? 1) - 1) });
    tx.update(reqRef, { state: "released" });
  });
}

export async function confirmImport(db: Firestore, workspaceId: string, requestId: string) {
  await db.doc(`workspaces/${workspaceId}/usageRequests/import_${requestId}`).update({ state: "consumed" });
}
