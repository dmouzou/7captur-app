import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import { GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_OAUTH_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY } from "../../config";
import { addNotification } from "../../notify/inapp";
import { localToday } from "../../shared/periods";
import { requireMember } from "../../workspaces/access";
import { decryptToken } from "../shopify/crypto";
import { GoogleAuthError, gaql, refreshAccessToken } from "./api";
import { SPEND_QUERY, mapCampaignDay, windowFor, type CampaignDayRow } from "./spend";

const BATCH = 400;
const MIN_MANUAL_INTERVAL_MS = 2 * 60 * 1000;
const SECRETS = [GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, TOKEN_ENCRYPTION_KEY];

/** Sync one connection into `promotions` (one record per campaign per day, provenance `connected`). Link fields set by the customer are never overwritten. */
export async function syncGoogleAdsConnection(db: Firestore, workspaceId: string, connId: string): Promise<{ upserted: number }> {
  const connRef = db.doc(`workspaces/${workspaceId}/connections/${connId}`);
  const conn = (await connRef.get()).data();
  if (!conn || conn.provider !== "google_ads" || conn.status !== "connected" || !conn.secretRef) return { upserted: 0 };
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  const biz = (await db.doc(`workspaces/${workspaceId}/businesses/${conn.businessId}`).get()).data();
  if (!ws || !biz || ws.deletionScheduledFor) return { upserted: 0 };
  const blob = (await db.doc(conn.secretRef as string).get()).data()?.token as string | undefined;
  if (!blob) { await markReconnect(db, workspaceId, connId); return { upserted: 0 }; }

  try {
    const accessToken = await refreshAccessToken(decryptToken(blob, TOKEN_ENCRYPTION_KEY.value()), GOOGLE_OAUTH_CLIENT_SECRET.value());
    const auth = { accessToken, developerToken: GOOGLE_ADS_DEVELOPER_TOKEN.value(), ...(conn.loginCustomerId ? { loginCustomerId: conn.loginCustomerId as string } : {}) };
    // Google reports dates in the ad account's own time zone, so "today" is taken there too.
    const today = localToday(new Date(), conn.timeZone ?? ws.timezone);
    const { from, to } = windowFor((conn.syncCursor as string | null) ?? null, today);
    const rows = await gaql<CampaignDayRow>(auth, conn.customerId as string, SPEND_QUERY(from, to));
    const mapped = rows.map((r) => mapCampaignDay(r, conn.customerId as string, conn.currency as string)).filter((m): m is NonNullable<typeof m> => m !== null);

    const col = `workspaces/${workspaceId}/promotions`;
    let upserted = 0;
    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      const refs = chunk.map((m) => db.doc(`${col}/${m.id}`));
      const existing = await db.getAll(...refs);
      const batch = db.batch();
      chunk.forEach((m, j) => {
        if (existing[j].exists) batch.update(refs[j], { ...m.synced, syncedAt: FieldValue.serverTimestamp() });
        else batch.create(refs[j], {
          ...m.synced, platform: "google", objective: biz.objective, ...(m.campaignName ? { notes: `Campaign: ${m.campaignName}` } : {}),
          workspaceId, businessId: conn.businessId, createdBy: "system:googleads", createdAt: FieldValue.serverTimestamp(),
          provenance: "connected", connectionId: connId, source: "google_ads", syncedAt: FieldValue.serverTimestamp(),
        });
        upserted++;
      });
      await batch.commit();
    }
    await connRef.update({ lastSyncedAt: FieldValue.serverTimestamp(), syncCursor: today, lastError: null });
    return { upserted };
  } catch (err) {
    if (err instanceof GoogleAuthError) { await markReconnect(db, workspaceId, connId); return { upserted: 0 }; }
    logger.error("google ads sync failed", { workspaceId, connId, err: String(err) });
    await connRef.update({ lastError: "Sync failed. We will retry automatically." });
    throw err;
  }
}

async function markReconnect(db: Firestore, workspaceId: string, connId: string) {
  await db.doc(`workspaces/${workspaceId}/connections/${connId}`).update({ status: "needs_reconnect", lastError: "Google no longer accepts our access" });
  await addNotification(db, workspaceId, {
    kind: "integration_disconnected", title: "Reconnect your Google Ads account",
    body: "7Captur can no longer read spend from your Google Ads account. Open Connections and reconnect. Your existing data is kept.", priority: "high",
  }, `googleads_reconnect_${connId}`);
}

const manualInput = z.object({ workspaceId: z.string().min(1).max(128), connectionId: z.string().min(1).max(128) });
export const syncGoogleAdsNow = onCall({ secrets: SECRETS, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = manualInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const db = getFirestore();
  await requireMember(db, p.data.workspaceId, uid, true);
  const ref = db.doc(`workspaces/${p.data.workspaceId}/connections/${p.data.connectionId}`);
  const c = (await ref.get()).data();
  if (!c || c.provider !== "google_ads") throw new HttpsError("not-found", "Connection not found.");
  if (Date.now() - (c.lastManualSyncAt?.toMillis?.() ?? 0) < MIN_MANUAL_INTERVAL_MS) throw new HttpsError("resource-exhausted", "Synced a moment ago. Try again in a couple of minutes.");
  await ref.update({ lastManualSyncAt: FieldValue.serverTimestamp() });
  return syncGoogleAdsConnection(db, p.data.workspaceId, p.data.connectionId);
});

/** Every 6 hours: sync connected accounts, and clear account-selection steps nobody finished within a day. */
export const syncGoogleAdsScheduled = onSchedule({ schedule: "every 6 hours", secrets: SECRETS, timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const db = getFirestore();
  const snap = await db.collectionGroup("connections").where("status", "==", "connected").get();
  for (const d of snap.docs) {
    if (d.data().provider !== "google_ads") continue;
    try { await syncGoogleAdsConnection(db, d.ref.parent.parent!.id, d.id); } catch { /* logged; next run retries */ }
  }
  const stale = await db.collectionGroup("connections").where("status", "==", "pending_account").get();
  for (const d of stale.docs) {
    const created = (d.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0;
    if (Date.now() - created < 24 * 3600 * 1000) continue;
    if (d.data().secretRef) await db.doc(d.data().secretRef as string).delete().catch(() => undefined);
    await d.ref.delete();
  }
});
