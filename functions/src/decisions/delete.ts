import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { deleteDecisionInput } from "../shared/decision";
import { requireMember } from "../workspaces/access";

/**
 * Permanently deletes a decision and its associated follow-up threads.
 * Can be performed by any workspace editor/owner.
 * The underlying recommendation and commercial records remain untouched.
 */
export const deleteDecision = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = deleteDecisionInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { workspaceId, decisionId } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);

  const decRef = db.doc(`workspaces/${workspaceId}/decisions/${decisionId}`);
  const snap = await decRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Decision not found.");

  // Clean up any nested followups in this decision
  const followupsSnap = await decRef.collection("followups").get();
  const batch = db.batch();
  for (const doc of followupsSnap.docs) {
    batch.delete(doc.ref);
  }
  batch.delete(decRef);
  await batch.commit();

  return { ok: true };
});

