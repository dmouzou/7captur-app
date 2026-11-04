import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import { z } from "zod";
import { PADDLE_API_KEY } from "../config";
import { requireMember } from "../workspaces/access";
import { accountPath, applyAccountPatchIf, bootstrapOwners, ensureAccountForWorkspace } from "../accounts/account";
import { PADDLE_PRICE_MAP, notifyOwner } from "./webhook";
import { cancelAtPeriodEnd, changeMode, changeSubscriptionPrice, createPortalSession, parsePriceMap } from "./paddle";

const PADDLE_ENV = defineString("PADDLE_ENV", { default: "sandbox" });
const wsInput = z.object({ workspaceId: z.string().min(1).max(128) });
const changeInput = wsInput.extend({ targetPlan: z.enum(["starter", "growth", "custom", "free", "cancel"]) });

async function ownerBilling(uid: string, workspaceId: string) {
  const db = getFirestore();
  await requireMember(db, workspaceId, uid, false);
  const owned = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!owned || owned.ownerUid !== uid) throw new HttpsError("permission-denied", "Only the workspace owner can manage billing.");
  // Billing belongs to the account, not to one workspace. `ws` below is the account state (plan, billingStatus).
  const { account: ws } = await ensureAccountForWorkspace(db, workspaceId);
  const billing = (await db.doc(`${accountPath(uid)}/billing/subscription`).get()).data();
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
  if (p.data.targetPlan === "free" || p.data.targetPlan === "cancel") {
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
  // Workspaces that pre-date accounts get their account first, so they are never skipped.
  await bootstrapOwners(db, (await db.collection("workspaces").where("restrictAt", "<=", Timestamp.now()).limit(200).get()).docs);
  const due = await db.collection("accounts").where("restrictAt", "<=", Timestamp.now()).limit(200).get();
  for (const doc of due.docs) {
    try {
      // A super admin plan override sticks until a super admin clears it.
      if ((await db.doc(`planOverrides/${doc.id}`).get()).exists) continue;
      const status = doc.data().billingStatus === "past_due" ? "restricted" : "canceled";
      // Only if nothing changed since we read it: a Paddle event that just arrived wins.
      const applied = await applyAccountPatchIf(db, doc.id, { billingStatus: doc.data().billingStatus, restrictAtMs: doc.data().restrictAt?.toMillis?.() ?? null }, { billingStatus: status, restrictAt: null });
      if (!applied) continue;
      await db.doc(`${accountPath(doc.id)}/billing/subscription`).set({ restrictedAt: FieldValue.serverTimestamp() }, { merge: true });
      const primary = (doc.data().primaryWorkspaceId as string | undefined) ?? "";
      // A scheduled cancellation also gets Paddle's own subscription.canceled event, which sends the email.
      if (status === "restricted" && primary) await notifyOwner(primary, "subscription_ended", `${primary}_restrict_${doc.data().paddleSubscriptionId ?? ""}`);
    } catch (err) { logger.error("enforceBilling failed", { accountId: doc.id, err: String(err) }); }
  }
  logger.info(`enforceBilling processed ${due.size} account(s).`);
});
