// One-off migration: plan + subscription move from the workspace to an ACCOUNT (accounts/{ownerUid}).
//
// What it does for every owner that has workspaces and no account yet:
//   1. creates accounts/{ownerUid} from the primary workspace (plan, billingStatus, trial, restrictAt, Paddle ids, timezone)
//   2. copies workspaces/{primary}/billing/subscription  -> accounts/{uid}/billing/subscription
//   3. copies workspaces/{primary}/usage/*               -> accounts/{uid}/usage/*   (allowances are now shared per account)
//   4. copies planOverrides/{primary}                    -> planOverrides/{uid}      (admin overrides are per account)
//   5. stamps overLimit=false and accountTimezone on the owner's workspaces
// It never deletes anything: the old workspace-level billing and usage docs stay in place as a backup.
// It is safe to re-run: owners that already have an account are skipped.
//
// The deployed functions also do steps 1-4 lazily the first time they touch an account (webhook, usage, create),
// but the daily jobs (trialLifecycle, enforceBilling) only look at accounts/, so RUN THIS RIGHT AFTER DEPLOYING.
//
// Usage (dry run is the default; nothing is written without --apply):
//   gcloud auth application-default login
//   GOOGLE_CLOUD_PROJECT=captur-app-dev node scripts/migrate-accounts.mjs
//   GOOGLE_CLOUD_PROJECT=captur-app-dev node scripts/migrate-accounts.mjs --apply

import { createRequire } from "node:module";

const req = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, applicationDefault } = req("firebase-admin/app");
const { getFirestore, FieldValue } = req("firebase-admin/firestore");

const apply = process.argv.includes("--apply");
const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (!project) { console.error("Set GOOGLE_CLOUD_PROJECT (for example captur-app-dev or the prod project id)."); process.exit(1); }

initializeApp({ credential: applicationDefault(), projectId: project });
const db = getFirestore();
console.log(`Account migration on project ${project} (${apply ? "APPLY" : "DRY RUN, nothing is written"})\n`);

const millis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);
const wsSnap = await db.collection("workspaces").get();
const byOwner = new Map();
for (const d of wsSnap.docs) {
  const uid = d.data().ownerUid;
  if (!uid) { console.log(`[SKIP] workspace ${d.id} has no ownerUid`); continue; }
  if (!byOwner.has(uid)) byOwner.set(uid, []);
  byOwner.get(uid).push(d);
}
console.log(`${wsSnap.size} workspaces, ${byOwner.size} owners.\n`);

const maxBusinesses = { starter: 1, growth: 3 }; // Custom and unknown plans are never marked over the limit
let created = 0, skipped = 0, failed = 0, manual = 0;

for (const [uid, docs] of byOwner) {
  try {
    docs.sort((a, b) => millis(a.data().createdAt) - millis(b.data().createdAt) || a.id.localeCompare(b.id));
    const accRef = db.doc(`accounts/${uid}`);
    if ((await accRef.get()).exists) { skipped++; console.log(`[EXISTS] ${uid}`); continue; }
    // Before accounts, an owner had one workspace. More than one (or two subscriptions) needs a human decision.
    if (docs.length > 1 || docs.filter((d) => d.data().paddleSubscriptionId).length > 1) {
      manual++;
      console.log(`[MANUAL] owner ${uid} has ${docs.length} workspaces (${docs.map((d) => d.id).join(", ")}). Skipped: decide the primary by hand.`);
      continue;
    }

    const primary = docs.find((d) => d.data().paddleSubscriptionId) ?? docs[0];
    const w = primary.data();
    const account = {
      ownerUid: uid,
      primaryWorkspaceId: primary.id,
      timezone: w.timezone ?? "UTC",
      plan: w.plan ?? "starter",
      planConfigVersion: w.planConfigVersion ?? 5,
      billingStatus: w.billingStatus ?? "none",
      trialEndsAt: w.trialEndsAt ?? null,
      restrictAt: w.restrictAt ?? null,
      paddleSubscriptionId: w.paddleSubscriptionId ?? null,
      paddleCustomerId: w.paddleCustomerId ?? null,
      createdAt: w.createdAt ?? FieldValue.serverTimestamp(),
      migratedFromWorkspace: primary.id,
    };
    const billing = await db.doc(`workspaces/${primary.id}/billing/subscription`).get();
    const usage = await db.collection(`workspaces/${primary.id}/usage`).get();
    const override = await db.doc(`planOverrides/${primary.id}`).get();
    console.log(`[MIGRATE] owner ${uid}: ${docs.length} workspace(s), primary ${primary.id}, plan=${account.plan}, status=${account.billingStatus}, sub=${account.paddleSubscriptionId ?? "none"}, usage docs=${usage.size}, override=${override.exists}`);
    if (!apply) { created++; continue; }

    await accRef.create(account);
    if (billing.exists) await db.doc(`accounts/${uid}/billing/subscription`).set(billing.data(), { merge: true });
    for (const u of usage.docs) await db.doc(`accounts/${uid}/usage/${u.id}`).set(u.data(), { merge: true });
    if (override.exists && !(await db.doc(`planOverrides/${uid}`).get()).exists) {
      await db.doc(`planOverrides/${uid}`).set({ ...override.data(), workspaceId: primary.id });
    }
    const allowed = maxBusinesses[account.plan] ?? Infinity;
    const ordered = [primary, ...docs.filter((d) => d.id !== primary.id)];
    for (let i = 0; i < ordered.length; i++) {
      await ordered[i].ref.update({ overLimit: i >= allowed, accountTimezone: account.timezone });
    }
    created++;
  } catch (err) {
    failed++;
    console.error(`[ERROR] owner ${uid}:`, err);
  }
}

console.log(`\nDone. ${apply ? "Migrated" : "Would migrate"}: ${created}, already had an account: ${skipped}, needs manual review: ${manual}, failed: ${failed}.`);
if (!apply) console.log("Re-run with --apply to write.");
process.exit(failed ? 1 : 0);
