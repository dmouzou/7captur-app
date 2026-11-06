import { describe, expect, it } from "vitest";
import { deleteAllRecordsInput, COLLECTIONS } from "../functions/src/shared/records";

describe("deleteAllRecordsInput", () => {
  it("validates valid input with workspaceId", () => {
    const res = deleteAllRecordsInput.safeParse({
      workspaceId: "ws_123",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.workspaceId).toBe("ws_123");
      expect(res.data.businessId).toBeUndefined();
      expect(res.data.includeRecommendations).toBeUndefined();
    }
  });

  it("validates valid input with businessId and includeRecommendations", () => {
    const res = deleteAllRecordsInput.safeParse({
      workspaceId: "ws_123",
      businessId: "biz_456",
      includeRecommendations: true,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.workspaceId).toBe("ws_123");
      expect(res.data.businessId).toBe("biz_456");
      expect(res.data.includeRecommendations).toBe(true);
    }
  });

  it("rejects missing or empty workspaceId", () => {
    expect(deleteAllRecordsInput.safeParse({}).success).toBe(false);
    expect(deleteAllRecordsInput.safeParse({ workspaceId: "" }).success).toBe(false);
  });

  it("ensures all 5 commercial collections are targeted", () => {
    expect(COLLECTIONS).toEqual(["posts", "promotions", "leads", "sales", "costs"]);
  });
});

