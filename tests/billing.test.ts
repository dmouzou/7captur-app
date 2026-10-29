import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cancelAtPeriodEnd, changeMode, changeSubscriptionPrice, createPortalSession, parsePriceMap, reducePaddleEvent, verifyPaddleSignature,
  type PaddleEvent,
} from "../functions/src/billing/paddle";

const secret = "pdl_ntfset_test_secret";
const sign = (body: string, ts: number, s = secret) => `ts=${ts};h1=${createHmac("sha256", s).update(`${ts}:${body}`).digest("hex")}`;

describe("verifyPaddleSignature", () => {
  const body = JSON.stringify({ event_id: "evt_1" });
  const now = 1_800_000_000_000;
  const ts = now / 1000;
  it("accepts a valid signature", () => expect(verifyPaddleSignature(body, sign(body, ts), secret, now)).toBe(true));
  it("rejects a tampered body, wrong secret, missing or malformed header", () => {
    expect(verifyPaddleSignature(body + " ", sign(body, ts), secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, ts, "other"), secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, undefined, secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, "garbage", secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, `ts=${ts};h1=zz`, secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, ts), "", now)).toBe(false);
  });
  it("rejects replays older than 5 minutes", () => {
    expect(verifyPaddleSignature(body, sign(body, ts - 301), secret, now)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, ts - 299), secret, now)).toBe(true);
  });
  it("accepts any matching h1 (secret rotation)", () => {
    const good = sign(body, ts).split(";")[1];
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${"0".repeat(64)};${good}`, secret, now)).toBe(true);
  });
});

const cfg = { priceMap: parsePriceMap('{"pri_s":"starter","pri_g":"growth","pri_p":"pro_scale","pri_bad":"nonsense","pri_free":"free"}'), graceDays: 7 };
const ev = (type: string, status: string, at: string, o: Partial<PaddleEvent["data"]> = {}): PaddleEvent => ({
  event_id: "evt_" + Math.random(), event_type: type, occurred_at: at,
  data: { id: "sub_1", status, customer_id: "ctm_1", custom_data: { workspaceId: "ws1" }, items: [{ price: { id: "pri_g" } }], ...o },
});

describe("parsePriceMap", () => {
  it("keeps only known paid plans and survives bad JSON", () => {
    expect(cfg.priceMap).toEqual({ pri_s: "starter", pri_g: "growth", pri_p: "pro_scale" });
    expect(parsePriceMap("not json")).toEqual({});
  });
});

describe("reducePaddleEvent", () => {
  it("activates the mapped plan", () => {
    const r = reducePaddleEvent(ev("subscription.created", "active", "2026-11-01T00:00:00Z"), {}, cfg);
    expect(r).toMatchObject({ action: "apply", workspace: { plan: "growth", billingStatus: "active", restrictAt: null } });
  });
  it("never trusts an unknown price: plan unchanged", () => {
    expect(reducePaddleEvent(ev("subscription.updated", "active", "2026-11-01T00:00:00Z", { items: [{ price: { id: "pri_unknown" } }] }), {}, cfg))
      .toEqual({ action: "ignore", reason: "unmapped_price" });
  });
  it("ignores out-of-order (older) events", () => {
    expect(reducePaddleEvent(ev("subscription.updated", "active", "2026-11-01T00:00:00Z"), { lastEventAt: "2026-11-02T00:00:00Z" }, cfg))
      .toEqual({ action: "ignore", reason: "stale_event" });
  });
  it("past due: keeps plan during grace, sets restrict date once, never extends it", () => {
    const first = reducePaddleEvent(ev("subscription.past_due", "past_due", "2026-11-01T00:00:00.000Z"), {}, cfg);
    expect(first).toMatchObject({ action: "apply", workspace: { plan: "growth", billingStatus: "past_due", restrictAt: "2026-11-08T00:00:00.000Z" } });
    const again = reducePaddleEvent(ev("subscription.updated", "past_due", "2026-11-03T00:00:00.000Z"), { pastDueSince: "2026-11-01T00:00:00.000Z", restrictAt: "2026-11-08T00:00:00.000Z", lastEventAt: "2026-11-01T00:00:00.000Z" }, cfg);
    expect(again).toMatchObject({ workspace: { restrictAt: "2026-11-08T00:00:00.000Z" } });
  });
  it("recovery from past due clears the restriction", () => {
    const r = reducePaddleEvent(ev("subscription.updated", "active", "2026-11-04T00:00:00Z"), { pastDueSince: "2026-11-01T00:00:00Z", restrictAt: "2026-11-08T00:00:00Z" }, cfg);
    expect(r).toMatchObject({ workspace: { billingStatus: "active", restrictAt: null } });
  });
  it("scheduled cancellation keeps access until the effective date", () => {
    const r = reducePaddleEvent(ev("subscription.updated", "active", "2026-11-01T00:00:00Z", { scheduled_change: { action: "cancel", effective_at: "2026-12-01T00:00:00Z" } }), {}, cfg);
    expect(r).toMatchObject({ notify: "subscription_ending", workspace: { plan: "growth", billingStatus: "canceling", restrictAt: "2026-12-01T00:00:00Z" } });
  });
  it("canceled and paused drop to free, data untouched", () => {
    expect(reducePaddleEvent(ev("subscription.canceled", "canceled", "2026-12-01T00:00:00Z"), {}, cfg)).toMatchObject({ notify: "subscription_ended", workspace: { plan: "free", billingStatus: "canceled" } });
    expect(reducePaddleEvent(ev("subscription.paused", "paused", "2026-12-01T00:00:00Z"), {}, cfg)).toMatchObject({ workspace: { plan: "free", billingStatus: "paused" } });
  });
  it("payment failure notifies; other events are ignored", () => {
    expect(reducePaddleEvent(ev("transaction.payment_failed", "", "2026-11-01T00:00:00Z"), {}, cfg)).toEqual({ action: "notify_only", notify: "payment_failed" });
    expect(reducePaddleEvent(ev("customer.updated", "", "2026-11-01T00:00:00Z"), {}, cfg)).toEqual({ action: "ignore", reason: "unhandled_event" });
  });
});

describe("plan change mode", () => {
  it("upgrade prorates now, downgrade bills the new price next period", () => {
    expect(changeMode("starter", "growth")).toBe("prorated_immediately");
    expect(changeMode("growth", "starter")).toBe("full_next_billing_period");
    expect(changeMode("pro_growth", "pro_scale")).toBe("prorated_immediately");
  });
});

describe("Paddle API helpers", () => {
  const mk = (status: number, json: unknown, spy?: (url: string, init: any) => void) =>
    (async (url: string, init: any) => { spy?.(url, init); return new Response(JSON.stringify(json), { status }); }) as unknown as typeof fetch;
  it("portal session uses the sandbox host and returns the URL", async () => {
    let seen = "";
    const url = await createPortalSession("sandbox", "k", "ctm_1", "sub_1", mk(200, { data: { urls: { general: { overview: "https://x/portal" } } } }, (u) => (seen = u)));
    expect(url).toBe("https://x/portal");
    expect(seen).toBe("https://sandbox-api.paddle.com/customers/ctm_1/portal-sessions");
  });
  it("production host, plan change and cancel payloads, failures return false/null", async () => {
    let body: any, urlSeen = "";
    expect(await changeSubscriptionPrice("production", "k", "sub_1", "pri_g", "prorated_immediately", mk(200, {}, (u, i) => { urlSeen = u; body = JSON.parse(i.body); }))).toBe(true);
    expect(urlSeen).toBe("https://api.paddle.com/subscriptions/sub_1");
    expect(body).toEqual({ items: [{ price_id: "pri_g", quantity: 1 }], proration_billing_mode: "prorated_immediately" });
    let cancelBody: any;
    expect(await cancelAtPeriodEnd("sandbox", "k", "sub_1", mk(200, {}, (_u, i) => (cancelBody = JSON.parse(i.body))))).toBe(true);
    expect(cancelBody).toEqual({ effective_from: "next_billing_period" });
    expect(await changeSubscriptionPrice("sandbox", "k", "sub_1", "p", "x", mk(400, {}))).toBe(false);
    expect(await createPortalSession("sandbox", "k", "c", "s", mk(500, {}))).toBeNull();
  });
});
