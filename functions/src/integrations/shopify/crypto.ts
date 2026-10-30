import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM. Key: 32 bytes as base64 (TOKEN_ENCRYPTION_KEY). Output: v1.iv.tag.ciphertext (base64url). */
function keyBytes(b64: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}
export function encryptToken(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyBytes(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function decryptToken(blob: string, keyB64: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad token blob");
  const d = createDecipheriv("aes-256-gcm", keyBytes(keyB64), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** OAuth callback query HMAC (hex): sorted key=value pairs joined by &, hmac excluded. */
export function verifyOAuthHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("&");
  return safeEq(createHmac("sha256", secret).update(msg).digest("hex"), hmac);
}

/** Webhook HMAC (base64) over the RAW body. */
export function verifyWebhookHmac(rawBody: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  return safeEq(createHmac("sha256", secret).update(rawBody).digest("base64"), header);
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
export function normalizeShop(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const full = s.includes(".") ? s : `${s}.myshopify.com`;
  return SHOP_RE.test(full) ? full : null;
}
export const shopSlug = (shop: string) => shop.replace(".myshopify.com", "");
