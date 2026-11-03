// One-time cleanup after the admin fixes. Usage (run LOCALLY, once per project):
//   gcloud auth application-default login
//   GOOGLE_CLOUD_PROJECT=<project-id> node scripts/scrub-admin-data.mjs [--dry-run]
// 1) Removes `internalNotes` from every customer-readable workspaces/{id}/feedback/{ticket} doc
//    (they were copied there by the old adminUpdateFeedback and could be read by workspace members).
// 2) Moves the old `planOverride` field off the customer-readable workspace doc into planOverrides/{id}
//    (server-only), so existing manual overrides keep sticking and their reason stops being customer-visible.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const dry = process.argv.includes("--dry-run");
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) { console.error("Set GOOGLE_CLOUD_PROJECT to the Firebase project id."); process.exit(1); }
initializeApp({ credential: applicationDefault(), projectId: project });
const db = getFirestore();

let notes = 0;
for (const doc of (await db.collectionGroup("feedback").get()).docs) {
  if (!("internalNotes" in doc.data())) continue;
  notes++;
  if (!dry) await doc.ref.update({ internalNotes: FieldValue.delete() });
}

let overrides = 0;
for (const doc of (await db.collection("workspaces").where("planOverride", "!=", null).get()).docs) {
  const d = doc.data();
  overrides++;
  if (dry) continue;
  const batch = db.batch();
  batch.set(db.doc(`planOverrides/${doc.id}`), {
    plan: d.plan, billingStatus: d.billingStatus ?? "none", reason: d.planOverride?.reason ?? "migrated", by: d.planOverride?.by ?? null,
    byEmail: null, at: d.planOverride?.at ?? FieldValue.serverTimestamp(),
  });
  batch.update(doc.ref, { planOverride: FieldValue.delete() });
  await batch.commit();
}
console.log(`${dry ? "Would scrub" : "Scrubbed"} internalNotes on ${notes} feedback doc(s); ${dry ? "would move" : "moved"} ${overrides} plan override(s) in ${project}.`);
