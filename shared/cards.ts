import { z } from "zod";

export type CardStatus = "available" | "import" | "manual" | "planned";

export interface CardDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  status: CardStatus;
  route?: string; // absent for planned
  minPlan?: string; // entitlement gate, checked server-side too
  parent: "add" | "add.connect" | "add.manual" | "understand" | "decide";
}

export const cardStatusSchema = z.enum(["available", "import", "manual", "planned"]);

export const cardDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  icon: z.string(),
  status: cardStatusSchema,
  route: z.string().optional(),
  minPlan: z.string().optional(),
  parent: z.enum(["add", "add.connect", "add.manual", "understand", "decide"]),
});

export const CARDS: CardDef[] = [
  // Add root options
  {
    id: "add.connect",
    label: "Connect a platform",
    description: "Sync e-commerce stores and ad platforms automatically.",
    icon: "plug",
    status: "available",
    route: "/add/connect",
    parent: "add",
  },
  {
    id: "add.import",
    label: "Import a CSV file",
    description: "Upload sales, spend, posts, or enquiries in bulk from spreadsheets.",
    icon: "clipboard",
    status: "available",
    route: "/add/import",
    parent: "add",
  },
  {
    id: "add.manual",
    label: "Type it in",
    description: "Record a single sale, post, enquiry, promotion, or aggregate daily total.",
    icon: "pin",
    status: "available",
    route: "/add/manual",
    parent: "add",
  },

  // Add > Connect tiles
  {
    id: "connect.shopify",
    label: "Shopify",
    description: "Sync orders, revenue, customers, and refund history automatically.",
    icon: "shopify",
    status: "available",
    route: "/add/connect/shopify",
    parent: "add.connect",
  },
  {
    id: "connect.meta",
    label: "Meta Ads",
    description: "Import Facebook and Instagram ad spend, impressions, and clicks.",
    icon: "meta",
    status: "import",
    route: "/add/import",
    parent: "add.connect",
  },
  {
    id: "connect.googleads",
    label: "Google Ads",
    description: "Search, Shopping, and YouTube advertising spend and conversion attribution.",
    icon: "signal",
    status: "planned",
    parent: "add.connect",
  },
  {
    id: "connect.woocommerce",
    label: "WooCommerce",
    description: "Connect WordPress e-commerce orders, customer transactions, and catalog.",
    icon: "woocommerce",
    status: "planned",
    parent: "add.connect",
  },
  {
    id: "connect.stripe",
    label: "Stripe",
    description: "Direct subscription, charge, dispute, and customer payment streaming.",
    icon: "credit-card",
    status: "planned",
    parent: "add.connect",
  },
  {
    id: "connect.other",
    label: "Other Platform",
    description: "Export from your tool and import CSV, or log transactions directly.",
    icon: "box",
    status: "available",
    route: "/add/import",
    parent: "add.connect",
  },

  // Add > Manual tiles
  {
    id: "manual.sale",
    label: "Sale & Revenue",
    description: "Log an order, revenue transaction, or customer purchase.",
    icon: "money",
    status: "available",
    route: "/data/sales",
    parent: "add.manual",
  },
  {
    id: "manual.enquiry",
    label: "Enquiry & Lead",
    description: "Track a customer message, lead form, phone call, or consultation booking.",
    icon: "users",
    status: "available",
    route: "/data/leads",
    parent: "add.manual",
  },
  {
    id: "manual.post",
    label: "Organic Post",
    description: "Log an Instagram post, TikTok video, LinkedIn update, or newsletter.",
    icon: "camera",
    status: "available",
    route: "/data/posts",
    parent: "add.manual",
  },
  {
    id: "manual.promotion",
    label: "Paid Promotion",
    description: "Record an ad campaign, influencer collaboration, or sponsored promotion.",
    icon: "megaphone",
    status: "available",
    route: "/data/promotions",
    parent: "add.manual",
  },
  {
    id: "manual.cost",
    label: "Cost & Spend",
    description: "Record ad spend, tools, freelancer costs, or operating overhead.",
    icon: "card",
    status: "available",
    route: "/data/costs",
    parent: "add.manual",
  },
  {
    id: "manual.aggregate",
    label: "Aggregate Entry",
    description: "Shortcut for daily or weekly summarized revenue, spend, and enquiries.",
    icon: "bars",
    status: "available",
    route: "/add/import",
    parent: "add.manual",
  },
];

export function getCardsByParent(parent: CardDef["parent"], recentIds: string[] = []): CardDef[] {
  const cards = CARDS.filter((c) => c.parent === parent);
  if (recentIds.length === 0) return cards;
  const recentSet = new Map<string, number>(recentIds.map((id, index) => [id, index]));
  return [...cards].sort((a, b) => {
    const aIdx = recentSet.has(a.id) ? recentSet.get(a.id)! : 9999;
    const bIdx = recentSet.has(b.id) ? recentSet.get(b.id)! : 9999;
    return aIdx - bIdx;
  });
}

