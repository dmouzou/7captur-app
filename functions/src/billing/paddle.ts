import { createHmac, timingSafeEqual } from "node:crypto";
import { PLAN_IDS, getPlan, type PlanId } from "../shared/plans";

// ---------- Signature verification (Paddle Billing) ----------

/** Header looks like "ts=1671552777;h1=<hex>[;h1=<hex>]". Signed payload is `${ts}:${rawBody}`, HMAC-SHA256 with the endpoint secret. */
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, nowMs = Date.now(), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  let ts = "";
  const hashes: string[] = [];
  for (const part of header.split(";")) {
    const [k, v] = part.split("=");
    if (k === "ts") ts = v ?? "";
    if (k === "h1" && v) hashes.push(v);
  }
  if (!/^\d+$/.test(ts) || hashes.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest();
  return hashes.some((h) => {
    const got = Buffer.from(h, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// ---------- Event reducer ----------

export interface PaddleEvent {
  event_id: string; event_type: string; occurred_at: string;
  data: {
    id?: string; status?: string; customer_id?: string; subscription_id?: string;
    custom_data?: { workspaceId?: string } | null;
    items?: { price?: { id?: string } }[];
    current_billing_period?: { ends_at?: string } | null;
    scheduled_change?: { action?: string; effective_at?: string } | null;
  };
}
export interface PrevBilling { lastEventAt?: string; restrictAt?: string | null; pastDueSince?: string | null }
export interface ReduceConfig { priceMap: Record<string, string>; graceDays: number }
export type Notify = "payment_failed" | "subscription_ending" | "subscription_ended";

export type Reduced =
  | { action: "ignore"; reason: string }
  | { action: "notify_only"; notify: Notify }
  | {
      action: "apply"; notify?: Notify;
      workspace: { plan: PlanId; billingStatus: string; restrictAt: string | null; paddleSubscriptionId: string; paddleCustomerId: string | null };
      billing: Record<string, unknown>;
    };

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString();

export function parsePriceMap(json: string): Record<string, string> {
  try {
    const raw = JSON.parse(json) as Record<string, string>;
    return Object.fromEntries(Object.entries(raw).filter(([, plan]) => (PLAN_IDS as string[]).includes(plan) && plan !== "free"));
  } catch { return {}; }
}

export function reducePaddleEvent(ev: PaddleEvent, prev: PrevBilling, cfg: ReduceConfig): Reduced {
  if (ev.event_type === "transaction.payment_failed") return { action: "notify_only", notify: "payment_failed" };
  if (!ev.event_type.startsWith("subscription.")) return { action: "ignore", reason: "unhandled_event" };
  if (prev.lastEventAt && ev.occurred_at < prev.lastEventAt) return { action: "ignore", reason: "stale_event" };

  const d = ev.data;
  const status = d.status ?? "";
  const subId = d.id ?? "";
  if (!subId) return { action: "ignore", reason: "no_subscription_id" };
  const priceId = d.items?.find((i) => i.price?.id && cfg.priceMap[i.price.id])?.price?.id;
  const mapped = priceId ? (cfg.priceMap[priceId] as PlanId) : undefined;

  const billing: Record<string, unknown> = {
    status, subscriptionId: subId, customerId: d.customer_id ?? null, priceId: priceId ?? null,
    currentPeriodEndsAt: d.current_billing_period?.ends_at ?? null, scheduledChange: d.scheduled_change ?? null,
    lastEventAt: ev.occurred_at, lastEventId: ev.event_id,
  };
  const ws = (plan: PlanId, billingStatus: string, restrictAt: string | null, pastDueSince: string | null) => {
    billing.plan = plan; billing.pastDueSince = pastDueSince; billing.restrictAt = restrictAt;
    return { plan, billingStatus, restrictAt, paddleSubscriptionId: subId, paddleCustomerId: d.customer_id ?? null };
  };

  if (status === "active" || status === "trialing") {
    if (!mapped) return { action: "ignore", reason: "unmapped_price" };
    const canceling = d.scheduled_change?.action === "cancel" && !!d.scheduled_change.effective_at;
    return {
      action: "apply", notify: canceling ? "subscription_ending" : undefined,
      workspace: ws(mapped, canceling ? "canceling" : "active", canceling ? d.scheduled_change!.effective_at! : null, null), billing,
    };
  }
  if (status === "past_due") {
    if (!mapped) return { action: "ignore", reason: "unmapped_price" };
    // Keep the paid plan during the grace period, then restrict (enforceBilling). Grace starts at the first failure.
    const since = prev.pastDueSince ?? ev.occurred_at;
    const restrictAt = prev.pastDueSince && prev.restrictAt ? prev.restrictAt : addDaysIso(ev.occurred_at, cfg.graceDays);
    return { action: "apply", workspace: ws(mapped, "past_due", restrictAt, since), billing };
  }
  if (status === "paused") return { action: "apply", workspace: ws("free", "paused", null, null), billing };
  if (status === "canceled") return { action: "apply", notify: "subscription_ended", workspace: ws("free", "canceled", null, null), billing };
  return { action: "ignore", reason: `unknown_status_${status}` };
}

// ---------- Paddle API ----------

export const paddleBase = (env: string) => (env === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com");

async function paddleCall(
  env: string, apiKey: string, method: string, path: string, body: unknown, f: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await f(`${paddleBase(env)}${path}`, {
    method, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, json };
}

export async function createPortalSession(env: string, apiKey: string, customerId: string, subscriptionId: string, f?: typeof fetch): Promise<string | null> {
  const r = await paddleCall(env, apiKey, "POST", `/customers/${encodeURIComponent(customerId)}/portal-sessions`, { subscription_ids: [subscriptionId] }, f);
  return r.ok ? (r.json?.data?.urls?.general?.overview as string | undefined) ?? null : null;
}

/** Upgrades charge the prorated difference now. Downgrades take effect now with the new price from the next billing date. */
export function changeMode(fromPlan: string, toPlan: string): "prorated_immediately" | "full_next_billing_period" {
  const price = (p: string) => { const d = getPlan(p); return d.priceMonthly ?? d.priceMonthlyFrom ?? 0; };
  return price(toPlan) > price(fromPlan) ? "prorated_immediately" : "full_next_billing_period";
}

export async function changeSubscriptionPrice(env: string, apiKey: string, subscriptionId: string, priceId: string, mode: string, f?: typeof fetch): Promise<boolean> {
  const r = await paddleCall(env, apiKey, "PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    items: [{ price_id: priceId, quantity: 1 }], proration_billing_mode: mode,
  }, f);
  return r.ok;
}

/** Cancel at the end of the paid period. Access continues until then. */
export async function cancelAtPeriodEnd(env: string, apiKey: string, subscriptionId: string, f?: typeof fetch): Promise<boolean> {
  const r = await paddleCall(env, apiKey, "POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: "next_billing_period" }, f);
  return r.ok;
}

/** Cancel immediately (used when an account is deleted). */
export async function cancelNow(env: string, apiKey: string, subscriptionId: string, f?: typeof fetch): Promise<boolean> {
  const r = await paddleCall(env, apiKey, "POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: "immediately" }, f);
  return r.ok;
}
