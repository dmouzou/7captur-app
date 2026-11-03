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
import { confirmReservation, localToday, releaseReservation, reserveRecommendation } from "./usage";
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
  const { workspaceId, businessId, requestId } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);

  const recRef = db.doc(`workspaces/${workspaceId}/recommendations/${requestId}`);
  if ((await recRef.get()).exists) return { recommendationId: requestId, duplicate: true };

  const biz = await db.doc(`workspaces/${workspaceId}/businesses/${businessId}`).get();
  const ws = await db.doc(`workspaces/${workspaceId}`).get();
  if (!biz.exists || !ws.exists) throw new HttpsError("not-found", "Business not found.");

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
    const today = localToday(new Date(), ws.data()!.timezone);
    const from = addDays(today, -(WINDOW_DAYS - 1));
    const [posts, promotions, leads, sales, costs] = await Promise.all(
      (["posts", "promotions", "leads", "sales", "costs"] as const).map((c) => loadWindow(db, workspaceId, businessId, c, from, today))
    );
    const b = biz.data()!;
    const [fxSnap, procSnap] = await Promise.all([
      db.doc("config/fx").get(),
      db.collection(`workspaces/${workspaceId}/connections`).where("status", "==", "connected").get(),
    ]);
    const processorConnected = procSnap.docs.some((d) => ["stripe", "paypal"].includes(String(d.data().provider)));
    const rec = runEngine({
      records: {
        posts: posts.rows, promotions: promotions.rows, leads: leads.rows, sales: sales.rows, costs: costs.rows,
      } as never,
      business: { objective: b.objective ?? b.objectives?.[0], currency: b.currency, convertCurrencies: b.convertCurrencies },
      today,
      fx: fxSnap.exists ? (fxSnap.data() as FxRates) : null,
      processorConnected,
    });
    const dropped = posts.dropped + promotions.dropped + leads.dropped + sales.dropped + costs.dropped;
    if (dropped > 0) rec.evidence.warnings.push(`${dropped} record(s) had invalid values and were ignored.`);

    // Optional AI phrasing. Never blocks or fails the recommendation; rejected output is dropped.
    let secretKey: string | undefined;
    try { secretKey = ANTHROPIC_API_KEY.value(); } catch { secretKey = undefined; }
    let ai = null;
    try {
      ai = await explainWithAI(rec, secretKey);
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
