// Usage:
//   node scripts/migrate-workspaces.mjs --dry-run
//   node scripts/migrate-workspaces.mjs
// Run LOCALLY with Application Default Credentials for the target project:
//   gcloud auth application-default login && GOOGLE_CLOUD_PROJECT=captur-app-dev node scripts/migrate-workspaces.mjs --dry-run

import { createRequire } from "node:module";

let initializeApp, applicationDefault, getFirestore, Timestamp, FieldValue, getAuth;

try {
  const appModule = await import("firebase-admin/app");
  const fsModule = await import("firebase-admin/firestore");
  const authModule = await import("firebase-admin/auth");
  initializeApp = appModule.initializeApp;
  applicationDefault = appModule.applicationDefault;
  getFirestore = fsModule.getFirestore;
  Timestamp = fsModule.Timestamp;
  FieldValue = fsModule.FieldValue;
  getAuth = authModule.getAuth;
} catch {
  const req = createRequire(new URL("../functions/package.json", import.meta.url));
  const adminApp = req("firebase-admin/app");
  const adminFs = req("firebase-admin/firestore");
  const adminAuth = req("firebase-admin/auth");
  initializeApp = adminApp.initializeApp;
  applicationDefault = adminApp.applicationDefault;
  getFirestore = adminFs.getFirestore;
  Timestamp = adminFs.Timestamp;
  FieldValue = adminFs.FieldValue;
  getAuth = adminAuth.getAuth;
}

const isDryRun = process.argv.includes("--dry-run");
const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "captur-app-dev";

initializeApp({
  credential: applicationDefault(),
  projectId: project,
});

const db = getFirestore();
const auth = getAuth();

console.log(`Starting workspace migration on project: ${project} (${isDryRun ? "DRY-RUN MODE" : "LIVE RUN"})`);

const wsSnap = await db.collection("workspaces").get();
console.log(`Found ${wsSnap.size} total workspaces to inspect.\n`);

let migratedCount = 0;
let grandfatheredCount = 0;
let unchangedCount = 0;
let errorCount = 0;

const now = new Date();
const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

for (const doc of wsSnap.docs) {
  const ws = doc.data();
  const wid = doc.id;
  const currentPlan = ws.plan || "free";
  const billingStatus = ws.billingStatus || "none";

  // Resolve owner email
  let ownerEmail = ws.ownerEmail || null;
  if (!ownerEmail && ws.ownerUid) {
    try {
      const u = await auth.getUser(ws.ownerUid);
      ownerEmail = u.email || null;
    } catch {
      ownerEmail = null;
    }
  }

  // Identify Free workspaces
  if (currentPlan === "free" || (!ws.paddleSubscriptionId && billingStatus === "none" && currentPlan !== "growth" && currentPlan !== "custom")) {
    const planned = {
      plan: "starter",
      billingStatus: "trialing",
      trialEndsAt: trialEndsAt.toISOString(),
    };

    if (isDryRun) {
      console.log(`[DRY-RUN] Workspace: ${wid} ("${ws.name || 'Untitled'}")`);
      console.log(`  Owner: ${ownerEmail || 'No email found'} (${ws.ownerUid || 'No UID'})`);
      console.log(`  Current State: plan="${currentPlan}", billingStatus="${billingStatus}"`);
      console.log(`  Planned State: plan="${planned.plan}", billingStatus="${planned.billingStatus}", trialEndsAt="${planned.trialEndsAt}"`);
      console.log(`  Planned Email: "Your 7Captur workspace has been upgraded to a 14-day Starter trial"\n`);
      migratedCount++;
    } else {
      try {
        // 1. Send notification email first (idempotent doc ID)
        if (ownerEmail) {
          const mailId = `migrate_free_starter_${wid}`;
          const mailRef = db.collection("mail").doc(mailId);
          const mailDoc = await mailRef.get();
          if (!mailDoc.exists) {
            await mailRef.set({
              to: ownerEmail,
              message: {
                subject: "Your 7Captur workspace has been upgraded to a 14-day Starter trial",
                text: `Hello,\n\nWe have updated our plans to deliver a more focused experience. Your workspace "${ws.name || 'Untitled'}" has been moved to a 14-day Starter trial starting today.\n\nYou now have full access to Starter features (recommendations, CSV imports, and multi-platform connections) with no card required.\n\nSign in to your workspace:\nhttps://app.7captur.com/\n\nThe 7Captur Team`,
                html: `<p>Hello,</p><p>We have updated our plans to deliver a more focused experience. Your workspace <strong>${ws.name || 'Untitled'}</strong> has been moved to a <strong>14-day Starter trial</strong> starting today.</p><p>You now have full access to Starter features with no credit card required.</p><p><a href="https://app.7captur.com/" style="background:#2563eb;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Open 7Captur</a></p><p>The 7Captur Team</p>`,
              },
              meta: { workspaceId: wid, kind: "trial_migration" },
              queuedAt: FieldValue.serverTimestamp(),
            });
          }
        }

        // 2. Update workspace document
        await doc.ref.update({
          plan: "starter",
          billingStatus: "trialing",
          trialEndsAt: Timestamp.fromDate(trialEndsAt),
          migratedToTrialAt: FieldValue.serverTimestamp(),
        });

        console.log(`[MIGRATED] Workspace: ${wid} -> plan="starter", billingStatus="trialing", trialEndsAt="${planned.trialEndsAt}"`);
        migratedCount++;
      } catch (err) {
        console.error(`[ERROR] Failed to migrate workspace ${wid}:`, err);
        errorCount++;
      }
    }
  } else if (ws.paddleSubscriptionId || billingStatus === "active" || billingStatus === "canceling" || billingStatus === "past_due") {
    // Grandfathered paid subscription
    console.log(`[GRANDFATHERED] Workspace: ${wid} ("${ws.name || 'Untitled'}"), plan="${currentPlan}", billingStatus="${billingStatus}"`);
    grandfatheredCount++;
  } else {
    // Already on starter or other state
    console.log(`[UNCHANGED] Workspace: ${wid}, plan="${currentPlan}", billingStatus="${billingStatus}"`);
    unchangedCount++;
  }
}

console.log("\n================ MIGRATION SUMMARY ================");
console.log(`Mode:            ${isDryRun ? "DRY-RUN" : "LIVE"}`);
console.log(`Total Inspected: ${wsSnap.size}`);
console.log(`Migrated:        ${migratedCount}`);
console.log(`Grandfathered:   ${grandfatheredCount}`);
console.log(`Unchanged:       ${unchangedCount}`);
console.log(`Errors:          ${errorCount}`);
console.log("===================================================\n");
