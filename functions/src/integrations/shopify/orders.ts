import { localToday } from "../../shared/periods";

/** What we ask Shopify for. No customer fields on purpose: we never store customer personal data. */
export const ORDERS_QUERY = `
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt test displayFinancialStatus
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      lineItems(first: 3) { nodes { title } }
    }
  }
}`;

export interface ShopifyOrderNode {
  id: string; name?: string; createdAt: string; updatedAt: string; cancelledAt: string | null; test: boolean; displayFinancialStatus: string | null;
  subtotalPriceSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
  totalPriceSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
  totalRefundedSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
  lineItems?: { nodes: { title: string }[] };
}
export type MappedOrder =
  | { action: "skip"; id: string; reason: string }
  | { action: "upsert"; id: string; synced: { date: string; orderNumber?: string; amount: number; currency: string; status: "confirmed" | "pending" | "partially_refunded" | "refunded"; refundAmount?: number; product?: string; externalUpdatedAt: string } };

const STATUS: Record<string, "confirmed" | "pending" | "partially_refunded" | "refunded" | undefined> = {
  PAID: "confirmed", PENDING: "pending", AUTHORIZED: "pending", PARTIALLY_PAID: "pending",
  PARTIALLY_REFUNDED: "partially_refunded", REFUNDED: "refunded",
};

/** Doc id from the numeric part of the GraphQL id. */
export const orderDocId = (gid: string) => `shopify_${gid.split("/").pop()}`;

/**
 * Revenue = order subtotal after discounts, excluding shipping and tax, in the shop currency.
 * Test orders are permitted in dev/test stores; cancelled, voided and expired orders are skipped.
 */
export function mapOrder(o: ShopifyOrderNode, timezone: string, opts?: { allowTestOrders?: boolean }): MappedOrder {
  const id = orderDocId(o.id);
  const allowTest = opts?.allowTestOrders ?? (process.env.SHOPIFY_ALLOW_TEST_ORDERS === "true" && process.env.NODE_ENV !== "test");
  if (o.test && !allowTest) return { action: "skip", id, reason: "test order" };
  if (o.cancelledAt) return { action: "skip", id, reason: "cancelled" };
  const status = STATUS[o.displayFinancialStatus ?? ""];
  if (!status) return { action: "skip", id, reason: `status ${o.displayFinancialStatus ?? "unknown"}` };
  const rawMoney = o.subtotalPriceSet?.shopMoney ?? o.totalPriceSet?.shopMoney;
  const amount = Number(rawMoney?.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) return { action: "skip", id, reason: "bad amount" };
  const currency = (rawMoney?.currencyCode ?? "USD").toUpperCase();
  const refunded = Number(o.totalRefundedSet?.shopMoney.amount ?? 0);
  const titles = (o.lineItems?.nodes ?? []).map((n) => n.title).filter(Boolean).join(", ").slice(0, 80);
  return {
    action: "upsert", id,
    synced: {
      date: localToday(new Date(o.createdAt), timezone),
      ...(o.name ? { orderNumber: o.name } : {}),
      amount,
      currency,
      status,
      ...(refunded > 0 ? { refundAmount: Math.min(refunded, amount) } : {}),
      ...(titles ? { product: titles } : {}),
      externalUpdatedAt: o.updatedAt,
    },
  };
}
