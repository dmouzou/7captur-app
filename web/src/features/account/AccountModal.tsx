import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBilling?: () => void;
}

const OBJECTIVE_OPTIONS = [
  { value: "profitability", label: "Profitability & Contribution", desc: "Prioritizes margin after COGS, ad spend, and variable delivery costs." },
  { value: "revenue_growth", label: "Incremental Revenue Growth", desc: "Prioritizes incremental sales volume while maintaining break-even safety." },
  { value: "efficiency", label: "Advertising Efficiency (ROAS)", desc: "Maximizes attributed ROAS and reduces wasted ad spend." },
  { value: "qualified_enquiries", label: "Qualified Enquiries & Leads", desc: "Maximizes qualified buyer enquiries and consultation bookings." },
  { value: "content_testing", label: "Content Reach & Engagement", desc: "Discovers top-performing creative hooks and organic reach." },
  { value: "custom", label: "Custom Business Objective", desc: "Tailored to your specific sales and conversion funnel." },
];

const CURRENCY_OPTIONS = [
  { code: "USD", symbol: "$", label: "USD - United States Dollar" },
  { code: "EUR", symbol: "€", label: "EUR - Euro" },
  { code: "GBP", symbol: "£", label: "GBP - British Pound" },
  { code: "CAD", symbol: "$", label: "CAD - Canadian Dollar" },
  { code: "AUD", symbol: "$", label: "AUD - Australian Dollar" },
  { code: "JPY", symbol: "¥", label: "JPY - Japanese Yen" },
  { code: "CHF", symbol: "Fr", label: "CHF - Swiss Franc" },
];

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function AccountModal({ isOpen, onClose, onOpenBilling }: AccountModalProps) {
  const { user } = useAuth();
  const ws = useWorkspace();

  const [workspaceName, setWorkspaceName] = useState(ws.workspaceName || "");
  const [objective, setObjective] = useState(ws.objective || "profitability");
  const [currency, setCurrency] = useState(ws.currency || "USD");
  const [timezone, setTimezone] = useState(ws.timezone || "America/New_York");
  const [country, setCountry] = useState(ws.country || "US");
  const [defaultViewMode, setDefaultViewMode] = useState<"beginner" | "advanced">("beginner");
  const [weeklyEmail, setWeeklyEmail] = useState(true);
  const [reviewAlerts, setReviewAlerts] = useState(true);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWorkspaceName(ws.workspaceName || "");
      setObjective(ws.objective || "profitability");
      setCurrency(ws.currency || "USD");
      setTimezone(ws.timezone || "America/New_York");
      setCountry(ws.country || "US");
      setMessage(null);
    }
  }, [isOpen, ws]);

  if (!isOpen) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const updateFn = httpsCallable<unknown, { ok: boolean }>(functions, "updateWorkspaceDetails");
      await updateFn({
        workspaceId: ws.workspaceId,
        businessId: ws.businessId,
        workspaceName: workspaceName.trim() || undefined,
        objective,
        currency,
        timezone,
        country: country.toUpperCase(),
        notificationPrefs: {
          weeklyEmail,
          reviewAlerts,
        },
        defaultViewMode,
      });

      setMessage({ text: "Account details and preferences saved successfully.", type: "success" });
      setTimeout(() => {
        setMessage(null);
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update preferences.";
      setMessage({ text: msg, type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const currentPlan = PLANS[ws.plan] || PLANS.starter;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 640,
          width: "92%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          borderRadius: 16,
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: "var(--ink)", fontWeight: 700 }}>
              Account & Preferences
            </h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Manage your business profile, goals, currency, location, and decision view settings.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            aria-label="Close"
            style={{ width: 32, height: 32, padding: 0, borderRadius: "50%", minWidth: 32 }}
          >
            ✕
          </button>
        </div>

        {/* Plan / Subscription overview badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--surface-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>
              Active Subscription
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{currentPlan.name} Plan</span>
              <span className="badge badge-primary" style={{ textTransform: "capitalize" }}>
                {ws.billingStatus || "Active"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {currentPlan.recommendations.weekly} recommendations/week · {currentPlan.maxConnections} platform connections
            </div>
          </div>
          {onOpenBilling && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onClose();
                onOpenBilling();
              }}
              style={{ margin: 0, fontSize: 13 }}
            >
              Manage Plan
            </button>
          )}
        </div>

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Identity info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Email Address</label>
              <input
                type="text"
                value={user?.email || ""}
                disabled
                style={{ opacity: 0.7, background: "var(--surface-subtle)", cursor: "not-allowed", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Business / Workspace Name</label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="e.g. Acme Studio"
                required
                style={{ fontSize: 13 }}
              />
            </div>
          </div>

          {/* Business Goal / Objective (Decision Engine V3) */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6, display: "block" }}>
              Primary Business Objective (Decision Engine Goal)
            </label>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
              The decision engine optimizes recommendations strictly around this chosen primary objective.
            </p>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              style={{ width: "100%", fontSize: 14, padding: "8px 12px" }}
            >
              {OBJECTIVE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, fontStyle: "italic" }}>
              {OBJECTIVE_OPTIONS.find((o) => o.value === objective)?.desc}
            </div>
          </div>

          {/* Currency and Location */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Default Reporting Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                style={{ width: "100%", fontSize: 13, padding: "8px 10px" }}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.symbol})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Country Code</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                style={{ width: "100%", fontSize: 13, padding: "8px 10px" }}
              >
                <option value="US">United States (US)</option>
                <option value="CA">Canada (CA)</option>
                <option value="GB">United Kingdom (GB)</option>
                <option value="AU">Australia (AU)</option>
                <option value="DE">Germany (DE)</option>
                <option value="FR">France (FR)</option>
                <option value="IT">Italy (IT)</option>
                <option value="ES">Spain (ES)</option>
                <option value="NL">Netherlands (NL)</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Business Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{ width: "100%", fontSize: 13, padding: "8px 10px" }}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 11, marginTop: 2, display: "block" }}>
              Used to calculate daily rollups and weekly recommendation reset timing.
            </span>
          </div>

          {/* Default Decision Presentation View (Spec V3 7.0) */}
          <div style={{ background: "var(--surface-subtle)", padding: 14, borderRadius: 12, border: "1px solid var(--border)" }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 10 }}>
              Default Recommendation Presentation Mode (Spec V3)
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: defaultViewMode === "beginner" ? "var(--surface)" : "transparent",
                  border: `1.5px solid ${defaultViewMode === "beginner" ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  name="viewModeModal"
                  value="beginner"
                  checked={defaultViewMode === "beginner"}
                  onChange={() => setDefaultViewMode("beginner")}
                  style={{ marginTop: 2, cursor: "pointer" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    Beginner View
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>
                    Plain language, clear single action, key unknowns, and safeguards.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: defaultViewMode === "advanced" ? "var(--surface)" : "transparent",
                  border: `1.5px solid ${defaultViewMode === "advanced" ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  name="viewModeModal"
                  value="advanced"
                  checked={defaultViewMode === "advanced"}
                  onChange={() => setDefaultViewMode("advanced")}
                  style={{ marginTop: 2, cursor: "pointer" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    Advanced Telemetry
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>
                    Formula breakdowns, exact sample counts, attribution breakdown, gate conditions, and deterministic trace.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Notification Preferences */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 8 }}>
              Notification Preferences
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={weeklyEmail}
                  onChange={(e) => setWeeklyEmail(e.target.checked)}
                />
                Receive Weekly Summary & Performance Digest (Growth & Custom plans)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={reviewAlerts}
                  onChange={(e) => setReviewAlerts(e.target.checked)}
                />
                Receive Decision Review Readiness Alerts (when new evidence validates next step)
              </label>
            </div>
          </div>

          {message && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                background: message.type === "success" ? "rgba(143, 206, 58, 0.15)" : "rgba(226, 104, 95, 0.15)",
                color: message.type === "success" ? "var(--accent)" : "var(--danger)",
                border: `1px solid ${message.type === "success" ? "var(--accent)" : "var(--danger)"}`,
              }}
            >
              {message.text}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving Changes…" : "Save Preferences"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
