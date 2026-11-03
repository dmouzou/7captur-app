import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { createWorkspace } from "./workspaces/createWorkspace";
export { updateWorkspaceDetails } from "./workspaces/updateWorkspace";
export { generateRecommendation } from "./recommendations/generate";
export { recordRecommendationAction } from "./recommendations/action";
export { createDecision } from "./decisions/create";
export { askAboutDecision } from "./decisions/followup";
export { recordDecisionUpdate } from "./decisions/respond";
export { importRecords } from "./imports/importRecords";
export { refreshFxRates } from "./fx/refresh";
export { exportData } from "./exports/exportData";
export { weeklyReports } from "./reports/weekly";
export { paddleWebhook } from "./billing/webhook";
export { createBillingPortalSession, changeSubscriptionPlan, enforceBilling } from "./billing/manage";
export { trialLifecycle } from "./billing/trialLifecycle";
export { requestAccountDeletion, cancelAccountDeletion, processDeletions } from "./account/deletion";
export { startShopifyConnect, shopifyCallback, disconnectIntegration } from "./integrations/shopify/connect";
export { syncShopifyNow, syncShopifyScheduled } from "./integrations/shopify/sync";
export { startGoogleAdsConnect, googleAdsCallback, selectGoogleAdsAccount } from "./integrations/googleads/connect";
export { syncGoogleAdsNow, syncGoogleAdsScheduled } from "./integrations/googleads/sync";
export { shopifyWebhook } from "./integrations/shopify/webhook";
export { submitFeedback } from "./feedback/submit";
export * from "./admin/callables";

export const health = onRequest((_req, res) => {
  res.json({ ok: true, service: "7captur-functions", time: new Date().toISOString() });
});

// Phase 3: Shopify done; Meta Ads next. Phase 4: admin.
