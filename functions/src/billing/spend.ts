import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import { z } from "zod";
import { PADDLE_API_KEY } from "../config";
import { PLANS } from "../shared/plans";
import { addNotification } from "../notify/inapp";
import { APP_URL, enqueueMail } from "../notify/mail";
import { requireMember } from "../workspaces/access";
import { decideBandChange } from "./band";
import { changeSubscriptionPrice, parsePriceMap } from "./paddle";
import { PADDLE_PRICE_MAP } from "./webhook";
import { getAuth } from "firebase-admin/auth";

const PADDLE_ENV = defineString("PADDLE_ENV", { default: "sandbox" });
const input = z.object({ workspaceId: z.string().min(1).max(128), monthlySpendUsd: z.number().finite().min(0).max(1e9) });

/**
 * The owner reports monthly ad spend (labelled user-reported). If a Pro subscriber's band would change,
 * we notify in-app and by email now and schedule the change for the next billing date.
 */
export const setReportedSpend = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = input.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Enter a spend of 0 or more.");
  const { workspaceId, monthlySpendUsd } = p.data;
  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const ws = (await wsRef.get()).data();
  if (!ws) throw new HttpsError("not-found", "Workspace not found.");
  if (ws.ownerUid !== uid) throw new HttpsError("permission-denied", "Only the owner can change this.");

  const decision = decideBandChange(ws.plan, monthlySpendUsd, ws.pendingBandChange?.to ?? null);
  const update: Record<string, unknown> = { reportedSpendUsd: monthlySpendUsd, reportedSpendAt: FieldValue.serverTimestamp(), reportedSpendSource: "user_reported" };

  if (decision.action === "clear") update.pendingBandChange = FieldValue.delete();
  if (decision.action === "schedule") {
    const billing = (await db.doc(`workspaces/${workspaceId}/billing/subscription`).get()).data();
    const effective = billing?.currentPeriodEndsAt ? new Date(billing.currentPeriodEndsAt) : new Date(Date.now() + 30 * 86400000);
    update.pendingBandChange = { to: decision.to, effectiveAt: Timestamp.fromDate(effective), noticedAt: FieldValue.serverTimestamp() };
    const day = effective.toISOString().slice(0, 10);
    const title = "Your Pro price band will change";
    const body = `Based on the monthly ad spend you reported, your plan moves from ${PLANS[ws.plan as keyof typeof PLANS].name} to ${PLANS[decision.to].name} on ${day}. Nothing changes before then, and you can update your reported spend any time.`;
    await addNotification(db, workspaceId, { kind: "band_change", title, body, priority: "high" }, `band_${decision.to}_${day}`);
    const user = await getAuth().getUser(uid).catch(() => null);
    if (user?.email && user.emailVerified) {
      await enqueueMail(db, `${workspaceId}_band_${decision.to}_${day}`, {
        to: user.email, subject: title, text: `${body}\n\n${APP_URL}/`, html: `<p>${body}</p><p><a href="${APP_URL}/">Open 7Captur</a></p>`,
        meta: { workspaceId, kind: "band_change" },
      });
    }
  }
  await wsRef.update(update);
  return { decision: decision.action, to: decision.action === "schedule" ? decision.to : null };
});

/** Daily: apply scheduled band changes once their effective date has passed. */
export const applyBandChanges = onSchedule({ schedule: "every day 03:45", secrets: [PADDLE_API_KEY] }, async () => {
  const db = getFirestore();
  const due = await db.collection("workspaces").where("pendingBandChange.effectiveAt", "<=", Timestamp.now()).limit(100).get();
  const priceMap = parsePriceMap(PADDLE_PRICE_MAP.value());
  for (const doc of due.docs) {
    const ws = doc.data();
    const to = ws.pendingBandChange?.to as string;
    try {
      const billing = (await db.doc(`workspaces/${doc.id}/billing/subscription`).get()).data();
      const priceId = Object.entries(priceMap).find(([, plan]) => plan === to)?.[0];
      if (!billing?.subscriptionId || !priceId || ws.billingStatus !== "active") {
        logger.warn("band change skipped", { workspaceId: doc.id, status: ws.billingStatus });
        continue;
      }
      const ok = await changeSubscriptionPrice(PADDLE_ENV.value(), PADDLE_API_KEY.value(), billing.subscriptionId, priceId, "full_next_billing_period");
      if (ok) await doc.ref.update({ pendingBandChange: FieldValue.delete() });
      else logger.error("band change failed at provider", { workspaceId: doc.id });
    } catch (err) { logger.error("band change error", { workspaceId: doc.id, err: String(err) }); }
  }
});
