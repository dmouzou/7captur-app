import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createWorkspaceInput } from "../shared/schemas";
import { PLAN_CONFIG_VERSION, getPlan } from "../shared/plans";
import { accountPath, bootstrapAccount, workspacesOfOwner } from "../accounts/account";
import { nextWeeklyRun } from "../reports/time";

/**
 * Creates Account -> Workspace -> Business -> owner membership in one transaction.
 * The first workspace creates the account with a 14-day Starter trial. Later workspaces join the same account
 * and are capped by the account's plan (Starter 1, Growth 3). Clients cannot set plan or role.
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

  const primaryObjective = input.objective ?? input.objectives?.[0] ?? "profitability";
  const objectives = input.objectives && input.objectives.length > 0 ? input.objectives : [primaryObjective];

  const cName = (input.contactName ?? "").trim();
  const cEmail = (input.contactEmail ?? "").trim();
  const cPhone = (input.contactPhone ?? "").trim();
  const hasContact = Boolean(cName || cEmail || cPhone);

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Users who created their workspace before accounts existed get their account first.
  if ((await workspacesOfOwner(db, uid)).length > 0) await bootstrapAccount(db, uid);

  const accRef = db.doc(accountPath(uid));
  const bizRef = wsRef.collection("businesses").doc();
  const result = await db.runTransaction(async (tx) => {
    const [accSnap, owned, again] = await Promise.all([
      tx.get(accRef), tx.get(db.collection("workspaces").where("ownerUid", "==", uid)), tx.get(wsRef),
    ]);
    if (again.exists) return { created: false as const };
    const acct = accSnap.data();
    const first = owned.size === 0;

    // Plan state comes from the account. The first workspace creates the account with the 14-day Starter trial.
    let plan = "starter", billingStatus = "trialing", planVersion: number = PLAN_CONFIG_VERSION;
    let trial: Timestamp | null = Timestamp.fromDate(trialEndsAt);
    let restrictAt: unknown = null, subId: unknown = null, custId: unknown = null;
    if (acct) {
      plan = acct.plan; billingStatus = acct.billingStatus ?? "none"; planVersion = acct.planConfigVersion ?? PLAN_CONFIG_VERSION;
      trial = acct.trialEndsAt ?? null; restrictAt = acct.restrictAt ?? null; subId = acct.paddleSubscriptionId ?? null; custId = acct.paddleCustomerId ?? null;
      if (billingStatus === "trial_expired" || billingStatus === "restricted") {
        throw new HttpsError("failed-precondition", "Your account is read-only. Subscribe to add a workspace.");
      }
      const max = getPlan(plan).maxBusinesses;
      if (owned.size >= max) {
        throw new HttpsError("resource-exhausted", `Your plan allows ${max} business workspace${max === 1 ? "" : "s"}. ${plan === "starter" ? "Upgrade to Growth to add more." : "Contact us to add more."}`);
      }
    } else if (!first) {
      throw new HttpsError("failed-precondition", "Account not found. Try again.");
    } else {
      tx.set(accRef, {
        ownerUid: uid, primaryWorkspaceId: wsRef.id, timezone: input.timezone,
        plan, planConfigVersion: planVersion, billingStatus, trialEndsAt: trial, restrictAt: null,
        paddleSubscriptionId: null, paddleCustomerId: null, createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(wsRef, {
      name: input.workspaceName,
      ownerUid: uid,
      country: input.country,
      timezone: input.timezone,
      defaultCurrency: input.currency,
      plan,
      planConfigVersion: planVersion,
      billingStatus,
      trialEndsAt: trial,
      restrictAt,
      paddleSubscriptionId: subId,
      paddleCustomerId: custId,
      overLimit: false,
      accountTimezone: (acct?.timezone as string | undefined) ?? input.timezone,
      reportNextRunAt: Timestamp.fromDate(nextWeeklyRun(now, input.timezone)),
      createdAt: FieldValue.serverTimestamp(),
      ...(hasContact ? { contact: { name: cName, email: cEmail, phone: cPhone } } : {}),
    });
    tx.set(wsRef.collection("members").doc(uid), { role: "owner", status: "active", joinedAt: FieldValue.serverTimestamp() });
    tx.set(bizRef, {
      workspaceId: wsRef.id,
      name: input.businessName,
      type: input.businessType,
      objective: primaryObjective,
      objectives,
      buyingMethods: input.buyingMethods,
      channels: [],
      currency: input.currency,
      timezone: input.timezone,
      createdAt: FieldValue.serverTimestamp(),
    });
    // The default workspace is the first one. Later workspaces never replace it.
    tx.set(db.doc(`users/${uid}`), {
      ...(first ? { defaultWorkspaceId: wsRef.id } : {}), status: "active", createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { created: true as const };
  });
  if (!result.created) return { workspaceId: wsRef.id, created: false };
  return { workspaceId: wsRef.id, businessId: bizRef.id, created: true };
});
