import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";

interface AccountPreferencesPanelProps {
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

export function AccountPreferencesPanel({ onOpenBilling }: AccountPreferencesPanelProps) {
  const { user } = useAuth();
  const ws = useWorkspace();

  const [workspaceName, setWorkspaceName] = useState(ws.workspaceName || "");
  const [objective, setObjective] = useState(ws.objective || "profitability");
  const [currency, setCurrency] = useState(ws.currency || "USD");
  const [convertCurrencies, setConvertCurrencies] = useState(ws.convertCurrencies !== false);
  const [timezone, setTimezone] = useState(ws.timezone || "America/New_York");
  const [country, setCountry] = useState(ws.country || "US");
  const [defaultViewMode, setDefaultViewMode] = useState<"beginner" | "advanced">("beginner");
  const [weeklyEmail, setWeeklyEmail] = useState(true);
  const [reviewAlerts, setReviewAlerts] = useState(true);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    setWorkspaceName(ws.workspaceName || "");
    setObjective(ws.objective || "profitability");
    setCurrency(ws.currency || "USD");
    setTimezone(ws.timezone || "America/New_York");
    setCountry(ws.country || "US");
  }, [ws]);

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
        convertCurrencies,
        timezone,
        country: country.toUpperCase(),
        notificationPrefs: {
          weeklyEmail,
          reviewAlerts,
        },
        defaultViewMode,
      });

      setMessage({ text: "Account details and preferences saved successfully.", type: "success" });
      setTimeout(() => setMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update preferences.";
      setMessage({ text: msg, type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const currentPlan = PLANS[ws.plan] || PLANS.starter;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* Page Header */}
      <div
        className="card"
        style={{
          padding: "24px 28px",
          marginBottom: 20,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: "1.65rem" }}>Account & Preferences</h1>
          <span className="badge badge-primary">Workspace Profile</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Manage your business profile, decision engine objectives, default currency, location, and presentation mode.
        </p>
      </div>

      {/* Plan / Subscription overview badge */}
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>
            Active Subscription
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>{currentPlan.name} Plan</span>
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
            onClick={onOpenBilling}
            style={{ margin: 0, fontSize: 13 }}
          >
            Manage Subscription & Plans
          </button>
        )}
      </div>

      {/* Main Settings Form Card */}
      <div className="card" style={{ padding: "24px 28px" }}>
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Identity info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
                Email Address
              </label>
              <input
                type="text"
                value={user?.email || ""}
                disabled
                style={{ opacity: 0.7, background: "var(--surface-subtle)", cursor: "not-allowed", fontSize: 13, width: "100%" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
                Business / Workspace Name
              </label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="e.g. Acme Studio"
                required
                style={{ fontSize: 13, width: "100%" }}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
                Default Reporting Currency
              </label>
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
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={convertCurrencies} onChange={(e) => setConvertCurrencies(e.target.checked)} />
                <span>
                  Convert records in other currencies into {currency} using European Central Bank daily reference rates.
                  Converted figures are labelled with the rate date. If this is off, records in other currencies are left out of calculations.
                </span>
              </label>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
                Country Code
              </label>
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
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
              Business Timezone
            </label>
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
            <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
              Used to calculate daily rollups and weekly recommendation reset timing.
            </span>
          </div>

          {/* Default Decision Presentation View */}
          <div style={{ background: "var(--surface-subtle)", padding: 20, borderRadius: 14, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink)", marginBottom: 12 }}>
              Default Recommendation Presentation Mode
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                onClick={() => setDefaultViewMode("beginner")}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "16px 18px",
                  borderRadius: 12,
                  background: defaultViewMode === "beginner" ? "var(--surface-hover)" : "var(--surface)",
                  border: defaultViewMode === "beginner" ? "2px solid var(--accent-fill)" : "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: defaultViewMode === "beginner" ? "0 0 0 1px var(--accent-fill)" : "none",
                }}
              >
                <input
                  type="radio"
                  name="viewModePanel"
                  value="beginner"
                  checked={defaultViewMode === "beginner"}
                  onChange={() => setDefaultViewMode("beginner")}
                  style={{
                    width: 18,
                    height: 18,
                    minWidth: 18,
                    marginTop: 2,
                    cursor: "pointer",
                    accentColor: "var(--accent-fill)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink)", marginBottom: 3 }}>
                    Beginner View
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
                    Plain language, clear single action, key unknowns, and safeguards.
                  </div>
                </div>
              </div>

              <div
                onClick={() => setDefaultViewMode("advanced")}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "16px 18px",
                  borderRadius: 12,
                  background: defaultViewMode === "advanced" ? "var(--surface-hover)" : "var(--surface)",
                  border: defaultViewMode === "advanced" ? "2px solid var(--accent-fill)" : "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: defaultViewMode === "advanced" ? "0 0 0 1px var(--accent-fill)" : "none",
                }}
              >
                <input
                  type="radio"
                  name="viewModePanel"
                  value="advanced"
                  checked={defaultViewMode === "advanced"}
                  onChange={() => setDefaultViewMode("advanced")}
                  style={{
                    width: 18,
                    height: 18,
                    minWidth: 18,
                    marginTop: 2,
                    cursor: "pointer",
                    accentColor: "var(--accent-fill)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink)", marginBottom: 3 }}>
                    Advanced Telemetry
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
                    Formula breakdowns, exact sample counts, attribution breakdown, gate conditions, and deterministic trace.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Notification Preferences */}
          <div style={{ background: "var(--surface-subtle)", padding: 20, borderRadius: 14, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--ink)", marginBottom: 12 }}>
              Notification Preferences
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: 0,
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={weeklyEmail}
                  onChange={(e) => setWeeklyEmail(e.target.checked)}
                  style={{
                    width: 18,
                    height: 18,
                    minWidth: 18,
                    cursor: "pointer",
                    accentColor: "var(--accent-fill)",
                    flexShrink: 0,
                  }}
                />
                <span>Receive Weekly Summary & Performance Digest (Growth & Custom plans)</span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: 0,
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={reviewAlerts}
                  onChange={(e) => setReviewAlerts(e.target.checked)}
                  style={{
                    width: 18,
                    height: 18,
                    minWidth: 18,
                    cursor: "pointer",
                    accentColor: "var(--accent-fill)",
                    flexShrink: 0,
                  }}
                />
                <span>Receive Decision Review Readiness Alerts (when new evidence validates next step)</span>
              </label>
            </div>
          </div>

          {message && (
            <div
              style={{
                padding: "12px 16px",
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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 10 }}>
            <button type="submit" disabled={saving} style={{ padding: "10px 24px", fontSize: 14 }}>
              {saving ? "Saving Changes…" : "Save Preferences"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
