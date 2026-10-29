import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { defineInt, defineString } from "firebase-functions/params";
import { PADDLE_WEBHOOK_SECRET } from "../config";
import { enqueueMail, APP_URL } from "../notify/mail";
import { parsePriceMap, reducePaddleEvent, verifyPaddleSignature, type Notify, type PaddleEvent, type PrevBilling } from "./paddle";

export const PADDLE_PRICE_MAP = defineString("PADDLE_PRICE_MAP", { default: "{}" });
export const BILLING_GRACE_DAYS = defineInt("BILLING_GRACE_DAYS", { default: 7 });

const MAIL: Record<Notify, { subject: string; body: string }> = {
  payment_failed: { subject: "Action needed: your 7Captur payment did not go through", body: "We could not process your latest payment. Update your payment method under Billing in the app to keep your plan." },
  subscription_ending: { subject: "Your 7Captur subscription is set to end", body: "Your subscription is set to end at the close of the current billing period. You keep your plan until then, and your data stays available." },
  subscription_ended: { subject: "Your 7Captur subscription has ended", body: "Your paid plan has ended and your account is now on the Free plan. Your data and history are kept." },
};

export async function notifyOwner(wid: string, kind: Notify, idemKey: string) {
  const db = getFirestore();
  const ws = (await db.doc(`workspaces/${wid}`).get()).data();
  if (!ws) return;
  const user = await getAuth().getUser(ws.ownerUid).catch(() => null);
  if (!user?.email || !user.emailVerified) return;
  const m = MAIL[kind];
  const link = `${APP_URL}/`;
  await enqueueMail(db, idemKey, {
    to: user.email, subject: m.subject, text: `${m.body}\n\n${link}`,
    html: `<p>${m.body}</p><p><a href="${link}">Open 7Captur</a></p>`, meta: { workspaceId: wid, kind },
  });
}

/**
 * Paddle webhook. Subscription state is changed ONLY here, after the signature is verified
 * (spec AC-11). Idempotent on event_id, ignores out-of-order events, returns 5xx on failure so
 * Paddle retries.
 */
export const paddleWebhook = onRequest({ secrets: [PADDLE_WEBHOOK_SECRET], cors: false }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  const raw = (req.rawBody ?? Buffer.from("")).toString("utf8");
  if (!verifyPaddleSignature(raw, req.get("Paddle-Signature"), PADDLE_WEBHOOK_SECRET.value())) {
    res.status(401).send("Invalid signature"); return;
  }
  let ev: PaddleEvent;
  try { ev = JSON.parse(raw) as PaddleEvent; } catch { res.status(400).send("Bad JSON"); return; }
  if (!ev.event_id || !ev.event_type) { res.status(400).send("Bad event"); return; }

  const db = getFirestore();
  try {
    let wid = ev.data?.custom_data?.workspaceId;
    if (!wid) {
      const subId = ev.data?.id && ev.event_type.startsWith("subscription.") ? ev.data.id : ev.data?.subscription_id;
      if (subId) wid = (await db.collection("workspaces").where("paddleSubscriptionId", "==", subId).limit(1).get()).docs[0]?.id;
    }
    if (!wid || !(await db.doc(`workspaces/${wid}`).get()).exists) {
      logger.warn("paddle event without a known workspace", { eventId: ev.event_id, type: ev.event_type });
      res.status(200).send("ignored"); return;
    }

    const eventRef = db.doc(`billingEvents/${ev.event_id}`);
    const billingRef = db.doc(`workspaces/${wid}/billing/subscription`);
    const wsRef = db.doc(`workspaces/${wid}`);
    const notify = await db.runTransaction(async (tx) => {
      const [seen, billing] = await Promise.all([tx.get(eventRef), tx.get(billingRef)]);
      if (seen.exists) return null;
      const prev = (billing.data() ?? {}) as PrevBilling;
      const out = reducePaddleEvent(ev, prev, { priceMap: parsePriceMap(PADDLE_PRICE_MAP.value()), graceDays: BILLING_GRACE_DAYS.value() });
      tx.set(eventRef, { type: ev.event_type, workspaceId: wid, occurredAt: ev.occurred_at, outcome: out.action, receivedAt: FieldValue.serverTimestamp() });
      if (out.action !== "apply") return out.action === "notify_only" ? out.notify : null;
      tx.set(billingRef, { ...out.billing, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.update(wsRef, {
        plan: out.workspace.plan, billingStatus: out.workspace.billingStatus,
        restrictAt: out.workspace.restrictAt ? Timestamp.fromDate(new Date(out.workspace.restrictAt)) : null,
        paddleSubscriptionId: out.workspace.paddleSubscriptionId, paddleCustomerId: out.workspace.paddleCustomerId,
      });
      return out.notify ?? null;
    });
    if (notify) await notifyOwner(wid, notify, `${ev.event_id}_${notify}`);
    res.status(200).send("ok");
  } catch (err) {
    logger.error("paddle webhook failed", { eventId: ev.event_id, err: String(err) });
    res.status(500).send("retry");
  }
});
