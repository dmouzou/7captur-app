import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import type { PlanId } from "../../shared/plans";

export interface WorkspaceState {
  workspaceId: string; businessId: string; plan: PlanId; timezone: string; currency: string; objective: string;
  ownerUid: string; billingStatus: string; restrictAtMs: number | null; hasSubscription: boolean;
  deletionScheduledMs: number | null; reportedSpendUsd: number | null; pendingBand: { to: PlanId; effectiveMs: number } | null;
}
const Ctx = createContext<WorkspaceState | null>(null);
export const useWorkspace = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside provider");
  return v;
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let unsub = () => {};
    (async () => {
      try {
        const u = await getDoc(doc(db, "users", user.uid));
        const workspaceId = u.data()?.defaultWorkspaceId as string | undefined;
        if (!workspaceId) throw new Error("no workspace");
        const biz = await getDocs(query(collection(db, `workspaces/${workspaceId}/businesses`), limit(1)));
        const b = biz.docs[0];
        if (!b) throw new Error("no business");
        unsub = onSnapshot(doc(db, "workspaces", workspaceId), (w) => {
          const d = w.data();
          if (!d) return;
          setState({
            workspaceId, businessId: b.id, plan: d.plan, timezone: d.timezone,
            currency: b.data().currency, objective: b.data().objective,
            ownerUid: d.ownerUid, billingStatus: d.billingStatus ?? "none", hasSubscription: Boolean(d.paddleSubscriptionId),
            restrictAtMs: d.restrictAt?.toMillis?.() ?? null,
            deletionScheduledMs: d.deletionScheduledFor?.toMillis?.() ?? null,
            reportedSpendUsd: typeof d.reportedSpendUsd === "number" ? d.reportedSpendUsd : null,
            pendingBand: d.pendingBandChange?.to ? { to: d.pendingBandChange.to, effectiveMs: d.pendingBandChange.effectiveAt?.toMillis?.() ?? 0 } : null,
          });
        });
      } catch { setError("Could not load your workspace."); }
    })();
    return () => unsub();
  }, [user]);

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!state) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
