import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { respondInput } from "../shared/decision";
import { requireMember } from "../workspaces/access";

/**
 * Records the customer's choice, their own execution progress and optional outcome feedback.
 * Only the state fields change. The decision content and snapshot are never rewritten, and
 * every change is also appended to decisionEvents. Nothing here writes to an ad platform.
 * Outcome feedback is always labelled customer_reported and is never treated as causal proof.
 */
export const recordDecisionUpdate = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = respondInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const input = parsed.data;

  const db = getFirestore();
  await requireMember(db, input.workspaceId, uid, true);
  const ref = db.doc(`workspaces/${input.workspaceId}/decisions/${input.decisionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Decision not found.");
  const d = snap.data()!;

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  const event: Record<string, unknown> = { decisionId: input.decisionId, actor: uid, createdAt: FieldValue.serverTimestamp() };

  if (input.type === "response") {
    patch.response = input.response;
    patch.responseNote = input.note ?? null;
    Object.assign(event, { type: `response_${input.response}`, note: input.note ?? null });
  } else if (input.type === "execution") {
    if (!["accepted", "modified"].includes(d.response)) {
      throw new HttpsError("failed-precondition", "Accept or modify the decision before tracking progress.");
    }
    patch.executionState = input.executionState;
    Object.assign(event, { type: `execution_${input.executionState}` });
  } else {
    patch.outcome = {
      followThrough: input.followThrough, outcome: input.outcome, note: input.note ?? null,
      evidence: "customer_reported", // never causal
    };
    Object.assign(event, { type: "outcome_reported", followThrough: input.followThrough, outcome: input.outcome, note: input.note ?? null });
  }

  const batch = db.batch();
  batch.update(ref, patch);
  batch.set(db.collection(`workspaces/${input.workspaceId}/decisionEvents`).doc(), event);
  await batch.commit();
  return { ok: true };
});
