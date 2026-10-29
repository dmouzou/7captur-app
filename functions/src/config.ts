import { defineSecret } from "firebase-functions/params";

// Set per project with: firebase functions:secrets:set ANTHROPIC_API_KEY -P <dev|prod>. Never commit it.
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
