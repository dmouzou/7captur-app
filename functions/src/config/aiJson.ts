/**
 * Models sometimes wrap the JSON reply in a sentence or a code fence. Take the first JSON object in the text.
 * Returns null when there is none. Callers still validate the content, this only finds it.
 */
export function parseModelJson<T = Record<string, unknown>>(raw: string): T | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}
