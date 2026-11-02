import { getFirestore } from "firebase-admin/firestore";
import { ANTHROPIC_API_KEY } from "../config";

export const DEFAULT_CLAUDE_KEY = process.env.DEFAULT_CLAUDE_KEY ?? "";
export const DEFAULT_AI_MODEL = "claude-3-5-sonnet-20241022";

export interface AiConfigData {
  anthropicApiKey?: string;
  model?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Returns the active Claude API key and model.
 * Priority:
 * 1. Firestore `config/ai` (configured by Super Admin in Admin Panel)
 * 2. Secret / Environment variable ANTHROPIC_API_KEY
 * 3. Default fallback key provided in spec
 */
export async function getActiveAiConfig(): Promise<{ apiKey: string; model: string }> {
  try {
    const snap = await getFirestore().doc("config/ai").get();
    if (snap.exists) {
      const data = snap.data() as AiConfigData;
      const key = data.anthropicApiKey?.trim();
      const model = data.model?.trim() || DEFAULT_AI_MODEL;
      if (key) {
        return { apiKey: key, model };
      }
    }
  } catch {
    // fallback if Firestore read fails
  }

  // Check secret / environment
  let envKey: string | undefined;
  try {
    envKey = ANTHROPIC_API_KEY.value();
  } catch {
    envKey = process.env.ANTHROPIC_API_KEY;
  }

  const finalKey =
    envKey && envKey.trim().startsWith("sk-") ? envKey.trim() : DEFAULT_CLAUDE_KEY;
  return { apiKey: finalKey, model: DEFAULT_AI_MODEL };
}

export function maskApiKey(key?: string): string {
  if (!key) return "Not configured";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}••••••••${key.slice(-6)}`;
}
