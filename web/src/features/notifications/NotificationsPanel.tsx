import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";

interface Item { id: string; title: string; body: string; priority: string; createdAtMs: number; read: boolean }

function useNotifications(): Item[] {
  const { workspaceId } = useWorkspace();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const q = query(collection(db, `workspaces/${workspaceId}/notifications`), orderBy("createdAt", "desc"), limit(50));
    return onSnapshot(q, (s) => setItems(s.docs.map((d) => {
      const x = d.data();
      return { id: d.id, title: String(x.title ?? ""), body: String(x.body ?? ""), priority: String(x.priority ?? "normal"), createdAtMs: x.createdAt?.toMillis?.() ?? 0, read: Boolean(x.readAt) };
    })), () => setItems([]));
  }, [workspaceId]);
  return items;
}

export const useUnreadCount = () => useNotifications().filter((i) => !i.read).length;

export function NotificationsPanel() {
  const { workspaceId } = useWorkspace();
  const items = useNotifications();
  const [error, setError] = useState("");
  async function markRead(ids: string[]) {
    setError("");
    try { await Promise.all(ids.map((id) => updateDoc(doc(db, `workspaces/${workspaceId}/notifications/${id}`), { readAt: serverTimestamp() }))); }
    catch { setError("Could not update notifications."); }
  }
  const unread = items.filter((i) => !i.read);
  return (
    <section>
      <div className="card">
        <h2>Notifications</h2>
        {unread.length > 0 && <button type="button" onClick={() => markRead(unread.map((i) => i.id))}>Mark all as read</button>}
        {items.length === 0 && <p className="muted">Nothing yet. Weekly summaries, billing notices and connection problems appear here.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {items.map((i) => (
            <li key={i.id} style={{ margin: "12px 0", opacity: i.read ? 0.65 : 1 }}>
              <strong>{i.title}</strong>{i.priority === "high" && !i.read ? " · Important" : ""}
              <div className="muted">{i.createdAtMs ? new Date(i.createdAtMs).toLocaleString() : ""}</div>
              <div>{i.body}</div>
              {!i.read && <button type="button" className="link" onClick={() => markRead([i.id])}>Mark as read</button>}
            </li>
          ))}
        </ul>
        <div role="alert" className="error">{error}</div>
      </div>
    </section>
  );
}
