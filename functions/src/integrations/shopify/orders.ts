import { localToday } from "../../shared/periods";

/** What we ask Shopify for. No customer fields on purpose: we never store customer personal data. */
export const ORDERS_QUERY = `
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt updatedAt cancelledAt test displayFinancialStatus
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      lineItems(first: 3) { nodes { title } }
    }
  }
}`;

export interface ShopifyOrderNode {
  id: string; createdAt: string; updatedAt: string; cancelledAt: string | null; test: boolean; displayFinancialStatus: string | null;
  subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
  lineItems?: { nodes: { title: string }[] };
}
export type MappedOrder =
  | { action: "skip"; id: string; reason: string }
  | { action: "upsert"; id: string; synced: { date: string; amount: number; currency: string; status: "confirmed" | "pending" | "partially_refunded" | "refunded"; refundAmount?: number; product?: string; externalUpdatedAt: string } };

const STATUS: Record<string, "confirmed" | "pending" | "partially_refunded" | "refunded" | undefined> = {
  PAID: "confirmed", PENDING: "pending", AUTHORIZED: "pending", PARTIALLY_PAID: "pending",
  PARTIALLY_REFUNDED: "partially_refunded", REFUNDED: "refunded",
};

/** Doc id from the numeric part of the GraphQL id. */
export const orderDocId = (gid: string) => `shopify_${gid.split("/").pop()}`;

/**
 * Revenue = order subtotal after discounts, excluding shipping and tax, in the shop currency.
 * Test, cancelled, voided and expired orders are skipped (and removed if previously synced).
 */
export function mapOrder(o: ShopifyOrderNode, timezone: string): MappedOrder {
  const id = orderDocId(o.id);
  if (o.test) return { action: "skip", id, reason: "test order" };
  if (o.cancelledAt) return { action: "skip", id, reason: "cancelled" };
  const status = STATUS[o.displayFinancialStatus ?? ""];
  if (!status) return { action: "skip", id, reason: `status ${o.displayFinancialStatus ?? "unknown"}` };
  const amount = Number(o.subtotalPriceSet.shopMoney.amount);
  if (!Number.isFinite(amount) || amount < 0) return { action: "skip", id, reason: "bad amount" };
  const refunded = Number(o.totalRefundedSet?.shopMoney.amount ?? 0);
  const titles = (o.lineItems?.nodes ?? []).map((n) => n.title).filter(Boolean).join(", ").slice(0, 80);
  return {
    action: "upsert", id,
    synced: {
      date: localToday(new Date(o.createdAt), timezone), amount, currency: o.subtotalPriceSet.shopMoney.currencyCode.toUpperCase(), status,
      ...(refunded > 0 ? { refundAmount: Math.min(refunded, amount) } : {}), ...(titles ? { product: titles } : {}), externalUpdatedAt: o.updatedAt,
    },
  };
}
