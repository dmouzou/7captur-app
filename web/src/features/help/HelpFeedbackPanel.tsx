import { useEffect, useState, type FormEvent } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useAuth } from "../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import type { FeedbackType } from "../../shared/schemas";

interface TicketItem {
  id: string;
  type: FeedbackType;
  subject: string;
  message: string;
  status: string;
  recommendationId?: string | null;
  internalNotes?: { by: string; note: string; at: string }[];
  createdAt?: { toMillis?: () => number };
}

export function HelpFeedbackPanel({ initialRecommendationId }: { initialRecommendationId?: string }) {
  const ws = useWorkspace();
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<FeedbackType | "status">(
    initialRecommendationId ? "bad_recommendation" : "support_request"
  );

  const [subject, setSubject] = useState(
    initialRecommendationId ? `Issue with recommendation ${initialRecommendationId.slice(0, 8)}` : ""
  );
  const [recId, setRecId] = useState(initialRecommendationId ?? "");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [issueReason, setIssueReason] = useState("inaccurate_math");

  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [tickets, setTickets] = useState<TicketItem[]>([]);

  useEffect(() => {
    if (!ws.workspaceId) return;
    const q = query(
      collection(db, `workspaces/${ws.workspaceId}/feedback`),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setTickets(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<TicketItem, "id">),
          }))
        );
      },
      () => setTickets([])
    );
  }, [ws.workspaceId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);

    try {
      const fullMessage =
        subTab === "bad_recommendation"
          ? `[Issue Category: ${issueReason.replace(/_/g, " ").toUpperCase()}]\n\n${message}`
          : message;

      await httpsCallable(functions, "submitFeedback")({
        workspaceId: ws.workspaceId,
        type: subTab,
        recommendationId: recId.trim() || undefined,
        subject: subject.trim(),
        message: fullMessage.trim(),
        contactEmail: contactEmail.trim() || undefined,
        meta: {
          issueReason: subTab === "bad_recommendation" ? issueReason : undefined,
          workspaceName: ws.workspaceId,
        },
      });

      setSuccess("Your feedback has been logged. Our operations team reviews every report.");
      setMessage("");
      if (subTab !== "bad_recommendation") setSubject("");
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not send feedback. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  type BrandLogoName = "shopify" | "google" | "meta" | "facebook" | "instagram" | "tiktok" | "woocommerce" | "whatsapp";

  function BrandLogo({ name, size = 22 }: { name: BrandLogoName; size?: number }) {
    switch (name) {
      case "shopify":
        return (
          <span title="Shopify" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Shopify" style={{ verticalAlign: "middle" }}>
              <path d="M19.3 6.6c-.1-.3-.3-.4-.5-.4h-2.1c-.1-.9-.5-1.9-1.2-2.6C14.6 2.7 13.5 2 12.1 2c-1.3 0-2.4.7-3.2 1.6-.7.7-1.1 1.7-1.2 2.6H5.4c-.3 0-.5.2-.6.4L2.1 20.3c-.1.3 0 .7.3.9.2.2.4.3.7.3h15.8c.3 0 .5-.1.7-.3.3-.2.4-.6.3-.9L19.3 6.6z" fill="#95BF47"/>
              <path d="M12.1 3.8c.8 0 1.5.5 1.9 1.1.4.5.6 1.1.7 1.7h-5.2c.1-.6.3-1.2.7-1.7.4-.6 1.1-1.1 1.9-1.1z" fill="#5E8E3E"/>
              <path d="M14.6 11.2c-.2-.1-.5-.2-.9-.3-.5-.1-.8-.2-1.1-.3-.4-.2-.6-.4-.6-.7 0-.3.2-.5.5-.7.4-.2.8-.2 1.4-.2.6 0 1.1.1 1.5.3l.4-1.4c-.5-.2-1.2-.4-2-.4-1.1 0-2 .3-2.6.9-.6.6-.9 1.3-.9 2.1 0 .6.2 1.1.6 1.5.4.4.9.7 1.6.8.5.1.9.2 1.2.4.3.1.5.3.5.6 0 .3-.2.6-.6.8-.4.2-.9.2-1.5.2-.7 0-1.4-.2-2-.5l-.4 1.4c.6.3 1.4.5 2.3.5 1.2 0 2.1-.3 2.7-.9.6-.6.9-1.3.9-2.2 0-.6-.2-1.1-.6-1.5z" fill="#ffffff"/>
            </svg>
          </span>
        );
      case "google":
        return (
          <span title="Google" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Google" style={{ verticalAlign: "middle" }}>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
          </span>
        );
      case "meta":
        return (
          <span title="Meta" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="#0081FB" aria-label="Meta" style={{ verticalAlign: "middle" }}>
              <path d="M12 15.3c-.9-1.4-1.7-2.9-2.4-4.4C8.7 8.9 7.4 7.5 5.7 7.5 3.3 7.5 1.5 9.4 1.5 12c0 2.6 1.9 4.6 4.4 4.6 1.5 0 2.8-.7 3.8-1.9.7 1.2 2 1.9 3.5 1.9s2.8-.7 3.5-1.9c1 1.2 2.3 1.9 3.8 1.9 2.5 0 4.4-2 4.4-4.6 0-2.6-1.8-4.5-4.2-4.5-1.7 0-3 1.4-3.9 3.4-.7 1.5-1.5 3-2.4 4.4zm-6.3-.9c-1.4 0-2.5-1.1-2.5-2.4s1.1-2.4 2.5-2.4c1 0 1.9.9 2.6 2.4-.7 1.5-1.6 2.4-2.6 2.4zm12.6 0c-1 0-1.9-.9-2.6-2.4.7-1.5 1.6-2.4 2.6-2.4 1.4 0 2.4 1.1 2.4 2.4s-1 2.4-2.4 2.4z"/>
            </svg>
          </span>
        );
      case "facebook":
        return (
          <span title="Facebook" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Facebook" style={{ verticalAlign: "middle" }}>
              <circle cx="12" cy="12" r="11" fill="#1877F2"/>
              <path d="M13.5 18v-5.5h1.8l.3-2.1h-2.1V9.1c0-.6.2-1 .1-1.1.2-.1.5-.1.9-.1h1.1V6.1c-.5-.1-1.2-.1-1.9-.1-1.9 0-3.1 1.1-3.1 3.2v1.3H9v2.1h1.7V18h2.8z" fill="#ffffff"/>
            </svg>
          </span>
        );
      case "instagram":
        return (
          <span title="Instagram" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Instagram" style={{ verticalAlign: "middle" }}>
              <defs>
                <radialGradient id="igGrad" cx="20%" cy="110%" r="130%">
                  <stop offset="0%" stopColor="#ffc107" />
                  <stop offset="20%" stopColor="#f44336" />
                  <stop offset="60%" stopColor="#e91e63" />
                  <stop offset="80%" stopColor="#9c27b0" />
                  <stop offset="100%" stopColor="#4a148c" />
                </radialGradient>
              </defs>
              <rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#igGrad)"/>
              <rect x="5.5" y="5.5" width="13" height="13" rx="3.5" stroke="#ffffff" strokeWidth="1.6" fill="none"/>
              <circle cx="12" cy="12" r="3.2" stroke="#ffffff" strokeWidth="1.6" fill="none"/>
              <circle cx="15.8" cy="8.2" r="0.9" fill="#ffffff"/>
            </svg>
          </span>
        );
      case "tiktok":
        return (
          <span title="TikTok" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" aria-label="TikTok" style={{ verticalAlign: "middle" }}>
              <rect width="24" height="24" rx="5" fill="#000000"/>
              <path d="M16.5 8.2c-1.1-.3-2-1-2.3-2.1h-2v9.3c0 1.2-1 2.2-2.2 2.2-1.2 0-2.2-1-2.2-2.2s1-2.2 2.2-2.2c.3 0 .5.1.7.2V11c-.2 0-.5-.1-.7-.1-2.4 0-4.3 1.9-4.3 4.3s1.9 4.3 4.3 4.3c2.4 0 4.3-1.9 4.3-4.3v-5.2c1 .7 2.2 1.1 3.5 1.1V8.2c-.6 0-1.1-.1-1.6-.3z" fill="#25F4EE"/>
              <path d="M16.8 7.9c-1.1-.3-2-1-2.3-2.1h-1.6v9.3c0 1.2-1 2.2-2.2 2.2-1.2 0-2.2-1-2.2-2.2s1-2.2 2.2-2.2c.3 0 .5.1.7.2v-1.8c-.2 0-.5-.1-.7-.1-2.4 0-4.3 1.9-4.3 4.3s1.9 4.3 4.3 4.3c2.4 0 4.3-1.9 4.3-4.3v-5.2c1 .7 2.2 1.1 3.5 1.1v-1.6c-.6 0-1.1-.1-1.6-.3z" fill="#FE2C55"/>
              <path d="M16.5 7.9c-1.1-.3-2-1-2.3-2.1h-1.8v9.3c0 1.2-1 2.2-2.2 2.2-1.2 0-2.2-1-2.2-2.2s1-2.2 2.2-2.2c.3 0 .5.1.7.2v-1.5c-.2 0-.5-.1-.7-.1-2.4 0-4.3 1.9-4.3 4.3s1.9 4.3 4.3 4.3c2.4 0 4.3-1.9 4.3-4.3v-5.2c1 .7 2.2 1.1 3.5 1.1v-1.8c-.6 0-1.1-.1-1.6-.3z" fill="#ffffff"/>
            </svg>
          </span>
        );
      case "woocommerce":
        return (
          <span title="WooCommerce" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" aria-label="WooCommerce" style={{ verticalAlign: "middle" }}>
              <circle cx="12" cy="12" r="11" fill="#96588A"/>
              <path d="M4.5 9.5c.3 3.5 1.5 6 3 6 1.1 0 1.9-1.2 2.4-2.8.5 1.7 1.4 2.8 2.5 2.8 1.1 0 2-1.2 2.5-2.8.5 1.6 1.3 2.8 2.4 2.8 1.5 0 2.7-2.5 3-6-1.5.3-2.6 1.8-3.1 3.8-.4-1.6-1.2-2.8-2.2-2.8-1 0-1.8 1.2-2.2 2.8-.5-1.6-1.3-2.8-2.3-2.8-1 0-1.8 1.2-2.2 2.8-.5-2-1.6-3.5-3.1-3.8z" fill="#ffffff"/>
            </svg>
          </span>
        );
      case "whatsapp":
        return (
          <span title="WhatsApp" style={{ display: "inline-flex", alignItems: "center" }}>
            <svg width={size} height={size} viewBox="0 0 24 24" aria-label="WhatsApp" style={{ verticalAlign: "middle" }}>
              <circle cx="12" cy="12" r="11" fill="#25D366"/>
              <path d="M12 4.5A7.5 7.5 0 0 0 5.5 15.8L4.5 19.5l3.8-1a7.5 7.5 0 1 0 3.7-14zm0 13.7a6.2 6.2 0 0 1-3.2-.9l-.2-.1-2.4.6.6-2.3-.2-.3a6.2 6.2 0 1 1 5.4 3zm3.4-4.6c-.2-.1-1.1-.6-1.3-.7-.2-.1-.3-.1-.4.1-.1.2-.5.7-.7.8-.1.1-.2.2-.4.1-.2-.1-.9-.3-1.7-1-.6-.6-1.1-1.3-1.2-1.5-.1-.2 0-.3.1-.4.1-.1.2-.2.3-.4.1-.1.1-.2.2-.3 0-.1 0-.2 0-.3 0-.1-.4-1.1-.6-1.5-.2-.4-.3-.3-.4-.3h-.4c-.1 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1.1.8 2.2.9 2.3.1.2 1.6 2.5 3.9 3.5.5.2 1 .4 1.3.5.6.2 1.1.2 1.5.1.5-.1 1.1-.6 1.3-1.1.2-.5.2-1 .1-1.1-.1-.1-.3-.2-.5-.3z" fill="#ffffff"/>
            </svg>
          </span>
        );
    }
  }

  const INTEGRATION_STATUSES: {
    name: string;
    status: string;
    badge: string;
    desc: string;
    logos: BrandLogoName[];
  }[] = [
    {
      name: "Shopify Store",
      status: "Live & Connected",
      badge: "badge-primary",
      desc: "Direct read-only API sync for verified orders, returns, and gross sales revenue.",
      logos: ["shopify"],
    },
    {
      name: "Google Ads",
      status: "Live & Connected",
      badge: "badge-primary",
      desc: "Direct OAuth read-only sync for active campaign ad spend, clicks, and impressions.",
      logos: ["google"],
    },
    {
      name: "Meta Ads (Facebook & Instagram)",
      status: "Manual & CSV Supported",
      badge: "badge-pop",
      desc: "Import official Ads Manager CSVs or enter spend manually. Direct API in verification.",
      logos: ["meta", "facebook", "instagram"],
    },
    {
      name: "WooCommerce",
      status: "Manual & CSV Supported",
      badge: "badge-pop",
      desc: "Export sales CSVs from WooCommerce and upload via the Import Center.",
      logos: ["woocommerce"],
    },
    {
      name: "Instagram & TikTok Organic",
      status: "Manual & CSV Supported",
      badge: "badge-pop",
      desc: "Export analytics CSVs from social platforms, or enter metrics manually.",
      logos: ["instagram", "tiktok"],
    },
    {
      name: "WhatsApp, Phone & In-Person Enquiries",
      status: "Full First-Class Support",
      badge: "badge-primary",
      desc: "Log enquiries, quotes, and customer orders directly without requiring an ad pixel or website.",
      logos: ["whatsapp"],
    },
    {
      name: "TikTok Shop Direct API",
      status: "Planned",
      badge: "badge-warning",
      desc: "Scheduled for post-launch release once developer partner review is completed.",
      logos: ["tiktok"],
    },
  ];

  return (
    <section>
      {/* Header card */}
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-subtle) 100%)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: "1.65rem" }}>Help & Feedback</h1>
            <span className="badge badge-primary">Support Desk</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Report inaccurate recommendations, submit feature feedback, or inspect integration ecosystem status.
          </p>
        </div>

        {/* Tab switcher buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={subTab === "support_request" ? "" : "btn-secondary"}
            onClick={() => { setSubTab("support_request"); setSuccess(""); setError(""); }}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            <Icon name="help" size={14} inline />Support Request
          </button>
          <button
            type="button"
            className={subTab === "bad_recommendation" ? "" : "btn-secondary"}
            onClick={() => { setSubTab("bad_recommendation"); setSuccess(""); setError(""); }}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            <Icon name="alert" size={14} inline />Report Bad Recommendation
          </button>
          <button
            type="button"
            className={subTab === "product_feedback" ? "" : "btn-secondary"}
            onClick={() => { setSubTab("product_feedback"); setSuccess(""); setError(""); }}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            <Icon name="sparkle" size={14} inline />Product Feedback
          </button>
          <button
            type="button"
            className={subTab === "status" ? "" : "btn-secondary"}
            onClick={() => { setSubTab("status"); setSuccess(""); setError(""); }}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            <Icon name="signal" size={14} inline />Integration Status
          </button>
        </div>
      </div>

      {subTab === "status" ? (
        /* Integration Status Section (Spec 4.1 AC-16) */
        <div className="card" style={{ padding: "26px 28px" }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 6px 0", fontSize: "1.25rem" }}>Platform Integration Ecosystem Status</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              As defined in our product integrity policy, channels listed are explicitly labeled as live/direct, import-supported, manual-supported, or planned.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {INTEGRATION_STATUSES.map((item) => (
              <div
                key={item.name}
                style={{
                  padding: "18px 20px",
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {item.logos.map((logo) => (
                        <div
                          key={logo}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: "var(--surface)",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                            border: "1px solid var(--line)",
                          }}
                        >
                          <BrandLogo name={logo} size={20} />
                        </div>
                      ))}
                    </div>
                    <span className={`badge ${item.badge}`} style={{ fontSize: 11 }}>{item.status}</span>
                  </div>
                  <strong style={{ display: "block", fontSize: 15, color: "var(--ink)", marginBottom: 6 }}>{item.name}</strong>
                  <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Submission Form */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          <div className="card" style={{ padding: "26px 28px" }}>
            <h2 style={{ margin: "0 0 8px 0", fontSize: "1.25rem" }}>
              {subTab === "bad_recommendation"
                ? "Report Inaccurate or Unhelpful Advice"
                : subTab === "product_feedback"
                ? "Share Ideas & Feature Requests"
                : "Ask Support"}
            </h2>
            <p className="muted" style={{ margin: "0 0 20px 0", fontSize: 13.5 }}>
              {subTab === "bad_recommendation"
                ? "Help us refine our decision rules. All reported recommendations are inspected with full audit snapshots."
                : subTab === "product_feedback"
                ? "Tell us what workflows, channels or data you need next."
                : "Need help with imports, connecting stores, or understanding your metrics? We are here to help."}
            </p>

            {success && (
              <div role="status" style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(143, 206, 58, 0.15)", border: "1px solid var(--accent)", color: "var(--ink)", marginBottom: 16, fontSize: 13.5 }}>
                ✓ {success}
              </div>
            )}
            {error && (
              <div role="alert" className="error" style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13.5 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {subTab === "bad_recommendation" && (
                <>
                  <label>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Recommendation Reference ID
                    </span>
                    <input
                      type="text"
                      placeholder="e.g. 8 characters or UUID"
                      value={recId}
                      onChange={(e) => setRecId(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </label>

                  <label>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      What was wrong with the advice?
                    </span>
                    <select
                      value={issueReason}
                      onChange={(e) => setIssueReason(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="inaccurate_math">Calculation / arithmetic discrepancy</option>
                      <option value="unsafe_budget">Suggested spend adjustment too aggressive or risky</option>
                      <option value="irrelevant_channel">Irrelevant to my sales channels / business model</option>
                      <option value="missing_context">Ignored my stated business objective</option>
                      <option value="other">Other issue</option>
                    </select>
                  </label>
                </>
              )}

              <label>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Subject
                </span>
                <input
                  type="text"
                  required
                  placeholder={
                    subTab === "bad_recommendation"
                      ? "Brief summary of the issue"
                      : subTab === "product_feedback"
                      ? "Summary of your suggestion"
                      : "How can we help?"
                  }
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>

              <label>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Details & Context
                </span>
                <textarea
                  required
                  rows={5}
                  placeholder={
                    subTab === "bad_recommendation"
                      ? "Explain what you observed, what was unexpected, or which numbers didn't match your records."
                      : "Provide as much detail as possible so we can address your request promptly."
                  }
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </label>

              <label>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Contact Email for Follow-up (optional)
                </span>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>

              <button
                type="submit"
                disabled={busy}
                style={{
                  marginTop: 6,
                  padding: "10px 22px",
                  fontSize: 14,
                  borderRadius: 10,
                }}
              >
                {busy ? "Submitting…" : "Send to Operations Desk"}
              </button>
            </form>
          </div>

          {/* Previous Tickets / Activity */}
          <div className="card" style={{ padding: "26px 28px" }}>
            <h2 style={{ margin: "0 0 8px 0", fontSize: "1.25rem" }}>Ticket History</h2>
            <p className="muted" style={{ margin: "0 0 20px 0", fontSize: 13.5 }}>
              Status and resolution notes on your submitted reports.
            </p>

            {tickets.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px" }} className="muted">
                <Icon name="check" size={28} inline />
                <p style={{ margin: "12px 0 0", fontSize: 14 }}>No tickets opened yet for this workspace.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {tickets.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 10,
                      background: "var(--surface-subtle)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <strong style={{ fontSize: 14, color: "var(--ink)" }}>{t.subject}</strong>
                      <span
                        className={`badge ${
                          t.status === "resolved"
                            ? "badge-primary"
                            : t.status === "in_progress"
                            ? "badge-warning"
                            : ""
                        }`}
                        style={{ fontSize: 11, textTransform: "capitalize" }}
                      >
                        {t.status.replace(/_/g, " ")}
                      </span>
                    </div>

                    <p style={{ margin: "0 0 8px 0", fontSize: 13, color: "var(--body)", whiteSpace: "pre-wrap" }}>
                      {t.message}
                    </p>

                    {t.internalNotes && t.internalNotes.length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "8px 12px",
                          borderRadius: 8,
                          background: "var(--surface-hover)",
                          borderLeft: "3px solid var(--accent)",
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--accent)" }}>
                          Operations Response
                        </span>
                        {t.internalNotes.map((n, i) => (
                          <p key={i} style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink)" }}>
                            {n.note}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>
                      Ref: {t.id} · Type: {t.type.replace(/_/g, " ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
