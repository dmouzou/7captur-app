import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/** Membership check. Editing actions are also refused while an admin has suspended the workspace. */
export async function requireMember(
  db: Firestore,
  workspaceId: string,
  uid: string,
  edit: boolean,
  opts: { allowSuspended?: boolean; allowReadOnly?: boolean } = {}
) {
  const wsDoc = await db.doc(`workspaces/${workspaceId}`).get();
  const ws = wsDoc.data();
  if (!wsDoc.exists || !ws) throw new HttpsError("not-found", "Workspace not found.");

  const isOwner = ws.ownerUid === uid;
  const m = await db.doc(`workspaces/${workspaceId}/members/${uid}`).get();
  const d = m.data();

  if (!isOwner && (!m.exists || d?.status !== "active")) {
    throw new HttpsError("permission-denied", "Not a member of this workspace.");
  }
  const role = isOwner ? "owner" : d?.role;
  if (edit && !["owner", "editor"].includes(role)) {
    throw new HttpsError("permission-denied", "Your role cannot do this.");
  }
  if (edit) {
    if (!opts.allowSuspended && ws.suspended) {
      throw new HttpsError("failed-precondition", "This workspace is suspended. Contact support.");
    }
    if (!opts.allowReadOnly) {
      if (ws.overLimit === true) {
        throw new HttpsError("failed-precondition", "This workspace is over your plan's workspace limit and is read-only. Upgrade to keep editing it. Nothing is deleted.");
      }
      if (ws.billingStatus === "trial_expired" || ws.billingStatus === "restricted") {
        throw new HttpsError("failed-precondition", "This workspace is read-only. Subscribe to continue making changes.");
      }
    }
  }
}
