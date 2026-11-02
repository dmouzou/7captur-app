import { describe, expect, it } from "vitest";
import { processWorkspaceTrial } from "../functions/src/billing/trialLifecycle";
import { requireMember } from "../functions/src/workspaces/access";

describe("Trial Lifecycle Scheduler (Spec 3)", () => {
  const mkDb = () => {
    const writes: { path: string; data: any; type: string }[] = [];
    const mailDocs = new Map<string, any>();
    const notifDocs = new Map<string, any>();
    const wsDocs = new Map<string, any>();

    const db: any = {
      collection: (coll: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: coll === "mail" ? mailDocs.has(id) : notifDocs.has(id),
            data: () => (coll === "mail" ? mailDocs.get(id) : notifDocs.get(id)),
          }),
          create: async (data: any) => {
            if (coll === "mail" && mailDocs.has(id)) throw { code: 6 }; // ALREADY_EXISTS
            if (coll === "mail") mailDocs.set(id, data);
            else notifDocs.set(id, data);
            writes.push({ path: `${coll}/${id}`, data, type: "create" });
          },
          set: async (data: any, opts: any) => {
            writes.push({ path: `${coll}/${id}`, data, type: "set" });
          },
        }),
      }),
      doc: (path: string) => ({
        get: async () => ({
          exists: wsDocs.has(path),
          data: () => wsDocs.get(path),
        }),
        update: async (data: any) => {
          writes.push({ path, data, type: "update" });
          wsDocs.set(path, { ...(wsDocs.get(path) ?? {}), ...data });
        },
        create: async (data: any) => {
          writes.push({ path, data, type: "create" });
          wsDocs.set(path, data);
        },
        set: async (data: any, opts: any) => {
          writes.push({ path, data, type: "set" });
          wsDocs.set(path, data);
        },
      }),
      _writes: writes,
      _mail: mailDocs,
      _notif: notifDocs,
      _ws: wsDocs,
    };
    return db;
  };

  it("sends reminder on day 10 (4 days before trial end)", async () => {
    const db = mkDb();
    const now = new Date("2026-11-10T12:00:00Z");
    // Trial ends on 2026-11-14 (4 days out = day 10 of trial)
    const trialEndsAt = new Date("2026-11-14T12:00:00Z");
    const ws = {
      id: "ws_trial_10",
      name: "Test Store",
      ownerUid: "u1",
      ownerEmail: "owner@example.com",
      plan: "starter",
      billingStatus: "trialing",
      trialEndsAt: { toDate: () => trialEndsAt, toMillis: () => trialEndsAt.getTime() } as any,
    };

    await processWorkspaceTrial(db, ws, now);

    // Expect mail doc created with idempotent key
    expect(db._writes.some((w: any) => w.path === "mail/trial_reminder_10_ws_trial_10")).toBe(true);
    // Expect in-app notification doc created
    expect(db._writes.some((w: any) => w.path.includes("trial_reminder_10"))).toBe(true);
  });

  it("sends reminder on day 13 (1 day before trial end)", async () => {
    const db = mkDb();
    const now = new Date("2026-11-13T12:00:00Z");
    // Trial ends on 2026-11-14 (1 day out = day 13 of trial)
    const trialEndsAt = new Date("2026-11-14T12:00:00Z");
    const ws = {
      id: "ws_trial_13",
      name: "Test Store",
      ownerUid: "u1",
      ownerEmail: "owner@example.com",
      plan: "starter",
      billingStatus: "trialing",
      trialEndsAt: { toDate: () => trialEndsAt, toMillis: () => trialEndsAt.getTime() } as any,
    };

    await processWorkspaceTrial(db, ws, now);

    expect(db._writes.some((w: any) => w.path === "mail/trial_reminder_13_ws_trial_13")).toBe(true);
  });

  it("sets trial_expired on day 14 when trial has ended without a subscription", async () => {
    const db = mkDb();
    const now = new Date("2026-11-15T00:00:00Z");
    // Trial ended on 2026-11-14
    const trialEndsAt = new Date("2026-11-14T00:00:00Z");
    const ws = {
      id: "ws_trial_exp",
      name: "Test Store",
      ownerUid: "u1",
      ownerEmail: "owner@example.com",
      plan: "starter",
      billingStatus: "trialing",
      trialEndsAt: { toDate: () => trialEndsAt, toMillis: () => trialEndsAt.getTime() } as any,
    };

    await processWorkspaceTrial(db, ws, now);

    // Expect workspace updated to trial_expired
    const update = db._writes.find((w: any) => w.path === "workspaces/ws_trial_exp" && w.type === "update");
    expect(update).toBeDefined();
    expect(update.data.billingStatus).toBe("trial_expired");
    // Expect email notification
    expect(db._writes.some((w: any) => w.path === "mail/trial_expired_ws_trial_exp")).toBe(true);
  });

  it("emails owner 30 days after expiry before scheduling deletion", async () => {
    const db = mkDb();
    const now = new Date("2026-12-15T00:00:00Z");
    // Expired 31 days ago
    const expiredAt = new Date("2026-11-14T00:00:00Z");
    const ws = {
      id: "ws_trial_del",
      name: "Test Store",
      ownerUid: "u1",
      ownerEmail: "owner@example.com",
      plan: "starter",
      billingStatus: "trial_expired",
      trialEndsAt: { toDate: () => expiredAt, toMillis: () => expiredAt.getTime() } as any,
    };

    await processWorkspaceTrial(db, ws, now);

    expect(db._writes.some((w: any) => w.path === "mail/pre_deletion_ws_trial_del")).toBe(true);
    const update = db._writes.find((w: any) => w.path === "workspaces/ws_trial_del" && w.type === "update");
    expect(update.data.deletionScheduledFor).toBeDefined();
  });
});

describe("Read-Only Enforcement in requireMember", () => {
  const mkMemberDb = (role: string, billingStatus: string) => ({
    doc: (path: string) => ({
      get: async () => {
        if (path.includes("/members/")) {
          return { exists: true, data: () => ({ role, status: "active" }) };
        }
        return { exists: true, data: () => ({ billingStatus }) };
      },
    }),
  } as any);

  it("allows read access even when trial_expired or restricted", async () => {
    const db = mkMemberDb("owner", "trial_expired");
    // edit = false should not throw
    await expect(requireMember(db, "ws1", "uid1", false)).resolves.not.toThrow();
  });

  it("blocks edit actions when workspace is trial_expired", async () => {
    const db = mkMemberDb("owner", "trial_expired");
    await expect(requireMember(db, "ws1", "uid1", true)).rejects.toThrow("This workspace is read-only");
  });

  it("blocks edit actions when workspace is restricted", async () => {
    const db = mkMemberDb("owner", "restricted");
    await expect(requireMember(db, "ws1", "uid1", true)).rejects.toThrow("This workspace is read-only");
  });

  it("allows edit actions during active trial or active subscription", async () => {
    const dbTrialing = mkMemberDb("owner", "trialing");
    await expect(requireMember(dbTrialing, "ws1", "uid1", true)).resolves.not.toThrow();

    const dbActive = mkMemberDb("owner", "active");
    await expect(requireMember(dbActive, "ws1", "uid1", true)).resolves.not.toThrow();
  });
});
