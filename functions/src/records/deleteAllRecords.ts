import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { COLLECTIONS, deleteAllRecordsInput } from "../shared/records";
import { requireMember } from "../workspaces/access";

/**
 * Permanently deletes all commercial records (posts, promotions, leads, sales, costs)
 * in a workspace, optionally scoped to a businessId.
 * Optionally also clears generated recommendations and decisions.
 * Can be performed by workspace owners or editors.
 */
export const deleteAllRecords = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = deleteAllRecordsInput.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const { workspaceId, businessId, includeRecommendations } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);

  const deletedCounts: Record<string, number> = {};
  let totalDeleted = 0;

  for (const coll of COLLECTIONS) {
    const colRef = db.collection(`workspaces/${workspaceId}/${coll}`);
    let count = 0;
    while (true) {
      let q: FirebaseFirestore.Query = colRef;
      if (businessId) {
        q = q.where("businessId", "==", businessId);
      }
      const snap = await q.limit(400).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      count += snap.size;
      if (snap.size < 400) break;
    }
    deletedCounts[coll] = count;
    totalDeleted += count;
  }

  if (includeRecommendations) {
    for (const coll of ["recommendations", "recommendationEvents"] as const) {
      const colRef = db.collection(`workspaces/${workspaceId}/${coll}`);
      let count = 0;
      while (true) {
        let q: FirebaseFirestore.Query = colRef;
        if (businessId) {
          q = q.where("businessId", "==", businessId);
        }
        const snap = await q.limit(400).get();
        if (snap.empty) break;

        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        count += snap.size;
        if (snap.size < 400) break;
      }
      deletedCounts[coll] = count;
      totalDeleted += count;
    }

    // Decisions collection & subcollections
    const decCol = db.collection(`workspaces/${workspaceId}/decisions`);
    let qDec: FirebaseFirestore.Query = decCol;
    if (businessId) {
      qDec = qDec.where("businessId", "==", businessId);
    }
    const decSnap = await qDec.get();
    let decCount = 0;
    for (const decDoc of decSnap.docs) {
      await db.recursiveDelete(decDoc.ref);
      decCount++;
    }
    deletedCounts.decisions = decCount;
    totalDeleted += decCount;
  }

  return { ok: true, deletedCounts, totalDeleted };
});

