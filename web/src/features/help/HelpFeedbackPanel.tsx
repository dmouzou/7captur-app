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

  const INTEGRATION_STATUSES = [
    {
      name: "Shopify Store",
      status: "Live & Connected",
      badge: "badge-primary",
      desc: "Direct read-only API sync for verified orders, returns, and gross sales revenue.",
    },
    {
      name: "Google Ads",
      status: "Live & Connected",
      badge: "badge-primary",
      desc: "Direct OAuth read-only sync for active campaign ad spend, clicks, and impressions.",
    },
    {
      name: "Meta Ads (Facebook & Instagram)",
      status: "Manual & CSV Supported",
      badge: "badge-pop",
      desc: "Import official Ads Manager CSVs or enter spend manually. Direct API in verification.",
    },
    {
      name: "WooCommerce",
      status: "Manual & CSV Supported",
      badge: "badge-pop",
      desc: "Export sales CSVs from WooCommerce and upload via the Import Center.",
    },
    {
      name: "Instagram & TikTok Organic",
      status: "Manual & CSV Supported",
      badge: "badge-pop",
      desc: "Export analytics CSVs from social platforms, or enter metrics manually.",
    },
    {
      name: "WhatsApp, Phone & In-Person Enquiries",
      status: "Full First-Class Support",
      badge: "badge-primary",
      desc: "Log enquiries, quotes, and customer orders directly without requiring an ad pixel or website.",
    },
    {
      name: "TikTok Shop Direct API",
      status: "Planned",
      badge: "badge-warning",
      desc: "Scheduled for post-launch release once developer partner review is completed.",
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
                  padding: "16px 18px",
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <strong style={{ fontSize: 14, color: "var(--ink)" }}>{item.name}</strong>
                    <span className={`badge ${item.badge}`} style={{ fontSize: 11 }}>{item.status}</span>
                  </div>
                  <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.45 }}>{item.desc}</p>
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
                ? "Tell us what workflows, channels, or telemetry you need next."
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
