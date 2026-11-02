import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/** Membership check. Editing actions are also refused while an admin has suspended the workspace. */
export async function requireMember(db: Firestore, workspaceId: string, uid: string, edit: boolean, opts: { allowSuspended?: boolean } = {}) {
  const m = await db.doc(`workspaces/${workspaceId}/members/${uid}`).get();
  const d = m.data();
  if (!m.exists || d?.status !== "active") throw new HttpsError("permission-denied", "Not a member of this workspace.");
  if (edit && !["owner", "editor"].includes(d.role)) throw new HttpsError("permission-denied", "Your role cannot do this.");
  if (edit) {
    const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
    if (!opts.allowSuspended && ws?.suspended) {
      throw new HttpsError("failed-precondition", "This workspace is suspended. Contact support.");
    }
    if (ws?.billingStatus === "trial_expired" || ws?.billingStatus === "restricted") {
      throw new HttpsError("failed-precondition", "This workspace is read-only. Subscribe to continue making changes.");
    }
  }
}
