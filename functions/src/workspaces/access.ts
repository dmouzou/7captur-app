import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export async function requireMember(db: Firestore, workspaceId: string, uid: string, edit: boolean) {
  const m = await db.doc(`workspaces/${workspaceId}/members/${uid}`).get();
  const d = m.data();
  if (!m.exists || d?.status !== "active") throw new HttpsError("permission-denied", "Not a member of this workspace.");
  if (edit && !["owner", "editor"].includes(d.role)) throw new HttpsError("permission-denied", "Your role cannot do this.");
}
