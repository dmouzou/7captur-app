import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireMember } from "./access";

const inputSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128),
  workspaceName: z.string().trim().min(1).max(120).optional(),
  objective: z.enum(["profit", "growth", "efficiency", "leads", "reach", "custom", "profitability", "revenue_growth", "qualified_enquiries", "content_engagement"]).optional(),
  currency: z.string().trim().length(3).optional(),
  convertCurrencies: z.boolean().optional(),
  timezone: z.string().trim().min(2).max(80).optional(),
  country: z.string().trim().length(2).optional(),
  notificationPrefs: z.object({
    weeklyEmail: z.boolean().optional(),
    weeklyStatusOnly: z.boolean().optional(),
    reviewAlerts: z.boolean().optional(),
  }).optional(),
  defaultViewMode: z.enum(["beginner", "advanced"]).optional(),
});

export const updateWorkspaceDetails = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const p = inputSchema.safeParse(request.data);
  if (!p.success) {
    throw new HttpsError("invalid-argument", p.error.issues[0]?.message ?? "Invalid update payload.");
  }
  const { workspaceId, businessId, workspaceName, objective, currency, timezone, country, notificationPrefs, defaultViewMode, convertCurrencies } = p.data;

  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    } catch {
      throw new HttpsError("invalid-argument", "Unknown timezone.");
    }
  }

  const db = getFirestore();
  // Requires owner or editor
  await requireMember(db, workspaceId, uid, true);

  const batch = db.batch();

  // 1. Update workspace doc
  const wsRef = db.doc(`workspaces/${workspaceId}`);
  const wsUpdates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (workspaceName) wsUpdates.name = workspaceName;
  if (currency) wsUpdates.defaultCurrency = currency.toUpperCase();
  if (timezone) wsUpdates.timezone = timezone;
  if (country) wsUpdates.country = country.toUpperCase();
  batch.update(wsRef, wsUpdates);

  // 2. Update business doc
  const bizRef = db.doc(`workspaces/${workspaceId}/businesses/${businessId}`);
  const bizUpdates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (workspaceName) bizUpdates.name = workspaceName;
  if (objective) bizUpdates.objective = objective;
  if (currency) bizUpdates.currency = currency.toUpperCase();
  if (convertCurrencies !== undefined) bizUpdates.convertCurrencies = convertCurrencies;
  if (timezone) bizUpdates.timezone = timezone;
  batch.update(bizRef, bizUpdates);

  // 3. Update user preferences
  const userRef = db.doc(`users/${uid}`);
  const userUpdates: Record<string, unknown> = {};
  if (notificationPrefs) {
    userUpdates.notificationPrefs = notificationPrefs;
  }
  if (defaultViewMode) {
    userUpdates.defaultViewMode = defaultViewMode;
  }
  if (Object.keys(userUpdates).length > 0) {
    batch.set(userRef, userUpdates, { merge: true });
  }

  await batch.commit();

  return { ok: true };
});
