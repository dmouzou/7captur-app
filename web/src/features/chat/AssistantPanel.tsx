import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { Icon } from "../../components/Icon";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  context?: string;
  timestamp: number;
}

interface AssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  currentScreen: string;
  screenContextDescription?: string;
}

const CONTEXT_SUGGESTIONS: Record<string, string[]> = {
  understand: [
    "What is my current evidence level?",
    "What missing fields should I fix first?",
    "Summarize what changed this week",
  ],
  decide: [
    "Why is this recommendation prioritized?",
    "What assumptions and unknowns exist in this decision?",
    "What guardrails should I apply before taking action?",
  ],
  add: [
    "How should I format my CSV for bulk import?",
    "What connectors are available vs planned?",
    "How does the 14-day stale data threshold work?",
  ],
  data: [
    "How does 7Captur calculate commercial certainty?",
    "What is the difference between connected and manual provenance?",
    "Can I export sanitized records to CSV?",
  ],
  default: [
    "Give me an executive overview of my workspace.",
    "How do I reach the 'Optimize' evidence level?",
    "What commercial records are most influential for recommendations?",
  ],
};

export function AssistantPanel({
  isOpen,
  onClose,
  onToggle,
  currentScreen,
  screenContextDescription,
}: AssistantPanelProps) {
  const ws = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // AC-4: Panel survives route changes, but resets when workspaceId changes
  useEffect(() => {
    setMessages([
      {
        id: "initial",
        sender: "assistant",
        text: `Hello! I'm your 7Captur Assistant for **${ws.workspaceName}**. I can answer questions about your data health, explain decision rationales, or guide you through adding commercial records.`,
        context: "Workspace initialized",
        timestamp: Date.now(),
      },
    ]);
  }, [ws.workspaceId, ws.workspaceName]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const suggestions =
    CONTEXT_SUGGESTIONS[currentScreen] ||
    (currentScreen.startsWith("data") ? CONTEXT_SUGGESTIONS.data : CONTEXT_SUGGESTIONS.default);

  const screenBadgeLabel = screenContextDescription || currentScreen.replace(/\//g, " > ");

  async function sendMessage(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || busy) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      sender: "user",
      text: trimmed,
      context: screenBadgeLabel,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setBusy(true);

    // Provide contextual assistance based on screen and workspace state
    setTimeout(() => {
      let reply = "";
      const q = trimmed.toLowerCase();

      if (q.includes("evidence level") || q.includes("optimize") || q.includes("explore")) {
        reply = `Your evidence level is currently based on logged commercial data.\n\n- **Explore**: Starting tier with manual or partial records.\n- **Improve**: Requires at least 14 days of continuous spend and sales records.\n- **Optimize**: Requires connected platform telemetry (e.g. Shopify orders) and mapped ad spend.\n\nTo unlock the next level, continue recording daily spend or connect your live store.`;
      } else if (q.includes("stale") || q.includes("14 days") || q.includes("refresh")) {
        reply = `7Captur uses a **14-day freshness window**. If no commercial records or syncs occurred in the last 14 days, your intelligence banner will alert you to refresh your numbers so recommendations stay accurate.`;
      } else if (q.includes("guardrail") || q.includes("risk")) {
        reply = `Every recommendation in the Decide queue includes strict guardrails (e.g., maximum test budgets, minimum sample sizes, review dates). 7Captur never writes to any ad platform; you stay in full control of execution.`;
      } else if (q.includes("format") || q.includes("csv") || q.includes("import")) {
        reply = `You can upload CSV spreadsheets up to **25MB**. Files are parsed with UTF-8/BOM support. If rejected rows exceed **50%**, a warning dialog will prompt you to review before proceeding. Only valid, non-duplicate rows are persisted.`;
      } else if (q.includes("prioritize") || q.includes("decision") || q.includes("why")) {
        reply = `Decisions are categorized into **Act** (high certainty & high ROI impact), **Investigate** (potential opportunity requiring verification), and **Monitor** (steady performance tracking). Review the 'Why this option' section on any decision card for full rationale.`;
      } else {
        reply = `Here is what I can tell you about **${ws.workspaceName}**:\n\n- **Objective**: ${ws.objective?.replace(/_/g, " ") || "Profitability"}\n- **Currency**: ${ws.currency}\n- **Timezone**: ${ws.timezone}\n- **Plan**: ${ws.plan}\n\nAsk me about data health, how recommendations are generated, or how to import your sales and ad spend.`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: "assistant",
          text: reply,
          context: screenBadgeLabel,
          timestamp: Date.now(),
        },
      ]);
      setBusy(false);
    }, 450);
  }

  return (
    <>
      {/* Floating Action Button at Bottom Right */}
      <button
        type="button"
        className="chat-fab-button"
        onClick={onToggle}
        aria-label={isOpen ? "Close Assistant" : "Ask 7Captur Assistant"}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 90,
          height: 48,
          borderRadius: 24,
          padding: isOpen ? "0 18px" : "0 20px",
          background: "var(--accent)",
          color: "var(--bg)",
          border: "none",
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontWeight: 600,
          fontSize: 13.5,
          transition: "transform 0.15s ease, background-color 0.15s ease",
        }}
      >
        <Icon name="help" size={19} />
        <span>{isOpen ? "Close Assistant" : "Ask 7Captur"}</span>
      </button>

      {/* Side Slide-Over Panel */}
      {isOpen && (
        <aside
          className="chat-side-panel"
          style={{
            position: "fixed",
            top: 70,
            right: 0,
            bottom: 0,
            width: 400,
            maxWidth: "92vw",
            background: "var(--surface)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.25)",
            zIndex: 89,
            display: "flex",
            flexDirection: "column",
          }}
          aria-label="7Captur Assistant"
        >
          {/* Panel Header */}
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "var(--surface-subtle)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>
                  7Captur Assistant
                </span>
                <span className="badge badge-primary" style={{ fontSize: 10 }}>
                  AI
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                Screen context: <span style={{ color: "var(--accent)" }}>{screenBadgeLabel}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              aria-label="Close assistant"
              style={{
                width: 32,
                height: 32,
                padding: 0,
                borderRadius: 8,
                margin: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>
          </div>

          {/* Messages Scroll Area */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                }}
              >
                <div
                  style={{
                    padding: "12px 15px",
                    borderRadius: 12,
                    fontSize: 13,
                    lineHeight: 1.5,
                    background:
                      m.sender === "user"
                        ? "var(--accent)"
                        : "var(--surface-subtle)",
                    color: m.sender === "user" ? "#000" : "var(--ink)",
                    border:
                      m.sender === "user"
                        ? "none"
                        : "1px solid var(--border)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.text}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    marginTop: 4,
                    textAlign: m.sender === "user" ? "right" : "left",
                  }}
                >
                  {new Date(m.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}

            {busy && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                  fontSize: 12.5,
                  color: "var(--muted)",
                }}
              >
                Analyzing context…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Context Prompt Suggestions */}
          <div
            style={{
              padding: "10px 18px",
              borderTop: "1px solid var(--border)",
              background: "var(--surface-subtle)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Suggested for {screenBadgeLabel}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="btn-secondary"
                  onClick={() => sendMessage(s)}
                  style={{
                    margin: 0,
                    padding: "6px 10px",
                    fontSize: 11.5,
                    borderRadius: 6,
                    textAlign: "left",
                    color: "var(--ink)",
                    background: "var(--surface)",
                  }}
                >
                  💬 {s}
                </button>
              ))}
            </div>
          </div>

          {/* Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            style={{
              padding: "14px 18px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: 8,
              background: "var(--surface)",
            }}
          >
            <input
              type="text"
              placeholder="Ask a question about your numbers…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              style={{
                flex: 1,
                fontSize: 13,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
              }}
            />
            <button
              type="submit"
              className="primary"
              disabled={busy || !input.trim()}
              style={{
                margin: 0,
                padding: "8px 16px",
                fontSize: 13,
                borderRadius: 8,
              }}
            >
              Send
            </button>
          </form>
        </aside>
      )}
    </>
  );
}

