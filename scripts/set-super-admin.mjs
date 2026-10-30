// Usage: node scripts/set-super-admin.mjs <email> [--revoke]
// Run LOCALLY with Application Default Credentials for the target project:
//   gcloud auth application-default login && GOOGLE_CLOUD_PROJECT=<project-id> node scripts/set-super-admin.mjs you@example.com
// Admin roles are Firebase custom claims. This is the only way to create the FIRST super_admin.
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [email, flag] = process.argv.slice(2);
if (!email) { console.error("Usage: node scripts/set-super-admin.mjs <email> [--revoke]"); process.exit(1); }
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) { console.error("Set GOOGLE_CLOUD_PROJECT to the Firebase project id."); process.exit(1); }
initializeApp({ credential: applicationDefault(), projectId: project });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
if (!user.emailVerified && flag !== "--revoke") { console.error("Email is not verified. Verify it first."); process.exit(1); }
const claims = { ...(user.customClaims ?? {}) };
if (flag === "--revoke") delete claims.role; else claims.role = "super_admin";
await auth.setCustomUserClaims(user.uid, claims);
await auth.revokeRefreshTokens(user.uid);
console.log(`${flag === "--revoke" ? "Revoked" : "Granted super_admin to"} ${email} (${user.uid}) in ${project}. Sign out and back in to refresh the token.`);
