import { Firestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getPlan } from "../shared/plans";

import { localDate, localToday, periodIds } from "../shared/periods";
export { localDate, localToday, periodIds };

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

    const { plan, timezone } = ws.data() as { plan: string; timezone: string };
    const caps = getPlan(plan).recommendations;
    const ids = periodIds(now, timezone);
    const weekRef = wsRef.collection("usage").doc(ids.weekId);
    const monthRef = wsRef.collection("usage").doc(ids.monthId);
    const [week, month] = await Promise.all([tx.get(weekRef), tx.get(monthRef)]);
    const weekCount = (week.data()?.recommendations as number | undefined) ?? 0;
    const monthCount = (month.data()?.recommendations as number | undefined) ?? 0;

    if (weekCount >= caps.weekly) return { ok: false as const, reason: "weekly_limit" as const, resetsOn: ids.weeklyResetsOn };
    if (caps.monthly !== null && monthCount >= caps.monthly) {
      return { ok: false as const, reason: "monthly_limit" as const, resetsOn: ids.monthlyResetsOn };
    }

    tx.set(weekRef, { kind: "week", recommendations: weekCount + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(monthRef, { kind: "month", recommendations: monthCount + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(reqRef, { state: "reserved", weekId: ids.weekId, monthId: ids.monthId, createdAt: Timestamp.fromDate(now) });
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
    const { weekId, monthId } = req.data() as { weekId: string; monthId: string };
    const weekRef = wsRef.collection("usage").doc(weekId);
    const monthRef = wsRef.collection("usage").doc(monthId);
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
    const { plan, timezone } = ws.data() as { plan: string; timezone: string };
    const limit = getPlan(plan).importsPerMonth;
    const ids = periodIds(now, timezone);
    const monthRef = wsRef.collection("usage").doc(ids.monthId);
    const month = await tx.get(monthRef);
    const used = (month.data()?.imports as number | undefined) ?? 0;
    if (used >= limit) return { ok: false as const, limit, resetsOn: ids.monthlyResetsOn };
    tx.set(monthRef, { kind: "month", imports: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(reqRef, { state: "reserved", monthId: ids.monthId, createdAt: Timestamp.fromDate(now) });
    return { ok: true as const, duplicate: false };
  });
}

export async function releaseImport(db: Firestore, workspaceId: string, requestId: string) {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`import_${requestId}`);
  await db.runTransaction(async (tx) => {
    const req = await tx.get(reqRef);
    if (!req.exists || req.data()!.state !== "reserved") return;
    const monthRef = wsRef.collection("usage").doc((req.data() as { monthId: string }).monthId);
    const m = await tx.get(monthRef);
    tx.update(monthRef, { imports: Math.max(0, ((m.data()?.imports as number) ?? 1) - 1) });
    tx.update(reqRef, { state: "released" });
  });
}

export async function confirmImport(db: Firestore, workspaceId: string, requestId: string) {
  await db.doc(`workspaces/${workspaceId}/usageRequests/import_${requestId}`).update({ state: "consumed" });
}
