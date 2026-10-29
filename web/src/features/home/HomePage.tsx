import { signOut } from "firebase/auth";
import { auth } from "../../services/firebase";
import { PLANS } from "../../shared/plans";

// Placeholder. Phase 1 builds: next action, allowance/reset, recent activity, missing-data prompt.
export function HomePage() {
  const free = PLANS.free;
  return (
    <main className="page">
      <h1>Home</h1>
      <div className="card">
        <p>Workspace created on the <strong>{free.name}</strong> plan: {free.recommendations.weekly} new recommendations per week.</p>
        <p className="muted">Manual inputs, imports and recommendations arrive in Phase 1 of the roadmap.</p>
        <button type="button" onClick={() => signOut(auth)}>Sign out</button>
      </div>
    </main>
  );
}
