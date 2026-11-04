import { describe, expect, it } from "vitest";
import { allowedWorkspaces, applyAccountPatchIf, mirrorAccountToWorkspaces, orderWorkspaces } from "../functions/src/accounts/account";
import { reserveRecommendation } from "../functions/src/recommendations/usage";
import { requireMember } from "../functions/src/workspaces/access";
import { PLANS } from "../shared/plans";

/** Minimal in-memory Firestore: documents, an ownerUid query, batches and transactions. */
function fakeDb(seed: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const ref = (path: string): any => ({
    path, id: path.split("/").pop(),
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: store.has(path), id: path.split("/").pop(), data: () => store.get(path) }),
    set: async (v: Record<string, unknown>, o?: { merge?: boolean }) => { store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...v } : v); },
  });
  const db: any = {
    doc: (p: string) => ref(p),
    collection: (name: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && k.split("/").length === 2 && v[field] === value)
            .map(([k, v]) => ({ id: k.split("/")[1], ref: ref(k), data: () => v })),
        }),
      }),
    }),
    batch: () => {
      const ops: (() => void)[] = [];
      return { update: (r: { path: string }, v: Record<string, unknown>) => ops.push(() => store.set(r.path, { ...(store.get(r.path) ?? {}), ...v })), commit: async () => ops.forEach((f) => f()) };
    },
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (r: { path: string }) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
      set: (r: { path: string }, v: Record<string, unknown>, o?: { merge?: boolean }) => store.set(r.path, o?.merge ? { ...(store.get(r.path) ?? {}), ...v } : v),
      update: (r: { path: string }, v: Record<string, unknown>) => store.set(r.path, { ...(store.get(r.path) ?? {}), ...v }),
    }),
  };
  return { db, store };
}
const ts = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const threeWorkspaces = () => ({
  "workspaces/a": { ownerUid: "u1", createdAt: ts("2026-01-01"), plan: "starter" },
  "workspaces/b": { ownerUid: "u1", createdAt: ts("2026-02-01"), plan: "starter" },
  "workspaces/c": { ownerUid: "u1", createdAt: ts("2026-03-01"), plan: "starter" },
  "workspaces/other": { ownerUid: "u2", createdAt: ts("2026-01-01"), plan: "starter" },
});

describe("account-level plan", () => {
  it("Growth: 3 workspaces, 7 connections each, 15 recommendations a week", () => {
    expect(PLANS.growth.maxBusinesses).toBe(3);
    expect(PLANS.growth.maxConnections).toBe(7);
    expect(PLANS.growth.recommendations.weekly).toBe(15);
    expect(PLANS.growth.weeklySummary).toBe(true);
    expect(PLANS.growth.prioritySupport).toBe(true);
    expect(allowedWorkspaces("starter")).toBe(1);
    expect(allowedWorkspaces("growth")).toBe(3);
  });

  it("mirrors the account plan to every workspace of the owner and nobody else", async () => {
    const { db, store } = fakeDb({ ...threeWorkspaces(), "accounts/u1": { plan: "growth", billingStatus: "active", primaryWorkspaceId: "a", paddleSubscriptionId: "sub_1", restrictAt: null } });
    await mirrorAccountToWorkspaces(db, "u1");
    for (const id of ["a", "b", "c"]) expect(store.get(`workspaces/${id}`)).toMatchObject({ plan: "growth", billingStatus: "active", paddleSubscriptionId: "sub_1", overLimit: false });
    expect(store.get("workspaces/other")?.plan).toBe("starter");
    expect(store.get("workspaces/other")?.overLimit).toBeUndefined();
  });

  it("a downgrade keeps the primary workspace editable and marks the rest overLimit, deleting nothing", async () => {
    const { db, store } = fakeDb({ ...threeWorkspaces(), "accounts/u1": { plan: "starter", billingStatus: "active", primaryWorkspaceId: "b" } });
    await mirrorAccountToWorkspaces(db, "u1");
    expect(store.get("workspaces/b")?.overLimit).toBe(false);
    expect(store.get("workspaces/a")?.overLimit).toBe(true);
    expect(store.get("workspaces/c")?.overLimit).toBe(true);
    expect(store.has("workspaces/a")).toBe(true);
  });

  it("orders the primary first, then oldest first", async () => {
    const docs = ["a", "b", "c"].map((id) => ({ id }) as any);
    expect(orderWorkspaces(docs, "c").map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("recommendation allowance is one weekly pool across all workspaces of the account", async () => {
    const { db, store } = fakeDb({ ...threeWorkspaces(), "accounts/u1": { plan: "growth", timezone: "UTC", primaryWorkspaceId: "a" } });
    const now = new Date("2026-11-03T10:00:00Z");
    for (let i = 0; i < 15; i++) {
      const ws = ["a", "b", "c"][i % 3];
      expect(await reserveRecommendation(db, ws, `r${i}`, now)).toMatchObject({ ok: true, duplicate: false });
    }
    expect(await reserveRecommendation(db, "b", "r-over", now)).toMatchObject({ ok: false, reason: "weekly_limit" });
    expect(await reserveRecommendation(db, "c", "r-over2", now)).toMatchObject({ ok: false, reason: "weekly_limit" });
    const week = [...store.entries()].find(([k]) => k.startsWith("accounts/u1/usage/") && k.includes("W"))![1];
    expect(week.recommendations).toBe(15);
    expect([...store.keys()].some((k) => k.startsWith("workspaces/a/usage/"))).toBe(false);
  });

  it("another owner's workspace has its own pool", async () => {
    const { db } = fakeDb({ ...threeWorkspaces(), "accounts/u1": { plan: "starter", timezone: "UTC" }, "accounts/u2": { plan: "starter", timezone: "UTC" } });
    const now = new Date("2026-11-03T10:00:00Z");
    for (let i = 0; i < 3; i++) await reserveRecommendation(db, "a", `r${i}`, now);
    expect(await reserveRecommendation(db, "b", "x", now)).toMatchObject({ ok: false, reason: "weekly_limit" });
    expect(await reserveRecommendation(db, "other", "y", now)).toMatchObject({ ok: true });
  });

  it("editing is blocked on an overLimit workspace but reading is not", async () => {
    const mk = (overLimit: boolean) => ({
      doc: (path: string) => ({
        get: async () => path.includes("/members/") ? { exists: true, data: () => ({ role: "owner", status: "active" }) } : { exists: true, data: () => ({ billingStatus: "active", overLimit }) },
      }),
    } as any);
    await expect(requireMember(mk(true), "w", "u", true)).rejects.toThrow("over your plan's workspace limit");
    await expect(requireMember(mk(true), "w", "u", false)).resolves.not.toThrow();
    await expect(requireMember(mk(false), "w", "u", true)).resolves.not.toThrow();
  });

  it("a job's patch is skipped if a Paddle event changed the account in the meantime", async () => {
    const { db, store } = fakeDb({ ...threeWorkspaces(), "accounts/u1": { plan: "growth", billingStatus: "active", primaryWorkspaceId: "a" } });
    // The job read "trialing", but the subscription went active before it wrote.
    expect(await applyAccountPatchIf(db, "u1", { billingStatus: "trialing" }, { billingStatus: "trial_expired" })).toBe(false);
    expect(store.get("accounts/u1")?.billingStatus).toBe("active");
    expect(store.get("workspaces/a")?.billingStatus).toBeUndefined();
    // Unchanged account: the patch applies and is mirrored.
    expect(await applyAccountPatchIf(db, "u1", { billingStatus: "active" }, { billingStatus: "restricted", restrictAt: null })).toBe(true);
    expect(store.get("workspaces/b")?.billingStatus).toBe("restricted");
  });
});
