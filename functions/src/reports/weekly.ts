import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { RecordCollection } from "../shared/records";
import { getPlan } from "../shared/plans";
import { enqueueMail, weeklyEmail } from "../notify/mail";
import { addNotification } from "../notify/inapp";
import { localToday, periodIds } from "../recommendations/usage";
import { loadWindow } from "../recommendations/generate";
import { buildWeeklyReport, type RecEvent } from "./buildReport";
import { addDays, nextWeeklyRun } from "./time";
import type { DecisionForReview } from "../decisions/sufficiency";

const MAX_ATTEMPTS = 3;

/** Dated window with pagination (same loader as recommendations), 90 days back so reviews have a baseline. */
async function loadRecords(db: Firestore, wid: string, bid: string, coll: RecordCollection, today: string) {
  const { rows } = await loadWindow(db, wid, bid, coll, addDays(today, -90), today);
  return rows;
}

const dateOf = (t: unknown, tz: string) => (t instanceof Timestamp ? localToday(t.toDate(), tz) : "1970-01-01");

/** Generates (idempotently) one workspace's weekly report and email. Returns what happened. */
export async function runWeeklyForWorkspace(db: Firestore, wid: string, now = new Date()): Promise<"created" | "suppressed" | "exists"> {
  const wsSnap = await db.doc(`workspaces/${wid}`).get();
  const ws = wsSnap.data()!;
  if (ws.deletionScheduledFor) return "suppressed";

  // Gate by plan: Growth and above only. Starter users see no weekly summary.
  const plan = getPlan(ws.plan);
  if (!plan.weeklySummary) return "suppressed";

  const tz = ws.timezone as string;
  const bizSnap = await db.collection(`workspaces/${wid}/businesses`).limit(1).get();
  const biz = bizSnap.docs[0];
  if (!biz) return "suppressed";
  const bid = biz.id;
  const today = localToday(now, tz);
  const weekId = periodIds(new Date(`${addDays(today, -7)}T12:00:00Z`), "UTC").weekId;

  const reportRef = db.doc(`workspaces/${wid}/reports/${weekId}`);
  if ((await reportRef.get()).exists) return "exists";

  const userSnap = await db.doc(`users/${ws.ownerUid}`).get();
  const prefs = (userSnap.data()?.notificationPrefs ?? {}) as { weeklyEmail?: boolean; weeklyStatusOnly?: boolean };

  const [posts, promotions, leads, sales, costs] = await Promise.all(
    (["posts", "promotions", "leads", "sales", "costs"] as const).map((c) => loadRecords(db, wid, bid, c, today)),
  );
  const recSnap = await db.collection(`workspaces/${wid}/recommendations`).where("businessId", "==", bid).limit(500).get();
  const evSnap = await db.collection(`workspaces/${wid}/recommendationEvents`).orderBy("createdAt", "desc").limit(500).get();
  const events: RecEvent[] = evSnap.docs.map((d) => ({ type: d.data().type as string, date: dateOf(d.data().createdAt, tz) }));

  const decSnap = await db.collection(`workspaces/${wid}/decisions`).limit(300).get();
  const decisions: DecisionForReview[] = decSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      decision: String(x.decision ?? ""),
      headline: String(x.headline ?? ""),
      reviewOn: String(x.reviewOn ?? "1970-01-01"),
      evidenceUsed: x.evidenceUsed ?? { windowStart: "1970-01-01", windowEnd: "1970-01-01" },
      expectedOutcome: x.expectedOutcome,
      outcome: x.outcome ?? null,
    };
  });

  const report = buildWeeklyReport({
    records: { posts, promotions, leads, sales, costs } as never,
    recommendations: recSnap.docs.map((d) => ({ id: d.id, action: d.data().action as string, status: d.data().status as string, createdDate: dateOf(d.data().createdAt, tz) })),
    events,
    decisions,
    historyDays: plan.historyDays,
    currency: biz.data().currency,
    today,
    weekId,
    statusOnly: prefs.weeklyStatusOnly === true,
  });
  if (!report) return "suppressed";

  try {
    await reportRef.create({ ...report, workspaceId: wid, generatedAt: FieldValue.serverTimestamp(), email: { state: "skipped" } });
  } catch (e) {
    if ((e as { code?: number }).code === 6) return "exists";
    throw e;
  }

  await addNotification(db, wid, { kind: "weekly_report", title: "Your weekly summary is ready", body: "See what changed last week, what is missing and what to focus on next." }, `weekly_${weekId}`);

  // Emit outcome_followup notification for decisions that are ready for review (once per decision)
  if (report.reviews?.ready && report.reviews.ready.length > 0) {
    for (const r of report.reviews.ready) {
      await addNotification(
        db,
        wid,
        {
          kind: "outcome_followup",
          title: "Decision ready for outcome review",
          body: r.prompt,
        },
        `followup_${r.id}`
      );
    }
  }

  // Email: preference-controlled, verified address only, idempotent per workspace and week.
  if (prefs.weeklyEmail !== false) {
    const user = await getAuth().getUser(ws.ownerUid).catch(() => null);
    if (user?.email && user.emailVerified) {
      const m = weeklyEmail();
      const queued = await enqueueMail(db, `${wid}_${weekId}_weekly`, { to: user.email, ...m, meta: { workspaceId: wid, kind: "weekly_report", weekId } });
      await reportRef.update({ email: { state: queued ? "queued" : "duplicate" } });
    }
  }
  return "created";
}

/**
 * Hourly: pick workspaces whose next run time has passed, generate, then schedule the next Monday 08:00
 * local time. Bounded retries per workspace; after MAX_ATTEMPTS the week is skipped and the error is kept.
 */
export const weeklyReports = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const db = getFirestore();
  const now = new Date();
  const due = await db.collection("workspaces").where("reportNextRunAt", "<=", Timestamp.fromDate(now)).limit(100).get();
  for (const doc of due.docs) {
    const tz = doc.data().timezone as string;
    const attempts = (doc.data().reportJob?.attempts as number | undefined) ?? 0;
    try {
      const outcome = await runWeeklyForWorkspace(db, doc.id, now);
      await doc.ref.update({ reportNextRunAt: Timestamp.fromDate(nextWeeklyRun(now, tz)), reportJob: { lastStatus: outcome, lastRunAt: FieldValue.serverTimestamp(), attempts: 0 } });
    } catch (err) {
      logger.error("weekly report failed", { workspaceId: doc.id, attempts: attempts + 1, err: String(err) });
      const giveUp = attempts + 1 >= MAX_ATTEMPTS;
      await doc.ref.update({
        reportNextRunAt: Timestamp.fromDate(giveUp ? nextWeeklyRun(now, tz) : new Date(now.getTime() + 60 * 60 * 1000)),
        reportJob: { lastStatus: giveUp ? "failed" : "retrying", lastError: String(err).slice(0, 300), lastRunAt: FieldValue.serverTimestamp(), attempts: giveUp ? 0 : attempts + 1 },
      });
    }
  }
});
