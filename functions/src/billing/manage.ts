import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import { z } from "zod";
import { PADDLE_API_KEY } from "../config";
import { PLAN_IDS } from "../shared/plans";
import { requireMember } from "../workspaces/access";
import { PADDLE_PRICE_MAP, notifyOwner } from "./webhook";
import { cancelAtPeriodEnd, changeMode, changeSubscriptionPrice, createPortalSession, parsePriceMap } from "./paddle";

const PADDLE_ENV = defineString("PADDLE_ENV", { default: "sandbox" });
const wsInput = z.object({ workspaceId: z.string().min(1).max(128) });
const changeInput = wsInput.extend({ targetPlan: z.enum(PLAN_IDS as [string, ...string[]]) });

async function ownerBilling(uid: string, workspaceId: string) {
  const db = getFirestore();
  await requireMember(db, workspaceId, uid, false);
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!ws || ws.ownerUid !== uid) throw new HttpsError("permission-denied", "Only the workspace owner can manage billing.");
  const billing = (await db.doc(`workspaces/${workspaceId}/billing/subscription`).get()).data();
  return { ws, billing };
}

/** Secure Paddle-hosted page for payment method, invoices and cancellation. */
export const createBillingPortalSession = onCall({ secrets: [PADDLE_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = wsInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { billing } = await ownerBilling(uid, p.data.workspaceId);
  if (!billing?.customerId || !billing?.subscriptionId) throw new HttpsError("failed-precondition", "No subscription to manage.");
  const url = await createPortalSession(PADDLE_ENV.value(), PADDLE_API_KEY.value(), billing.customerId, billing.subscriptionId);
  if (!url) throw new HttpsError("unavailable", "Could not open the billing page. Try again shortly.");
  return { url };
});

/**
 * Plan change for an existing paid subscriber. This only asks Paddle to change the subscription;
 * our plan field changes when the verified webhook arrives, never from this call.
 */
export const changeSubscriptionPlan = onCall({ secrets: [PADDLE_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = changeInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { ws, billing } = await ownerBilling(uid, p.data.workspaceId);
  if (!billing?.subscriptionId) throw new HttpsError("failed-precondition", "Subscribe first.");
  if (ws.billingStatus === "past_due") throw new HttpsError("failed-precondition", "Fix your payment issue before changing plan.");
  if (p.data.targetPlan === "free") {
    const ok = await cancelAtPeriodEnd(PADDLE_ENV.value(), PADDLE_API_KEY.value(), billing.subscriptionId);
    if (!ok) throw new HttpsError("unavailable", "Could not schedule the cancellation. Try again.");
    return { ok: true, effective: "end_of_period" };
  }
  const priceMap = parsePriceMap(PADDLE_PRICE_MAP.value());
  const priceId = Object.entries(priceMap).find(([, plan]) => plan === p.data.targetPlan)?.[0];
  if (!priceId) throw new HttpsError("failed-precondition", "That plan is not available for self-serve yet.");
  if (p.data.targetPlan === ws.plan) throw new HttpsError("failed-precondition", "You are already on that plan.");
  const ok = await changeSubscriptionPrice(PADDLE_ENV.value(), PADDLE_API_KEY.value(), billing.subscriptionId, priceId, changeMode(ws.plan, p.data.targetPlan));
  if (!ok) throw new HttpsError("unavailable", "Could not change your plan. Try again.");
  return { ok: true, effective: "pending_confirmation" };
});

/** Daily: restrict paid features once a grace period or paid-through date has passed. History is never deleted. */
export const enforceBilling = onSchedule("every day 03:30", async () => {
  const db = getFirestore();
  const due = await db.collection("workspaces").where("restrictAt", "<=", Timestamp.now()).limit(200).get();
  for (const doc of due.docs) {
    try {
      const status = doc.data().billingStatus === "past_due" ? "restricted" : "canceled";
      await doc.ref.update({ plan: "free", billingStatus: status, restrictAt: null });
      await db.doc(`workspaces/${doc.id}/billing/subscription`).set({ restrictedAt: FieldValue.serverTimestamp(), plan: "free" }, { merge: true });
      // A scheduled cancellation also gets Paddle's own subscription.canceled event, which sends the email.
      if (status === "restricted") await notifyOwner(doc.id, "subscription_ended", `${doc.id}_restrict_${doc.data().paddleSubscriptionId ?? ""}`);
    } catch (err) { logger.error("enforceBilling failed", { workspaceId: doc.id, err: String(err) }); }
  }
  logger.info(`enforceBilling processed ${due.size} workspace(s).`);
});
