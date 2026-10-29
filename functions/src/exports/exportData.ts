import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { exportDataInput } from "../shared/export";
import { COLLECTIONS } from "../shared/records";
import { requireMember } from "../workspaces/access";

const input = z.object({ workspaceId: z.string().min(1).max(128), businessId: z.string().min(1).max(128) });

function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]));
  return v;
}

/** Returns the customer's own data for download. Scoped to one workspace and business; any active member can export. */
export const exportData = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { workspaceId, businessId } = parsed.data;
  const db = getFirestore();
  await requireMember(db, workspaceId, uid, false);

  const max = exportDataInput.maxPerCollection;
  const biz = await db.doc(`workspaces/${workspaceId}/businesses/${businessId}`).get();
  if (!biz.exists) throw new HttpsError("not-found", "Business not found.");

  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), business: plain(biz.data()) };
  const truncated: string[] = [];
  for (const c of [...COLLECTIONS, "recommendations"] as const) {
    const snap = await db.collection(`workspaces/${workspaceId}/${c}`).where("businessId", "==", businessId).limit(max + 1).get();
    if (snap.size > max) truncated.push(c);
    out[c] = snap.docs.slice(0, max).map((d) => ({ id: d.id, ...(plain(d.data()) as object) }));
  }
  out.truncated = truncated;
  return out;
});
