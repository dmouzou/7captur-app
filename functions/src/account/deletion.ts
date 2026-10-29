import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineInt, defineString } from "firebase-functions/params";
import { z } from "zod";
import { PADDLE_API_KEY } from "../config";
import { addNotification } from "../notify/inapp";
import { APP_URL, enqueueMail } from "../notify/mail";
import { cancelNow } from "../billing/paddle";
import { disconnectAllConnections } from "../connections/disconnect";

export const DELETION_GRACE_DAYS = defineInt("DELETION_GRACE_DAYS", { default: 14 });
const PADDLE_ENV = defineString("PADDLE_ENV", { default: "sandbox" });
const input = z.object({ workspaceId: z.string().min(1).max(128) });
const FRESH_LOGIN_SECONDS = 300;

async function ownerOf(uid: string, workspaceId: string) {
  const db = getFirestore();
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!ws) throw new HttpsError("not-found", "Workspace not found.");
  if (ws.ownerUid !== uid) throw new HttpsError("permission-denied", "Only the workspace owner can do this.");
  return { db, ws };
}

async function mailOwner(uid: string, workspaceId: string, key: string, subject: string, body: string) {
  const db = getFirestore();
  const user = await getAuth().getUser(uid).catch(() => null);
  if (!user?.email || !user.emailVerified) return;
  await enqueueMail(db, key, { to: user.email, subject, text: `${body}\n\n${APP_URL}/`, html: `<p>${body}</p><p><a href="${APP_URL}/">Open 7Captur</a></p>`, meta: { workspaceId, kind: "deletion" } });
}

/**
 * Step 1: owner asks to delete the workspace. Requires a login from the last 5 minutes.
 * Nothing is deleted yet: there is a cancellable waiting period (DELETION_GRACE_DAYS, default 14).
 */
export const requestAccountDeletion = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const authTime = Number(request.auth?.token.auth_time ?? 0);
  if (Date.now() / 1000 - authTime > FRESH_LOGIN_SECONDS) throw new HttpsError("failed-precondition", "recent-login-required");
  const p = input.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { db, ws } = await ownerOf(uid, p.data.workspaceId);
  if (ws.deletionScheduledFor) return { scheduledFor: (ws.deletionScheduledFor as Timestamp).toDate().toISOString(), duplicate: true };

  const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS.value() * 86400000);
  const wid = p.data.workspaceId;
  await db.doc(`deletionRequests/${wid}`).set({ workspaceId: wid, ownerUid: uid, status: "pending", requestedAt: FieldValue.serverTimestamp(), scheduledFor: Timestamp.fromDate(scheduledFor) });
  await db.doc(`workspaces/${wid}`).update({ deletionScheduledFor: Timestamp.fromDate(scheduledFor) });
  const day = scheduledFor.toISOString().slice(0, 10);
  const body = `Your 7Captur workspace and its data will be permanently deleted on ${day}. You can cancel any time before then in Settings. Download your data first if you need it.`;
  await addNotification(db, wid, { kind: "deletion_scheduled", title: "Account deletion scheduled", body, priority: "high" });
  await mailOwner(uid, wid, `${wid}_deletion_${day}`, "Your 7Captur account is scheduled for deletion", body);
  return { scheduledFor: scheduledFor.toISOString(), duplicate: false };
});

export const cancelAccountDeletion = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = input.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { db } = await ownerOf(uid, p.data.workspaceId);
  const wid = p.data.workspaceId;
  await db.doc(`deletionRequests/${wid}`).set({ status: "cancelled", cancelledAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.doc(`workspaces/${wid}`).update({ deletionScheduledFor: FieldValue.delete() });
  await addNotification(db, wid, { kind: "deletion_cancelled", title: "Account deletion cancelled", body: "Your workspace will not be deleted." });
  return { ok: true };
});

/**
 * Step 2 (daily): permanently delete workspaces whose waiting period has ended. Order: stop billing,
 * revoke and delete connection credentials, delete uploads and queued emails, delete the workspace tree
 * and the user, then write a PII-free audit event. Idempotent: if a step throws, it runs again tomorrow.
 * Provider billing records stay in Paddle and our `billingEvents` log (no personal data) for accounting.
 */
export const processDeletions = onSchedule({ schedule: "every day 02:30", secrets: [PADDLE_API_KEY], timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const db = getFirestore();
  const due = await db.collection("deletionRequests").where("scheduledFor", "<=", Timestamp.now()).limit(20).get();
  for (const req of due.docs) {
    if (req.data().status !== "pending") continue;
    const wid = req.id;
    try {
      const wsRef = db.doc(`workspaces/${wid}`);
      const ws = (await wsRef.get()).data();
      const memberUids = (await wsRef.collection("members").get()).docs.map((d) => d.id);
      const billing = (await wsRef.collection("billing").doc("subscription").get()).data();
      if (billing?.subscriptionId && ["active", "past_due", "paused"].includes(billing.status)) {
        await cancelNow(PADDLE_ENV.value(), PADDLE_API_KEY.value(), billing.subscriptionId);
      }
      await disconnectAllConnections(db, wid);
      await getStorage().bucket().deleteFiles({ prefix: `workspaces/${wid}/`, force: true });
      const mails = await db.collection("mail").where("meta.workspaceId", "==", wid).get();
      await Promise.all(mails.docs.map((d) => d.ref.delete()));
      await db.recursiveDelete(wsRef);
      for (const uid of memberUids) {
        await db.doc(`users/${uid}`).delete();
        await getAuth().deleteUser(uid).catch((e) => { if ((e as { code?: string }).code !== "auth/user-not-found") throw e; });
      }
      await db.collection("auditEvents").add({ action: "account_deleted", workspaceId: wid, requestedAt: req.data().requestedAt, completedAt: FieldValue.serverTimestamp(), hadPlan: ws?.plan ?? null });
      await req.ref.set({ status: "completed", completedAt: FieldValue.serverTimestamp(), ownerUid: FieldValue.delete() }, { merge: true });
    } catch (err) {
      logger.error("deletion failed, will retry", { workspaceId: wid, err: String(err) });
    }
  }
});
