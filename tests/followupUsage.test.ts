import { describe, expect, it } from "vitest";
import { releaseFollowUp, reserveFollowUp } from "../functions/src/decisions/followupUsage";

/** Minimal in-memory Firestore: just enough surface for the reservation transaction. */
function fakeDb(plan: string) {
  const store = new Map<string, Record<string, unknown>>([["workspaces/w1", { plan, timezone: "UTC" }]]);
  const ref = (path: string): any => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const snap = (path: string) => ({ exists: store.has(path), data: () => store.get(path) });
  const db: any = {
    doc: (p: string) => ref(p),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (r: { path: string }) => snap(r.path),
      set: (r: { path: string }, v: Record<string, unknown>, o?: { merge?: boolean }) => store.set(r.path, o?.merge ? { ...(store.get(r.path) ?? {}), ...v } : v),
      update: (r: { path: string }, v: Record<string, unknown>) => store.set(r.path, { ...(store.get(r.path) ?? {}), ...v }),
    }),
  };
  return { db, store };
}
const now = new Date("2026-11-03T10:00:00Z");

describe("AI follow-up credits", () => {
  it("Starter: 3 per decision, then blocked; another decision still has monthly credits", async () => {
    const { db } = fakeDb("starter");
    for (let i = 0; i < 3; i++) expect(await reserveFollowUp(db, "w1", "d1", `req-${i}`, now)).toEqual({ ok: true, duplicate: false });
    expect(await reserveFollowUp(db, "w1", "d1", "req-x", now)).toMatchObject({ ok: false, reason: "decision_limit", limit: 3 });
    expect(await reserveFollowUp(db, "w1", "d2", "req-y", now)).toEqual({ ok: true, duplicate: false });
  });

  it("Starter: monthly pool of 10 across decisions", async () => {
    const { db } = fakeDb("starter");
    for (let i = 0; i < 10; i++) expect((await reserveFollowUp(db, "w1", `d${Math.floor(i / 3)}`, `req-${i}`, now)).ok).toBe(true);
    expect(await reserveFollowUp(db, "w1", "d9", "req-z", now)).toMatchObject({ ok: false, reason: "monthly_limit", limit: 10 });
  });

  it("Growth: 10 per decision, 100 per month", async () => {
    const { db } = fakeDb("growth");
    for (let i = 0; i < 10; i++) expect((await reserveFollowUp(db, "w1", "d1", `req-${i}`, now)).ok).toBe(true);
    expect(await reserveFollowUp(db, "w1", "d1", "req-11", now)).toMatchObject({ ok: false, reason: "decision_limit", limit: 10 });
  });

  it("is idempotent on requestId and does not touch recommendation counters", async () => {
    const { db, store } = fakeDb("starter");
    await reserveFollowUp(db, "w1", "d1", "req-1", now);
    expect(await reserveFollowUp(db, "w1", "d1", "req-1", now)).toEqual({ ok: true, duplicate: true });
    const month = [...store.entries()].find(([k]) => k.startsWith("workspaces/w1/usage/"))![1];
    expect(month.aiFollowUps).toBe(1);
    expect(month.recommendations).toBeUndefined();
  });

  it("release gives the credit back, and twice is safe", async () => {
    const { db, store } = fakeDb("starter");
    await reserveFollowUp(db, "w1", "d1", "req-1", now);
    await releaseFollowUp(db, "w1", "req-1");
    await releaseFollowUp(db, "w1", "req-1");
    expect(store.get("workspaces/w1/followupCounts/d1")?.count).toBe(0);
    expect([...store.entries()].find(([k]) => k.startsWith("workspaces/w1/usage/"))![1].aiFollowUps).toBe(0);
    expect(await reserveFollowUp(db, "w1", "d1", "req-2", now)).toEqual({ ok: true, duplicate: false });
  });
});
