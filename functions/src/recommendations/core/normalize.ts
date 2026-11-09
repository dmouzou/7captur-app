import type { EngineInput } from "./shared";
import { convert } from "../../shared/fx";
import { OBJECTIVES } from "../../shared/schemas";
import type { SaleRecord } from "../../shared/records";
import { WINDOW_DAYS, addDays } from "./shared";
import type { WithId, Obj } from "./shared";

/** Window filter, currency handling, order de-duplication, refund status. No decisions are made here. */
export function normalize(input: EngineInput) {
  const { business, today } = input;
  const start = addDays(today, -(WINDOW_DAYS - 1));
  const inWin = (d: string) => d >= start && d <= today;
  const cur = business.currency;
  const objective: Obj = (OBJECTIVES as readonly string[]).includes(business.objective) ? (business.objective as Obj) : "profitability";
  const warnings: string[] = [];
  // Conversion is the owner's choice. Until they answer (undefined) nothing is converted and nothing is guessed.
  const convertOn = business.convertCurrencies === true;
  const excludedBy: Record<string, number> = {};

  /* ---- currency: convert when allowed and a rate exists, otherwise leave out, never guess ---- */
  const fxRatesUsed: Record<string, number> = {};
  let convertedRecords = 0;
  let excluded = 0;
  const rateTo = (from: string | undefined): number | null => {
    if (!from || from === cur) return 1;
    if (convertOn) {
      const c = convert(1, from, cur, input.fx);
      if (c) { fxRatesUsed[from] = Math.round(c.rate * 1e6) / 1e6; convertedRecords++; return c.rate; }
    }
    excluded++;
    excludedBy[from] = (excludedBy[from] ?? 0) + 1;
    return null;
  };

  const normProv = (p?: string) => (p === "screenshot_extracted" ? "manual" : p ?? "unknown");
  const posts = input.records.posts.filter((p) => inWin(p.publishedAt));
  const leads = input.records.leads.filter((l) => inWin(l.date));

  const promosInWindow = input.records.promotions.filter((p) => inWin(p.startDate));
  const promos = promosInWindow.flatMap((p) => {
    const f = rateTo(p.currency);
    return f === null ? [] : [{ ...p, spend: p.spend * f }];
  });
  const excludedPromos = promosInWindow.length - promos.length;
  // The same order can arrive twice (a store sync and a CSV). One order number is one order; keep the connected copy.
  const provRank = (p?: string) => (p === "connected" ? 0 : p === "imported" ? 1 : 2);
  const bestByOrder = new Map<string, WithId<SaleRecord>>();
  const noOrderNo: WithId<SaleRecord>[] = [];
  for (const s of input.records.sales.filter((x) => inWin(x.date))) {
    const k = (s.orderNumber ?? "").trim().toLowerCase().replace(/^#/, "");
    if (!k) { noOrderNo.push(s); continue; }
    const cur0 = bestByOrder.get(k);
    if (!cur0 || provRank(s.provenance) < provRank(cur0.provenance)) bestByOrder.set(k, s);
  }
  const dedupedSales = [...bestByOrder.values(), ...noOrderNo];
  const duplicateOrders = input.records.sales.filter((x) => inWin(x.date)).length - dedupedSales.length;
  if (duplicateOrders > 0) warnings.push(`${duplicateOrders} order(s) appeared more than once with the same order number (for example from a store connection and a file). Each order is counted once.`);
  const sales = dedupedSales.flatMap((s0) => {
    const f = rateTo(s0.currency);
    if (f === null) return [];
    // A refund larger than the order cannot happen. A confirmed order with a refund on it is a refunded order.
    const amount0 = s0.amount, refund0 = Math.min(s0.refundAmount ?? 0, amount0);
    const status = s0.status === "confirmed" && refund0 > 0 ? (refund0 >= amount0 ? "refunded" : "partially_refunded") : s0.status;
    return [{ ...s0, status, amount: amount0 * f, refundAmount: refund0 * f, discountAmount: (s0.discountAmount ?? 0) * f }];
  });
  const costsIn = input.records.costs.flatMap((c) => {
    if (c.kind === "percentage") return [c];
    const f = rateTo(c.currency);
    return f === null ? [] : [{ ...c, amount: c.amount * f }];
  });
  if (excluded > 0) warnings.push(`${excluded} record(s) in a currency other than ${cur} were left out of every figure. ${business.convertCurrencies === undefined ? "Choose how to handle them (convert, switch your reporting currency, or keep them out)." : "Conversion is off or no rate is available."}`);
  if (convertedRecords > 0 && input.fx) warnings.push(`${convertedRecords} record(s) were converted to ${cur} using ECB reference rates dated ${input.fx.date}.`);

  const prov: Record<string, number> = {};
  for (const r of [...posts, ...promos, ...leads, ...sales]) {
    const k = normProv(r.provenance);
    prov[k] = (prov[k] ?? 0) + 1;
  }

  return { start, inWin, cur, objective, warnings, posts, leads, promos, excludedPromos, sales, costsIn, prov, excluded, excludedBy, fxRatesUsed, convertedRecords };
}
