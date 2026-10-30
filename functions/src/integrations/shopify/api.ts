import { defineString } from "firebase-functions/params";

export const SHOPIFY_CLIENT_ID = defineString("SHOPIFY_CLIENT_ID", { default: "" });
export const SHOPIFY_API_VERSION = defineString("SHOPIFY_API_VERSION", { default: "2026-07" });
/** Public URL of the shopifyCallback function, e.g. https://us-central1-<project>.cloudfunctions.net/shopifyCallback */
export const SHOPIFY_REDIRECT_URI = defineString("SHOPIFY_REDIRECT_URI", { default: "" });
export const SHOPIFY_SCOPES = "read_orders";

export class ShopifyAuthError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GraphQL Admin API call with retry on throttling. 401/403 means the token is no longer valid. */
export async function shopifyGraphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION.value()}/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 423) throw new ShopifyAuthError(`status ${res.status}`);
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (json.errors?.some((e) => e.extensions?.code === "THROTTLED")) { await sleep(2000 * (attempt + 1)); continue; }
    if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors[0].message}`);
    return json.data as T;
  }
  throw new Error("Shopify request kept failing");
}
