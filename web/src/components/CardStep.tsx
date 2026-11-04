import { useState } from "react";
import type { CardDef } from "../shared/cards";
import { Icon } from "./Icon";

interface CardStepProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; onClick?: () => void }[];
  onBack?: () => void;
  cards: CardDef[];
  onSelectCard: (card: CardDef) => void;
  onNotifyPlanned?: (card: CardDef) => void;
}

export function CardStep({
  title,
  subtitle,
  breadcrumbs,
  onBack,
  cards,
  onSelectCard,
  onNotifyPlanned,
}: CardStepProps) {
  const [notified, setNotified] = useState<Record<string, boolean>>({});

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      {/* Breadcrumbs & Navigation Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          {onBack && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onBack}
              style={{
                padding: "6px 12px",
                fontSize: 12.5,
                margin: 0,
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              ← Back
            </button>
          )}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
              {breadcrumbs.map((b, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
                  {b.onClick ? (
                    <button
                      type="button"
                      className="link"
                      onClick={b.onClick}
                      style={{ fontSize: 13, textDecoration: "none" }}
                    >
                      {b.label}
                    </button>
                  ) : (
                    <span style={{ color: "var(--ink)" }}>{b.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
        </div>
      </div>

      {/* Title & Subtitle Card */}
      <div
        className="card"
        style={{
          padding: "24px 28px",
          marginBottom: 24,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)",
          border: "1px solid var(--border)",
        }}
      >
        <h1 style={{ margin: "0 0 6px 0", fontSize: "1.65rem", fontWeight: 500 }}>{title}</h1>
        {subtitle && (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {cards.map((card) => {
          const isPlanned = card.status === "planned";
          const isNotified = notified[card.id];

          return (
            <div
              key={card.id}
              className="card"
              onClick={() => {
                if (!isPlanned) onSelectCard(card);
              }}
              style={{
                cursor: isPlanned ? "default" : "pointer",
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                opacity: isPlanned ? 0.65 : 1,
                border: isPlanned ? "1px dashed var(--line-strong)" : "1px solid var(--border)",
                transition: "all 0.18s ease",
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: isPlanned ? "var(--surface-subtle)" : "var(--accent-soft)",
                      color: isPlanned ? "var(--muted)" : "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name={card.icon} size={20} />
                  </div>
                  {isPlanned ? (
                    <span className="badge" style={{ fontSize: 11, background: "var(--bg3)", color: "var(--muted)" }}>
                      Planned
                    </span>
                  ) : card.status === "import" ? (
                    <span className="badge badge-pop" style={{ fontSize: 11 }}>
                      Import Supported
                    </span>
                  ) : (
                    <span className="badge badge-primary" style={{ fontSize: 11 }}>
                      Live
                    </span>
                  )}
                </div>

                <h3 style={{ margin: "0 0 6px 0", fontSize: "1.1rem", fontWeight: 500, color: "var(--ink)" }}>
                  {card.label}
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
                  {card.description}
                </p>
              </div>

              {isPlanned && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isNotified}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNotified((prev) => ({ ...prev, [card.id]: true }));
                      onNotifyPlanned?.(card);
                    }}
                    style={{
                      width: "100%",
                      margin: 0,
                      padding: "6px 12px",
                      fontSize: 12,
                      borderRadius: 6,
                    }}
                  >
                    {isNotified ? "✓ We'll notify you" : "Notify me when available"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

