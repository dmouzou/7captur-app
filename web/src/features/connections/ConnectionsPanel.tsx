import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { PLANS } from "../../shared/plans";

interface Account { customerId: string; name: string; currency: string }
interface Conn { id: string; provider: string; shop: string; label: string; accounts: Account[]; status: string; lastSyncedMs: number | null; lastError: string | null; partial: boolean }

const CATALOG: [string, string][] = [
  ["Shopify orders", "Direct connection available"],
  ["Google Ads (spend, clicks, impressions)", "Direct connection available"],
  ["Meta Ads (Facebook, Instagram)", "Import supported (Ads Manager CSV export)"],
  ["TikTok Ads", "Import supported (CSV)"],
  ["Organic posts (Instagram, Facebook, TikTok)", "Manual tracking supported"],
  ["WhatsApp and DM enquiries", "Manual tracking supported"],
  ["WooCommerce", "Planned"],
];

export function ConnectionsPanel() {
  const ws = useWorkspace();
  const [conns, setConns] = useState<Conn[]>([]);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const autoSynced = useRef(false);
  const limit = PLANS[ws.plan].maxConnections;

  useEffect(() => onSnapshot(collection(db, `workspaces/${ws.workspaceId}/connections`), (s) => setConns(s.docs.map((d) => {
    const x = d.data();
    return { id: d.id, provider: x.provider, shop: x.shop ?? "", label: x.provider === "google_ads" ? `Google Ads: ${x.accountName ?? x.customerId ?? ""}` : x.shop ?? "", accounts: (x.accounts as Account[] | undefined) ?? [], status: x.status, lastSyncedMs: x.lastSyncedAt?.toMillis?.() ?? null, lastError: x.lastError ?? null, partial: Boolean(x.partialSync) };
  })), () => setConns([])), [ws.workspaceId]);

  const active = conns.filter((c) => c.status === "connected" || c.status === "needs_reconnect");

  async function sync(id: string, quiet = false) {
    setError(""); if (!quiet) setNote(""); setBusy(`sync_${id}`);
    const google = conns.find((c) => c.id === id)?.provider === "google_ads";
    try {
      const r = await httpsCallable<unknown, { upserted: number }>(functions, google ? "syncGoogleAdsNow" : "syncShopifyNow")({ workspaceId: ws.workspaceId, connectionId: id });
      setNote(`Synced ${r.data.upserted} ${google ? "daily campaign record" : "order"}${r.data.upserted === 1 ? "" : "s"}.`);
    } catch (e) { setError((e as { message?: string }).message ?? "Sync failed."); }
    finally { setBusy(""); }
  }

  // Right after returning from Shopify, run the first sync once.
  useEffect(() => {
    const gflag = new URLSearchParams(window.location.search).get("googleads");
    if (gflag) {
      if (gflag !== "choose_account") setError({ denied: "Google access was not approved.", no_accounts: "No Google Ads accounts were found for that Google login.", no_refresh: "Google did not grant offline access. Try again and approve everything.", scope_missing: "Google did not grant Ads access. Try again and approve the permission." }[gflag] ?? "Could not connect Google Ads. Try again.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    const flag = new URLSearchParams(window.location.search).get("shopify");
    if (!flag) return;
    if (flag === "connected") {
      const fresh = conns.find((c) => c.provider === "shopify" && c.status === "connected" && !c.lastSyncedMs);
      if (fresh && !autoSynced.current) { autoSynced.current = true; window.history.replaceState({}, "", window.location.pathname); void sync(fresh.id); }
    } else {
      setError(flag === "scope_missing" ? "Shopify did not grant order access. Try again and approve the permission." : "Could not connect your store. Try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conns]);

  async function connect() {
    setError(""); setNote(""); setBusy("connect");
    try {
      const r = await httpsCallable<unknown, { url: string }>(functions, "startShopifyConnect")({ workspaceId: ws.workspaceId, businessId: ws.businessId, shop });
      window.location.assign(r.data.url);
    } catch (e) { setError((e as { message?: string }).message ?? "Could not start the connection."); setBusy(""); }
  }
  async function connectGoogle() {
    setError(""); setNote(""); setBusy("connect_google");
    try {
      const r = await httpsCallable<unknown, { url: string }>(functions, "startGoogleAdsConnect")({ workspaceId: ws.workspaceId, businessId: ws.businessId });
      window.location.assign(r.data.url);
    } catch (e) { setError((e as { message?: string }).message ?? "Could not start the connection."); setBusy(""); }
  }
  async function chooseAccount(pendingId: string, customerId: string) {
    setError(""); setBusy(`choose_${customerId}`);
    try {
      const r = await httpsCallable<unknown, { connectionId: string }>(functions, "selectGoogleAdsAccount")({ workspaceId: ws.workspaceId, pendingId, customerId });
      void sync(r.data.connectionId);
    } catch (e) { setError((e as { message?: string }).message ?? "Could not connect that account."); setBusy(""); }
  }
  async function disconnect(c: Conn) {
    if (!window.confirm(`Disconnect ${c.label}? Data already synced stays in your records, labelled as connected data. New data stops syncing.`)) return;
    setError(""); setBusy(`d_${c.id}`);
    try { await httpsCallable(functions, "disconnectIntegration")({ workspaceId: ws.workspaceId, connectionId: c.id }); }
    catch { setError("Could not disconnect. Try again."); }
    finally { setBusy(""); }
  }

  return (
    <section>
      <div className="card">
        <h2>Connections</h2>
        <p className="muted">Direct connections are read-only. 7Captur reads orders and never changes your store or your ads. We do not store customer names, emails or addresses. Your plan allows up to {limit} direct connection{limit === 1 ? "" : "s"}.</p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {conns.filter((c) => c.status === "pending_account").map((c) => (
            <li key={c.id} className="card" style={{ margin: "12px 0" }}>
              <strong>Choose the Google Ads account to connect</strong>
              {c.accounts.map((a) => (
                <div key={a.customerId} style={{ margin: "8px 0" }}>{a.name} ({a.customerId}, {a.currency}) <button type="button" disabled={!!busy} onClick={() => chooseAccount(c.id, a.customerId)}>Connect</button></div>
              ))}
              <button type="button" className="link" onClick={() => disconnect(c)}>Cancel</button>
            </li>
          ))}
          {conns.filter((c) => c.status === "connected" || c.status === "needs_reconnect").map((c) => (
            <li key={c.id} style={{ margin: "12px 0" }}>
              <strong>{c.label}</strong> · {c.status === "connected" ? "Connected" : "Needs reconnecting"}
              <div className="muted">{c.lastSyncedMs ? `Last synced ${new Date(c.lastSyncedMs).toLocaleString()}` : "Not synced yet"}{c.partial ? " · more history is still being read" : ""}</div>
              {c.lastError && <div className="error">{c.lastError}</div>}
              {c.status === "connected" && <button type="button" disabled={!!busy} onClick={() => sync(c.id)}>Sync now</button>}{" "}
              <button type="button" disabled={!!busy} onClick={() => disconnect(c)} style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }}>Disconnect</button>
            </li>
          ))}
        </ul>
        {(active.length < limit || conns.some((c) => c.status === "needs_reconnect")) && (
          <>
            <label htmlFor="shop">{conns.some((c) => c.provider === "shopify" && c.status === "needs_reconnect") ? "Reconnect your store" : "Connect a Shopify store"}</label>
            <input id="shop" value={shop} onChange={(e) => setShop(e.target.value)} placeholder="my-store.myshopify.com" autoCapitalize="none" />
            <button type="button" disabled={!!busy || !shop.trim()} onClick={connect}>Connect with Shopify</button>
            <p className="muted">Shopify shows what 7Captur can read and asks you to approve. By default Shopify exposes the last 60 days of orders to apps. Older history can come in through CSV import.</p>
          </>
        )}
        {(active.length < limit || conns.some((c) => c.provider === "google_ads" && c.status === "needs_reconnect")) && (
          <>
            <p><button type="button" disabled={!!busy} onClick={connectGoogle}>Connect Google Ads</button></p>
            <p className="muted">Read-only. We read daily campaign spend, impressions and clicks. We never change your campaigns, budgets or ads. You can disconnect any time.</p>
          </>
        )}
        <div role="alert" className="error">{error}</div>
        <div role="status" className="muted">{note}</div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>What works with what</h3>
        <ul>{CATALOG.map(([n, s]) => <li key={n}><strong>{n}</strong>: {s}</li>)}</ul>
      </div>
    </section>
  );
}
