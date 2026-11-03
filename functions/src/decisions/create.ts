import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createDecisionInput } from "../shared/decision";
import type { Recommendation } from "../shared/recommendation";
import { requireMember } from "../workspaces/access";
import { localToday } from "../recommendations/usage";
import { buildDecision } from "./build";

/**
 * v2: turns an existing v1 recommendation into a decision record with alternatives, review date
 * and an immutable evidence snapshot. It does not use a recommendation credit, because the
 * credit was already spent when the recommendation was generated. Idempotent: id = dec_<recommendationId>.
 * Never touches an ad platform and never edits the source recommendation.
 */
export const createDecision = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = createDecisionInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { workspaceId, recommendationId } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);

  const decisionId = `dec_${recommendationId}`;
  const decRef = db.doc(`workspaces/${workspaceId}/decisions/${decisionId}`);
  if ((await decRef.get()).exists) return { decisionId, duplicate: true };

  const [recSnap, wsSnap] = await Promise.all([
    db.doc(`workspaces/${workspaceId}/recommendations/${recommendationId}`).get(),
    db.doc(`workspaces/${workspaceId}`).get(),
  ]);
  if (!recSnap.exists || !wsSnap.exists) throw new HttpsError("not-found", "Recommendation not found.");
  const rec = recSnap.data() as Recommendation & { status: string; businessId: string };
  if (rec.status === "failed") throw new HttpsError("failed-precondition", "This recommendation failed and cannot become a decision.");

  const today = localToday(new Date(), (wsSnap.data() as { timezone: string }).timezone);
  const content = buildDecision(rec, { today });

  const batch = db.batch();
  batch.create(decRef, {
    ...content,
    workspaceId, businessId: rec.businessId, recommendationId, createdBy: uid,
    response: "pending", executionState: "not_started", outcome: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection(`workspaces/${workspaceId}/decisionEvents`).doc(), {
    decisionId, type: "created", actor: uid, createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { decisionId, duplicate: false };
});
