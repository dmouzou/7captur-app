import { localDate } from "../recommendations/usage";

/** Offset (minutes) of a timezone from UTC at a given instant. */
export function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Local wall-clock time in a timezone -> UTC milliseconds (handles DST). */
export function zonedTimeToUtc(y: number, m: number, d: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const off1 = tzOffsetMinutes(guess, timeZone);
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(t, timeZone);
  if (off2 !== off1) t = guess - off2 * 60000;
  return t;
}

/** Next Monday at `hour`:00 local time that is strictly after `now`. */
export function nextWeeklyRun(now: Date, timeZone: string, hour = 8): Date {
  const { y, m, d } = localDate(now, timeZone);
  for (let i = 0; i < 8; i++) {
    const c = new Date(Date.UTC(y, m - 1, d + i));
    if (c.getUTCDay() !== 1) continue;
    const t = zonedTimeToUtc(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), hour, 0, timeZone);
    if (t > now.getTime()) return new Date(t);
  }
  throw new Error("unreachable");
}

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
