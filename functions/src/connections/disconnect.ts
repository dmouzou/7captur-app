import type { Firestore } from "firebase-admin/firestore";

/** Provider-specific revocation hooks. Each provider module registers one (see shopify.ts). */
export type Revoker = (db: Firestore, workspaceId: string, connectionId: string, conn: FirebaseFirestore.DocumentData) => Promise<void>;
export const revokers: Record<string, Revoker> = {};

/**
 * Disconnect one connection: revoke at the provider (best effort), delete the stored credential,
 * mark it disconnected. Previously synced records stay (labelled as connected data). Idempotent.
 */
export async function disconnectConnection(db: Firestore, workspaceId: string, connectionId: string): Promise<void> {
  const ref = db.doc(`workspaces/${workspaceId}/connections/${connectionId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const conn = snap.data()!;
  try { await revokers[conn.provider]?.(db, workspaceId, connectionId, conn); } catch { /* provider may already have revoked it */ }
  if (conn.secretRef) await db.doc(conn.secretRef as string).delete();
  await ref.update({ status: "disconnected", secretRef: null, disconnectedAt: new Date() });
}

export async function disconnectAllConnections(db: Firestore, workspaceId: string): Promise<void> {
  const snap = await db.collection(`workspaces/${workspaceId}/connections`).get();
  for (const d of snap.docs) await disconnectConnection(db, workspaceId, d.id);
}
