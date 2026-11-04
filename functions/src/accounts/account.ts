import { FieldValue, Timestamp, type DocumentData, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { PLAN_CONFIG_VERSION, getPlan } from "../shared/plans";

/**
 * Account = the paying customer. One account per owner uid: accounts/{ownerUid}.
 * It holds the plan, trial, subscription and the shared usage counters. A workspace is one business and
 * belongs to an account through workspaces/{id}.ownerUid.
 *
 * Plan fields are MIRRORED onto every workspace doc by the server (mirrorAccountToWorkspaces) so that
 * security rules, the client and the admin tools can keep reading them from the workspace. The account is
 * the source of truth: never write these fields on a workspace directly.
 */
export const accountPath = (uid: string) => `accounts/${uid}`;

export const MIRROR_KEYS = [
  "plan", "planConfigVersion", "billingStatus", "trialEndsAt", "restrictAt", "paddleSubscriptionId", "paddleCustomerId",
] as const;

const millis = (v: unknown): number => (v && typeof (v as Timestamp).toMillis === "function" ? (v as Timestamp).toMillis() : 0);

/** Workspaces owned by uid, oldest first. */
export async function workspacesOfOwner(db: Firestore, uid: string): Promise<QueryDocumentSnapshot[]> {
  const snap = await db.collection("workspaces").where("ownerUid", "==", uid).get();
  return snap.docs.slice().sort((a, b) => millis(a.data().createdAt) - millis(b.data().createdAt) || a.id.localeCompare(b.id));
}

/** Primary workspace first, then the rest oldest first. */
export function orderWorkspaces(docs: QueryDocumentSnapshot[], primaryId?: string | null): QueryDocumentSnapshot[] {
  const rest = docs.filter((d) => d.id !== primaryId);
  const first = docs.filter((d) => d.id === primaryId);
  return [...first, ...rest];
}

/** How many workspaces of this account the plan allows to be active (editable). */
export function allowedWorkspaces(plan: string): number {
  return getPlan(plan).maxBusinesses;
}

/** Copies the account's plan state onto all its workspaces, and marks workspaces beyond the plan's limit as overLimit (read-only, nothing deleted). */
export async function mirrorAccountToWorkspaces(db: Firestore, uid: string, acct?: DocumentData): Promise<void> {
  const a = acct ?? (await db.doc(accountPath(uid)).get()).data();
  if (!a) return;
  const docs = orderWorkspaces(await workspacesOfOwner(db, uid), a.primaryWorkspaceId as string | undefined);
  const allowed = allowedWorkspaces(a.plan as string);
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach((d, j) => {
      const update: Record<string, unknown> = { overLimit: i + j >= allowed };
      for (const k of MIRROR_KEYS) if (a[k] !== undefined) update[k] = a[k];
      // Allowance periods (weeks, months) reset in the account's timezone, which is the first workspace's.
      if (a.timezone) update.accountTimezone = a.timezone;
      batch.update(d.ref, update);
    });
    await batch.commit();
  }
}

/** Writes a patch on the account, then mirrors the result to its workspaces. Use this for every plan or billing change. */
export async function applyAccountPatch(db: Firestore, uid: string, patch: Record<string, unknown>): Promise<void> {
  const ref = db.doc(accountPath(uid));
  await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await mirrorAccountToWorkspaces(db, uid, (await ref.get()).data());
}

/**
 * Like applyAccountPatch, but only if the account still has the state the caller read (billingStatus and restrictAt).
 * Scheduled jobs use it so a Paddle event that lands while they run is never overwritten. Returns false when skipped.
 */
export async function applyAccountPatchIf(
  db: Firestore, uid: string, expected: { billingStatus?: string; restrictAtMs?: number | null }, patch: Record<string, unknown>,
): Promise<boolean> {
  const ref = db.doc(accountPath(uid));
  const ok = await db.runTransaction(async (tx) => {
    const a = (await tx.get(ref)).data();
    if (!a) return false;
    if (expected.billingStatus !== undefined && a.billingStatus !== expected.billingStatus) return false;
    if (expected.restrictAtMs !== undefined && (a.restrictAt ? millis(a.restrictAt) : null) !== expected.restrictAtMs) return false;
    tx.set(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  if (ok) await mirrorAccountToWorkspaces(db, uid, (await ref.get()).data());
  return ok;
}

/** Makes sure every owner of the given workspaces has an account. The daily jobs call this so legacy workspaces are never skipped. */
export async function bootstrapOwners(db: Firestore, docs: QueryDocumentSnapshot[]): Promise<void> {
  const seen = new Set<string>();
  for (const d of docs) {
    const uid = d.data().ownerUid as string | undefined;
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    await bootstrapAccount(db, uid).catch(() => undefined);
  }
}

/**
 * Creates accounts/{uid} from a pre-account workspace (one-time, idempotent). Moves the subscription record,
 * the admin plan override and the current usage counters to the account. Used lazily by the server and
 * eagerly by scripts/migrate-accounts.mjs.
 */
export async function bootstrapAccount(db: Firestore, uid: string): Promise<DocumentData> {
  const ref = db.doc(accountPath(uid));
  const existing = await ref.get();
  if (existing.exists) return existing.data()!;
  const docs = await workspacesOfOwner(db, uid);
  if (docs.length === 0) throw new Error("no workspace for account");
  const primary = docs.find((d) => d.data().paddleSubscriptionId) ?? docs[0];
  const w = primary.data();
  const data: Record<string, unknown> = {
    ownerUid: uid,
    primaryWorkspaceId: primary.id,
    timezone: w.timezone ?? "UTC",
    plan: w.plan ?? "starter",
    planConfigVersion: w.planConfigVersion ?? PLAN_CONFIG_VERSION,
    billingStatus: w.billingStatus ?? "none",
    trialEndsAt: w.trialEndsAt ?? null,
    restrictAt: w.restrictAt ?? null,
    paddleSubscriptionId: w.paddleSubscriptionId ?? null,
    paddleCustomerId: w.paddleCustomerId ?? null,
    createdAt: w.createdAt ?? FieldValue.serverTimestamp(),
    migratedFromWorkspace: primary.id,
  };
  // Copy the old billing, override and usage FIRST, never overwriting anything that already exists, and create the
  // account LAST. A crash before the create leaves no account, so the next call simply starts over. The account doc
  // is what other code treats as "migrated", so it must only appear once everything it needs is in place.
  const keep = async (target: string, value: DocumentData) => {
    try { await db.doc(target).create(value); } catch (e) { if ((e as { code?: number }).code !== 6) throw e; }
  };
  const billing = await db.doc(`workspaces/${primary.id}/billing/subscription`).get();
  if (billing.exists) await keep(`${accountPath(uid)}/billing/subscription`, billing.data()!);
  const usage = await db.collection(`workspaces/${primary.id}/usage`).get();
  for (const u of usage.docs) await keep(`${accountPath(uid)}/usage/${u.id}`, u.data());
  const override = await db.doc(`planOverrides/${primary.id}`).get();
  if (override.exists) await keep(`planOverrides/${uid}`, { ...override.data()!, workspaceId: primary.id });
  try {
    await ref.create(data);
  } catch (e) {
    if ((e as { code?: number }).code === 6) return (await ref.get()).data()!; // created by a parallel call
    throw e;
  }
  const created = (await ref.get()).data()!;
  await mirrorAccountToWorkspaces(db, uid, created);
  return created;
}

/** Account behind a workspace. Bootstraps it for workspaces that pre-date accounts. */
export async function ensureAccountForWorkspace(db: Firestore, workspaceId: string): Promise<{ uid: string; account: DocumentData }> {
  const ws = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  if (!ws?.ownerUid) throw new Error("workspace not found");
  const uid = ws.ownerUid as string;
  const snap = await db.doc(accountPath(uid)).get();
  return { uid, account: snap.exists ? snap.data()! : await bootstrapAccount(db, uid) };
}
