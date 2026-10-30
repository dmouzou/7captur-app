import { describe, expect, it } from "vitest";
import { requireAdmin, roleHas, plain } from "../functions/src/admin/auth";

const req = (token: Record<string, unknown> | null) => ({ auth: token ? { uid: "u1", token } : undefined, data: {} }) as never;
const now = () => Math.floor(Date.now() / 1000);

describe("admin authorization", () => {
  it("rejects anonymous and non-admin users with no hint", () => {
    expect(() => requireAdmin(req(null), "read_overview")).toThrow(/Sign in/);
    expect(() => requireAdmin(req({ email: "a@b.c", auth_time: now() }), "read_overview")).toThrow(/Not allowed/);
    expect(() => requireAdmin(req({ role: "owner", auth_time: now() }), "read_overview")).toThrow(/Not allowed/);
  });
  it("super_admin has every permission", () => {
    expect(requireAdmin(req({ role: "super_admin", auth_time: now(), email: "me@x.y" }), "manage_admins").role).toBe("super_admin");
  });
  it("least privilege for other roles", () => {
    expect(roleHas("support", "change_plan")).toBe(false);
    expect(roleHas("support", "read_workspaces")).toBe(true);
    expect(roleHas("billing", "read_billing")).toBe(true);
    expect(roleHas("billing", "read_recommendations")).toBe(false);
    expect(roleHas("ops", "manage_admins")).toBe(false);
    expect(() => requireAdmin(req({ role: "support", auth_time: now() }), "suspend_workspace")).toThrow(/Not allowed/);
  });
  it("sensitive actions need a fresh login", () => {
    expect(() => requireAdmin(req({ role: "super_admin", auth_time: now() - 3600 }), "change_plan", { fresh: true })).toThrow(/recent-login-required/);
    expect(requireAdmin(req({ role: "super_admin", auth_time: now() - 10 }), "change_plan", { fresh: true }).uid).toBe("u1");
  });
  it("unknown role strings grant nothing", () => {
    expect(roleHas("superadmin", "read_overview")).toBe(false);
    expect(roleHas(undefined, "read_overview")).toBe(false);
  });
});

describe("plain()", () => {
  it("drops secret-looking keys recursively", () => {
    expect(plain({ a: 1, accessToken: "x", nested: { clientSecret: "y", ok: 2 }, list: [{ password: "p", k: 1 }] })).toEqual({ a: 1, nested: { ok: 2 }, list: [{ k: 1 }] });
  });
});
