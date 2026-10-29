import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type NotificationKind =
  | "weekly_report" | "payment_failed" | "subscription_ending" | "subscription_ended" | "band_change"
  | "integration_disconnected" | "deletion_scheduled" | "deletion_cancelled";

/** In-app notification. Pass an id to make it idempotent (same id never creates a second one). */
export async function addNotification(
  db: Firestore, workspaceId: string, n: { kind: NotificationKind; title: string; body: string; priority?: "normal" | "high" }, id?: string,
): Promise<void> {
  const ref = id ? db.doc(`workspaces/${workspaceId}/notifications/${id}`) : db.collection(`workspaces/${workspaceId}/notifications`).doc();
  try {
    await ref.create({ ...n, priority: n.priority ?? "normal", createdAt: FieldValue.serverTimestamp(), readAt: null });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) throw e; // ALREADY_EXISTS is fine
  }
}
