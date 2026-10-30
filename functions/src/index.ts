import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { createWorkspace } from "./workspaces/createWorkspace";
export { generateRecommendation } from "./recommendations/generate";
export { recordRecommendationAction } from "./recommendations/action";
export { importRecords } from "./imports/importRecords";
export { extractFromScreenshot, cleanupUploads } from "./imports/screenshot";
export { exportData } from "./exports/exportData";
export { weeklyReports } from "./reports/weekly";
export { paddleWebhook } from "./billing/webhook";
export { createBillingPortalSession, changeSubscriptionPlan, enforceBilling } from "./billing/manage";
export { setReportedSpend, applyBandChanges } from "./billing/spend";
export { requestAccountDeletion, cancelAccountDeletion, processDeletions } from "./account/deletion";
export { startShopifyConnect, shopifyCallback, disconnectIntegration } from "./integrations/shopify/connect";
export { syncShopifyNow, syncShopifyScheduled } from "./integrations/shopify/sync";
export { shopifyWebhook } from "./integrations/shopify/webhook";

export const health = onRequest((_req, res) => {
  res.json({ ok: true, service: "7captur-functions", time: new Date().toISOString() });
});

// Phase 3: Shopify done; Meta Ads next. Phase 4: admin.
