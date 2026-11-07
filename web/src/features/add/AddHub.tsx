import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { getCardsByParent, type CardDef } from "../../shared/cards";
import { CardStep } from "../../components/CardStep";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
import { AddArt, BrandLogo } from "../../components/art";

interface AddHubProps {
  subview?: "root" | "connect" | "manual" | "connect.shopify";
  onNavigate: (route: string) => void;
  onOpenManualRecord?: (type: string) => void;
}

export function AddHub({ subview = "root", onNavigate, onOpenManualRecord }: AddHubProps) {
  const ws = useWorkspace();
  const [recentIds, setRecentIds] = useState<string[]>([]);

  // Listen to recent sources for this workspace (Section 9 data model)
  useEffect(() => {
    if (!ws.workspaceId) return;
    return onSnapshot(
      collection(db, `workspaces/${ws.workspaceId}/recentSources`),
      (snapshot) => {
        const items = snapshot.docs
          .map((d) => ({
            id: d.id,
            lastUsedAt: Number(d.data().lastUsedAt || 0),
          }))
          .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
          .map((i) => i.id);
        setRecentIds(items);
      },
      () => setRecentIds([])
    );
  }, [ws.workspaceId]);

  async function recordUsage(cardId: string) {
    if (!ws.workspaceId) return;
    try {
      await setDoc(
        doc(db, `workspaces/${ws.workspaceId}/recentSources/${cardId}`),
        { lastUsedAt: Date.now(), updatedAt: Date.now() },
        { merge: true }
      );
    } catch {
      // Non-fatal if offline
    }
  }

  function handleSelectCard(card: CardDef) {
    void recordUsage(card.id);

    if (card.parent === "add") {
      if (card.route) {
        onNavigate(card.route);
      }
      return;
    }

    if (card.parent === "add.connect") {
      if (card.id === "connect.shopify") {
        onNavigate("/add/connect/shopify");
      } else if (card.route) {
        onNavigate(card.route);
      }
      return;
    }

    if (card.parent === "add.manual") {
      const collMap: Record<string, string> = {
        "manual.sale": "sales",
        "manual.enquiry": "leads",
        "manual.post": "posts",
        "manual.promotion": "promotions",
        "manual.cost": "costs",
      };
      const targetColl = collMap[card.id];
      if (targetColl && onOpenManualRecord) {
        onOpenManualRecord(targetColl);
      } else if (card.route) {
        onNavigate(card.route);
      }
      return;
    }

    if (card.route) {
      onNavigate(card.route);
    }
  }

  // Subview: Shopify Connection Details
  if (subview === "connect.shopify") {
    return (
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onNavigate("/add/connect")}
            style={{
              padding: "6px 12px",
              fontSize: 12.5,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ← Back to Connectors
          </button>
        </div>
        <ConnectionsPanel />
      </div>
    );
  }

  // Subview: Connect Platform Source Tiles
  if (subview === "connect") {
    const cards = getCardsByParent("add.connect", recentIds);
    return (
      <CardStep
        title="Connect a platform"
        subtitle="Bring in orders and ad spend automatically. Connections are read-only: 7Captur never changes your ads, budgets or posts."
        art={<div style={{ display: "flex", gap: 10 }}>{["shopify", "meta", "googleads", "woocommerce"].map((b) => <span key={b} style={{ width: 46, height: 46, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center" }}><BrandLogo name={b} size={26} /></span>)}</div>}
        breadcrumbs={[
          { label: "Add", onClick: () => onNavigate("/add") },
          { label: "Connect a platform" },
        ]}
        onBack={() => onNavigate("/add")}
        cards={cards}
        onSelectCard={handleSelectCard}
      />
    );
  }

  // Subview: Manual Entry Tiles
  if (subview === "manual") {
    const cards = getCardsByParent("add.manual", recentIds);
    return (
      <CardStep
        title="Type it in"
        subtitle="Record a sale, an enquiry, a post, a promotion or a cost in a few taps. No spreadsheet needed."
        art={<AddArt size={150} />}
        breadcrumbs={[
          { label: "Add", onClick: () => onNavigate("/add") },
          { label: "Type it in" },
        ]}
        onBack={() => onNavigate("/add")}
        cards={cards}
        onSelectCard={handleSelectCard}
      />
    );
  }

  // Root Subview: /add
  const rootCards = getCardsByParent("add", recentIds);
  return (
    <CardStep
      title="Add your data"
      subtitle="Connect a store or ad account, import a CSV or Excel file, or type it in. Whatever fits your day. You can mix all three."
      art={<AddArt size={190} />}
      breadcrumbs={[{ label: "Add" }]}
      cards={rootCards}
      onSelectCard={handleSelectCard}
    />
  );
}

