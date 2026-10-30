import { defineSecret } from "firebase-functions/params";

// Set per project with: firebase functions:secrets:set ANTHROPIC_API_KEY -P <dev|prod>. Never commit it.
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Paddle (payment provider). Secrets: firebase functions:secrets:set PADDLE_WEBHOOK_SECRET / PADDLE_API_KEY
export const PADDLE_WEBHOOK_SECRET = defineSecret("PADDLE_WEBHOOK_SECRET");
export const PADDLE_API_KEY = defineSecret("PADDLE_API_KEY");

// Shopify (public app). Secrets: SHOPIFY_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY (32 random bytes, base64: `openssl rand -base64 32`).
export const SHOPIFY_CLIENT_SECRET = defineSecret("SHOPIFY_CLIENT_SECRET");
export const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");
