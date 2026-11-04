import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getPlan } from "../shared/plans";
import { periodIds } from "../shared/periods";
import { accountOfTx, usageBase, type WsData } from "../recommendations/usage";

export type FollowUpReserve =
  | { ok: true; duplicate: boolean }
  | { ok: false; reason: "monthly_limit" | "decision_limit"; limit: number; resetsOn: string };

/**
 * Atomically reserve one AI follow-up credit: a monthly pool per workspace plus a cap per decision.
 * Separate from recommendation credits, which follow-ups never touch. Idempotent on requestId.
 */
export async function reserveFollowUp(db: Firestore, workspaceId: string, decisionId: string, requestId: string, now = new Date()): Promise<FollowUpReserve> {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`fu_${requestId}`);
  const countRef = wsRef.collection("followupCounts").doc(decisionId);
  return db.runTransaction(async (tx) => {
    const [ws, existing, count] = await Promise.all([tx.get(wsRef), tx.get(reqRef), tx.get(countRef)]);
    if (!ws.exists) throw new Error("workspace not found");
    if (existing.exists && existing.data()!.state !== "released") return { ok: true as const, duplicate: true };
    const { accountRef, accountId, plan, timezone } = await accountOfTx(db, tx, ws.data() as WsData);
    const caps = getPlan(plan).aiFollowUps;
    const ids = periodIds(now, timezone);
    const monthRef = accountRef.collection("usage").doc(ids.monthId);
    const month = await tx.get(monthRef);
    const usedMonth = (month.data()?.aiFollowUps as number | undefined) ?? 0;
    const usedDecision = (count.data()?.count as number | undefined) ?? 0;
    if (usedMonth >= caps.monthly) return { ok: false as const, reason: "monthly_limit" as const, limit: caps.monthly, resetsOn: ids.monthlyResetsOn };
    if (usedDecision >= caps.perDecision) return { ok: false as const, reason: "decision_limit" as const, limit: caps.perDecision, resetsOn: ids.monthlyResetsOn };
    tx.set(monthRef, { kind: "month", aiFollowUps: usedMonth + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(countRef, { count: usedDecision + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(reqRef, { state: "reserved", accountId, monthId: ids.monthId, decisionId, createdAt: Timestamp.fromDate(now) });
    return { ok: true as const, duplicate: false };
  });
}

/** AI unavailable or answer rejected: the credit goes back. Safe to call twice. */
export async function releaseFollowUp(db: Firestore, workspaceId: string, requestId: string) {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`fu_${requestId}`);
  await db.runTransaction(async (tx) => {
    const req = await tx.get(reqRef);
    if (!req.exists || req.data()!.state !== "reserved") return;
    const { monthId, decisionId, accountId } = req.data() as { monthId: string; decisionId: string; accountId?: string };
    const monthRef = usageBase(db, workspaceId, accountId).collection("usage").doc(monthId);
    const countRef = wsRef.collection("followupCounts").doc(decisionId);
    const [m, c] = await Promise.all([tx.get(monthRef), tx.get(countRef)]);
    tx.update(monthRef, { aiFollowUps: Math.max(0, ((m.data()?.aiFollowUps as number) ?? 1) - 1) });
    tx.update(countRef, { count: Math.max(0, ((c.data()?.count as number) ?? 1) - 1) });
    tx.update(reqRef, { state: "released" });
  });
}

/** Adds real token usage to the account's month for cost tracking. */
export async function addAiTokens(db: Firestore, workspaceId: string, requestId: string, monthId: string, tokens: { input: number; output: number }) {
  const reqRef = db.doc(`workspaces/${workspaceId}`).collection("usageRequests").doc(`fu_${requestId}`);
  const req = (await reqRef.get()).data() as { accountId?: string; monthId?: string } | undefined;
  // The reservation knows the account and the month it was counted in (account timezone); trust it over the caller's guess.
  await usageBase(db, workspaceId, req?.accountId).collection("usage").doc(req?.monthId ?? monthId).set(
    { aiInputTokens: FieldValue.increment(tokens.input), aiOutputTokens: FieldValue.increment(tokens.output) }, { merge: true });
}

/** Answer stored: the credit is final, and real token usage is added to the month for cost tracking. */
export async function confirmFollowUp(db: Firestore, workspaceId: string, requestId: string, monthId: string, tokens: { input: number; output: number }) {
  await db.doc(`workspaces/${workspaceId}`).collection("usageRequests").doc(`fu_${requestId}`).update({ state: "consumed" });
  await addAiTokens(db, workspaceId, requestId, monthId, tokens);
}
