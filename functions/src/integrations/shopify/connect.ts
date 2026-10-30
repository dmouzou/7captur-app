import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { SHOPIFY_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY } from "../../config";
import { APP_URL } from "../../notify/mail";
import { getPlan } from "../../shared/plans";
import { disconnectConnection, revokers } from "../../connections/disconnect";
import { requireMember } from "../../workspaces/access";
import { SHOPIFY_CLIENT_ID, SHOPIFY_REDIRECT_URI, SHOPIFY_SCOPES, shopifyGraphql } from "./api";
import { decryptToken, encryptToken, normalizeShop, shopSlug, verifyOAuthHmac } from "./crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
export const connectionIdFor = (shop: string) => `shopify_${shopSlug(shop)}`;
export const secretPathFor = (workspaceId: string, connId: string) => `connectionSecrets/${workspaceId}__${connId}`;

const startInput = z.object({ workspaceId: z.string().min(1).max(128), businessId: z.string().min(1).max(128), shop: z.string().min(1).max(200) });

/** Step 1: build the Shopify install/authorize URL. Owner or editor only; respects the plan's connection limit. */
export const startShopifyConnect = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = startInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const shop = normalizeShop(p.data.shop);
  if (!shop) throw new HttpsError("invalid-argument", "Enter your store address, like my-store.myshopify.com.");
  if (!SHOPIFY_CLIENT_ID.value() || !SHOPIFY_REDIRECT_URI.value()) throw new HttpsError("failed-precondition", "Shopify connection is not available yet.");
  const db = getFirestore();
  const { workspaceId, businessId } = p.data;
  await requireMember(db, workspaceId, uid, true);
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!ws) throw new HttpsError("not-found", "Workspace not found.");
  if (ws.deletionScheduledFor) throw new HttpsError("failed-precondition", "This workspace is scheduled for deletion.");
  if (!(await db.doc(`workspaces/${workspaceId}/businesses/${businessId}`).get()).exists) throw new HttpsError("not-found", "Business not found.");

  const connId = connectionIdFor(shop);
  const existing = await db.collection(`workspaces/${workspaceId}/connections`).where("status", "in", ["connected", "needs_reconnect"]).get();
  const others = existing.docs.filter((d) => d.id !== connId).length;
  const limit = getPlan(ws.plan).maxConnections;
  if (others >= limit) throw new HttpsError("resource-exhausted", `Your plan allows ${limit} direct connection${limit === 1 ? "" : "s"}. Disconnect one or upgrade.`);

  const nonce = randomBytes(24).toString("base64url");
  await db.doc(`oauthStates/${nonce}`).set({ workspaceId, businessId, uid, shop, expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS) });
  const url = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID.value(), scope: SHOPIFY_SCOPES, redirect_uri: SHOPIFY_REDIRECT_URI.value(), state: nonce,
  }).toString();
  return { url };
});

function back(res: import("express").Response, result: string) {
  res.redirect(302, `${APP_URL}/?shopify=${encodeURIComponent(result)}`);
}

/** Step 2: Shopify redirects here. Verifies HMAC, single-use state and shop, then stores the token encrypted. */
export const shopifyCallback = onRequest({ secrets: [SHOPIFY_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY], cors: false }, async (req, res) => {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) if (typeof v === "string") q[k] = v;
  const secret = SHOPIFY_CLIENT_SECRET.value();
  if (!verifyOAuthHmac(q, secret)) { res.status(400).send("Invalid request"); return; }
  const shop = normalizeShop(q.shop ?? "");
  if (!shop || !q.code || !q.state) { res.status(400).send("Invalid request"); return; }

  const db = getFirestore();
  const stateRef = db.doc(`oauthStates/${q.state}`);
  const st = await db.runTransaction(async (t) => { // single use
    const s = await t.get(stateRef);
    if (s.exists) t.delete(stateRef);
    return s.data();
  });
  if (!st || st.shop !== shop || (st.expiresAt as Timestamp).toMillis() < Date.now()) { res.status(400).send("This link expired. Start the connection again from 7Captur."); return; }

  try {
    const tokRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID.value(), client_secret: secret, code: q.code }),
    });
    if (!tokRes.ok) throw new Error(`token exchange ${tokRes.status}`);
    const tok = (await tokRes.json()) as { access_token?: string; scope?: string };
    if (!tok.access_token) throw new Error("no token");
    const granted = (tok.scope ?? "").split(",").map((s) => s.trim());
    if (!granted.includes("read_orders") && !granted.includes("read_all_orders")) { back(res, "scope_missing"); return; }

    const connId = connectionIdFor(shop);
    const secretPath = secretPathFor(st.workspaceId, connId);
    await db.doc(secretPath).set({ workspaceId: st.workspaceId, provider: "shopify", token: encryptToken(tok.access_token, TOKEN_ENCRYPTION_KEY.value()), createdAt: FieldValue.serverTimestamp() });
    await db.doc(`workspaces/${st.workspaceId}/connections/${connId}`).set({
      provider: "shopify", shop, businessId: st.businessId, status: "connected", scopes: granted, secretRef: secretPath,
      connectedBy: st.uid, connectedAt: FieldValue.serverTimestamp(), lastSyncedAt: null, lastError: null, disconnectedAt: null,
    }, { merge: true });
    // app/uninstalled is the only per-shop webhook we need; GDPR topics are set in the app configuration.
    await registerUninstallWebhook(shop, tok.access_token).catch((e) => logger.warn("webhook registration failed", { shop, err: String(e) }));
    back(res, "connected");
  } catch (err) {
    logger.error("shopify callback failed", { shop, err: String(err) });
    back(res, "error");
  }
});

async function registerUninstallWebhook(shop: string, token: string) {
  const callbackUrl = SHOPIFY_REDIRECT_URI.value().replace(/shopifyCallback\/?$/, "shopifyWebhook");
  await shopifyGraphql(shop, token,
    `mutation($cb: URL!) { webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: { callbackUrl: $cb, format: JSON }) { userErrors { message } } }`, { cb: callbackUrl });
}

/** Revoke our access at Shopify when the customer disconnects (best effort). */
revokers.shopify = async (db, workspaceId, connectionId, conn) => {
  if (!conn.secretRef) return;
  const blob = (await db.doc(conn.secretRef as string).get()).data()?.token as string | undefined;
  if (!blob) return;
  const token = decryptToken(blob, TOKEN_ENCRYPTION_KEY.value());
  await fetch(`https://${conn.shop}/admin/api_permissions/current.json`, { method: "DELETE", headers: { "X-Shopify-Access-Token": token } });
};

const discInput = z.object({ workspaceId: z.string().min(1).max(128), connectionId: z.string().min(1).max(128) });
export const disconnectIntegration = onCall({ secrets: [TOKEN_ENCRYPTION_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = discInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const db = getFirestore();
  await requireMember(db, p.data.workspaceId, uid, true);
  await disconnectConnection(db, p.data.workspaceId, p.data.connectionId);
  return { ok: true };
});

