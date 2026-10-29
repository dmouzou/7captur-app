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

export const health = onRequest((_req, res) => {
  res.json({ ok: true, service: "7captur-functions", time: new Date().toISOString() });
});

// Phase 2 in progress: weekly reports, billing. Phase 2: billing webhooks. Phase 3: Meta/Shopify adapters. Phase 4: admin.
