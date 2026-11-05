import type { Intent } from "../shared/assistant";
import type { Facts } from "./facts";

/**
 * Fixed answers. Every number and name comes from the facts bundle. No AI, no credit.
 * Plain language: no promises, no claims about what will happen.
 */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LEVEL_TEXT: Record<string, string> = {
  Explore: "Explore means there is not enough recent data yet, so recommendations are small, careful tests.",
  Improve: "Improve means there is enough recent data to see early patterns, but not enough to lean on them heavily.",
  Optimize: "Optimize means your recent data is plentiful or connected, so recommendations can rest on more evidence.",
};

function countsLine(f: Facts): string {
  const c = f.data.counts;
  return `${plural(c.sales, "sale", "sales")}, ${plural(c.leads, "enquiry", "enquiries")}, ${plural(c.promotions, "promotion", "promotions")}, ${plural(c.posts, "post", "posts")} and ${plural(c.costs, "cost", "costs")}`;
}

function freshness(f: Facts): string {
  const d = f.data;
  if (d.totalRecords === 0 || !d.newestDate) return "You have not added any dated records yet.";
  return `Your newest record is dated ${d.newestDate} (${plural(d.freshnessDays ?? 0, "day", "days")} ago), so your data is ${d.isStale ? "stale" : "fresh"}.`;
}

export function answerIntent(intent: Intent, f: Facts): string {
  switch (intent) {
    case "evidence_level":
      return `Your evidence level is ${f.evidence.level}. ${LEVEL_TEXT[f.evidence.level] ?? ""} You have ${plural(f.data.totalRecords, "record", "records")}. ${f.evidence.nextLevelUnlock}`.trim();

    case "stale_data":
      return `7Captur treats your data as stale after ${f.limits.staleDays} days without a new record or sync. ${freshness(f)}${f.data.isStale ? " Add recent numbers or import a file to refresh it." : ""}`;

    case "csv_import":
      return [
        `You can import a CSV file up to ${f.limits.importMaxMb} MB, ${f.limits.importMaxRows} rows and ${f.limits.importMaxColumns} columns.`,
        "Columns are matched to 7Captur fields for you to check, and you see a preview before anything is saved.",
        `Only valid rows that are not already saved are imported. If more than ${f.limits.rejectedWarningPercent}% of rows are rejected you get a warning first, and you can download an error report with the row, the field and the reason.`,
      ].join(" ");

    case "connectors": {
      const parts: string[] = [];
      parts.push(f.connections.connected.length ? `Connected now: ${join(f.connections.connected)}.` : "Nothing is connected yet.");
      if (f.connections.needsAttention.length) parts.push(`Needs reconnecting: ${join(f.connections.needsAttention)}.`);
      if (f.connectors.available.length) parts.push(`Available to connect: ${join(f.connectors.available)}.`);
      if (f.connectors.importOnly.length) parts.push(`${join(f.connectors.importOnly)} is import only for now: export a CSV from the platform and import it.`);
      if (f.connectors.planned.length) parts.push(`Planned, not available yet: ${join(f.connectors.planned)}.`);
      parts.push("Connections are read-only. 7Captur never changes your ads, budgets or posts.");
      return parts.join(" ");
    }

    case "what_changed": {
      const w = f.week;
      if (w.last7 === 0 && w.previous7 === 0) return "No records are dated in the last 14 days, so there is nothing to compare. Add recent numbers to see what changed.";
      const by = Object.entries(w.last7ByType).map(([k, n]) => `${n} ${k}`);
      return `In the last 7 days you added ${plural(w.last7, "record", "records")}${by.length ? ` (${join(by)})` : ""}, compared with ${w.previous7} in the 7 days before. This counts records by their date, not by their value.`;
    }

    case "guardrails": {
      const fo = f.focus;
      const base = "Every recommendation lists what to watch and when not to act. 7Captur never changes your ads, budgets or posts: you make the call.";
      if (!fo) return `${base} You have no recommendation yet. Generate one from Understand.`;
      const bits = [fo.watch && `Watch: ${fo.watch}`, fo.stopIf && `Do not act if: ${fo.stopIf}`, fo.risk && `Risk: ${fo.risk}`].filter(Boolean);
      return `${base} For "${fo.title}": ${bits.length ? bits.join(" ") : "no specific guardrails were saved."}`;
    }

    case "why_priority": {
      const fo = f.focus;
      if (!fo) return "You have no recommendation yet, so there is nothing to explain. Generate one from Understand, then ask again.";
      return `${fo.title} Why: ${fo.why.length ? fo.why.slice(0, 3).join(" ") : "no reasons were saved with it."}`;
    }

    case "unknowns": {
      const fo = f.focus;
      if (!fo) return "You have no recommendation yet. Once you do, it lists what is not known and what it assumes.";
      return `For "${fo.title}": ${fo.unknowns.length ? fo.unknowns.slice(0, 4).join(" ") : "no unknowns were saved with it."}`;
    }

    case "data_gaps": {
      const d = f.data;
      const gaps: string[] = [];
      if (d.salesWithoutAttribution) gaps.push(`${plural(d.salesWithoutAttribution, "sale has", "sales have")} no attribution`);
      if (d.promotionsWithoutObjective) gaps.push(`${plural(d.promotionsWithoutObjective, "promotion has", "promotions have")} no objective`);
      if (d.leadsWithoutSource) gaps.push(`${plural(d.leadsWithoutSource, "enquiry has", "enquiries have")} no source`);
      if (d.totalRecords === 0) return "You have no records yet, so there is nothing to check. Add your first data from Add.";
      return `${gaps.length ? `In your recent records, ${join(gaps)}. Fix these first: missing details lower how much a recommendation can say.` : "No missing fields were found in your recent records."} ${freshness(f)}`;
    }

    case "next_step": {
      const fo = f.focus;
      const d = f.data;
      if (d.totalRecords === 0) return "Add your first data: type in a sale, enquiry or post, import a CSV file, or connect a store.";
      if (d.isStale) return "Your data is stale. Add recent numbers or import a fresh file, then generate a new recommendation.";
      if (fo?.nextStep) return `The next thing to record for "${fo.title}": ${fo.nextStep}`;
      return "Keep recording sales, enquiries and costs, then review your recommendation in Decide.";
    }

    case "credits": {
      const u = f.usage;
      return `You have used ${u.aiCreditsUsed} of ${u.aiCreditsMonthly} AI credits this month. They reset on ${u.monthlyResetsOn}. Recommendation credits are separate: ${u.recommendationsUsed} of ${u.recommendationsWeekly} used this week. Fixed answers like this one are free.`;
    }

    case "overview": {
      const fo = f.focus;
      return [
        `${f.workspace.name} is on the ${cap(f.workspace.plan)} plan${f.workspace.objective ? `, with the goal ${f.workspace.objective.replace(/_/g, " ")}` : ""}, reporting in ${f.workspace.currency}.`,
        f.data.totalRecords ? `You have ${countsLine(f)}.` : "You have no records yet.",
        freshness(f),
        `Evidence level: ${f.evidence.level}.`,
        fo ? `Latest recommendation: ${fo.title}` : "You have no recommendation yet.",
        f.connections.connected.length ? `Connected: ${join(f.connections.connected)}.` : "Nothing is connected.",
      ].join(" ");
    }
  }
}

/** Used when the AI is unavailable or its answer is rejected. No credit is used. */
export function fallbackAnswer(f: Facts): string {
  return `I could not answer that one, and no AI credit was used. Here is where your workspace stands. ${answerIntent("overview", f)}`;
}
