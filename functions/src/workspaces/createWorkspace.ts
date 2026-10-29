import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createWorkspaceInput } from "../shared/schemas";
import { PLAN_CONFIG_VERSION } from "../shared/plans";

/**
 * Creates User -> Workspace -> Business -> owner membership in one batch.
 * Plan is always "free" (permanent, no trial). Clients cannot set plan or role.
 * Idempotent on requestId so a double click or retry cannot create two workspaces.
 */
export const createWorkspace = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const parsed = createWorkspaceInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input.");
  const input = parsed.data;

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone });
  } catch {
    throw new HttpsError("invalid-argument", "Unknown timezone.");
  }

  const db = getFirestore();
  // Deterministic ids derived from uid + requestId make the call idempotent.
  const wsRef = db.doc(`workspaces/${uid}_${input.requestId}`);
  if ((await wsRef.get()).exists) return { workspaceId: wsRef.id, created: false };

  const bizRef = wsRef.collection("businesses").doc();
  const batch = db.batch();
  batch.set(wsRef, {
    name: input.workspaceName,
    ownerUid: uid,
    country: input.country,
    timezone: input.timezone,
    defaultCurrency: input.currency,
    plan: "free",
    planConfigVersion: PLAN_CONFIG_VERSION,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(wsRef.collection("members").doc(uid), {
    role: "owner", status: "active", joinedAt: FieldValue.serverTimestamp(),
  });
  batch.set(bizRef, {
    workspaceId: wsRef.id,
    name: input.businessName,
    type: input.businessType,
    objective: input.objective,
    buyingMethods: input.buyingMethods,
    channels: [],
    currency: input.currency,
    timezone: input.timezone,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`users/${uid}`), {
    defaultWorkspaceId: wsRef.id, status: "active", createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { workspaceId: wsRef.id, businessId: bizRef.id, created: true };
});
