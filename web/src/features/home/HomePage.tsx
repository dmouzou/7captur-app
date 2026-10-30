import { useState, useEffect, type ReactNode } from "react";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { RecordsPanel } from "../records/RecordsPanel";
import { ImportPanel } from "../imports/ImportPanel";
import { ScreenshotPanel } from "../imports/ScreenshotPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { ReportsPanel } from "../reports/ReportsPanel";
import { BillingPanel } from "../billing/BillingPanel";
import { NotificationsPanel, useUnreadCount } from "../notifications/NotificationsPanel";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
import { RecommendationsPanel } from "../recommendations/RecommendationsPanel";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useAuth } from "../auth/AuthProvider";
import { PLANS } from "../../shared/plans";
import { Logo } from "../../components/Logo";
import { ThemeToggle } from "../../components/ThemeContext";

function useCollectionCount(coll: string) {
  const ws = useWorkspace();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!ws.workspaceId || !ws.businessId) return;
    return onSnapshot(
      query(collection(db, `workspaces/${ws.workspaceId}/${coll}`), where("businessId", "==", ws.businessId)),
      (s) => setCount(s.size),
      () => setCount(0)
    );
  }, [ws.workspaceId, ws.businessId, coll]);
  return count;
}

type Tab =
  | "overview"
  | "recommendations"
  | "reports"
  | "posts"
  | "promotions"
  | "leads"
  | "sales"
  | "costs"
  | "connections"
  | "import"
  | "screenshot"
  | "notifications"
  | "billing"
  | "settings";

interface NavGroup {
  title: string;
  items: {
    id: Tab;
    name: string;
    icon: ReactNode;
    badge?: string | number | null;
  }[];
}

export function HomePage() {
  const ws = useWorkspace();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("shopify") || params.has("googleads")) return "connections";
    return "overview";
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const unread = useUnreadCount();
  const leadsCount = useCollectionCount("leads");
  const salesCount = useCollectionCount("sales");
  const costsCount = useCollectionCount("costs");
  const postsCount = useCollectionCount("posts");

  const navGroups: NavGroup[] = [
    {
      title: "Executive Intelligence",
      items: [
        {
          id: "overview",
          name: "Dashboard",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
          ),
        },
        {
          id: "recommendations",
          name: "Recommendations",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          ),
        },
        {
          id: "reports",
          name: "Weekly Summary",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          ),
        },
      ],
    },
    {
      title: "Commercial Records",
      items: [
        {
          id: "leads",
          name: "Enquiries & Leads",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          ),
        },
        {
          id: "sales",
          name: "Sales & Revenue",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          ),
        },
        {
          id: "costs",
          name: "Costs & Spend",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          ),
        },
        {
          id: "posts",
          name: "Marketing Posts",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          ),
        },
        {
          id: "promotions",
          name: "Promotions & Ads",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          ),
        },
      ],
    },
    {
      title: "Data Pipeline",
      items: [
        {
          id: "import",
          name: "Import CSV Data",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          ),
        },
        {
          id: "screenshot",
          name: "AI Screenshot OCR",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          ),
        },
        {
          id: "connections",
          name: "Connected Integrations",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          ),
        },
      ],
    },
    {
      title: "Workspace & Team",
      items: [
        {
          id: "notifications",
          name: "Notifications",
          badge: unread || null,
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          ),
        },
        {
          id: "billing",
          name: "Subscription & Plans",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          ),
        },
        {
          id: "settings",
          name: "Settings",
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          ),
        },
      ],
    },
  ];

  return (
    <div className="app-shell">
      {/* Top Navigation Bar (Image 5 style) */}
      <header className="app-topbar">
        {/* Left: Hamburger + Brand + Workspace Pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Mobile hamburger menu toggle */}
          <button
            type="button"
            className="btn-secondary mobile-menu-btn"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            style={{ width: 38, height: 38, padding: 0, borderRadius: 10, margin: 0 }}
          >
            {mobileNavOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
          <Logo size={32} />
          <div
            className="topbar-ws-pill"
            style={{
              height: 24,
              width: 1,
              background: "var(--border)",
              display: "inline-block",
            }}
          />
          <div className="topbar-ws-pill" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              Workspace
            </span>
            <span className="badge badge-primary">
              {PLANS[ws.plan]?.name || "Free"} Plan
            </span>
          </div>
        </div>

        {/* Center: Global Search Bar */}
        <div className="topbar-search" style={{ flex: 1, maxWidth: 460, display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", width: "100%" }}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search records, recommendations, metrics... (⌘K)"
              style={{
                paddingLeft: 36,
                paddingRight: 14,
                paddingTop: 8,
                paddingBottom: 8,
                fontSize: 13,
                borderRadius: 20,
                background: "var(--surface-subtle)",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setTab("recommendations");
                }
              }}
            />
          </div>
        </div>

        {/* Right Tools: Light/Dark Toggle, Notifications, Profile */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ThemeToggle />

          {/* Quick Notification Bell Button */}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setTab("notifications")}
            style={{
              position: "relative",
              width: 38,
              height: 38,
              padding: 0,
              borderRadius: 10,
              margin: 0,
            }}
            title="Notifications"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {Boolean(unread) && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--danger)",
                }}
              />
            )}
          </button>

          {/* User Profile Pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "4px 10px 4px 6px",
              background: "var(--surface-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 20,
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "var(--accent-fill)",
                color: "var(--on-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
            <span
              className="topbar-user-email"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text)",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user?.email || "User"}
            </span>
            <button
              type="button"
              className="link"
              onClick={() => setConfirmSignOut(true)}
              style={{ fontSize: 12, marginLeft: 2 }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Body with Sidebar + Content Area */}
      <div className="app-body">
        {/* Backdrop for mobile drawer */}
        {mobileNavOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Modern Sidebar (Image 5 style) */}
        <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
          {navGroups.map((group, gi) => (
            <div key={gi}>
              <div className="nav-group-title">{group.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {group.items.map((item) => {
                  const isActive = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`nav-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        setTab(item.id);
                        setMobileNavOpen(false);
                      }}
                    >
                      <span className="nav-item-icon">{item.icon}</span>
                      <span style={{ flex: 1 }}>{item.name}</span>
                      {item.badge ? (
                        <span className="badge badge-primary" style={{ padding: "1px 6px", fontSize: 11 }}>
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sidebar Footer info */}
          <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
              Timezone: <span className="mono">{ws.timezone}</span>
              <br />
              Currency: <span className="mono">{ws.currency}</span>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="app-content">
          {/* Critical Workspace Alerts */}
          {ws.billingStatus === "past_due" && tab !== "billing" && (
            <div
              className="card"
              style={{
                background: "var(--danger-bg)",
                borderColor: "rgba(239, 68, 68, 0.3)",
                color: "var(--danger)",
                padding: "16px 20px",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              role="alert"
            >
              <span>Your last payment failed. Update your payment method to keep your plan active.</span>
              <button type="button" onClick={() => setTab("billing")} style={{ margin: 0, padding: "6px 14px", fontSize: 13 }}>
                Update Billing
              </button>
            </div>
          )}

          {ws.deletionScheduledMs && tab !== "settings" && (
            <div
              className="card"
              style={{
                background: "var(--danger-bg)",
                borderColor: "rgba(239, 68, 68, 0.3)",
                color: "var(--danger)",
                padding: "16px 20px",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              role="alert"
            >
              <span>This workspace is scheduled for permanent deletion on {new Date(ws.deletionScheduledMs).toLocaleDateString()}.</span>
              <button type="button" onClick={() => setTab("settings")} style={{ margin: 0, padding: "6px 14px", fontSize: 13 }}>
                Cancel Deletion
              </button>
            </div>
          )}

          {/* Overview Dashboard Tab (Image 5 Inspiration) */}
          {tab === "overview" && (
            <div>
              {/* Executive Welcome Banner */}
              <div
                className="card"
                style={{
                  padding: "32px 36px",
                  marginBottom: 28,
                  background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)",
                  border: "1px solid var(--border)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "relative", zIndex: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span className="badge badge-success">Workspace Active</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                    </span>
                  </div>
                  <h1 style={{ fontSize: "1.9rem", marginBottom: 8 }}>
                    Welcome, {user?.displayName || user?.email?.split("@")[0] || "Partner"}
                  </h1>
                  <p className="muted" style={{ maxWidth: 650, fontSize: 15, margin: 0 }}>
                    Here is your marketing intelligence overview. Track commercials, analyze campaign impact, and decide your next high-ROI moves.
                  </p>
                </div>
              </div>

              {/* 4 Core Commercial Metric Cards */}
              <div className="dashboard-metrics-grid">
                <div
                  className="card"
                  style={{
                    padding: "20px 22px",
                    cursor: "pointer",
                    transition: "transform 0.15s, border-color 0.15s",
                  }}
                  onClick={() => setTab("leads")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Enquiries & Leads</span>
                    <span style={{ fontSize: 18 }}>👥</span>
                  </div>
                  <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)", lineHeight: 1.1, marginBottom: 8 }}>
                    {leadsCount ?? 0}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                    View enquiries →
                  </span>
                </div>

                <div
                  className="card"
                  style={{
                    padding: "20px 22px",
                    cursor: "pointer",
                    transition: "transform 0.15s, border-color 0.15s",
                  }}
                  onClick={() => setTab("sales")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Sales & Orders</span>
                    <span style={{ fontSize: 18 }}>💰</span>
                  </div>
                  <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)", lineHeight: 1.1, marginBottom: 8 }}>
                    {salesCount ?? 0}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                    View sales logs →
                  </span>
                </div>

                <div
                  className="card"
                  style={{
                    padding: "20px 22px",
                    cursor: "pointer",
                    transition: "transform 0.15s, border-color 0.15s",
                  }}
                  onClick={() => setTab("costs")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Ad Spend & Costs</span>
                    <span style={{ fontSize: 18 }}>💳</span>
                  </div>
                  <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)", lineHeight: 1.1, marginBottom: 8 }}>
                    {costsCount ?? 0}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                    View cost records →
                  </span>
                </div>

                <div
                  className="card"
                  style={{
                    padding: "20px 22px",
                    cursor: "pointer",
                    transition: "transform 0.15s, border-color 0.15s",
                  }}
                  onClick={() => setTab("posts")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Marketing Posts</span>
                    <span style={{ fontSize: 18 }}>📢</span>
                  </div>
                  <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)", lineHeight: 1.1, marginBottom: 8 }}>
                    {postsCount ?? 0}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                    View content posts →
                  </span>
                </div>
              </div>

              {/* 3 Executive Action Cards (matching Image 5 top row) */}
              <div className="dashboard-actions-grid">
                {/* Card 1: Next Move */}
                <div
                  className="card"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                  onClick={() => setTab("recommendations")}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          background: "var(--primary-subtle)",
                          color: "var(--primary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </div>
                      <span className="badge badge-primary">Intelligence</span>
                    </div>
                    <h3 style={{ fontSize: 16, marginBottom: 6 }}>Predict Next Best Moves</h3>
                    <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                      Preview AI recommendations tuned to your {ws.objective?.replace(/_/g, " ") || "business"} goal.
                    </p>
                  </div>
                  <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>View Recommendations →</span>
                  </div>
                </div>

                {/* Card 2: Ingest Fresh Data */}
                <div
                  className="card"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                  onClick={() => setTab("import")}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          background: "var(--lime-subtle)",
                          color: "var(--lime)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      </div>
                      <span className="badge badge-success">Pipeline</span>
                    </div>
                    <h3 style={{ fontSize: 16, marginBottom: 6 }}>Sync Sales & Ad Data</h3>
                    <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                      Upload CSV exports or take screenshots of ad dashboards to extract metrics automatically.
                    </p>
                  </div>
                  <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--lime)" }}>Import CSV Data →</span>
                  </div>
                </div>

                {/* Card 3: Weekly Automated Health */}
                <div
                  className="card"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                  onClick={() => setTab("reports")}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          background: "var(--gold-subtle)",
                          color: "var(--gold)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </div>
                      <span className="badge badge-warning">Every Monday</span>
                    </div>
                    <h3 style={{ fontSize: 16, marginBottom: 6 }}>Weekly Health Digest</h3>
                    <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                      Scheduled delivery at 8:00 AM ({ws.timezone}). Summarizes performance and missing telemetry.
                    </p>
                  </div>
                  <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gold)" }}>Configure Digest →</span>
                  </div>
                </div>
              </div>

              {/* Quick Jump Panels */}
              <div className="card" style={{ padding: "26px 28px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Commercial Record Hub</h3>
                  <span className="muted" style={{ fontSize: 12.5 }}>Direct data management</span>
                </div>
                <div className="dashboard-hub-grid">
                  <button type="button" className="btn-secondary dashboard-hub-btn" onClick={() => setTab("leads")}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>👥</span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Record Leads</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>WhatsApp & DM enquiries</div>
                    </div>
                  </button>
                  <button type="button" className="btn-secondary dashboard-hub-btn" onClick={() => setTab("sales")}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>💰</span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Record Sales</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>Track orders & gross revenue</div>
                    </div>
                  </button>
                  <button type="button" className="btn-secondary dashboard-hub-btn" onClick={() => setTab("costs")}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>💳</span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Record Ad Spend</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>Daily campaign expenditures</div>
                    </div>
                  </button>
                  <button type="button" className="btn-secondary dashboard-hub-btn" onClick={() => setTab("posts")}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>📢</span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Record Posts</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>Social media creatives & hooks</div>
                    </div>
                  </button>
                  <button type="button" className="btn-secondary dashboard-hub-btn" onClick={() => setTab("connections")}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>🔌</span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Integrations</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>Connect Shopify & Google Ads</div>
                    </div>
                  </button>
                  <button type="button" className="btn-secondary dashboard-hub-btn" onClick={() => setTab("screenshot")}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>📸</span>
                    <div style={{ textAlign: "left", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>Screenshot OCR</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>Auto-extract ads & metrics</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Section Panels */}
          {tab === "recommendations" && <RecommendationsPanel />}
          {tab === "reports" && <ReportsPanel />}
          {tab === "leads" && <RecordsPanel coll="leads" />}
          {tab === "sales" && <RecordsPanel coll="sales" />}
          {tab === "costs" && <RecordsPanel coll="costs" />}
          {tab === "posts" && <RecordsPanel coll="posts" />}
          {tab === "promotions" && <RecordsPanel coll="promotions" />}
          {tab === "connections" && <ConnectionsPanel />}
          {tab === "import" && <ImportPanel />}
          {tab === "screenshot" && <ScreenshotPanel />}
          {tab === "notifications" && <NotificationsPanel />}
          {tab === "billing" && <BillingPanel />}
          {tab === "settings" && <SettingsPanel />}
        </main>
      </div>

      {/* Sign Out Confirmation Modal */}
      {confirmSignOut && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-dialog-title"
          onClick={() => setConfirmSignOut(false)}
        >
          <div
            className="modal-box"
            onClick={(e) => e.stopPropagation()}
            style={{ textAlign: "center" }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "rgba(226, 104, 95, 0.12)",
                color: "var(--red, #e2685f)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            <h3 id="signout-dialog-title" style={{ fontSize: 18, marginBottom: 8, color: "var(--ink)" }}>
              Sign out of 7Captur?
            </h3>
            <p className="muted" style={{ fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              Are you sure you want to log out? You will need to sign back in with your credentials to access your workspace.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmSignOut(false)}
                style={{ flex: 1, margin: 0, padding: "10px 18px", borderRadius: 10, fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmSignOut(false);
                  signOut(auth);
                }}
                style={{
                  flex: 1,
                  margin: 0,
                  padding: "10px 18px",
                  borderRadius: 10,
                  fontSize: 14,
                  background: "var(--red, #e2685f)",
                  borderColor: "var(--red, #e2685f)",
                  color: "#fff",
                }}
              >
                Yes, Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
