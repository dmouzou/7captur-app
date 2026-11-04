import { useEffect, useRef, useState } from "react";
import { PLANS } from "../../shared/plans";
import { OnboardingPage } from "../onboarding/OnboardingPage";
import { useWorkspace } from "./WorkspaceProvider";

/**
 * Topbar workspace picker. Each business workspace is a separate business: its own records, recommendations
 * and connections. The plan, allowances and billing are shared by the account.
 */
export function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const canAdd = ws.workspaces.length < ws.maxWorkspaces && !ws.isReadOnly;
  const multi = ws.workspaces.length > 1 || ws.maxWorkspaces > 1;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className="topbar-ws-pill" style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => multi && setOpen((o) => !o)}
        aria-haspopup={multi ? "listbox" : undefined}
        aria-expanded={multi ? open : undefined}
        aria-label={multi ? "Switch business workspace" : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 8, margin: 0, cursor: multi ? "pointer" : "default",
          background: "var(--surface-subtle)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 12px 4px 10px",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ws.workspaceName || "Workspace"}
        </span>
        <span className="badge badge-primary" style={{ fontSize: 10, padding: "2px 6px" }}>{PLANS[ws.plan]?.name || "Starter"}</span>
        {multi && <span aria-hidden="true" style={{ fontSize: 10, color: "var(--text-muted)" }}>▾</span>}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Business workspaces"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 240, zIndex: 50, padding: 6,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          {ws.workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="option"
              aria-selected={w.id === ws.workspaceId}
              onClick={() => { setOpen(false); if (w.id !== ws.workspaceId) ws.switchWorkspace(w.id); }}
              style={{
                display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8, margin: 0, textAlign: "left",
                padding: "8px 10px", borderRadius: 8, border: "none", background: w.id === ws.workspaceId ? "var(--surface-hover)" : "transparent",
                color: "var(--ink)", fontSize: 13, fontWeight: w.id === ws.workspaceId ? 600 : 400, cursor: "pointer",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
              {w.id === ws.workspaceId && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }} />
          {canAdd ? (
            <button
              type="button"
              onClick={() => { setOpen(false); setCreating(true); }}
              style={{ display: "block", width: "100%", margin: 0, textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "var(--accent-fill)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              + New business workspace
            </button>
          ) : (
            <p className="muted" style={{ fontSize: 12, margin: "4px 10px 6px" }}>
              {ws.isReadOnly
                ? "Subscribe to add a workspace."
                : ws.maxWorkspaces > 1
                  ? `Your plan includes ${ws.maxWorkspaces} business workspaces.`
                  : "Growth includes 3 business workspaces."}
            </p>
          )}
        </div>
      )}

      {creating && (
        <div role="dialog" aria-modal="true" aria-label="New business workspace" style={{ position: "fixed", inset: 0, zIndex: 100, overflow: "auto", background: "var(--bg, var(--surface))" }}>
          <OnboardingPage
            onCancel={() => setCreating(false)}
            onDone={(id) => { setCreating(false); ws.refreshWorkspaces(id); }}
          />
        </div>
      )}
    </div>
  );
}
