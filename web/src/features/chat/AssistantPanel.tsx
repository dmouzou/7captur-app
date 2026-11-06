import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { Icon } from "../../components/Icon";
import { PLANS } from "../../shared/plans";
import { periodIds } from "../../shared/periods";
import { ASSISTANT_AI_DISCLAIMER, aiNoticeText, classifyQuestion, type AssistantResult } from "../../shared/assistant";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  context?: string;
  timestamp: number;
  /** Set on assistant answers: where the answer came from and whether it cost a credit. */
  source?: "ai" | "engine";
  creditsUsed?: number;
  creditReturned?: boolean;
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
    "How does 7Captur decide how strong the evidence is?",
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** A free-form question waits here until the user accepts that it uses an AI credit. */
  const [pendingAi, setPendingAi] = useState<string | null>(null);
  const [usedMonth, setUsedMonth] = useState(0);
  const monthly = (PLANS[ws.plan] ?? PLANS.starter).aiFollowUps.monthly;
  const left = Math.max(0, monthly - usedMonth);

  // AC-4: the panel survives route changes (it is mounted once for the whole workspace) and resets when the workspace changes
  useEffect(() => {
    setPendingAi(null);
    setInput("");
    setMessages([
      {
        id: "initial",
        sender: "assistant",
        text: `Hi, I'm the 7Captur assistant for ${ws.workspaceName}. Ask me about your data, your evidence level, your recommendations or how to add data. Answers about your numbers and about 7Captur are fixed and free. Open-ended questions are written by AI and use 1 AI credit, and I will always tell you before that happens.`,
        context: "Workspace opened",
        timestamp: Date.now(),
        source: "engine",
        creditsUsed: 0,
      },
    ]);
  }, [ws.workspaceId, ws.workspaceName]);

  // Live AI credits left this month (same pool as follow-up questions on decisions)
  useEffect(() => {
    const monthId = periodIds(new Date(), ws.accountTimezone).monthId;
    return onSnapshot(
      doc(db, `accounts/${ws.ownerUid}/usage/${monthId}`),
      (s) => setUsedMonth(Number(s.data()?.aiFollowUps ?? 0)),
      () => undefined
    );
  }, [ws.ownerUid, ws.accountTimezone]);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen, pendingAi]);

  const suggestions =
    CONTEXT_SUGGESTIONS[currentScreen] ||
    (currentScreen.startsWith("data") ? CONTEXT_SUGGESTIONS.data : CONTEXT_SUGGESTIONS.default);

  const screenBadgeLabel = screenContextDescription || currentScreen.replace(/\//g, " > ");

  /** Step 1: fixed questions go straight through. Open-ended ones ask the user to confirm the credit first. */
  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (classifyQuestion(trimmed) === "free_form" && trimmed.length >= 3) {
      setPendingAi(trimmed);
      return;
    }
    void send(trimmed);
  }

  async function send(question: string, engineOnly = false) {
    setPendingAi(null);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), sender: "user", text: question, context: screenBadgeLabel, timestamp: Date.now() }]);
    setInput("");
    setBusy(true);
    try {
      const res = await httpsCallable<unknown, AssistantResult>(functions, "askAssistant")({
        workspaceId: ws.workspaceId,
        businessId: ws.businessId,
        requestId: crypto.randomUUID(),
        question,
        screen: currentScreen,
        ...(engineOnly ? { engineOnly: true } : {}),
      });
      const r = res.data;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(), sender: "assistant", text: r.answer, context: screenBadgeLabel, timestamp: Date.now(),
          source: r.source, creditsUsed: r.creditsUsed, creditReturned: r.creditReturned,
        },
      ]);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const text = err.code === "functions/resource-exhausted"
        ? (err.message || "You have used all your AI credits this month.") + " No credit was used."
        : "I could not answer that just now. No AI credit was used. Please try again.";
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), sender: "assistant", text, context: screenBadgeLabel, timestamp: Date.now(), source: "engine", creditsUsed: 0 }]);
    } finally {
      setBusy(false);
    }
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
          right: isOpen ? 424 : 24,
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
                <span className="badge badge-primary" style={{ fontSize: 10 }} title="Open-ended questions are answered by AI and use 1 AI credit">
                  {left} of {monthly} AI credits left
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
                {m.sender === "assistant" && m.source && m.id !== "initial" && (
                  <div style={{ marginTop: 6 }}>
                    <span className={`badge ${m.source === "ai" ? "badge-primary" : "badge-success"}`} style={{ fontSize: 10.5 }}>
                      {m.source === "ai" ? "AI answer · 1 credit used" : m.creditReturned ? "Fixed answer · AI credit returned" : "Fixed answer · free"}
                    </span>
                    {m.source === "ai" && <div className="muted" style={{ fontSize: 10.5, marginTop: 4, maxWidth: 300 }}>{ASSISTANT_AI_DISCLAIMER}</div>}
                  </div>
                )}
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
                Looking at your workspace…
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
                  onClick={() => submit(s)}
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

          {/* Credit notice: shown before any AI answer is requested */}
          {pendingAi && (
            <div role="alert" style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--surface-subtle)" }}>
              <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.5, marginBottom: 6 }}>
                <strong>This question will use 1 AI credit.</strong>
              </div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
                {left > 0 ? aiNoticeText(left, monthly) : `You have no AI credits left this month. Fixed answers about your data and 7Captur are still free.`}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="primary" disabled={busy || left <= 0} onClick={() => void send(pendingAi)} style={{ margin: 0, padding: "7px 14px", fontSize: 12.5, borderRadius: 8 }}>
                  Ask with 1 AI credit
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void send(pendingAi, true)} style={{ margin: 0, padding: "7px 14px", fontSize: 12.5, borderRadius: 8 }}>
                  Get a fixed answer (free)
                </button>
                <button type="button" className="btn-secondary" onClick={() => setPendingAi(null)} style={{ margin: 0, padding: "7px 14px", fontSize: 12.5, borderRadius: 8 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
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
              placeholder="Ask about your data, or anything else…"
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

