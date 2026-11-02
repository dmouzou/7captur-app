import { useState, useEffect, useMemo, useRef } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";

export interface SearchItem {
  id: string;
  category: "Navigation" | "Metric" | "Record" | "Quick Action" | "Recommendation";
  title: string;
  subtitle: string;
  badge?: string;
  keywords?: string[];
  onSelect: () => void;
}

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onOpenAccount?: () => void;
}

export function GlobalSearchModal({ isOpen, onClose, onNavigate }: GlobalSearchModalProps) {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live records state for deep search
  const [recentSales, setRecentSales] = useState<{ id: string; orderNumber?: string; amount: number; product?: string; status: string; date: string }[]>([]);
  const [recentLeads, setRecentLeads] = useState<{ id: string; source?: string; status: string; date: string; notes?: string }[]>([]);
  const [recentPosts, setRecentPosts] = useState<{ id: string; platform: string; topic?: string; reach?: number; publishedAt: string }[]>([]);
  const [recentPromos, setRecentPromos] = useState<{ id: string; platform: string; spend: number; campaignId?: string; objective: string }[]>([]);
  const [recentRecs, setRecentRecs] = useState<{ id: string; primary_action?: { description?: string }; category?: string; status?: string }[]>([]);

  useEffect(() => {
    if (!isOpen || !ws.workspaceId) return;

    const unsubs = [
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/sales`), orderBy("createdAt", "desc"), limit(25)), (s) => {
        setRecentSales(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/leads`), orderBy("createdAt", "desc"), limit(25)), (s) => {
        setRecentLeads(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/posts`), orderBy("createdAt", "desc"), limit(25)), (s) => {
        setRecentPosts(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/promotions`), orderBy("createdAt", "desc"), limit(25)), (s) => {
        setRecentPromos(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
      onSnapshot(query(collection(db, `workspaces/${ws.workspaceId}/recommendations`), orderBy("createdAt", "desc"), limit(10)), (s) => {
        setRecentRecs(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [isOpen, ws.workspaceId]);

  useEffect(() => {
    if (isOpen) {
      setQ("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const allItems: SearchItem[] = useMemo(() => {
    const items: SearchItem[] = [
      // Quick Actions
      {
        id: "qa-rec",
        category: "Quick Action",
        title: "Generate New Recommendation",
        subtitle: "Run Decision Engine V3 intelligence with current evidence",
        keywords: ["new", "recommendation", "ai", "engine", "decision", "generate"],
        onSelect: () => {
          onNavigate("recommendations");
          onClose();
        },
      },
      {
        id: "qa-account",
        category: "Quick Action",
        title: "Account Details & Preferences",
        subtitle: "Change business objective, reporting currency, location and view mode",
        keywords: ["account", "preferences", "goals", "objective", "currency", "timezone", "location", "email"],
        onSelect: () => {
          onNavigate("account");
          onClose();
        },
      },
      {
        id: "qa-sale",
        category: "Quick Action",
        title: "Record New Sale / Order",
        subtitle: "Manually log gross sales, discounts, refunds or attribution",
        keywords: ["sale", "order", "revenue", "transaction", "invoice"],
        onSelect: () => {
          onNavigate("sales");
          onClose();
        },
      },
      {
        id: "qa-cost",
        category: "Quick Action",
        title: "Record Business Cost / COGS",
        subtitle: "Log variable product costs, shipping, processing fees, or fixed overhead",
        keywords: ["cost", "expense", "cogs", "shipping", "fee", "overhead", "margin"],
        onSelect: () => {
          onNavigate("costs");
          onClose();
        },
      },
      {
        id: "qa-lead",
        category: "Quick Action",
        title: "Record Customer Enquiry / Lead",
        subtitle: "Track inbound enquiry, qualification status, and potential value",
        keywords: ["lead", "enquiry", "prospect", "inbound", "client"],
        onSelect: () => {
          onNavigate("leads");
          onClose();
        },
      },

      // Navigation
      {
        id: "nav-overview",
        category: "Navigation",
        title: "Dashboard",
        subtitle: "Executive overview of revenue, spend, ROAS, and recent activity",
        keywords: ["overview", "home", "metrics", "dashboard", "summary"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
      {
        id: "nav-recs",
        category: "Navigation",
        title: "Recommendations",
        subtitle: "Engine recommendations with Beginner & Advanced Telemetry views",
        keywords: ["recommendations", "engine", "actions", "intelligence", "advice"],
        onSelect: () => {
          onNavigate("recommendations");
          onClose();
        },
      },
      {
        id: "nav-decisions",
        category: "Navigation",
        title: "Decision Center",
        subtitle: "Active decisions, safety milestones, outcome reviews, and guardrails",
        keywords: ["decisions", "center", "review", "guardrails", "milestones", "outcomes"],
        onSelect: () => {
          onNavigate("decisions");
          onClose();
        },
      },
      {
        id: "nav-reports",
        category: "Navigation",
        title: "Weekly Summary & Reports",
        subtitle: "Weekly executive briefing and scheduled email reports",
        keywords: ["weekly", "summary", "reports", "digest", "briefing"],
        onSelect: () => {
          onNavigate("reports");
          onClose();
        },
      },
      {
        id: "nav-leads",
        category: "Navigation",
        title: "Commercial Leads & Enquiries",
        subtitle: "Log and review qualified client enquiries and lead sources",
        keywords: ["leads", "enquiries", "pipeline", "prospects"],
        onSelect: () => {
          onNavigate("leads");
          onClose();
        },
      },
      {
        id: "nav-sales",
        category: "Navigation",
        title: "Sales & Revenue Records",
        subtitle: "Store order-line sales, discounts, refunds, and returns",
        keywords: ["sales", "revenue", "orders", "receipts", "transactions"],
        onSelect: () => {
          onNavigate("sales");
          onClose();
        },
      },
      {
        id: "nav-costs",
        category: "Navigation",
        title: "Costs & Variable Expenses",
        subtitle: "Manage COGS, payment fees, shipping, and operating costs",
        keywords: ["costs", "spend", "expenses", "cogs", "fees", "shipping"],
        onSelect: () => {
          onNavigate("costs");
          onClose();
        },
      },
      {
        id: "nav-posts",
        category: "Navigation",
        title: "Organic Posts & Content",
        subtitle: "Organic social media posts, reach, engagement, and content tests",
        keywords: ["posts", "content", "social", "instagram", "tiktok", "organic"],
        onSelect: () => {
          onNavigate("posts");
          onClose();
        },
      },
      {
        id: "nav-promos",
        category: "Navigation",
        title: "Paid Promotions & Campaigns",
        subtitle: "Daily campaign spend, impressions, clicks, and claimed conversions",
        keywords: ["promotions", "ads", "campaigns", "google", "meta", "paid"],
        onSelect: () => {
          onNavigate("promotions");
          onClose();
        },
      },
      {
        id: "nav-connections",
        category: "Navigation",
        title: "Connected Integrations",
        subtitle: "Shopify store connection, Google Ads OAuth, and data sync",
        keywords: ["integrations", "shopify", "google ads", "connections", "oauth", "sync"],
        onSelect: () => {
          onNavigate("connections");
          onClose();
        },
      },
      {
        id: "nav-billing",
        category: "Navigation",
        title: "Subscription & Plans",
        subtitle: "Starter, Growth, and Custom plans, recommendation allowances",
        keywords: ["billing", "subscription", "plans", "starter", "growth", "custom", "paddle"],
        onSelect: () => {
          onNavigate("billing");
          onClose();
        },
      },
      {
        id: "nav-settings",
        category: "Navigation",
        title: "Workspace Settings",
        subtitle: "Workspace members, data management, and exports",
        keywords: ["settings", "members", "export", "delete", "workspace"],
        onSelect: () => {
          onNavigate("settings");
          onClose();
        },
      },
      {
        id: "nav-account",
        category: "Navigation",
        title: "Account & Preferences",
        subtitle: "Workspace profile, goals, currency, location, and presentation view mode",
        keywords: ["account", "preferences", "goals", "objective", "currency", "timezone", "location", "view mode"],
        onSelect: () => {
          onNavigate("account");
          onClose();
        },
      },

      // Spec V3 Financial Metrics definitions & deep links
      {
        id: "met-att-roas",
        category: "Metric",
        title: "Attributed ROAS",
        subtitle: "Net attributed revenue ÷ matching ad spend (revenue efficiency, not profit)",
        badge: "Metric",
        keywords: ["roas", "attributed roas", "efficiency", "ad return"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
      {
        id: "met-rep-roas",
        category: "Metric",
        title: "Reported ROAS",
        subtitle: "Platform-claimed revenue ÷ platform spend (platform's claim only, never alone to decide)",
        badge: "Metric",
        keywords: ["reported roas", "claimed roas", "meta roas", "google roas"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
      {
        id: "met-cm",
        category: "Metric",
        title: "Contribution Margin (CM)",
        subtitle: "1 - COGS% - shipping% - variable costs% (required for break-even)",
        badge: "Metric",
        keywords: ["margin", "contribution margin", "cogs", "variable profit"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
      {
        id: "met-be-roas",
        category: "Metric",
        title: "Break-even ROAS",
        subtitle: "1 ÷ Contribution margin (minimum return to avoid losing money on ad spend)",
        badge: "Metric",
        keywords: ["break-even", "break even roas", "floor"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
      {
        id: "met-att-cov",
        category: "Metric",
        title: "Attribution Coverage (60% Safety Gate)",
        subtitle: "Share of net revenue verified to ad campaigns. Below 60% prevents aggressive scaling.",
        badge: "Safety Gate",
        keywords: ["coverage", "attribution coverage", "safety gate", "60%"],
        onSelect: () => {
          onNavigate("recommendations");
          onClose();
        },
      },
      {
        id: "met-cam",
        category: "Metric",
        title: "Contribution After Marketing",
        subtitle: "Net revenue × CM - ad spend - other marketing costs (true commercial profit)",
        badge: "Metric",
        keywords: ["contribution after marketing", "profit", "net profit"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
      {
        id: "met-runrate",
        category: "Metric",
        title: "30-Day Run Rate",
        subtitle: "(Net revenue in last 28 days ÷ 28) × 30 baseline extrapolation",
        badge: "Metric",
        keywords: ["run rate", "30 day run rate", "baseline extrapolation"],
        onSelect: () => {
          onNavigate("overview");
          onClose();
        },
      },
    ];

    // Add Live Records from state
    for (const s of recentSales) {
      items.push({
        id: `rec-sale-${s.id}`,
        category: "Record",
        title: `Sale: ${ws.currency} ${s.amount?.toFixed?.(2) ?? s.amount} · ${s.status}`,
        subtitle: `Date: ${s.date}${s.orderNumber ? ` · Order #${s.orderNumber}` : ""}${s.product ? ` · ${s.product}` : ""}`,
        badge: "Sale",
        keywords: ["sale", "order", s.orderNumber ?? "", s.product ?? "", String(s.amount), s.status],
        onSelect: () => {
          onNavigate("sales");
          onClose();
        },
      });
    }

    for (const l of recentLeads) {
      items.push({
        id: `rec-lead-${l.id}`,
        category: "Record",
        title: `Lead Enquiry · ${l.source || "Direct"} (${l.status})`,
        subtitle: `Date: ${l.date}${l.notes ? ` · ${l.notes.slice(0, 40)}...` : ""}`,
        badge: "Lead",
        keywords: ["lead", "enquiry", l.source ?? "", l.status, l.notes ?? ""],
        onSelect: () => {
          onNavigate("leads");
          onClose();
        },
      });
    }

    for (const p of recentPosts) {
      items.push({
        id: `rec-post-${p.id}`,
        category: "Record",
        title: `Post on ${p.platform}${p.topic ? ` (${p.topic})` : ""}`,
        subtitle: `Published ${p.publishedAt}${p.reach ? ` · Reach: ${p.reach.toLocaleString()}` : ""}`,
        badge: "Post",
        keywords: ["post", p.platform, p.topic ?? "", "content"],
        onSelect: () => {
          onNavigate("posts");
          onClose();
        },
      });
    }

    for (const pr of recentPromos) {
      items.push({
        id: `rec-promo-${pr.id}`,
        category: "Record",
        title: `Promotion on ${pr.platform} · Spend ${ws.currency} ${pr.spend}`,
        subtitle: `Objective: ${pr.objective}${pr.campaignId ? ` · Campaign: ${pr.campaignId}` : ""}`,
        badge: "Promo",
        keywords: ["promotion", "ad", pr.platform, pr.campaignId ?? "", pr.objective],
        onSelect: () => {
          onNavigate("promotions");
          onClose();
        },
      });
    }

    // Add Live Recommendations
    for (const r of recentRecs) {
      const act = r.primary_action?.description || "Explore action";
      items.push({
        id: `rec-rec-${r.id}`,
        category: "Recommendation",
        title: act.slice(0, 60),
        subtitle: `Category: ${r.category || "General"} · Status: ${r.status || "ready"}`,
        badge: "Decision",
        keywords: ["recommendation", act, r.category ?? "", r.status ?? ""],
        onSelect: () => {
          onNavigate("recommendations");
          onClose();
        },
      });
    }

    return items;
  }, [recentSales, recentLeads, recentPosts, recentPromos, recentRecs, ws, onNavigate, onClose]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return allItems.slice(0, 15);

    return allItems
      .filter((item) => {
        const inTitle = item.title.toLowerCase().includes(term);
        const inSub = item.subtitle.toLowerCase().includes(term);
        const inCat = item.category.toLowerCase().includes(term);
        const inKey = item.keywords?.some((k) => k.toLowerCase().includes(term)) ?? false;
        return inTitle || inSub || inCat || inKey;
      })
      .slice(0, 20);
  }, [allItems, q]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [q]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        zIndex: 1200,
        alignItems: "flex-start",
        paddingTop: "10vh",
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 600,
          width: "92%",
          borderRadius: 16,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          padding: 0,
          boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Top search input box */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            gap: 12,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search records, recommendations, metrics, navigation... (↑↓ to select, Enter)"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 15,
              background: "transparent",
              color: "var(--ink)",
              padding: 0,
            }}
          />
          {q && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setQ("")}
              style={{ padding: "2px 8px", fontSize: 12, borderRadius: 12, minWidth: "auto" }}
            >
              Clear
            </button>
          )}
          <span className="badge" style={{ fontSize: 11, background: "var(--surface-subtle)" }}>
            ESC to close
          </span>
        </div>

        {/* Results list */}
        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "8px 0" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--muted)" }}>
              <p style={{ margin: 0, fontSize: 14 }}>No matches found for &ldquo;{q}&rdquo;</p>
              <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                Try searching for <em>ROAS</em>, <em>Margin</em>, <em>Sale</em>, <em>Shopify</em>, <em>Preferences</em>, or <em>Recommendations</em>.
              </p>
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.onSelect}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 18px",
                    cursor: "pointer",
                    background: isSelected ? "var(--accent-fill)" : "transparent",
                    color: isSelected ? "var(--on-accent)" : "inherit",
                    borderLeft: isSelected ? "4px solid var(--accent)" : "4px solid transparent",
                    transition: "background 0.1s ease",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: isSelected ? "var(--on-accent)" : "var(--ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </span>
                      {item.badge && (
                        <span
                          className="badge"
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            background: isSelected ? "rgba(255,255,255,0.2)" : "var(--surface-subtle)",
                            color: isSelected ? "#fff" : "var(--muted)",
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 2,
                        color: isSelected ? "rgba(255,255,255,0.85)" : "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: isSelected ? "rgba(255,255,255,0.15)" : "var(--surface-subtle)",
                        color: isSelected ? "#fff" : "var(--muted)",
                        fontWeight: 600,
                      }}
                    >
                      {item.category}
                    </span>
                    {isSelected && (
                      <span style={{ fontSize: 12, opacity: 0.9 }}>↵</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 18px",
            background: "var(--surface-subtle)",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          <span>Tip: Press <strong>⌘K</strong> or <strong>Ctrl+K</strong> anytime to open quick search</span>
          <span><strong>↑↓</strong> Navigate · <strong>↵</strong> Open</span>
        </div>
      </div>
    </div>
  );
}
