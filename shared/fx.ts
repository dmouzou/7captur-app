/**
 * Currency conversion. Rates are ECB euro reference rates (units of currency per 1 EUR),
 * published once per working day. Conversion is optional and always labelled with the rate date.
 */
export interface FxRates {
  date: string;
  base: "EUR";
  source: "ecb";
  rates: Record<string, number>;
}

export const FX_SUPPORTED = [
  "EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN",
  "TRY", "ZAR", "BRL", "MXN", "INR", "IDR", "MYR", "PHP", "SGD", "THB", "HKD", "KRW", "CNY", "ILS", "ISK",
] as const;

export function rateFor(fx: FxRates | null | undefined, code: string): number | null {
  if (!fx) return null;
  if (code === "EUR") return 1;
  const r = fx.rates[code];
  return typeof r === "number" && r > 0 ? r : null;
}

/** Returns the converted amount and the rate used (to per from), or null when a rate is missing. */
export function convert(amount: number, from: string, to: string, fx: FxRates | null | undefined): { amount: number; rate: number } | null {
  if (from === to) return { amount, rate: 1 };
  const rf = rateFor(fx, from);
  const rt = rateFor(fx, to);
  if (rf === null || rt === null) return null;
  const rate = rt / rf;
  return { amount: amount * rate, rate };
}

/** Parses the ECB daily XML feed. Returns null when it does not look right. */
export function parseEcbXml(xml: string): FxRates | null {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const v = Number(m[2]);
    if (Number.isFinite(v) && v > 0) rates[m[1]] = v;
  }
  return Object.keys(rates).length >= 10 ? { date, base: "EUR", source: "ecb", rates } : null;
}
