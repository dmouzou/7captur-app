import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { askAboutDecisionInput } from "../shared/followup";
import { periodIds } from "../shared/periods";
import { requireMember } from "../workspaces/access";
import { getActiveAiConfig, normalizeAiModel } from "../config/aiConfig";
import { parseModelJson } from "../config/aiJson";
import { ANTHROPIC_API_KEY } from "../config";
import { buildFollowupPrompt, fallbackAnswer, FOLLOWUP_PROMPT_VERSION, validateAnswer, type Snapshot } from "./followupCore";
import { addAiTokens, confirmFollowUp, releaseFollowUp, reserveFollowUp } from "./followupUsage";
import { ensureAccountForWorkspace } from "../accounts/account";

const API_URL = "https://api.anthropic.com/v1/messages";

interface AiAnswer { text: string; model: string; inputTokens: number; outputTokens: number }

export async function askModel(snapshot: Snapshot, question: string, opts: { fetchImpl?: typeof fetch; model?: string; apiKey?: string } = {}): Promise<AiAnswer | { tokens: { input: number; output: number } } | null> {
  const f = opts.fetchImpl ?? fetch;
  let apiKey = opts.apiKey;
  let model = opts.model;
  if (!apiKey) { const cfg = await getActiveAiConfig(); apiKey = cfg.apiKey; model = model ?? cfg.model; }
  if (!apiKey) { logger.warn("askAboutDecision: no Anthropic API key configured"); return null; }
  model = normalizeAiModel(model);
  const { system, user } = buildFollowupPrompt(snapshot, question);
  let tokens = { input: 0, output: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await f(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logger.warn("askAboutDecision: Anthropic API returned non-200", { status: res.status, error: errText, model });
        return null;
      }
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      tokens = { input: tokens.input + (body.usage?.input_tokens ?? 0), output: tokens.output + (body.usage?.output_tokens ?? 0) };
      const raw = body.content?.find((c) => c.type === "text")?.text ?? "";
      const json = parseModelJson<{ answer?: unknown }>(raw);
      if (!json) logger.warn("askAboutDecision: reply was not JSON", { model, rawStart: raw.slice(0, 200) });
      const text = json ? validateAnswer(json.answer, snapshot, question) : null;
      if (json && !text) logger.warn("askAboutDecision: answer failed fail-closed validation", { model, answer: String(json.answer ?? "").slice(0, 400) });
      if (!text) return { tokens }; // rejected: tokens were still spent, so they are still recorded
      return { text, model: model ?? "", inputTokens: tokens.input, outputTokens: tokens.output };
    } catch (e) {
      logger.warn("askAboutDecision: request error", { err: String(e), attempt, model });
      if (attempt === 1) return tokens.input + tokens.output > 0 ? { tokens } : null;
    }
  }
  return null;
}

/**
 * Follow-up question on a saved decision. Uses AI credits (monthly pool plus a per-decision cap),
 * never recommendation credits. The model sees the decision's frozen aggregate snapshot only.
 * If the AI is unavailable or its answer fails validation, a fixed answer built from the snapshot is
 * returned and the credit is given back.
 */
export const askAboutDecision = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 45 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = askAboutDecisionInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { workspaceId, decisionId, requestId, question } = parsed.data;

  const db = getFirestore();
  await requireMember(db, workspaceId, uid, true);

  const fuRef = db.doc(`workspaces/${workspaceId}/decisions/${decisionId}/followups/${requestId}`);
  const prior = await fuRef.get();
  if (prior.exists) return { followUpId: requestId, duplicate: true };

  const dec = await db.doc(`workspaces/${workspaceId}/decisions/${decisionId}`).get();
  if (!dec.exists) throw new HttpsError("not-found", "Decision not found.");
  const snapshot = (dec.data()!.snapshot ?? null) as Snapshot | null;
  if (!snapshot) throw new HttpsError("failed-precondition", "This decision has no saved evidence to answer from.");

  await ensureAccountForWorkspace(db, workspaceId);
  const reservation = await reserveFollowUp(db, workspaceId, decisionId, requestId);
  if (!reservation.ok) {
    throw new HttpsError("resource-exhausted", reservation.reason === "decision_limit"
      ? `You have used all ${reservation.limit} follow-up questions for this decision.`
      : `You have used all ${reservation.limit} AI follow-up credits for this month. They reset on ${reservation.resetsOn}.`,
      { reason: reservation.reason, resetsOn: reservation.resetsOn });
  }
  if (reservation.duplicate) return { followUpId: requestId, duplicate: true };

  const ws = await db.doc(`workspaces/${workspaceId}`).get();
  const monthId = periodIds(new Date(), (ws.data() as { timezone: string }).timezone).monthId;
  try {
    const result = await askModel(snapshot, question);
    const ai = result && "text" in result ? result : null;
    const tokens = result ? ("tokens" in result ? result.tokens : { input: result.inputTokens, output: result.outputTokens }) : { input: 0, output: 0 };
    if (ai) {
      await fuRef.set({
        question, answer: ai.text, source: "ai", model: ai.model, promptVersion: FOLLOWUP_PROMPT_VERSION,
        inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, createdBy: uid, createdAt: FieldValue.serverTimestamp(),
      });
      await confirmFollowUp(db, workspaceId, requestId, monthId, tokens);
      return { followUpId: requestId, duplicate: false, source: "ai" };
    }
    await fuRef.set({
      question, answer: fallbackAnswer(snapshot, question), source: "engine", promptVersion: FOLLOWUP_PROMPT_VERSION,
      inputTokens: tokens.input, outputTokens: tokens.output, createdBy: uid, createdAt: FieldValue.serverTimestamp(),
    });
    await releaseFollowUp(db, workspaceId, requestId);
    if (tokens.input + tokens.output > 0) {
      await addAiTokens(db, workspaceId, requestId, monthId, tokens);
    }
    return { followUpId: requestId, duplicate: false, source: "engine" };
  } catch (err) {
    logger.error("askAboutDecision failed", { workspaceId, decisionId, err: String(err) });
    await releaseFollowUp(db, workspaceId, requestId);
    throw new HttpsError("internal", "Could not answer that question. Your credit was not used.");
  }
});
