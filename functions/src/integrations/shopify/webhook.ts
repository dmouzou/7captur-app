import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { SHOPIFY_CLIENT_SECRET } from "../../config";
import { addNotification } from "../../notify/inapp";
import { verifyWebhookHmac } from "./crypto";

/**
 * Shopify webhooks: app/uninstalled and the mandatory privacy topics. HMAC is verified on the raw body.
 * We store no customer personal data (names, emails, addresses), so customers/redact and customers/data_request
 * have nothing to delete or return. shop/redact deletes everything synced from that shop.
 */
export const shopifyWebhook = onRequest({ secrets: [SHOPIFY_CLIENT_SECRET], cors: false }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  if (!verifyWebhookHmac(req.rawBody, req.get("X-Shopify-Hmac-Sha256"), SHOPIFY_CLIENT_SECRET.value())) { res.status(401).send("Invalid signature"); return; }
  const topic = req.get("X-Shopify-Topic") ?? "";
  const shop = (req.get("X-Shopify-Shop-Domain") ?? "").toLowerCase();
  const db = getFirestore();
  try {
    const conns = await db.collectionGroup("connections").where("shop", "==", shop).get();
    const mine = conns.docs.filter((d) => d.data().provider === "shopify" && d.data().shop === shop);
    if (topic === "app/uninstalled") {
      for (const d of mine) {
        const wid = d.ref.parent.parent!.id;
        if (d.data().secretRef) await db.doc(d.data().secretRef).delete();
        await d.ref.update({ status: "disconnected", secretRef: null, disconnectedAt: new Date() });
        await addNotification(db, wid, { kind: "integration_disconnected", title: "Shopify store disconnected", body: `${shop} was uninstalled from Shopify. Your existing data is kept; reconnect any time.` }, `shopify_uninstalled_${d.id}_${req.get("X-Shopify-Webhook-Id") ?? "x"}`);
      }
    } else if (topic === "shop/redact") {
      for (const d of mine) {
        const wid = d.ref.parent.parent!.id;
        const sales = await db.collection(`workspaces/${wid}/sales`).where("connectionId", "==", d.id).get();
        for (let i = 0; i < sales.docs.length; i += 400) {
          const b = db.batch(); sales.docs.slice(i, i + 400).forEach((s) => b.delete(s.ref)); await b.commit();
        }
        if (d.data().secretRef) await db.doc(d.data().secretRef).delete();
        await d.ref.delete();
      }
    } // customers/redact, customers/data_request: no customer data held
    res.status(200).send("ok");
  } catch (err) {
    logger.error("shopify webhook failed", { topic, shop, err: String(err) });
    res.status(500).send("error");
  }
});
