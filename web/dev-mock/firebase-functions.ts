export const getFunctions = () => ({});
export const connectFunctionsEmulator = () => undefined;
const replies: Record<string, (p: any) => unknown> = {
  askAssistant: (p) => /\b(evidence|csv|stale)\b/i.test(p.question)
    ? { answer: "Your evidence level is Improve. You have 22 days of sales and spend records, and 62% of sales have a source. To reach Optimize, add the source to the remaining sales and enter your shipping cost.", source: "engine", intent: "evidence_level", creditsUsed: 0, creditsLeft: 7, creditsMonthly: 10 }
    : { answer: "Your studio tour video had the best enquiries per dollar in the last 28 days. That is an early signal, not proof, because enquiries are not yet linked to confirmed orders.", source: "ai", intent: "free_form", creditsUsed: 1, creditsLeft: 6, creditsMonthly: 10 },
};
export const httpsCallable = (_f: unknown, name: string) => async (payload: unknown) => ({ data: replies[name]?.(payload) ?? {} });
