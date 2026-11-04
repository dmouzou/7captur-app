import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { addNotification, type NotificationKind } from "../notify/inapp";
import { APP_URL, enqueueMail } from "../notify/mail";
import { applyAccountPatchIf, bootstrapOwners } from "../accounts/account";

const DAY_MS = 24 * 60 * 60 * 1000;

interface WorkspaceDoc {
  id: string;
  name?: string;
  ownerUid: string;
  ownerEmail?: string;
  billingStatus: string;
  plan: string;
  trialEndsAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  deletionScheduledFor?: Timestamp | null;
}

export async function sendTrialNotice(
  db: Firestore,
  ws: WorkspaceDoc,
  notice: {
    kind: NotificationKind;
    idemKey: string;
    title: string;
    body: string;
    emailSubject: string;
    emailBody: string;
    priority?: "normal" | "high";
  }
): Promise<void> {
  await addNotification(
    db,
    ws.id,
    {
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      priority: notice.priority ?? "normal",
    },
    notice.idemKey
  );

  let email = ws.ownerEmail;
  if (!email && ws.ownerUid) {
    try {
      const user = await getAuth().getUser(ws.ownerUid);
      if (user?.email) email = user.email;
    } catch {
      // Ignore if auth not available
    }
  }

  if (email) {
    const link = `${APP_URL}/`;
    await enqueueMail(db, notice.idemKey, {
      to: email,
      subject: notice.emailSubject,
      text: `${notice.emailBody}\n\n${link}`,
      html: `<p>${notice.emailBody}</p><p><a href="${link}">Open 7Captur</a></p>`,
      meta: { workspaceId: ws.id, kind: notice.kind },
    });
  }
}

/**
 * Evaluates trial lifecycle transitions and reminders for a single workspace.
 * Idempotent: safe to run multiple times per day.
 */
export async function processWorkspaceTrial(
  db: Firestore,
  ws: WorkspaceDoc,
  now = new Date()
): Promise<"reminded_10" | "reminded_13" | "expired" | "pre_deletion" | "none"> {
  if (!ws.trialEndsAt) return "none";
  const nowMs = now.getTime();
  const endsAtMs = ws.trialEndsAt.toMillis();
  const remainingMs = endsAtMs - nowMs;
  const daysLeft = Math.ceil(remainingMs / DAY_MS);

  // 1. Reminders for workspaces currently in trial
  if (ws.billingStatus === "trialing") {
    // Expiry: day 14 has passed without subscription
    if (nowMs >= endsAtMs) {
      await db.doc(`workspaces/${ws.id}`).update({
        billingStatus: "trial_expired",
        updatedAt: FieldValue.serverTimestamp(),
      });
      await sendTrialNotice(db, ws, {
        kind: "trial_expired",
        idemKey: `trial_expired_${ws.id}`,
        title: "Your 14-day trial has ended",
        body: "Your 14-day Starter trial has expired and your workspace is now read-only. Subscribe at any time to restore full editing access and continue with 7Captur.",
        emailSubject: "Your 7Captur trial has ended",
        emailBody: "Your 14-day Starter trial has expired and your workspace is now in read-only mode. You can export or view your records at any time. To continue adding records and generating advice, subscribe to a plan.",
        priority: "high",
      });
      return "expired";
    }

    // Day 13 reminder (<= 1 day left)
    if (daysLeft <= 1) {
      await sendTrialNotice(db, ws, {
        kind: "trial_reminder_13",
        idemKey: `trial_reminder_13_${ws.id}`,
        title: "1 day left in your trial",
        body: "Your Starter trial ends tomorrow. Your workspace will become read-only unless you choose a plan.",
        emailSubject: "1 day left in your 7Captur trial",
        emailBody: "Your 14-day trial ends tomorrow. Upgrade or select a plan to prevent interruption and keep your marketing workflows active.",
        priority: "high",
      });
      return "reminded_13";
    }

    // Day 10 reminder (<= 4 days left)
    if (daysLeft <= 4) {
      await sendTrialNotice(db, ws, {
        kind: "trial_reminder_10",
        idemKey: `trial_reminder_10_${ws.id}`,
        title: "4 days left in your trial",
        body: "You have 4 days remaining on your Starter trial. Explore recommendations and subscribe to keep full access.",
        emailSubject: "4 days left in your 7Captur trial",
        emailBody: "You have 4 days left in your 14-day Starter trial. Choose a plan whenever you're ready to lock in your subscription.",
        priority: "normal",
      });
      return "reminded_10";
    }
  }

  // 2. Pre-deletion notice: 30 days after expiry
  if (ws.billingStatus === "trial_expired") {
    const expiredForMs = nowMs - endsAtMs;
    const daysSinceExpiry = Math.floor(expiredForMs / DAY_MS);

    if (daysSinceExpiry >= 30 && !ws.deletionScheduledFor) {
      const scheduledFor = new Date(nowMs + 14 * DAY_MS);
      const scheduledDay = scheduledFor.toISOString().slice(0, 10);

      await db.doc(`workspaces/${ws.id}`).update({
        deletionScheduledFor: Timestamp.fromDate(scheduledFor),
      });

      await db.doc(`deletionRequests/${ws.id}`).set({
        workspaceId: ws.id,
        ownerUid: ws.ownerUid,
        status: "pending",
        reason: "trial_expired_inactivity_30d",
        requestedAt: FieldValue.serverTimestamp(),
        scheduledFor: Timestamp.fromDate(scheduledFor),
      }, { merge: true });

      await sendTrialNotice(db, ws, {
        kind: "pre_deletion",
        idemKey: `pre_deletion_${ws.id}`,
        title: "Workspace scheduled for deletion",
        body: `Your trial expired 30 days ago. Your workspace and records are scheduled for permanent deletion on ${scheduledDay}. Download your data or subscribe to cancel deletion.`,
        emailSubject: "Action required: your 7Captur workspace is scheduled for deletion",
        emailBody: `Your 7Captur workspace has been inactive for 30 days following trial expiry. It is scheduled for deletion on ${scheduledDay}. You can export your data now or subscribe to keep your workspace.`,
        priority: "high",
      });

      return "pre_deletion";
    }
  }

  return "none";
}

/** Scheduled job: runs daily to process trial reminders, expiration, and pre-deletion. Trials belong to the account. */
export const trialLifecycle = onSchedule("every day 04:00", async () => {
  const db = getFirestore();
  const now = new Date();

  // Workspaces that pre-date accounts get their account first, so they are never skipped.
  await bootstrapOwners(db, (await db.collection("workspaces").where("billingStatus", "in", ["trialing", "trial_expired"]).limit(300).get()).docs);
  const trialingSnap = await db.collection("accounts")
    .where("billingStatus", "in", ["trialing", "trial_expired"])
    .limit(300)
    .get();

  let count = 0;
  for (const acc of trialingSnap.docs) {
    try {
      if ((await db.doc(`planOverrides/${acc.id}`).get()).exists) continue; // override sticks until cleared
      const a = acc.data();
      const primaryId = a.primaryWorkspaceId as string | undefined;
      if (!primaryId) continue;
      const wsSnap = await db.doc(`workspaces/${primaryId}`).get();
      if (!wsSnap.exists) continue;
      // Reminders and notices go through the primary workspace; the plan state comes from the account.
      const ws = { ...(wsSnap.data() as Omit<WorkspaceDoc, "id">), id: primaryId, billingStatus: a.billingStatus, plan: a.plan, trialEndsAt: a.trialEndsAt ?? null };
      // Expire the trial on the account first, and only if it is still trialing: a subscription that just arrived wins.
      const expiring = a.billingStatus === "trialing" && a.trialEndsAt && now.getTime() >= a.trialEndsAt.toMillis();
      if (expiring && !(await applyAccountPatchIf(db, acc.id, { billingStatus: "trialing" }, { billingStatus: "trial_expired" }))) continue;
      await processWorkspaceTrial(db, ws, now);
      count++;
    } catch (err) {
      logger.error("trialLifecycle failed for account", { accountId: acc.id, err: String(err) });
    }
  }

  logger.info(`trialLifecycle processed ${count} accounts.`);
});
