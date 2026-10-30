import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_OAUTH_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY } from "../../config";
import { APP_URL } from "../../notify/mail";
import { getPlan } from "../../shared/plans";
import { revokers } from "../../connections/disconnect";
import { requireMember } from "../../workspaces/access";
import { decryptToken, encryptToken } from "../shopify/crypto";
import { secretPathFor } from "../shopify/connect";
import { GOOGLE_ADS_SCOPE, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_REDIRECT_URI, GoogleAuthError, discoverAccounts, refreshAccessToken, type GAccount } from "./api";

const STATE_TTL_MS = 10 * 60 * 1000;
export const googleConnId = (customerId: string) => `googleads_${customerId}`;
const ACTIVE = ["connected", "needs_reconnect"];

async function activeCount(workspaceId: string, exceptId?: string) {
  const s = await getFirestore().collection(`workspaces/${workspaceId}/connections`).where("status", "in", ACTIVE).get();
  return s.docs.filter((d) => d.id !== exceptId).length;
}

const startInput = z.object({ workspaceId: z.string().min(1).max(128), businessId: z.string().min(1).max(128) });

/** Step 1: Google consent URL (read-only Ads scope, offline access so we can sync without the user present). */
export const startGoogleAdsConnect = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = startInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  if (!GOOGLE_OAUTH_CLIENT_ID.value() || !GOOGLE_REDIRECT_URI.value()) throw new HttpsError("failed-precondition", "Google Ads connection is not available yet.");
  const db = getFirestore();
  const { workspaceId, businessId } = p.data;
  await requireMember(db, workspaceId, uid, true);
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!ws) throw new HttpsError("not-found", "Workspace not found.");
  if (ws.deletionScheduledFor) throw new HttpsError("failed-precondition", "This workspace is scheduled for deletion.");
  if (!(await db.doc(`workspaces/${workspaceId}/businesses/${businessId}`).get()).exists) throw new HttpsError("not-found", "Business not found.");
  const reconnecting = (await db.collection(`workspaces/${workspaceId}/connections`).where("status", "==", "needs_reconnect").get()).docs.some((d) => d.data().provider === "google_ads");
  const limit = getPlan(ws.plan).maxConnections;
  if (!reconnecting && (await activeCount(workspaceId)) >= limit) throw new HttpsError("resource-exhausted", `Your plan allows ${limit} direct connection${limit === 1 ? "" : "s"}. Disconnect one or upgrade.`);

  const nonce = randomBytes(24).toString("base64url");
  await db.doc(`oauthStates/${nonce}`).set({ provider: "google_ads", workspaceId, businessId, uid, expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS) });
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID.value(), redirect_uri: GOOGLE_REDIRECT_URI.value(), response_type: "code", scope: GOOGLE_ADS_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "false", state: nonce,
  }).toString();
  return { url };
});

function back(res: import("express").Response, result: string) { res.redirect(302, `${APP_URL}/?googleads=${encodeURIComponent(result)}`); }

/** Step 2: Google redirects here. Single-use state; stores the refresh token encrypted; lists the ad accounts to choose from. */
export const googleAdsCallback = onRequest({ secrets: [GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, TOKEN_ENCRYPTION_KEY], cors: false }, async (req, res) => {
  const q = req.query;
  const code = typeof q.code === "string" ? q.code : "", state = typeof q.state === "string" ? q.state : "";
  if (!state) { res.status(400).send("Invalid request"); return; }
  const db = getFirestore();
  const stateRef = db.doc(`oauthStates/${state}`);
  const st = await db.runTransaction(async (t) => { const s = await t.get(stateRef); if (s.exists) t.delete(stateRef); return s.data(); });
  if (!st || st.provider !== "google_ads" || (st.expiresAt as Timestamp).toMillis() < Date.now()) { res.status(400).send("This link expired. Start the connection again from 7Captur."); return; }
  if (q.error || !code) { back(res, "denied"); return; }
  try {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_OAUTH_CLIENT_ID.value(), client_secret: GOOGLE_OAUTH_CLIENT_SECRET.value(), redirect_uri: GOOGLE_REDIRECT_URI.value(), grant_type: "authorization_code" }),
    });
    if (!tokRes.ok) throw new Error(`token exchange ${tokRes.status}`);
    const tok = (await tokRes.json()) as { access_token: string; refresh_token?: string; scope?: string };
    if (!tok.refresh_token) { back(res, "no_refresh"); return; }
    if (!(tok.scope ?? "").split(" ").includes(GOOGLE_ADS_SCOPE)) { back(res, "scope_missing"); return; }

    const accounts = await discoverAccounts({ accessToken: tok.access_token, developerToken: GOOGLE_ADS_DEVELOPER_TOKEN.value() });
    if (accounts.length === 0) { back(res, "no_accounts"); return; }
    const pendingId = `googleads_pending_${randomBytes(6).toString("hex")}`;
    const secretPath = secretPathFor(st.workspaceId, pendingId);
    await db.doc(secretPath).set({ workspaceId: st.workspaceId, provider: "google_ads", token: encryptToken(tok.refresh_token, TOKEN_ENCRYPTION_KEY.value()), createdAt: FieldValue.serverTimestamp() });
    await db.doc(`workspaces/${st.workspaceId}/connections/${pendingId}`).set({
      provider: "google_ads", status: "pending_account", businessId: st.businessId, secretRef: secretPath, accounts, connectedBy: st.uid,
      createdAt: FieldValue.serverTimestamp(), lastError: null,
    });
    back(res, "choose_account");
  } catch (err) {
    logger.error("google ads callback failed", { err: String(err) });
    back(res, "error");
  }
});

const selectInput = z.object({ workspaceId: z.string().min(1).max(128), pendingId: z.string().min(1).max(128), customerId: z.string().regex(/^\d{5,12}$/) });

/** Step 3: the customer picks which ad account to connect. Only accounts discovered with their own login can be chosen. */
export const selectGoogleAdsAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const p = selectInput.safeParse(request.data);
  if (!p.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { workspaceId, pendingId, customerId } = p.data;
  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);
  const pendingRef = db.doc(`workspaces/${workspaceId}/connections/${pendingId}`);
  const pend = (await pendingRef.get()).data();
  if (!pend || pend.provider !== "google_ads" || pend.status !== "pending_account" || pend.connectedBy !== uid) throw new HttpsError("not-found", "This connection step expired. Start again.");
  const acct = (pend.accounts as GAccount[]).find((a) => a.customerId === customerId);
  if (!acct) throw new HttpsError("invalid-argument", "Choose one of the listed accounts.");
  const finalId = googleConnId(customerId);
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!ws) throw new HttpsError("not-found", "Workspace not found.");
  if ((await activeCount(workspaceId, finalId)) >= getPlan(ws.plan).maxConnections) throw new HttpsError("resource-exhausted", "Your plan's connection limit is reached.");

  const finalRef = db.doc(`workspaces/${workspaceId}/connections/${finalId}`);
  const old = (await finalRef.get()).data();
  if (old?.secretRef && old.secretRef !== pend.secretRef) await db.doc(old.secretRef as string).delete().catch(() => undefined);
  await finalRef.set({
    provider: "google_ads", customerId, accountName: acct.name, currency: acct.currency, timeZone: acct.timeZone, loginCustomerId: acct.loginCustomerId ?? null,
    businessId: pend.businessId, status: "connected", scopes: [GOOGLE_ADS_SCOPE], secretRef: pend.secretRef, connectedBy: uid,
    connectedAt: FieldValue.serverTimestamp(), lastError: null, disconnectedAt: null, ...(old ? {} : { lastSyncedAt: null, syncCursor: null }),
  }, { merge: true });
  await pendingRef.delete();
  return { connectionId: finalId };
});

/** Revoke our refresh token at Google when the customer disconnects (best effort). */
revokers.google_ads = async (db, _workspaceId, _connectionId, conn) => {
  if (!conn.secretRef) return;
  const blob = (await db.doc(conn.secretRef as string).get()).data()?.token as string | undefined;
  if (!blob) return;
  const token = decryptToken(blob, TOKEN_ENCRYPTION_KEY.value());
  await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
};

export { refreshAccessToken, GoogleAuthError };
