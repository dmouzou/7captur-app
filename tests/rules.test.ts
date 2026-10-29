import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

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
  it("public config is readable", async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "config/plans")));
  });
});
