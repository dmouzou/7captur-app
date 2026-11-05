import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { assistantInput, classifyQuestion, type AssistantInput, type AssistantResult } from "../shared/assistant";
import { requireMember } from "../workspaces/access";
import { ensureAccountForWorkspace } from "../accounts/account";
import { ANTHROPIC_API_KEY } from "../config";
import { answerIntent, fallbackAnswer } from "./answers";
import { loadFacts, type Facts } from "./facts";
import { askAssistantModel, type AssistantAiResult } from "./model";
import { addAssistantTokens, confirmAssistant, releaseAssistant, reserveAssistant, storedAssistantAnswer } from "./usage";

export interface AssistantDeps {
  loadFacts?: (db: Firestore, a: Parameters<typeof loadFacts>[1]) => Promise<Facts>;
  askModel?: (facts: Facts, question: string) => Promise<AssistantAiResult | null>;
  ensureAccount?: (db: Firestore, workspaceId: string) => Promise<unknown>;
  now?: Date;
}

/**
 * Order: authorize, build facts on the server, route. A fixed answer is free. A free-form question reserves one
 * AI credit BEFORE the model call and gives it back if the model fails or its answer is rejected.
 */
export async function runAssistant(db: Firestore, uid: string, input: AssistantInput, deps: AssistantDeps = {}): Promise<AssistantResult> {
  const { workspaceId, businessId, requestId, question, screen, context } = input;
  const load = deps.loadFacts ?? loadFacts;
  const ask = deps.askModel ?? ((f, q) => askAssistantModel(f, q));
  const intent = classifyQuestion(question);

  // Fixed answers work for every member, including viewers and read-only workspaces.
  await requireMember(db, workspaceId, uid, false);
  const facts = await load(db, { workspaceId, businessId, screen, context, now: deps.now });
  const monthly = facts.usage.aiCreditsMonthly;

  if (intent !== "free_form") {
    return { answer: answerIntent(intent, facts), source: "engine", intent, creditsUsed: 0, creditsLeft: Math.max(0, monthly - facts.usage.aiCreditsUsed), creditsMonthly: monthly };
  }

  // Free-form: AI. Needs the same permission as other AI features (editor or owner, workspace not read-only).
  await requireMember(db, workspaceId, uid, true);
  await (deps.ensureAccount ?? ensureAccountForWorkspace)(db, workspaceId);
  const reservation = await reserveAssistant(db, workspaceId, requestId, deps.now);
  if (!reservation.ok) {
    throw new HttpsError("resource-exhausted", `You have used all ${reservation.limit} AI credits for this month. They reset on ${reservation.resetsOn}. Fixed answers about your data and 7Captur still work and are free.`, {
      reason: reservation.reason, resetsOn: reservation.resetsOn, limit: reservation.limit,
    });
  }
  if (reservation.duplicate) {
    const stored = await storedAssistantAnswer(db, workspaceId, requestId);
    if (stored) return { answer: stored, source: "ai", intent, creditsUsed: 1, creditsLeft: Math.max(0, reservation.limit - reservation.used), creditsMonthly: reservation.limit, duplicate: true };
  }

  try {
    const result = await ask(facts, question);
    if (result?.text) {
      await confirmAssistant(db, workspaceId, requestId, result.text, result.tokens);
      return { answer: result.text, source: "ai", intent, creditsUsed: 1, creditsLeft: Math.max(0, reservation.limit - reservation.used), creditsMonthly: reservation.limit };
    }
    await releaseAssistant(db, workspaceId, requestId);
    if (result) await addAssistantTokens(db, workspaceId, requestId, result.tokens).catch(() => undefined);
    return { answer: fallbackAnswer(facts), source: "engine", intent, creditsUsed: 0, creditReturned: true, creditsLeft: Math.max(0, reservation.limit - (reservation.used - 1)), creditsMonthly: reservation.limit };
  } catch (err) {
    logger.error("askAssistant failed", { workspaceId, err: String(err) });
    await releaseAssistant(db, workspaceId, requestId);
    throw new HttpsError("internal", "Could not answer that question. Your AI credit was not used.");
  }
}

export const askAssistant = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 45 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = assistantInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  return runAssistant(getFirestore(), uid, parsed.data);
});
