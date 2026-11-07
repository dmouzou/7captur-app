import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { PLANS, type PlanId } from "../../shared/plans";

export interface WorkspaceState {
  workspaceId: string; businessId: string; workspaceName: string; businessName: string;
  plan: PlanId; timezone: string; currency: string; /** null until the owner has chosen. */ convertCurrencies: boolean | null; objective: string; country: string;
  ownerUid: string; userRole: "owner" | "editor" | "viewer"; billingStatus: string; restrictAtMs: number | null; trialEndsAtMs: number | null;
  daysLeft: number;
  isTrialing: boolean; isTrialExpired: boolean; isReadOnly: boolean; hasSubscription: boolean;
  deletionScheduledMs: number | null;
  /** Server flag: this workspace is beyond what the account's plan allows. It stays readable but not editable. */
  overLimit: boolean;
  /** Timezone in which the account's weekly and monthly allowances reset. */
  accountTimezone: string;
  /** All business workspaces of this account, and how many the plan allows. */
  workspaces: { id: string; name: string; role?: string }[];
  maxWorkspaces: number;
  switchWorkspace: (workspaceId: string) => void;
  /** Re-read the list after a new workspace is created, optionally switching to it. */
  refreshWorkspaces: (switchTo?: string) => void;
}
const Ctx = createContext<WorkspaceState | null>(null);
export const useWorkspace = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace outside provider");
  return v;
};

export function parseTimestampMs(val: unknown): number | null {
  if (!val) return null;
  if (typeof val === "number") {
    return val < 1e11 ? val * 1000 : val;
  }
  if (typeof val === "string") {
    const ms = Date.parse(val);
    return isNaN(ms) ? null : ms;
  }
  if (val instanceof Date) {
    return val.getTime();
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.toMillis === "function") return obj.toMillis();
    if (typeof obj.toDate === "function") return (obj.toDate() as Date).getTime();
    if (typeof obj.seconds === "number") return obj.seconds * 1000 + Math.round((Number(obj.nanoseconds) || 0) / 1e6);
    if (typeof obj._seconds === "number") return obj._seconds * 1000 + Math.round((Number(obj._nanoseconds) || 0) / 1e6);
  }
  return null;
}

const activeKey = (uid: string) => `7captur.activeWorkspace.${uid}`;
const readActive = (uid: string): string | null => { try { return localStorage.getItem(activeKey(uid)); } catch { return null; } };
const writeActive = (uid: string, id: string) => { try { localStorage.setItem(activeKey(uid), id); } catch { /* private mode: the default workspace is used */ } };

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState("");
  // The workspace being viewed. The account's other workspaces are separate businesses with their own data and connections.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [listNonce, setListNonce] = useState(0);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // Workspaces owned by this user, oldest first.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [u, prefsDoc, owned] = await Promise.all([
          getDoc(doc(db, "users", user.uid)),
          getDoc(doc(db, "users", user.uid, "prefs", "main")).catch(() => null),
          // If the list cannot be read, the default workspace below still loads.
          getDocs(query(collection(db, "workspaces"), where("ownerUid", "==", user.uid))).catch(() => ({ docs: [] as never[] })),
        ]);
        if (cancelled) return;
        const rows = owned.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? "Workspace"),
            role: "Owner",
            at: (d.data().createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
          }))
          .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        const prefsLast = prefsDoc?.exists() ? (prefsDoc.data()?.lastWorkspaceId as string | undefined) : undefined;
        const def = prefsLast ?? (u.data()?.defaultWorkspaceId as string | undefined);
        const ids = rows.map((r) => r.id);
        // Workspaces the user is only a member of (not the owner) fall back to the default workspace.
        if (def && !ids.includes(def)) rows.push({ id: def, name: "Workspace", role: "Member", at: Number.MAX_SAFE_INTEGER });
        setList(rows.map(({ id, name, role }) => ({ id, name, role })));
        const wanted = pendingSwitch ?? prefsLast ?? readActive(user.uid);
        const all = rows.map((r) => r.id);
        setActiveId(wanted && all.includes(wanted) ? wanted : def && all.includes(def) ? def : all[0] ?? null);
        if (pendingSwitch) setPendingSwitch(null);
      } catch { if (!cancelled) setError("Could not load your workspace."); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, listNonce]);

  useEffect(() => {
    if (!user || !activeId) return;
    let unsubWs = () => {};
    let unsubBiz = () => {};
    // A fast switch can finish this effect before the awaits below return: never attach listeners after cleanup.
    let cancelled = false;
    setState(null);
    (async () => {
      try {
        const workspaceId = activeId;
        if (!workspaceId) throw new Error("no workspace");
        const bizDocs = await getDocs(query(collection(db, `workspaces/${workspaceId}/businesses`), limit(1)));
        const b = bizDocs.docs[0];
        if (!b) throw new Error("no business");
        if (cancelled) return;

        let curBizData = b.data();
        let curWsData: Record<string, unknown> | null = null;

        const updateCombinedState = () => {
          if (!curWsData) return;
          const billingStatus = (curWsData.billingStatus as string) ?? "none";
          const restrictAtMs = parseTimestampMs(curWsData.restrictAt);
          const trialEndsAtMs = parseTimestampMs(curWsData.trialEndsAt) ?? (
            curWsData.createdAt ? (parseTimestampMs(curWsData.createdAt) ?? 0) + 14 * 24 * 60 * 60 * 1000 : null
          );
          const deletionScheduledMs = parseTimestampMs(curWsData.deletionScheduledFor);
          const hasSubscription = Boolean(curWsData.paddleSubscriptionId);
          const isExpiredByTime = (billingStatus === "trialing" || billingStatus === "none") && trialEndsAtMs !== null && trialEndsAtMs <= Date.now() && !hasSubscription;
          const isTrialExpired = billingStatus === "trial_expired" || isExpiredByTime;
          const isTrialing = !isTrialExpired && !hasSubscription && (billingStatus === "trialing" || billingStatus === "none") && (curWsData.plan === "starter" || !curWsData.plan);
          const daysLeft = trialEndsAtMs ? Math.max(0, Math.ceil((trialEndsAtMs - Date.now()) / (24 * 60 * 60 * 1000))) : 14;
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
            convertCurrencies: typeof curBizData.convertCurrencies === "boolean" ? curBizData.convertCurrencies : null,
            objective: String(curBizData.objective || "profitability"),
            country: String(curWsData.country || "US"),
            ownerUid: String(curWsData.ownerUid || ""),
            userRole: curWsData.ownerUid === user.uid ? "owner" : "editor",
            billingStatus,
            hasSubscription,
            restrictAtMs,
            trialEndsAtMs,
            daysLeft,
            isTrialing,
            isTrialExpired,
            isReadOnly,
            deletionScheduledMs,
            overLimit: curWsData.overLimit === true,
            accountTimezone: String(curWsData.accountTimezone || curWsData.timezone || curBizData.timezone || "America/New_York"),
            workspaces: list,
            maxWorkspaces: PLANS[plan].maxBusinesses,
            switchWorkspace: (id: string) => {
              writeActive(user.uid, id);
              setActiveId(id);
              setDoc(doc(db, "users", user.uid, "prefs", "main"), { lastWorkspaceId: id, updatedAt: Date.now() }, { merge: true }).catch(() => {});
            },
            refreshWorkspaces: (switchTo?: string) => {
              if (switchTo) {
                writeActive(user.uid, switchTo);
                setPendingSwitch(switchTo);
                setDoc(doc(db, "users", user.uid, "prefs", "main"), { lastWorkspaceId: switchTo, updatedAt: Date.now() }, { merge: true }).catch(() => {});
              }
              setListNonce((n) => n + 1);
            },
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
      cancelled = true;
      unsubWs();
      unsubBiz();
    };
  }, [user, activeId, list]);

  if (error) return <main className="page"><p className="error" role="alert">{error}</p></main>;
  if (!state) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
