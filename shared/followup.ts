import { z } from "zod";

export const askAboutDecisionInput = z.object({
  workspaceId: z.string().min(1).max(128),
  decisionId: z.string().min(1).max(160),
  requestId: z.string().min(8).max(64),
  question: z.string().trim().min(3, "Ask a full question").max(500),
});
export type AskAboutDecisionInput = z.infer<typeof askAboutDecisionInput>;

export interface FollowUp {
  id: string;
  question: string;
  answer: string;
  /** "ai": written by the AI model from the saved evidence. "engine": a fixed answer built from the saved decision, no AI, no credit used. */
  source: "ai" | "engine";
  createdAt?: unknown;
}

export const FOLLOWUP_DISCLAIMER =
  "Follow-up answers are written by AI and can make mistakes. The recommendation itself comes from 7Captur's decision engine and is not changed by these answers.";
