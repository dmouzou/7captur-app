import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { createWorkspaceInput } from "../../shared/schemas";
import { Logo } from "../../components/Logo";
import { ThemeToggle } from "../../components/ThemeContext";
import { COUNTRIES, CURRENCIES, TIMEZONES } from "./countriesAndTimezones";

interface OnboardingProps {
  onDone: () => void;
}

// Visual definitions for Business Types (Canva-style cases, Image 3)
const BUSINESS_TYPE_OPTIONS = [
  {
    id: "product_seller",
    title: "Product seller",
    desc: "You sell physical goods via eCommerce, DTC storefront, or brand retail.",
    icon: "📦",
  },
  {
    id: "reseller",
    title: "Reseller / Retailer",
    desc: "You stock, curate, and distribute items from multiple manufacturers or brands.",
    icon: "🔄",
  },
  {
    id: "service_provider",
    title: "Service provider",
    desc: "Agencies, consultants, design firms, freelancers, and professional practices.",
    icon: "💼",
  },
  {
    id: "restaurant_local",
    title: "Restaurant & Local",
    desc: "Hospitality venues, cafes, retail storefronts, salons, and local locations.",
    icon: "🍽️",
  },
  {
    id: "creator_individual",
    title: "Creator & Media",
    desc: "Creators, educators, digital product sellers, podcasts, and communities.",
    icon: "🎨",
  },
  {
    id: "other",
    title: "Other business model",
    desc: "Hybrid commerce, custom operations, or specialized business structures.",
    icon: "⚡",
  },
] as const;

// Visual definitions for Objectives (Image 2 ChatGPT & Image 3 Canva style cases)
const OBJECTIVE_OPTIONS = [
  {
    id: "profitability",
    title: "Profitability & Margin",
    desc: "Maximize blended ROAS and bottom-line margin on every dollar spent.",
    icon: "📈",
  },
  {
    id: "qualified_enquiries",
    title: "Qualified Enquiries",
    desc: "Attract high-intent sales leads, inbound consultations, and quotes.",
    icon: "🎯",
  },
  {
    id: "orders",
    title: "Order Volume",
    desc: "Accelerate transaction velocity and total purchase volume.",
    icon: "🛍️",
  },
  {
    id: "reduced_waste",
    title: "Cut Wasted Ad Spend",
    desc: "Uncover unprofitable channels, fatigue, and ad spend leakages.",
    icon: "✂️",
  },
  {
    id: "content_testing",
    title: "Content & Ad Testing",
    desc: "Identify winning creative angles, copy hooks, and content formats.",
    icon: "🧪",
  },
  {
    id: "awareness",
    title: "Brand Awareness",
    desc: "Expand audience reach, impressions, mindshare, and brand lift.",
    icon: "📢",
  },
] as const;

// Visual definitions for Buying Methods
const BUYING_METHOD_OPTIONS = [
  {
    id: "website",
    title: "Website / Online Store",
    desc: "Direct checkout on your website, Shopify store, or custom platform.",
    icon: "🌐",
  },
  {
    id: "dm_whatsapp",
    title: "DM / WhatsApp / Chat",
    desc: "Sales finalized through messaging, WhatsApp, Instagram DMs, or chat.",
    icon: "💬",
  },
  {
    id: "phone",
    title: "Phone Call / Sales Rep",
    desc: "Consultative conversations, inbound SDR, or direct calls.",
    icon: "📞",
  },
  {
    id: "booking",
    title: "Booking / Appointment",
    desc: "Scheduled appointments, Calendly bookings, or consultation slots.",
    icon: "📅",
  },
  {
    id: "marketplace",
    title: "Marketplace",
    desc: "Third-party platforms: Amazon, Etsy, eBay, Faire, or App Store.",
    icon: "🛒",
  },
  {
    id: "in_person",
    title: "In-Person Storefront",
    desc: "Physical register, point of sale, counter, or face-to-face service.",
    icon: "🏬",
  },
  {
    id: "other",
    title: "Other / Multi-channel",
    desc: "Bespoke checkout flow or a blend of multiple channels.",
    icon: "🔌",
  },
] as const;

export function OnboardingPage({ onDone }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const totalSteps = 6;

  // Form state
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<string>("product_seller");
  const [objectives, setObjectives] = useState<string[]>(["profitability"]);
  const [buyingMethods, setBuyingMethods] = useState<string[]>(["website"]);
  
  // Region & settings state
  const detectedTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";
  const [country, setCountry] = useState("US");
  const [timezone, setTimezone] = useState(detectedTz || "America/New_York");
  const [currency, setCurrency] = useState("USD");
  const [tzUserEdited, setTzUserEdited] = useState(false);
  
  // Optional contact state
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Country change helper to also pick currency and auto-adjust timezone unless manually edited
  function handleCountrySelect(cCode: string) {
    setCountry(cCode);
    const found = COUNTRIES.find((c) => c.code === cCode);
    if (found) {
      setCurrency(found.currency);
      if (!tzUserEdited && found.defaultTimezone) {
        setTimezone(found.defaultTimezone);
      }
    }
  }

  function toggleObjective(id: string) {
    if (objectives.includes(id)) {
      setObjectives(objectives.filter((o) => o !== id));
    } else {
      if (objectives.length < 3) {
        setObjectives([...objectives, id]);
      }
    }
  }

  function toggleBuyingMethod(id: string) {
    if (buyingMethods.includes(id)) {
      setBuyingMethods(buyingMethods.filter((m) => m !== id));
    } else {
      setBuyingMethods([...buyingMethods, id]);
    }
  }

  async function submit() {
    setError("");
    const parsed = createWorkspaceInput.safeParse({
      workspaceName: businessName.trim() || "My Workspace",
      businessName: businessName.trim() || "My Business",
      businessType,
      country: country.trim().toUpperCase(),
      timezone: timezone.trim(),
      currency: currency.trim().toUpperCase(),
      objective: objectives[0] || "profitability",
      objectives: objectives.length > 0 ? objectives : ["profitability"],
      buyingMethods: buyingMethods.length > 0 ? buyingMethods : ["website"],
      requestId,
      contactName: contactName.trim() || null,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your answers.");
      return;
    }

    setBusy(true);
    try {
      await httpsCallable(functions, "createWorkspace")(parsed.data);
      onDone();
    } catch (e: unknown) {
      console.error("Workspace creation failed:", e);
      setError((e as { message?: string })?.message ?? "Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleNext() {
    setError("");
    if (step === 1 && !businessName.trim()) {
      setError("Please enter your business or brand name.");
      return;
    }
    if (step === 3 && objectives.length === 0) {
      setError("Please select at least 1 growth goal (you can pick up to 3).");
      return;
    }
    if (step === 4 && buyingMethods.length === 0) {
      setError("Please select at least 1 sales channel where customers buy from you.");
      return;
    }
    if (step < totalSteps) {
      setStep((s) => s + 1);
    } else {
      submit();
    }
  }

  function handleBack() {
    setError("");
    if (step > 1) setStep((s) => s - 1);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Top Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 32px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <Logo size={34} subtitle="Onboarding Setup" />
        <ThemeToggle />
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, display: "flex", justifyContent: "center", padding: "36px 20px 60px" }}>
        <div style={{ width: "100%", maxWidth: 760 }}>
          {/* Progress Bar & Step Counter */}
          <div className="stepper-header">
            <div>
              <span className="badge badge-primary">
                Step {step} of {totalSteps}
              </span>
            </div>
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
              {step === 1 && "Business Name"}
              {step === 2 && "Business Model"}
              {step === 3 && "Primary Growth Objective"}
              {step === 4 && "Sales Channels"}
              {step === 5 && "Region & Timezone"}
              {step === 6 && "Contacts & Review"}
            </span>
          </div>

          <div className="stepper-progress-track">
            <div
              className="stepper-progress-fill"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>

          {/* Step 1: Business Name */}
          {step === 1 && (
            <div className="card" style={{ padding: "36px 32px" }}>
              <div style={{ marginBottom: 28 }}>
                <h2>What is your business called?</h2>
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                  This name will appear on your automated weekly summaries and recommendations.
                </p>
              </div>

              <div>
                <label htmlFor="businessNameInput" style={{ fontSize: 14 }}>
                  Business or Brand Name
                </label>
                <input
                  id="businessNameInput"
                  autoFocus
                  placeholder="e.g. LintMint, Acme Studio, BlueCoast Apparel"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleNext();
                    }
                  }}
                  style={{
                    padding: "14px 16px",
                    fontSize: 16,
                    borderRadius: 10,
                  }}
                />
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 12 }}>Suggested formats:</span>
                {["LintMint", "Nova Commerce", "Apex Consulting"].map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setBusinessName(ex)}
                    className="badge"
                    style={{ cursor: "pointer", background: "var(--surface-hover)", border: "1px solid var(--border)" }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Business Type (Cases / Cards, Image 3) */}
          {step === 2 && (
            <div className="card" style={{ padding: "36px 32px" }}>
              <div style={{ marginBottom: 20 }}>
                <h2>What best describes your business?</h2>
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                  Select the model that represents how you operate and generate revenue.
                </p>
              </div>

              <div className="case-grid">
                {BUSINESS_TYPE_OPTIONS.map((opt) => {
                  const isSelected = businessType === opt.id;
                  return (
                    <div
                      key={opt.id}
                      className={`case-card ${isSelected ? "selected" : ""}`}
                      onClick={() => setBusinessType(opt.id)}
                    >
                      <div className="case-card-check">
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="case-card-icon">{opt.icon}</div>
                      <div className="case-card-title">{opt.title}</div>
                      <div className="case-card-desc">{opt.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 3: Main Objective (Cases / Cards, up to 3) */}
          {step === 3 && (
            <div className="card" style={{ padding: "36px 32px" }}>
              <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2>What are your growth goals?</h2>
                  <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                    Select up to 3 objectives that matter most to your business.
                  </p>
                </div>
                <span className={`badge ${objectives.length > 0 ? "badge-primary" : ""}`}>
                  Selected: {objectives.length} / 3
                </span>
              </div>

              <div className="case-grid">
                {OBJECTIVE_OPTIONS.map((opt) => {
                  const isSelected = objectives.includes(opt.id);
                  const isMaxReached = objectives.length >= 3 && !isSelected;
                  return (
                    <div
                      key={opt.id}
                      className={`case-card ${isSelected ? "selected" : ""}`}
                      style={{ opacity: isMaxReached ? 0.6 : 1, cursor: isMaxReached ? "not-allowed" : "pointer" }}
                      onClick={() => toggleObjective(opt.id)}
                    >
                      <div className="case-card-check">
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="case-card-icon">{opt.icon}</div>
                      <div className="case-card-title">{opt.title}</div>
                      <div className="case-card-desc">{opt.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 4: Buying Method (Cases / Cards, select all that apply) */}
          {step === 4 && (
            <div className="card" style={{ padding: "36px 32px" }}>
              <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2>How do your customers buy from you?</h2>
                  <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                    Select all channels that apply where customer purchases or bookings take place.
                  </p>
                </div>
                <span className={`badge ${buyingMethods.length > 0 ? "badge-primary" : ""}`}>
                  Selected: {buyingMethods.length} channel{buyingMethods.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="case-grid">
                {BUYING_METHOD_OPTIONS.map((opt) => {
                  const isSelected = buyingMethods.includes(opt.id);
                  return (
                    <div
                      key={opt.id}
                      className={`case-card ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleBuyingMethod(opt.id)}
                    >
                      <div className="case-card-check">
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="case-card-icon">{opt.icon}</div>
                      <div className="case-card-title">{opt.title}</div>
                      <div className="case-card-desc">{opt.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 5: Region, Timezone & Currency (Interactive Selectors) */}
          {step === 5 && (
            <div className="card" style={{ padding: "36px 32px" }}>
              <div style={{ marginBottom: 24 }}>
                <h2>Where are your operations based?</h2>
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                  We use your timezone for scheduling weekly digest emails and your currency for revenue tracking.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
                {/* Country Selector */}
                <div>
                  <label htmlFor="countrySelect">Operating Country</label>
                  <select
                    id="countrySelect"
                    value={country}
                    onChange={(e) => handleCountrySelect(e.target.value)}
                    style={{ padding: "12px 14px", borderRadius: 10, fontSize: 14.5 }}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                    Selected ISO code: <span className="mono">{country}</span>
                  </span>
                </div>

                {/* Currency Selector */}
                <div>
                  <label htmlFor="currencySelect">Operating Currency</label>
                  <select
                    id="currencySelect"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    style={{ padding: "12px 14px", borderRadius: 10, fontSize: 14.5 }}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name} ({c.symbol})
                      </option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                    Figures in sales & costs will default to this currency.
                  </span>
                </div>

                {/* Timezone Selector */}
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label htmlFor="timezoneSelect">Business Timezone</label>
                    <span className="badge" style={{ fontSize: 11 }}>
                      {tzUserEdited ? "Manually set" : "Auto-adjusted for country"}
                    </span>
                  </div>
                  <select
                    id="timezoneSelect"
                    value={timezone}
                    onChange={(e) => {
                      setTimezone(e.target.value);
                      setTzUserEdited(true);
                    }}
                    style={{ padding: "12px 14px", borderRadius: 10, fontSize: 14.5 }}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                    Automated weekly summary arrives every Monday at 8:00 AM in this timezone.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step 6: Contact Information (Optional) & Final Review */}
          {step === 6 && (
            <div className="card" style={{ padding: "36px 32px" }}>
              <div style={{ marginBottom: 24 }}>
                <h2>Add a contact & confirm setup</h2>
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                  Optionally designate a primary point of contact for reports and notifications.
                </p>
              </div>

              {/* Contact Inputs (Optional) */}
              <div
                style={{
                  padding: 20,
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                  marginBottom: 24,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ margin: 0 }}>Primary Contact Information</h4>
                  <span className="badge">Optional</span>
                </div>
                <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 16px" }}>
                  Add your details or a team member to receive direct insights. You can skip this step safely.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  <div>
                    <label htmlFor="contactName" style={{ marginTop: 0 }}>Contact Name</label>
                    <input
                      id="contactName"
                      placeholder="e.g. Alex Smith"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="contactEmail" style={{ marginTop: 0 }}>Contact Email</label>
                    <input
                      id="contactEmail"
                      type="email"
                      placeholder="alex@business.com"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="contactPhone" style={{ marginTop: 0 }}>Phone / WhatsApp (optional)</label>
                    <input
                      id="contactPhone"
                      placeholder="+1 (555) 000-0000"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Summary Badges */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
                <h4 style={{ marginBottom: 12 }}>Workspace Summary</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span className="badge badge-primary">🏢 {businessName || "My Business"}</span>
                  <span className="badge">
                    {BUSINESS_TYPE_OPTIONS.find((b) => b.id === businessType)?.icon}{" "}
                    {BUSINESS_TYPE_OPTIONS.find((b) => b.id === businessType)?.title}
                  </span>
                  {objectives.map((objId) => {
                    const opt = OBJECTIVE_OPTIONS.find((o) => o.id === objId);
                    return (
                      <span key={objId} className="badge">
                        {opt?.icon} {opt?.title}
                      </span>
                    );
                  })}
                  {buyingMethods.map((bmId) => {
                    const opt = BUYING_METHOD_OPTIONS.find((m) => m.id === bmId);
                    return (
                      <span key={bmId} className="badge">
                        {opt?.icon} {opt?.title}
                      </span>
                    );
                  })}
                  <span className="badge">📍 {COUNTRIES.find((c) => c.code === country)?.flag} {country} · {currency}</span>
                  <span className="badge">⏰ {timezone}</span>
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div
              role="alert"
              className="error"
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: "var(--danger-bg)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                marginTop: 18,
              }}
            >
              {error}
            </div>
          )}

          {/* Action Navigation Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 24,
            }}
          >
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={busy}
                className="btn-secondary"
                style={{ borderRadius: 10, padding: "12px 20px" }}
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={busy}
              style={{
                borderRadius: 10,
                padding: "12px 28px",
                fontSize: 15,
                background: "var(--accent-fill)",
                color: "var(--on-accent)",
              }}
            >
              {busy ? "Creating your workspace…" : step === totalSteps ? "Launch 7Captur 🚀" : "Continue →"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
