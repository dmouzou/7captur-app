import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { createWorkspace } from "./workspaces/createWorkspace";

export const health = onRequest((_req, res) => {
  res.json({ ok: true, service: "7captur-functions", time: new Date().toISOString() });
});

// Phase 1+ (see spec section 17): generateRecommendation, recordRecommendationAction,
// imports, weekly reports. Phase 2: billing webhooks. Phase 3: Meta/Shopify adapters. Phase 4: admin.
