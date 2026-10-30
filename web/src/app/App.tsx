import { Suspense, lazy, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { AuthProvider, useAuth } from "../features/auth/AuthProvider";
import { AuthPage } from "../features/auth/AuthPage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { HomePage } from "../features/home/HomePage";
import { WorkspaceProvider } from "../features/workspace/WorkspaceProvider";
import { db } from "../services/firebase";

const AdminApp = lazy(() => import("../features/admin/AdminApp"));

// Route guards are UX only. Firestore rules and Functions enforce access.
function Gate() {
  const { user, loading } = useAuth();
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user) { setHasWorkspace(null); return; }
    // users/{uid}.defaultWorkspaceId is written server-side by createWorkspace.
    getDoc(doc(db, "users", user.uid))
      .then((s) => setHasWorkspace(Boolean(s.exists() && s.data().defaultWorkspaceId)))
      .catch(() => setHasWorkspace(false));
  }, [user, nonce]);

  if (loading) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  if (!user) return <AuthPage />;
  if (hasWorkspace === null) return <main className="page"><p className="muted" role="status">Loading…</p></main>;
  return hasWorkspace ? <WorkspaceProvider><HomePage /></WorkspaceProvider> : <OnboardingPage onDone={() => setNonce((n) => n + 1)} />;
}

export default function App() {
  const isHostAdmin = window.location.hostname.includes("-admin.") || window.location.hostname.startsWith("admin.");
  const isPathAdmin = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
  const isAdmin = isHostAdmin || isPathAdmin;
  return <AuthProvider>{isAdmin ? <Suspense fallback={null}><AdminApp /></Suspense> : <Gate />}</AuthProvider>;
}
