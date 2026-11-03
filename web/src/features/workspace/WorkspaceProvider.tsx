import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { PLANS, type PlanId } from "../../shared/plans";

export interface WorkspaceState {
  workspaceId: string; businessId: string; workspaceName: string; businessName: string;
  plan: PlanId; timezone: string; currency: string; convertCurrencies: boolean; objective: string; country: string;
  ownerUid: string; billingStatus: string; restrictAtMs: number | null; trialEndsAtMs: number | null;
  isTrialing: boolean; isTrialExpired: boolean; isReadOnly: boolean; hasSubscription: boolean;
  deletionScheduledMs: number | null;
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
    let unsubWs = () => {};
    let unsubBiz = () => {};
    (async () => {
      try {
        const u = await getDoc(doc(db, "users", user.uid));
        const workspaceId = u.data()?.defaultWorkspaceId as string | undefined;
        if (!workspaceId) throw new Error("no workspace");
        const bizDocs = await getDocs(query(collection(db, `workspaces/${workspaceId}/businesses`), limit(1)));
        const b = bizDocs.docs[0];
        if (!b) throw new Error("no business");

        let curBizData = b.data();
        let curWsData: Record<string, unknown> | null = null;

        const updateCombinedState = () => {
          if (!curWsData) return;
          const billingStatus = (curWsData.billingStatus as string) ?? "none";
          const restrictAt = curWsData.restrictAt as { toMillis?: () => number } | undefined;
          const trialEndsAt = curWsData.trialEndsAt as { toMillis?: () => number } | undefined;
          const deletionScheduledFor = curWsData.deletionScheduledFor as { toMillis?: () => number } | undefined;
          const restrictAtMs = restrictAt?.toMillis?.() ?? null;
          const trialEndsAtMs = trialEndsAt?.toMillis?.() ?? null;
          const isTrialing = billingStatus === "trialing";
          const isTrialExpired = billingStatus === "trial_expired";
          const isRestricted = billingStatus === "restricted" || (restrictAtMs !== null && restrictAtMs <= Date.now());
          const isReadOnly = isTrialExpired || isRestricted;

          const rawPlan = curWsData.plan as string | undefined;
          const plan: PlanId = (rawPlan && rawPlan in PLANS) ? (rawPlan as PlanId) : "starter";

          setState({
            workspaceId,
            businessId: b.id,
            workspaceName: String(curWsData.name || curBizData.name || "Workspace"),
            businessName: String(curBizData.name || curWsData.name || "Business"),
            plan,
            timezone: String(curWsData.timezone || curBizData.timezone || "America/New_York"),
            currency: String(curBizData.currency || curWsData.defaultCurrency || "USD"),
            convertCurrencies: curBizData.convertCurrencies !== false,
            objective: String(curBizData.objective || "profitability"),
            country: String(curWsData.country || "US"),
            ownerUid: String(curWsData.ownerUid || ""),
            billingStatus,
            hasSubscription: Boolean(curWsData.paddleSubscriptionId),
            restrictAtMs,
            trialEndsAtMs,
            isTrialing,
            isTrialExpired,
            isReadOnly,
            deletionScheduledMs: deletionScheduledFor?.toMillis?.() ?? null,
          });
        };

        unsubWs = onSnapshot(doc(db, "workspaces", workspaceId), (w) => {
          const d = w.data();
          if (!d) return;
          curWsData = d;
          updateCombinedState();
        });

        unsubBiz = onSnapshot(doc(db, `workspaces/${workspaceId}/businesses`, b.id), (bizSnap) => {
          const d = bizSnap.data();
          if (d) {
            curBizData = d;
            updateCombinedState();
          }
        });
      } catch { setError("Could not load your workspace."); }
    })();
    return () => {
      unsubWs();
      unsubBiz();
    };
  }, [user]);

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!state) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
