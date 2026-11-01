import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { submitFeedbackInput } from "../shared/schemas";
import { requireMember } from "../workspaces/access";

/**
 * Customer SaaS Feedback & Support Submission (Spec 6.0 & 10.2).
 * Allows reporting bad recommendations, submitting product feedback, or opening support requests.
 * Stored under the workspace for customer auditability, and in root supportTickets for ops.
 */
export const submitFeedback = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const parsed = submitFeedbackInput.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid feedback request.");
  }
  const { workspaceId, type, recommendationId, subject, message, contactEmail, meta } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, false);

  const userEmail = contactEmail || request.auth?.token.email || null;
  const ticketId = `fb_${Date.now()}_${randomUUID().slice(0, 8)}`;

  // If a recommendation was reported as bad, fetch its summary to enrich the ticket
  let recContext: Record<string, unknown> | null = null;
  if (recommendationId) {
    const rSnap = await db.doc(`workspaces/${workspaceId}/recommendations/${recommendationId}`).get();
    if (rSnap.exists) {
      const rd = rSnap.data()!;
      recContext = {
        id: recommendationId,
        action: rd.action,
        category: rd.category,
        mode: rd.mode,
        engineVersion: rd.engineVersion,
        createdAt: rd.createdAt,
      };
    }
  }

  const payload = {
    id: ticketId,
    workspaceId,
    type,
    recommendationId: recommendationId ?? null,
    recContext,
    subject,
    message,
    userEmail,
    createdBy: uid,
    status: "open",
    internalNotes: [],
    meta: meta ?? {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(db.doc(`workspaces/${workspaceId}/feedback/${ticketId}`), payload);
  batch.set(db.doc(`supportTickets/${ticketId}`), payload);
  await batch.commit();

  return { ok: true, ticketId };
});
