import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import { TOKEN_ENCRYPTION_KEY } from "../../config";
import { addNotification } from "../../notify/inapp";
import { requireMember } from "../../workspaces/access";
import { ShopifyAuthError, shopifyGraphql } from "./api";
import { decryptToken } from "./crypto";
import { ORDERS_QUERY, mapOrder, orderDocId, type ShopifyOrderNode } from "./orders";

const PAGE = 50;
const MAX_PAGES_PER_RUN = 20;       // 1,000 orders per run; the cursor resumes on the next run
const OVERLAP_MS = 60 * 60 * 1000;  // re-read the last hour so late updates (refunds) are never missed
const MIN_MANUAL_INTERVAL_MS = 2 * 60 * 1000;

interface OrdersData { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } }

/** Sync one connection. Synced fields are overwritten; link fields the customer set (postId, promotionId, leadId, attribution, notes) are never touched. */
export async function syncShopifyConnection(db: Firestore, workspaceId: string, connId: string): Promise<{ upserted: number; removed: number }> {
  const connRef = db.doc(`workspaces/${workspaceId}/connections/${connId}`);
  const conn = (await connRef.get()).data();
  if (!conn || conn.provider !== "shopify" || conn.status !== "connected" || !conn.secretRef) return { upserted: 0, removed: 0 };
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  const biz = (await db.doc(`workspaces/${workspaceId}/businesses/${conn.businessId}`).get()).data();
  if (!ws || !biz || ws.deletionScheduledFor) return { upserted: 0, removed: 0 };
  const blob = (await db.doc(conn.secretRef as string).get()).data()?.token as string | undefined;
  if (!blob) { await markReconnect(db, workspaceId, connId, "Credential missing"); return { upserted: 0, removed: 0 }; }
  const token = decryptToken(blob, TOKEN_ENCRYPTION_KEY.value());

  const since = conn.syncCursor ? new Date(new Date(conn.syncCursor as string).getTime() - OVERLAP_MS) : null;
  const search = since ? `updated_at:>=${since.toISOString()}` : undefined;
  let after: string | null = null, upserted = 0, removed = 0, maxUpdated = (conn.syncCursor as string | undefined) ?? "";
  let complete = false;
  try {
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const data: OrdersData = await shopifyGraphql<OrdersData>(conn.shop, token, ORDERS_QUERY, { first: PAGE, after, query: search });
      const col = `workspaces/${workspaceId}/sales`;
      const mapped = data.orders.nodes.map((n) => mapOrder(n, biz.timezone ?? ws.timezone));
      const refs = mapped.map((m) => db.doc(`${col}/${m.id}`));
      const existing = refs.length ? await db.getAll(...refs) : [];
      const batch = db.batch();
      mapped.forEach((m, i) => {
        const snap = existing[i], ref = refs[i];
        if (m.action === "skip") { if (snap.exists && snap.data()?.provenance === "connected") { batch.delete(ref); removed++; } return; }
        const synced = { ...m.synced, refundAmount: m.synced.refundAmount ?? FieldValue.delete(), product: m.synced.product ?? FieldValue.delete(), syncedAt: FieldValue.serverTimestamp() };
        if (snap.exists) { batch.update(ref, synced); }
        else {
          const { refundAmount, product, ...rest } = synced; void refundAmount; void product;
          batch.create(ref, {
            ...rest, ...(m.synced.refundAmount !== undefined ? { refundAmount: m.synced.refundAmount } : {}), ...(m.synced.product ? { product: m.synced.product } : {}),
            workspaceId, businessId: conn.businessId, createdBy: "system:shopify", createdAt: FieldValue.serverTimestamp(),
            provenance: "connected", attribution: "unknown", connectionId: connId, source: "shopify",
          });
        }
        upserted++;
      });
      await batch.commit();
      for (const n of data.orders.nodes) if (n.updatedAt > maxUpdated) maxUpdated = n.updatedAt;
      if (!data.orders.pageInfo.hasNextPage) { complete = true; break; }
      after = data.orders.pageInfo.endCursor;
    }
    await connRef.update({ lastSyncedAt: FieldValue.serverTimestamp(), syncCursor: maxUpdated || new Date().toISOString(), lastError: null, partialSync: !complete });
    return { upserted, removed };
  } catch (err) {
    if (err instanceof ShopifyAuthError) { await markReconnect(db, workspaceId, connId, "Shopify no longer accepts our access"); return { upserted, removed }; }
    logger.error("shopify sync failed", { workspaceId, connId, err: String(err) });
    await connRef.update({ lastError: "Sync failed. We will retry automatically." });
    throw err;
  }
}

async function markReconnect(db: Firestore, workspaceId: string, connId: string, why: string) {
  await db.doc(`workspaces/${workspaceId}/connections/${connId}`).update({ status: "needs_reconnect", lastError: why });
  await addNotification(db, workspaceId, {
    kind: "integration_disconnected", title: "Reconnect your Shopify store",
    body: "7Captur can no longer read orders from your Shopify store. Open Connections and reconnect. Your existing data is kept.", priority: "high",
  }, `shopify_reconnect_${connId}`);
}

const manualInput = z.object({ workspaceId: z.string().min(1).max(128), connectionId: z.string().min(1).max(128) });
export const syncShopifyNow = onCall({ secrets: [TOKEN_ENCRYPTION_KEY], timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = manualInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const db = getFirestore();
  await requireMember(db, p.data.workspaceId, uid, true);
  const ref = db.doc(`workspaces/${p.data.workspaceId}/connections/${p.data.connectionId}`);
  const c = (await ref.get()).data();
  if (!c) throw new HttpsError("not-found", "Connection not found.");
  const last = c.lastManualSyncAt?.toMillis?.() ?? 0;
  if (Date.now() - last < MIN_MANUAL_INTERVAL_MS) throw new HttpsError("resource-exhausted", "Synced a moment ago. Try again in a couple of minutes.");
  await ref.update({ lastManualSyncAt: FieldValue.serverTimestamp() });
  return syncShopifyConnection(db, p.data.workspaceId, p.data.connectionId);
});

/** Every 6 hours. Webhooks are not used for orders, so this is the freshness guarantee. */
export const syncShopifyScheduled = onSchedule({ schedule: "every 6 hours", secrets: [TOKEN_ENCRYPTION_KEY], timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const db = getFirestore();
  const snap = await db.collectionGroup("connections").where("status", "==", "connected").get();
  for (const d of snap.docs) {
    if (d.data().provider !== "shopify") continue;
    const workspaceId = d.ref.parent.parent!.id;
    try { await syncShopifyConnection(db, workspaceId, d.id); } catch { /* logged; next run retries */ }
  }
});

export { orderDocId };
