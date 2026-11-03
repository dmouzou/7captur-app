import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

/** Admin roles live ONLY in Firebase custom claims (`role`), set by the server. Never in Firestore, never by clients. */
export const ADMIN_ROLES = ["super_admin", "ops", "billing", "support"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type Permission =
  | "read_overview" | "read_analytics" | "read_workspaces" | "read_recommendations" | "read_imports" | "read_integrations" | "read_jobs"
  | "read_billing" | "read_plans" | "read_audit" | "suspend_workspace" | "change_plan" | "manage_admins" | "manage_ai"
  | "read_feedback" | "update_feedback";

const ALL: Permission[] = [
  "read_overview", "read_analytics", "read_workspaces", "read_recommendations", "read_imports", "read_integrations", "read_jobs",
  "read_billing", "read_plans", "read_audit", "suspend_workspace", "change_plan", "manage_admins", "manage_ai",
  "read_feedback", "update_feedback",
];
/**
 * change_plan, manage_admins and manage_ai belong to super_admin ONLY. Do not add them to another role.
 * (Plan changes are a super admin decision: they override Paddle until cleared.)
 */
export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  super_admin: ALL,
  ops: ["read_overview", "read_analytics", "read_workspaces", "read_recommendations", "read_imports", "read_integrations", "read_jobs", "read_plans", "suspend_workspace", "read_feedback", "update_feedback"],
  billing: ["read_overview", "read_analytics", "read_workspaces", "read_billing", "read_plans"],
  support: ["read_workspaces", "read_recommendations", "read_imports", "read_integrations", "read_feedback", "update_feedback"],
};
/** Actions that change state need a login from the last 5 minutes. */
const FRESH_LOGIN_SECONDS = 300;

export const roleHas = (role: string | undefined, perm: Permission) => ADMIN_ROLES.includes(role as AdminRole) && ROLE_PERMISSIONS[role as AdminRole].includes(perm);

/** True when the server rejects admin calls that were not signed in with a second factor. Off by default until MFA is enrolled. */
export const mfaEnforced = () => process.env.ADMIN_REQUIRE_MFA === "true";
export const hasSecondFactor = (token: Record<string, unknown> | undefined) =>
  Boolean((token?.firebase as { sign_in_second_factor?: string } | undefined)?.sign_in_second_factor);

export interface AdminContext { uid: string; email: string | null; role: AdminRole }

export function requireAdmin(request: CallableRequest, perm: Permission, opts: { fresh?: boolean } = {}): AdminContext {
  const t = request.auth?.token;
  if (!request.auth || !t) throw new HttpsError("unauthenticated", "Sign in first.");
  const role = t.role as string | undefined;
  // Same error for "not an admin" and "missing permission": do not reveal the admin surface exists.
  if (!roleHas(role, perm)) throw new HttpsError("permission-denied", "Not allowed.");
  if (mfaEnforced() && !hasSecondFactor(t as unknown as Record<string, unknown>)) throw new HttpsError("failed-precondition", "mfa-required");
  if (opts.fresh && Date.now() / 1000 - Number(t.auth_time ?? 0) > FRESH_LOGIN_SECONDS) throw new HttpsError("failed-precondition", "recent-login-required");
  return { uid: request.auth.uid, email: (t.email as string | undefined) ?? null, role: role as AdminRole };
}

type AuditExtra = { reason?: string; before?: unknown; after?: unknown; meta?: Record<string, unknown> };

function auditData(admin: AdminContext, action: string, target: string, extra: AuditExtra) {
  return {
    actorUid: admin.uid, actorEmail: admin.email, actorRole: admin.role, action, target, reason: extra.reason ?? null,
    before: extra.before ?? null, after: extra.after ?? null, meta: extra.meta ?? null, createdAt: FieldValue.serverTimestamp(),
  };
}

/** Append-only audit entry for every admin read of customer data and every admin change. */
export async function audit(admin: AdminContext, action: string, target: string, extra: AuditExtra = {}) {
  await getFirestore().collection("auditEvents").add(auditData(admin, action, target, extra));
}

/**
 * Put the audit entry in the SAME batch/transaction as the change, so a change can never be saved without its audit
 * entry (and an audit entry never exists for a change that failed).
 */
export function auditInBatch(batch: FirebaseFirestore.WriteBatch, admin: AdminContext, action: string, target: string, extra: AuditExtra = {}) {
  batch.set(getFirestore().collection("auditEvents").doc(), auditData(admin, action, target, extra));
}

/** Firestore Timestamps and nested values to JSON-safe values; drops secret-looking fields defensively. */
const SECRET_KEYS = /secret|token|password|apikey|api_key|credential/i;
/** Usage counters that merely contain the word "token" are not secrets. */
const SAFE_KEYS = /^(inputTokens|outputTokens|totalTokens|tokensUsed|tokenUsage)$/;
const isSecretKey = (k: string) => SECRET_KEYS.test(k) && !SAFE_KEYS.test(k);
export function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !isSecretKey(k)).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}
