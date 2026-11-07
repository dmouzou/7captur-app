import { describe, expect, it } from "vitest";
import { DEFAULT_AI_MODEL, normalizeAiModel } from "../functions/src/config/aiConfig";

describe("normalizeAiModel", () => {
  it("defaults to a current model", () => expect(normalizeAiModel(undefined)).toBe("claude-sonnet-5-5"));
  it("keeps current ids", () => {
    for (const m of ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"]) expect(normalizeAiModel(m)).toBe(m);
  });
  it("maps retired 3.x ids to current ones", () => {
    expect(normalizeAiModel("claude-3-5-sonnet-latest")).toBe("claude-sonnet-5-5");
    expect(normalizeAiModel("claude-3-5-sonnet-20241022")).toBe("claude-sonnet-5-5");
    expect(normalizeAiModel("claude-3-5-haiku-latest")).toBe("claude-haiku-5-5");
    expect(normalizeAiModel("claude-3-opus-latest")).toBe("claude-opus-5-5");
  });
  it("never defaults to a retired model", () => expect(DEFAULT_AI_MODEL).not.toMatch(/claude-3/));
});

import { parseModelJson } from "../functions/src/config/aiJson";
describe("parseModelJson", () => {
  it("parses plain, fenced and prose-wrapped JSON, and rejects text with no object", () => {
    expect(parseModelJson('{"answer":"a"}')).toEqual({ answer: "a" });
    expect(parseModelJson('```json\n{"answer":"a"}\n```')).toEqual({ answer: "a" });
    expect(parseModelJson('Here you go: {"answer":"a"} Hope that helps.')).toEqual({ answer: "a" });
    expect(parseModelJson("no json here")).toBeNull();
  });
});
