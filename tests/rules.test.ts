import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-7captur",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [wid, uid, role] of [["wsA", "alice", "owner"], ["wsB", "bob", "owner"], ["wsA", "viewer", "viewer"]] as const) {
      await setDoc(doc(db, `workspaces/${wid}`), { plan: "free", ownerUid: uid, timezone: "UTC" }, { merge: true });
      await setDoc(doc(db, `workspaces/${wid}/members/${uid}`), { role, status: "active" });
    }
    await setDoc(doc(db, "workspaces/wsA/posts/p1"), {
      workspaceId: "wsA", businessId: "b1", createdBy: "alice", provenance: "manual",
    });
  });
});

const post = (wid: string, uid: string) => ({
  workspaceId: wid, businessId: "b1", createdBy: uid, createdAt: serverTimestamp(), provenance: "manual",
});

describe("tenant isolation", () => {
  it("member reads own workspace", async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext("alice").firestore(), "workspaces/wsA")));
  });
  it("cross-tenant read fails", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(getDoc(doc(db, "workspaces/wsA")));
    await assertFails(getDoc(doc(db, "workspaces/wsA/posts/p1")));
  });
  it("cross-tenant write fails", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(setDoc(doc(db, "workspaces/wsA/posts/p2"), post("wsA", "bob")));
  });
  it("unauthenticated is denied", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "workspaces/wsA")));
  });
});

describe("privilege escalation", () => {
  it("client cannot change plan", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(db, "workspaces/wsA"), { plan: "custom" }));
  });
  it("client cannot write usage counters", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "workspaces/wsA/usage/2026-W44"), { recommendations: 0 }));
  });
  it("client cannot write billing, recommendations, connections, members", async () => {
    const db = env.authenticatedContext("alice").firestore();
    for (const path of ["billing/x", "recommendations/x", "recommendationEvents/x", "connections/x", "members/alice"]) {
      await assertFails(setDoc(doc(db, `workspaces/wsA/${path}`), { role: "owner", status: "active" }));
    }
  });
  it("client cannot write audit events or config", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "auditEvents/x"), { a: 1 }));
    await assertFails(setDoc(doc(db, "config/plans"), { a: 1 }));
  });
  it("viewer cannot create records, editor can", async () => {
    await assertFails(setDoc(doc(env.authenticatedContext("viewer").firestore(), "workspaces/wsA/posts/p3"), post("wsA", "viewer")));
    await assertSucceeds(setDoc(doc(env.authenticatedContext("alice").firestore(), "workspaces/wsA/posts/p3"), post("wsA", "alice")));
  });
  it("record cannot be forged as connected or moved to another workspace", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "workspaces/wsA/posts/p4"), { ...post("wsA", "alice"), provenance: "connected" }));
    await assertFails(setDoc(doc(db, "workspaces/wsA/posts/p5"), post("wsB", "alice")));
  });
  it("connected records: only link fields editable, no delete", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "workspaces/wsA/sales/shopify_1"), {
        workspaceId: "wsA", businessId: "b1", createdBy: "system:shopify", provenance: "connected", amount: 80, attribution: "unknown",
      });
    });
    const db = env.authenticatedContext("alice").firestore();
    const ref = doc(db, "workspaces/wsA/sales/shopify_1");
    await assertFails(updateDoc(ref, { amount: 999, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { promotionId: "promo1", attribution: "manual_reported", updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
  });
  it("public config is readable", async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "config/plans")));
  });
});

describe("read-only enforcement", () => {
  it("blocks record writes when trial_expired", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "workspaces/wsA"), { billingStatus: "trial_expired" });
    });
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, "workspaces/wsA/posts/p1")));
    await assertFails(setDoc(doc(db, "workspaces/wsA/posts/p_ro"), post("wsA", "alice")));
  });

  it("blocks record writes when restricted", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "workspaces/wsA"), { billingStatus: "restricted" });
    });
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, "workspaces/wsA/posts/p1")));
    await assertFails(setDoc(doc(db, "workspaces/wsA/posts/p_ro"), post("wsA", "alice")));
  });
});

describe("accounts and over-limit workspaces", () => {
  it("the owner can read their account usage; others cannot; nobody can write", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "accounts/alice"), { plan: "growth" });
      await setDoc(doc(ctx.firestore(), "accounts/alice/usage/2026-W45"), { recommendations: 3 });
      await setDoc(doc(ctx.firestore(), "accounts/alice/billing/subscription"), { subscriptionId: "sub_x" });
    });
    const alice = env.authenticatedContext("alice").firestore();
    const bob = env.authenticatedContext("bob").firestore();
    await assertSucceeds(getDoc(doc(alice, "accounts/alice")));
    await assertSucceeds(getDoc(doc(alice, "accounts/alice/usage/2026-W45")));
    await assertFails(getDoc(doc(bob, "accounts/alice")));
    await assertFails(getDoc(doc(bob, "accounts/alice/usage/2026-W45")));
    await assertFails(getDoc(doc(alice, "accounts/alice/billing/subscription")));
    await assertFails(setDoc(doc(alice, "accounts/alice"), { plan: "custom" }));
    await assertFails(setDoc(doc(alice, "accounts/alice/usage/2026-W45"), { recommendations: 0 }));
  });

  it("an owner can list only their own workspaces", async () => {
    const { collection, getDocs, query, where } = await import("firebase/firestore");
    const alice = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDocs(query(collection(alice, "workspaces"), where("ownerUid", "==", "alice"))));
    await assertFails(getDocs(query(collection(alice, "workspaces"), where("ownerUid", "==", "bob"))));
    await assertFails(getDocs(collection(alice, "workspaces")));
  });

  it("blocks record writes on a workspace beyond the plan limit, but still allows reads", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "workspaces/wsA"), { overLimit: true });
    });
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, "workspaces/wsA/posts/p1")));
    await assertFails(setDoc(doc(db, "workspaces/wsA/posts/p_over"), post("wsA", "alice")));
  });
});

describe("admin-only collections", () => {
  it("members and anonymous users cannot read or write planOverrides, supportTickets or auditEvents", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "planOverrides/wsA"), { plan: "growth", reason: "internal" });
      await setDoc(doc(db, "supportTickets/t1"), { workspaceId: "wsA", internalNotes: [{ note: "internal" }] });
      await setDoc(doc(db, "auditEvents/a1"), { action: "x" });
    });
    for (const db of [env.authenticatedContext("alice").firestore(), env.unauthenticatedContext().firestore()]) {
      for (const path of ["planOverrides/wsA", "supportTickets/t1", "auditEvents/a1"]) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { x: 1 }));
      }
    }
  });
  it("members cannot write their own workspace feedback copy", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "workspaces/wsA/feedback/t1"), { status: "resolved" }));
  });
});

describe("user preferences and recent sources", () => {
  it("user can read and write own preferences; cannot write privileged fields; cross-user is blocked", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    const bob = env.authenticatedContext("bob").firestore();
    const anon = env.unauthenticatedContext().firestore();

    // Alice writes own pref
    await assertSucceeds(setDoc(doc(alice, "users/alice/prefs/general"), { lastWorkspaceId: "wsA" }));
    await assertSucceeds(getDoc(doc(alice, "users/alice/prefs/general")));

    // Privileged fields like role or defaultWorkspaceId are rejected
    await assertFails(setDoc(doc(alice, "users/alice/prefs/p1"), { role: "admin" }));
    await assertFails(setDoc(doc(alice, "users/alice/prefs/p2"), { defaultWorkspaceId: "wsB" }));

    // Bob cannot read or write Alice's prefs
    await assertFails(getDoc(doc(bob, "users/alice/prefs/general")));
    await assertFails(setDoc(doc(bob, "users/alice/prefs/general"), { lastWorkspaceId: "wsB" }));

    // Unauthenticated access is blocked
    await assertFails(getDoc(doc(anon, "users/alice/prefs/general")));
    await assertFails(setDoc(doc(anon, "users/alice/prefs/general"), { lastWorkspaceId: "wsA" }));
  });

  it("workspace member can read and write recentSources with allowed keys; unallowed keys or non-member blocked", async () => {
    const alice = env.authenticatedContext("alice").firestore();
    const bob = env.authenticatedContext("bob").firestore();

    // Alice (active member) writes recent source with allowed keys
    await assertSucceeds(setDoc(doc(alice, "workspaces/wsA/recentSources/card1"), {
      lastUsedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(alice, "workspaces/wsA/recentSources/card1")));

    // Disallowed keys fail
    await assertFails(setDoc(doc(alice, "workspaces/wsA/recentSources/card2"), {
      lastUsedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      extraField: "bad",
    }));

    // Bob (not a member of wsA) cannot read or write
    await assertFails(getDoc(doc(bob, "workspaces/wsA/recentSources/card1")));
    await assertFails(setDoc(doc(bob, "workspaces/wsA/recentSources/card1"), {
      lastUsedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it("blocks recentSources writes when workspace is suspended or read-only", async () => {
    const alice = env.authenticatedContext("alice").firestore();

    // Suspended workspace
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "workspaces/wsA"), { suspended: true });
    });
    await assertFails(setDoc(doc(alice, "workspaces/wsA/recentSources/card1"), {
      lastUsedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));

    // Revert suspended, set trial_expired
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "workspaces/wsA"), { suspended: false, billingStatus: "trial_expired" });
    });
    await assertFails(setDoc(doc(alice, "workspaces/wsA/recentSources/card1"), {
      lastUsedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });
});

