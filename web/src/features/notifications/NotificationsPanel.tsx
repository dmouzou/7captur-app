import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { Icon } from "../../components/Icon";

interface Item {
  id: string;
  kind?: string;
  title: string;
  body: string;
  priority: string;
  createdAtMs: number;
  read: boolean;
}

function useNotifications(): Item[] {
  const { workspaceId } = useWorkspace();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const q = query(
      collection(db, `workspaces/${workspaceId}/notifications`),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    return onSnapshot(
      q,
      (s) =>
        setItems(
          s.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              kind: String(x.kind ?? "system"),
              title: String(x.title ?? ""),
              body: String(x.body ?? ""),
              priority: String(x.priority ?? "normal"),
              createdAtMs: x.createdAt?.toMillis?.() ?? 0,
              read: Boolean(x.readAt),
            };
          })
        ),
      () => setItems([])
    );
  }, [workspaceId]);
  return items;
}

export const useUnreadCount = () => useNotifications().filter((i) => !i.read).length;

const KIND_LABELS: Record<string, { label: string; badge: string }> = {
  weekly_report: { label: "Weekly Summary", badge: "badge-primary" },
  payment_failed: { label: "Billing Issue", badge: "badge-warning" },
  limit_reached: { label: "Credit Limit", badge: "badge-warning" },
  import_failed: { label: "Import Alert", badge: "badge-warning" },
  integration_disconnected: { label: "Connection Alert", badge: "badge-warning" },
  stale_data: { label: "Data Quality", badge: "badge-pop" },
  outcome_followup: { label: "Outcome Check", badge: "badge-pop" },
  security_event: { label: "Security Notice", badge: "badge-warning" },
  band_change: { label: "Spend Band", badge: "badge-primary" },
};

export function NotificationsPanel() {
  const { workspaceId } = useWorkspace();
  const items = useNotifications();
  const [error, setError] = useState("");

  async function markRead(ids: string[]) {
    setError("");
    try {
      await Promise.all(
        ids.map((id) =>
          updateDoc(doc(db, `workspaces/${workspaceId}/notifications/${id}`), {
            readAt: serverTimestamp(),
          })
        )
      );
    } catch {
      setError("Could not update notifications.");
    }
  }

  const unread = items.filter((i) => !i.read);

  return (
    <section>
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
          background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-subtle) 100%)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: "1.65rem" }}>System Notifications</h1>
            {unread.length > 0 && (
              <span className="badge badge-warning">{unread.length} Unread</span>
            )}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Lifecycle notices, import alerts, weekly summary announcements, and integration health updates.
          </p>
        </div>

        {unread.length > 0 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => markRead(unread.map((i) => i.id))}
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            Mark all as read
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="error" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: "20px 24px" }}>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px" }} className="muted">
            <Icon name="check" size={32} inline accent />
            <h3 style={{ margin: "12px 0 6px", fontSize: "1.15rem", color: "var(--ink)" }}>All caught up!</h3>
            <p style={{ margin: 0, fontSize: 14 }}>
              Weekly reports, import results, and subscription notices will appear here automatically.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((i) => {
              const meta = KIND_LABELS[i.kind ?? ""] ?? { label: "System", badge: "" };

              return (
                <div
                  key={i.id}
                  style={{
                    padding: "16px 18px",
                    borderRadius: 10,
                    background: i.read ? "var(--surface)" : "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                    borderLeft: i.read
                      ? "1px solid var(--border)"
                      : i.priority === "high"
                      ? "4px solid var(--gold)"
                      : "4px solid var(--accent)",
                    opacity: i.read ? 0.72 : 1,
                    transition: "opacity 0.2s, background 0.2s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`badge ${meta.badge}`} style={{ fontSize: 11 }}>
                        {meta.label}
                      </span>
                      {i.priority === "high" && !i.read && (
                        <span className="badge badge-warning" style={{ fontSize: 11 }}>
                          Important
                        </span>
                      )}
                      <strong style={{ fontSize: 14, color: "var(--ink)" }}>{i.title}</strong>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {i.createdAtMs ? new Date(i.createdAtMs).toLocaleString() : ""}
                      </span>
                      {!i.read && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => markRead([i.id])}
                          style={{ fontSize: 12, padding: 0 }}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>

                  <p style={{ margin: 0, fontSize: 13.5, color: "var(--body)", lineHeight: 1.5 }}>
                    {i.body}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
