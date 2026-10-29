import { defineSecret } from "firebase-functions/params";

// Set per project with: firebase functions:secrets:set ANTHROPIC_API_KEY -P <dev|prod>. Never commit it.
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Paddle (payment provider). Secrets: firebase functions:secrets:set PADDLE_WEBHOOK_SECRET / PADDLE_API_KEY
export const PADDLE_WEBHOOK_SECRET = defineSecret("PADDLE_WEBHOOK_SECRET");
export const PADDLE_API_KEY = defineSecret("PADDLE_API_KEY");
