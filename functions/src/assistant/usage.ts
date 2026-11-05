import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getPlan } from "../shared/plans";
import { periodIds } from "../shared/periods";
import { accountOfTx, usageBase, type WsData } from "../recommendations/usage";

/**
 * Assistant credits. A free-form assistant answer uses ONE credit from the same monthly AI pool as follow-up
 * questions (accounts/{ownerUid}/usage/{monthId}.aiFollowUps). It has no per-decision cap, because a chat
 * question is not about one decision, so it never touches followupCounts. Idempotent on requestId.
 */
export type AssistantReserve =
  | { ok: true; duplicate: boolean; used: number; limit: number; monthId: string; resetsOn: string }
  | { ok: false; reason: "monthly_limit"; limit: number; used: number; resetsOn: string };


export async function reserveAssistant(db: Firestore, workspaceId: string, requestId: string, now = new Date()): Promise<AssistantReserve> {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`as_${requestId}`);
  return db.runTransaction(async (tx) => {
    const [ws, existing] = await Promise.all([tx.get(wsRef), tx.get(reqRef)]);
    if (!ws.exists) throw new Error("workspace not found");
    const { accountRef, accountId, plan, timezone } = await accountOfTx(db, tx, ws.data() as WsData);
    const limit = getPlan(plan).aiFollowUps.monthly;
    const ids = periodIds(now, timezone);
    const monthRef = accountRef.collection("usage").doc(ids.monthId);
    const month = await tx.get(monthRef);
    const used = (month.data()?.aiFollowUps as number | undefined) ?? 0;
    if (existing.exists && existing.data()!.state !== "released") {
      return { ok: true as const, duplicate: true, used, limit, monthId: ids.monthId, resetsOn: ids.monthlyResetsOn };
    }
    if (used >= limit) return { ok: false as const, reason: "monthly_limit" as const, limit, used, resetsOn: ids.monthlyResetsOn };
    tx.set(monthRef, { kind: "month", aiFollowUps: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(reqRef, { kind: "assistant", state: "reserved", accountId, monthId: ids.monthId, createdAt: Timestamp.fromDate(now) });
    return { ok: true as const, duplicate: false, used: used + 1, limit, monthId: ids.monthId, resetsOn: ids.monthlyResetsOn };
  });
}

/** The AI failed or its answer was rejected: the credit goes back. Safe to call twice. */
export async function releaseAssistant(db: Firestore, workspaceId: string, requestId: string): Promise<boolean> {
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const reqRef = wsRef.collection("usageRequests").doc(`as_${requestId}`);
  return db.runTransaction(async (tx) => {
    const req = await tx.get(reqRef);
    if (!req.exists || req.data()!.state !== "reserved") return false;
    const { monthId, accountId } = req.data() as { monthId: string; accountId?: string };
    const monthRef = usageBase(db, workspaceId, accountId).collection("usage").doc(monthId);
    const m = await tx.get(monthRef);
    tx.update(monthRef, { aiFollowUps: Math.max(0, ((m.data()?.aiFollowUps as number) ?? 1) - 1) });
    tx.update(reqRef, { state: "released" });
    return true;
  });
}

/** Real token usage is recorded on the account's month for cost tracking, whether or not the credit was kept. */
export async function addAssistantTokens(db: Firestore, workspaceId: string, requestId: string, tokens: { input: number; output: number }) {
  if (tokens.input + tokens.output <= 0) return;
  const req = (await db.doc(`workspaces/${workspaceId}`).collection("usageRequests").doc(`as_${requestId}`).get()).data() as { accountId?: string; monthId?: string } | undefined;
  if (!req?.monthId) return;
  await usageBase(db, workspaceId, req.accountId).collection("usage").doc(req.monthId).set(
    { aiInputTokens: FieldValue.increment(tokens.input), aiOutputTokens: FieldValue.increment(tokens.output) }, { merge: true });
}

/** The answer was delivered: the credit is final. The answer is kept so a retry with the same requestId returns it. */
export async function confirmAssistant(db: Firestore, workspaceId: string, requestId: string, answer: string, tokens: { input: number; output: number }) {
  await db.doc(`workspaces/${workspaceId}`).collection("usageRequests").doc(`as_${requestId}`).update({ state: "consumed", answer });
  await addAssistantTokens(db, workspaceId, requestId, tokens);
}

/** The stored answer of an already-consumed request, for retries. */
export async function storedAssistantAnswer(db: Firestore, workspaceId: string, requestId: string): Promise<string | null> {
  const d = (await db.doc(`workspaces/${workspaceId}`).collection("usageRequests").doc(`as_${requestId}`).get()).data() as { state?: string; answer?: string } | undefined;
  return d?.state === "consumed" && d.answer ? d.answer : null;
}

