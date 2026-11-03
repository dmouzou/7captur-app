import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { recordActionInput } from "../shared/recommendation";
import { requireMember } from "../workspaces/access";

const STATUS_FOR: Record<string, string> = {
  viewed: "viewed", marked_to_try: "marked_to_try", dismissed: "dismissed",
  deferred: "deferred", completed: "completed", outcome_recorded: "outcome_recorded",
};

/**
 * Records the customer's choice only. Never touches an ad platform or any content.
 * Appends to the lifecycle log and updates status.
 */
export const recordRecommendationAction = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = recordActionInput.safeParse(request.data);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join(", ");
    throw new HttpsError("invalid-argument", `Invalid request: ${details}`);
  }
  const { workspaceId, recommendationId, action, reason, outcomeNote } = parsed.data;

  try {
    const db = getFirestore();
    await requireMember(db, workspaceId, uid, true);
    const ref = db.doc(`workspaces/${workspaceId}/recommendations/${recommendationId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Recommendation not found.");
    const current = snap.data()!.status as string;
    if (current === "superseded" || current === "failed") throw new HttpsError("failed-precondition", "This recommendation is closed.");
    if (action === "outcome_recorded" && !["marked_to_try", "completed", "outcome_recorded"].includes(current)) {
      throw new HttpsError("failed-precondition", "Mark it to try before recording an outcome.");
    }

    const batch = db.batch();
    batch.set(db.collection(`workspaces/${workspaceId}/recommendationEvents`).doc(), {
      recommendationId, type: action, actor: uid, reason: reason ?? null, outcomeNote: outcomeNote ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    const next = STATUS_FOR[action];
    if (next) batch.update(ref, { status: next, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("recordRecommendationAction error:", err);
    throw new HttpsError("internal", err instanceof Error ? err.message : "Failed to record recommendation action.");
  }
});
