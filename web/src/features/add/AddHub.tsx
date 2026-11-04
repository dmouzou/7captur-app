import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { getCardsByParent, type CardDef } from "../../shared/cards";
import { CardStep } from "../../components/CardStep";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";

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
        title="Connect Platforms"
        subtitle="Automate live orders, spend, and customer event synchronizations."
        breadcrumbs={[
          { label: "Add", onClick: () => onNavigate("/add") },
          { label: "Connect Platform" },
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
        title="Enter Manually"
        subtitle="Record individual commercial transactions, ad expenditures, or daily totals."
        breadcrumbs={[
          { label: "Add", onClick: () => onNavigate("/add") },
          { label: "Enter Manually" },
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
      title="Add Commercial Data"
      subtitle="Choose how you want to bring your marketing, sales, and spend numbers into 7Captur."
      breadcrumbs={[{ label: "Add" }]}
      cards={rootCards}
      onSelectCard={handleSelectCard}
    />
  );
}

