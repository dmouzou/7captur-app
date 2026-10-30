import { defineString } from "firebase-functions/params";

export const GOOGLE_OAUTH_CLIENT_ID = defineString("GOOGLE_OAUTH_CLIENT_ID", { default: "" });
/** Deployed URL of the googleAdsCallback function. Must be listed as an authorized redirect URI in Google Cloud. */
export const GOOGLE_REDIRECT_URI = defineString("GOOGLE_REDIRECT_URI", { default: "" });
export const GOOGLE_ADS_API_VERSION = defineString("GOOGLE_ADS_API_VERSION", { default: "v23" });
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

/** Refresh token rejected: the customer revoked access or it expired. */
export class GoogleAuthError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshAccessToken(refreshToken: string, clientSecret: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_OAUTH_CLIENT_ID.value(), client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (res.status === 400 || res.status === 401) throw new GoogleAuthError("refresh rejected");
  if (!res.ok) throw new Error(`token refresh ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

interface Auth { accessToken: string; developerToken: string; loginCustomerId?: string }
const headers = (a: Auth) => ({
  Authorization: `Bearer ${a.accessToken}`, "developer-token": a.developerToken, "Content-Type": "application/json",
  ...(a.loginCustomerId ? { "login-customer-id": a.loginCustomerId } : {}),
});
const base = () => `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION.value()}`;

async function request(url: string, init: RequestInit): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, init);
    if (res.status === 401) throw new GoogleAuthError("401");
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 403 && /USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(body)) throw new GoogleAuthError("403");
      throw new Error(`Google Ads HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error("Google Ads request kept failing");
}

export async function listAccessibleCustomers(a: Auth): Promise<string[]> {
  const j = (await request(`${base()}/customers:listAccessibleCustomers`, { headers: headers(a) })) as { resourceNames?: string[] };
  return (j.resourceNames ?? []).map((r) => r.replace("customers/", ""));
}

export interface GAccount { customerId: string; name: string; currency: string; timeZone: string; manager: boolean; loginCustomerId?: string }

/** Search (non-streaming, paged) so we do not have to parse a stream. */
export async function gaql<T>(a: Auth, customerId: string, query: string): Promise<T[]> {
  const out: T[] = []; let pageToken: string | undefined;
  do {
    const j = (await request(`${base()}/customers/${customerId}/googleAds:search`, {
      method: "POST", headers: headers(a), body: JSON.stringify({ query, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    })) as { results?: T[]; nextPageToken?: string };
    out.push(...(j.results ?? [])); pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

interface CustomerRow { customer: { id: string; descriptiveName?: string; manager?: boolean; currencyCode: string; timeZone: string } }
interface ClientRow { customerClient: { id: string; descriptiveName?: string; manager?: boolean; currencyCode: string; timeZone: string; status?: string } }

/** Accounts the customer can pick from: directly accessible client accounts, plus clients under any manager account they can access. */
export async function discoverAccounts(a: Auth): Promise<GAccount[]> {
  const ids = await listAccessibleCustomers(a);
  const out = new Map<string, GAccount>();
  for (const id of ids) {
    try {
      const [row] = await gaql<CustomerRow>(a, id, "SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code, customer.time_zone FROM customer LIMIT 1");
      if (!row) continue;
      const c = row.customer;
      if (!c.manager) { out.set(id, { customerId: id, name: c.descriptiveName ?? id, currency: c.currencyCode, timeZone: c.timeZone, manager: false }); continue; }
      const clients = await gaql<ClientRow>({ ...a, loginCustomerId: id }, id,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.currency_code, customer_client.time_zone, customer_client.status FROM customer_client WHERE customer_client.level <= 1 AND customer_client.manager = false AND customer_client.status = 'ENABLED'");
      for (const r of clients) {
        const k = r.customerClient;
        if (!out.has(k.id)) out.set(k.id, { customerId: k.id, name: k.descriptiveName ?? k.id, currency: k.currencyCode, timeZone: k.timeZone, manager: false, loginCustomerId: id });
      }
    } catch (e) { if (e instanceof GoogleAuthError) throw e; /* skip accounts we cannot read (cancelled, no access) */ }
  }
  return [...out.values()];
}
