import { z } from "zod";

/**
 * The 7Captur assistant is a hybrid:
 *  - Questions about your data and about 7Captur are answered by fixed rules from your real numbers. Free, no AI.
 *  - Anything else goes to an AI model that sees only a small summary of your workspace. It uses 1 AI credit.
 * Both the browser and the server call classifyQuestion, so the notice the user sees before sending
 * always matches what the server does.
 */
export const assistantInput = z.object({
  workspaceId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128),
  requestId: z.string().min(8).max(64),
  question: z.string().trim().min(3, "Ask a full question").max(500),
  /** The screen the user is on (for example "understand" or "decisions"). Only selects which facts are relevant. */
  screen: z.string().trim().min(1).max(60),
  /** Optional open item. Always re-checked on the server against the workspace. */
  context: z.object({ kind: z.enum(["recommendation", "decision"]), id: z.string().min(1).max(160) }).optional(),
});
export type AssistantInput = z.infer<typeof assistantInput>;

export type Intent =
  | "evidence_level"
  | "stale_data"
  | "csv_import"
  | "connectors"
  | "what_changed"
  | "guardrails"
  | "why_priority"
  | "data_gaps"
  | "unknowns"
  | "next_step"
  | "credits"
  | "overview";

export type Classified = Intent | "free_form";

/** Order matters: the most specific patterns come first. */
const RULES: [Intent, RegExp][] = [
  ["csv_import", /\b(csv|import|upload|spreadsheet|xlsx|file size|column|delimiter)\b/i],
  ["credits", /\b(ai credits?|follow-?up credits?|recommendation credits?|credits?|allowance|how many (questions|recommendations))\b/i],
  ["stale_data", /\b(stale|fresh(ness)?|14[- ]day|out of date|outdated|refresh)\b/i],
  ["evidence_level", /\b(evidence (level|stage)|explore|improve|optimi[sz]e|unlock|next level)\b/i],
  ["connectors", /\b(connect(or|ors|ion|ions|ed)?|integrations?|shopify|meta ads|google ads|woocommerce|stripe)\b/i],
  ["what_changed", /\b(what changed|this week|last week|weekly|since last|new this)\b/i],
  ["guardrails", /\b(guardrails?|do not act|when (not )?to act|safe to|risks?)\b/i],
  ["unknowns", /\b(unknowns?|assumptions?|not known|what do(n'?t| not) (we|you) know)\b/i],
  ["data_gaps", /\b(missing|data health|gaps?|fix first|incomplete|attribution)\b/i],
  ["next_step", /\b(what should i (do|record|add|log)|next (step|measurement)|record next|what to record)\b/i],
  ["why_priority", /\b(why (is|was|did|do)\b.*\b(recommend|priorit|decision|this|suggest)|priorit(y|ized|ised)|why this)\b/i],
  ["overview", /\b(overview|status|how am i doing|workspace summary|summar(y|ize|ise) (my )?workspace|executive)\b/i],
];

export function classifyQuestion(question: string): Classified {
  const q = question.trim();
  for (const [intent, re] of RULES) if (re.test(q)) return intent;
  return "free_form";
}

export type AssistantSource = "engine" | "ai";

export interface AssistantResult {
  answer: string;
  source: AssistantSource;
  intent: Classified;
  /** 1 only when an AI answer was delivered. Fixed answers never use a credit. */
  creditsUsed: 0 | 1;
  /** True when an AI answer failed or was rejected and the credit was given back. */
  creditReturned?: boolean;
  creditsLeft: number;
  creditsMonthly: number;
  duplicate?: boolean;
}

export const ASSISTANT_AI_DISCLAIMER =
  "AI answers can make mistakes. They use only a short summary of your workspace, and they never change your recommendations or your ad accounts.";

export function aiNoticeText(left: number, monthly: number): string {
  return `This answer is written by AI and uses 1 of your ${monthly} AI credits this month (${left} left). Fixed answers about your data and 7Captur are free.`;
}
