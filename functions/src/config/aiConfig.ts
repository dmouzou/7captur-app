import { getFirestore } from "firebase-admin/firestore";
import { ANTHROPIC_API_KEY } from "../config";

export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

/**
 * Claude 3.x models are retired on the Anthropic API (3.5 Sonnet 2025-10-28, Opus 3 2026-01-05, 3.5 Haiku 2026-02-19),
 * so a request to them fails. A model id saved earlier (admin panel) is mapped to the current replacement instead.
 * Source: https://platform.claude.com/docs/en/about-claude/model-deprecations
 */
export function normalizeAiModel(model?: string): string {
  if (!model) return DEFAULT_AI_MODEL;
  const m = model.trim();
  if (/^claude-3-5-sonnet/.test(m) || /^claude-3-7-sonnet/.test(m) || /^claude-3-sonnet/.test(m)) return "claude-sonnet-5-5";
  if (/^claude-3-5-haiku/.test(m) || /^claude-3-haiku/.test(m)) return "claude-haiku-5-5";
  if (/^claude-3-opus/.test(m)) return "claude-opus-5-5";
  return m;
}

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
 */
export async function getActiveAiConfig(): Promise<{ apiKey: string; model: string }> {
  try {
    const snap = await getFirestore().doc("config/ai").get();
    if (snap.exists) {
      const data = snap.data() as AiConfigData;
      const key = data.anthropicApiKey?.trim();
      const rawModel = data.model?.trim() || DEFAULT_AI_MODEL;
      const model = normalizeAiModel(rawModel);
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

  // No hardcoded or default key. Without a configured key the AI features return null and the fixed answers are used.
  const finalKey = envKey && envKey.trim().startsWith("sk-") ? envKey.trim() : "";
  return { apiKey: finalKey, model: DEFAULT_AI_MODEL };
}

export function maskApiKey(key?: string): string {
  if (!key) return "Not configured";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}••••••••${key.slice(-6)}`;
}
