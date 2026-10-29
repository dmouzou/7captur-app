import { FieldValue, getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { generateRecommendationInput } from "../shared/recommendation";
import { recordSchemas, type RecordCollection } from "../shared/records";
import { requireMember } from "../workspaces/access";
import { runEngine, ENGINE_VERSION } from "./engine";
import { confirmReservation, localToday, releaseReservation, reserveRecommendation } from "./usage";

const MAX_DOCS = 500;

async function load(db: FirebaseFirestore.Firestore, wid: string, bid: string, coll: RecordCollection) {
  const snap = await db.collection(`workspaces/${wid}/${coll}`).where("businessId", "==", bid).limit(MAX_DOCS).get();
  const schema = recordSchemas[coll];
  let dropped = 0;
  const rows = snap.docs.flatMap((d: QueryDocumentSnapshot) => {
    const parsed = (schema as typeof recordSchemas.posts).safeParse(d.data());
    if (!parsed.success) { dropped++; return []; }
    return [{ ...parsed.data, id: d.id, provenance: d.data().provenance as string | undefined }];
  });
  return { rows, dropped };
}

/**
 * Generates one recommendation. Order matters: authorize, reserve credit atomically,
 * run deterministic engine, persist, confirm credit. Any failure releases the credit.
 * The recommendation id equals requestId, so a retry returns the same result.
 */
export const generateRecommendation = onCall(async (request) => {
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
    throw new HttpsError("resource-exhausted", "Recommendation limit reached.", {
      reason: reservation.reason, resetsOn: reservation.resetsOn,
    });
  }
  if (reservation.duplicate) return { recommendationId: requestId, duplicate: true };

  try {
    const [posts, promotions, leads, sales, costs] = await Promise.all(
      (["posts", "promotions", "leads", "sales", "costs"] as const).map((c) => load(db, workspaceId, businessId, c))
    );
    const b = biz.data()!;
    const rec = runEngine({
      records: {
        posts: posts.rows, promotions: promotions.rows, leads: leads.rows, sales: sales.rows, costs: costs.rows,
      } as never,
      business: { objective: b.objective, currency: b.currency },
      today: localToday(new Date(), ws.data()!.timezone),
    });
    const dropped = posts.dropped + promotions.dropped + leads.dropped + sales.dropped + costs.dropped;
    if (dropped > 0) rec.evidence.warnings.push(`${dropped} record(s) had invalid values and were ignored.`);

    const batch = db.batch();
    batch.set(recRef, {
      ...rec, workspaceId, businessId, requestId, status: "generated", createdBy: uid,
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
    throw new HttpsError("internal", "Could not generate a recommendation. Your credit was not used.");
  }
});
