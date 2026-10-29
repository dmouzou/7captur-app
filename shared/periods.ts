/** Local calendar date parts in an IANA timezone. */
export function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Today's date (YYYY-MM-DD) in an IANA timezone. */
export function localToday(now: Date, timeZone: string): string {
  const { y, m, d } = localDate(now, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO week id (Monday start) and next reset date, in the workspace timezone. */
export function periodIds(now: Date, timeZone: string) {
  const { y, m, d } = localDate(now, timeZone);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(date.getTime() - dow * 86400000);
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
  const week = 1 + Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400000));
  const nextMonday = new Date(monday.getTime() + 7 * 86400000);
  const nextMonth = new Date(Date.UTC(y, m, 1));
  return {
    weekId: `${isoYear}-W${String(week).padStart(2, "0")}`,
    monthId: `${y}-${String(m).padStart(2, "0")}`,
    weeklyResetsOn: nextMonday.toISOString().slice(0, 10),
    monthlyResetsOn: nextMonth.toISOString().slice(0, 10),
  };
}

