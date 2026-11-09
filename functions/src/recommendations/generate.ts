import { FieldPath, FieldValue, getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { generateRecommendationInput } from "../shared/recommendation";
import { recordSchemas, type RecordCollection } from "../shared/records";
import { requireMember } from "../workspaces/access";
import { runEngine, ENGINE_VERSION, addDays, WINDOW_DAYS } from "./engine";
import type { FxRates } from "../shared/fx";
import { explainWithAI } from "./explain";
import { ANTHROPIC_API_KEY } from "../config";
import { commercialRecordCount, NO_RECORDS_MESSAGE } from "./preflight";
import { confirmReservation, localToday, releaseReservation, reserveRecommendation } from "./usage";
import { ensureAccountForWorkspace } from "../accounts/account";
import { addNotification } from "../notify/inapp";

const PAGE = 500;
const MAX_PAGES = 40; // 20,000 records per collection is far beyond any 28-day window
/** The field each collection is dated by. Costs are loaded whole: recurring costs started before the window. */
const DATE_FIELD: Record<RecordCollection, string | null> = {
  posts: "publishedAt", promotions: "startDate", leads: "date", sales: "date", costs: null,
};

/** Loads by date window with pagination, so the engine sees every record in the window, not an arbitrary 500. */
export async function loadWindow(db: FirebaseFirestore.Firestore, wid: string, bid: string, coll: RecordCollection, from: string, to: string) {
  const field = DATE_FIELD[coll];
  const base = db.collection(`workspaces/${wid}/${coll}`).where("businessId", "==", bid);
  const q = field ? base.where(field, ">=", from).where(field, "<=", to).orderBy(field) : base.orderBy(FieldPath.documentId());
  const docs: QueryDocumentSnapshot[] = [];
  let last: QueryDocumentSnapshot | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const snap = await (last ? q.startAfter(last) : q).limit(PAGE).get();
    docs.push(...snap.docs);
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  const schema = recordSchemas[coll];
  let dropped = 0;
  const rows = docs.flatMap((d) => {
    const parsed = (schema as typeof recordSchemas.posts).safeParse(d.data());
    if (!parsed.success) { dropped++; return []; }
    // Retired label: screenshot reading was removed, so older rows read as manual entries.
    const raw = d.data().provenance as string | undefined;
    return [{ ...parsed.data, id: d.id, provenance: raw === "screenshot_extracted" ? "manual" : raw }];
  });
  return { rows, dropped };
}

/**
 * Generates one recommendation. Order matters: authorize, reserve credit atomically,
 * run deterministic engine, persist, confirm credit. Any failure releases the credit.
 * The recommendation id equals requestId, so a retry returns the same result.
 */
export const generateRecommendation = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = generateRecommendationInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { workspaceId, businessId, requestId, overrideSafetyNet } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);

  const recRef = db.doc(`workspaces/${workspaceId}/recommendations/${requestId}`);
  const [existing, biz, ws] = await Promise.all([
    recRef.get(),
    db.doc(`workspaces/${workspaceId}/businesses/${businessId}`).get(),
    db.doc(`workspaces/${workspaceId}`).get(),
  ]);
  if (existing.exists) return { recommendationId: requestId, duplicate: true };
  if (!biz.exists || !ws.exists) throw new HttpsError("not-found", "Business not found.");

  const today = localToday(new Date(), ws.data()!.timezone);
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const [[posts, promotions, leads, sales, costs], fxSnap, procSnap] = await Promise.all([
    Promise.all((["posts", "promotions", "leads", "sales", "costs"] as const).map((c) => loadWindow(db, workspaceId, businessId, c, from, today))),
    db.doc("config/fx").get(),
    db.collection(`workspaces/${workspaceId}/connections`).where("status", "==", "connected").get(),
  ]);

  // Hard rule, not overridable: no commercial records in the window means no recommendation and no credit used.
  if (commercialRecordCount({ posts: posts.rows, promotions: promotions.rows, leads: leads.rows, sales: sales.rows }) === 0) {
    throw new HttpsError("failed-precondition", NO_RECORDS_MESSAGE, { reason: "no_records" });
  }

  // Safety net: check for recent recommendation (<30 min), zero data, or no new data since last recommendation
  if (!overrideSafetyNet) {
    const lastRecSnap = await db.collection(`workspaces/${workspaceId}/recommendations`)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get()
      .catch(() => null);

    let lastRecTime: number | null = null;
    if (lastRecSnap && !lastRecSnap.empty) {
      const lastRecDoc = lastRecSnap.docs[0];
      const createdTs = lastRecDoc.data().createdAt;
      const ms = createdTs?.toMillis ? createdTs.toMillis() : createdTs ? new Date(createdTs).getTime() : 0;
      if (ms > 0) {
        lastRecTime = ms;
        const diffMinutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
        if (Date.now() - ms < 30 * 60 * 1000) {
          throw new HttpsError(
            "failed-precondition",
            `A recommendation was generated ${diffMinutes <= 1 ? "just now" : `${diffMinutes} minutes ago`}. We recommend reviewing existing recommendations before generating a new one.`,
            { reason: "recent_recommendation", minutesAgo: diffMinutes }
          );
        }
      }
    }

    if (lastRecTime !== null) {
      let newestRecordMs = 0;
      for (const set of [posts.rows, promotions.rows, leads.rows, sales.rows, costs.rows]) {
        for (const row of set as Array<{ createdAt?: { toMillis?: () => number } | string | number }>) {
          const raw = row.createdAt;
          const rMs = (raw as any)?.toMillis ? (raw as any).toMillis() : raw ? new Date(raw as string).getTime() : 0;
          if (rMs > newestRecordMs) newestRecordMs = rMs;
        }
      }
      if (newestRecordMs > 0 && newestRecordMs <= lastRecTime) {
        throw new HttpsError(
          "failed-precondition",
          "No new records have been added since your last recommendation was generated.",
          { reason: "no_new_data" }
        );
      }
    }
  }

  await ensureAccountForWorkspace(db, workspaceId);
  const reservation = await reserveRecommendation(db, workspaceId, requestId);
  if (!reservation.ok) {
    await addNotification(
      db,
      workspaceId,
      {
        kind: "limit_reached",
        title: "Weekly recommendation limit reached",
        body: `You've used your recommendation allowance for this cycle. Credits reset on ${reservation.resetsOn}. You can upgrade your plan anytime for higher allowances.`,
        priority: "normal",
      },
      `limit_${workspaceId}_${reservation.resetsOn}`
    ).catch(() => undefined);

    throw new HttpsError("resource-exhausted", "Recommendation limit reached.", {
      reason: reservation.reason, resetsOn: reservation.resetsOn,
    });
  }
  if (reservation.duplicate) return { recommendationId: requestId, duplicate: true };

  try {
    const b = biz.data()!;
    const staleCutoff = Date.now() - 48 * 3600 * 1000;
    const staleSources = procSnap.docs.filter((d) => {
      const t = d.data().lastSyncedAt;
      const ms = t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0;
      return ms < staleCutoff && !["manual", "csv"].includes(String(d.data().provider));
    }).map((d) => String(d.data().provider));
    const processorConnected = procSnap.docs.some((d) => ["stripe", "paypal"].includes(String(d.data().provider)));
    const rec = runEngine({
      records: {
        posts: posts.rows, promotions: promotions.rows, leads: leads.rows, sales: sales.rows, costs: costs.rows,
      } as never,
      business: { objective: b.objective ?? b.objectives?.[0], currency: b.currency, convertCurrencies: b.convertCurrencies },
      today,
      fx: fxSnap.exists ? (fxSnap.data() as FxRates) : null,
      processorConnected,
      staleSources,
    });
    const dropped = posts.dropped + promotions.dropped + leads.dropped + sales.dropped + costs.dropped;
    if (dropped > 0) rec.evidence.warnings.push(`${dropped} record(s) had invalid values and were ignored.`);

    // Optional AI phrasing. Never blocks or fails the recommendation; rejected output is dropped.
    let ai = null;
    try {
      if (rec.category !== "measurement") ai = await explainWithAI(rec);
    } catch (aiErr) {
      logger.warn("explainWithAI caught non-fatal error", { err: String(aiErr) });
    }

    const batch = db.batch();
    // Guarantee no undefined fields are passed to Firestore batch
    const cleanRec = JSON.parse(JSON.stringify(rec));
    batch.set(recRef, {
      ...cleanRec,
      ...(ai ? { aiSummary: { text: ai.text, model: ai.model, promptVersion: ai.promptVersion }, aiUsage: { inputTokens: ai.inputTokens ?? null, outputTokens: ai.outputTokens ?? null } } : {}),
      workspaceId, businessId, requestId, status: "generated", createdBy: uid,
      engineVersion: ENGINE_VERSION, createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection(`workspaces/${workspaceId}/recommendationEvents`).doc(), {
      recommendationId: requestId, type: "generated", actor: uid, createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    await confirmReservation(db, workspaceId, requestId);
    return { recommendationId: requestId, duplicate: false };
  } catch (err) {
    logger.error("generateRecommendation failed", { workspaceId, requestId, err: String(err) });
    await releaseReservation(db, workspaceId, requestId);
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpsError("internal", `Could not generate a recommendation (${msg}). Your credit was not used.`);
  }
});
