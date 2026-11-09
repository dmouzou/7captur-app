import { describe, expect, it } from "vitest";
import { commercialRecordCount } from "../functions/src/recommendations/preflight";

describe("no recommendation without commercial records", () => {
  it("zero records counts as zero", () => {
    expect(commercialRecordCount({ posts: [], promotions: [], leads: [], sales: [] })).toBe(0);
  });
  it("any one record type is enough", () => {
    expect(commercialRecordCount({ posts: [], promotions: [], leads: [{}], sales: [] })).toBe(1);
  });
});
