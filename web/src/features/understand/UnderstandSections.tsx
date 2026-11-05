import { AddArt, BrandLogo, UnderstandArt } from "../../components/art";
import { Icon } from "../../components/Icon";

export type Level = "Explore" | "Improve" | "Optimize";
const LEVELS: Level[] = ["Explore", "Improve", "Optimize"];

export interface Gate { key: string; label: string; actual: number; required: number; passed: boolean }

/** Level meter. The level comes from the latest recommendation (the engine's own judgement) when there is one. */
export function EvidenceCard({ level, fromEngine, gates, unlock, onAdd }: { level: Level; fromEngine: boolean; gates: Gate[]; unlock: string; onAdd: () => void }) {
  const idx = LEVELS.indexOf(level);
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 13 }}>Evidence level</div>
          <div style={{ fontSize: "1.7rem", fontWeight: 500, color: "var(--ink)", margin: "4px 0 2px" }}>{level}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{fromEngine ? "From your latest recommendation" : "Estimated from your records. Generate a recommendation to confirm."}</div>
        </div>
        <UnderstandArt size={104} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "16px 0 6px" }} aria-label={`Evidence level ${level}`}>
        {LEVELS.map((l, i) => (
          <div key={l}>
            <div style={{ height: 8, borderRadius: 4, background: i <= idx ? "var(--accent-fill)" : "var(--border)", opacity: i < idx ? 0.55 : 1 }} />
            <div style={{ fontSize: 11.5, marginTop: 5, color: i === idx ? "var(--ink)" : "var(--muted)" }}>{l}</div>
          </div>
        ))}
      </div>
      {gates.length > 0 && (
        <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {gates.map((g) => (
            <li key={g.key} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto", gap: 10, alignItems: "center", fontSize: 13 }}>
              <span aria-hidden style={{ width: 18, height: 18, borderRadius: 9, display: "grid", placeItems: "center", background: g.passed ? "var(--accent-fill)" : "transparent", border: g.passed ? "none" : "1.5px dashed var(--muted)", color: "#10200a", fontSize: 11 }}>{g.passed ? "✓" : ""}</span>
              <span style={{ color: "var(--ink)" }}>{g.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>{g.actual} of {g.required}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)", fontSize: 13, lineHeight: 1.45 }}>
        <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 3 }}>To reach the next level</span>
        {unlock}{" "}
        <button type="button" className="link" onClick={onAdd} style={{ fontSize: 13 }}>Add data →</button>
      </div>
    </div>
  );
}

export function FreshnessCard({ days, min, max, stale, onAdd }: { days: number | null; min: string | null; max: string | null; stale: boolean; onAdd: () => void }) {
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>How fresh is your data</span>
        <span className={`badge ${stale ? "badge-danger" : "badge-success"}`} style={{ fontSize: 11 }}>{stale ? "Older than 14 days" : "Up to date"}</span>
      </div>
      <div style={{ fontSize: "1.7rem", fontWeight: 500, color: "var(--ink)", margin: "4px 0 10px" }}>
        {days === null ? "No records yet" : days === 0 ? "Updated today" : `Updated ${days} day${days === 1 ? "" : "s"} ago`}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Your records cover <span className="mono" style={{ color: "var(--ink)" }}>{min ?? "none"}</span> to <span className="mono" style={{ color: "var(--ink)" }}>{max ?? "none"}</span>.
      </div>
      <AddArt size={120} />
      {stale && <button type="button" className="btn-secondary" onClick={onAdd} style={{ display: "block", marginTop: 12, padding: "8px 14px", fontSize: 12.5, borderRadius: 8, color: "var(--accent)", borderColor: "var(--accent)" }}>Refresh your data →</button>}
    </div>
  );
}

const PROV: Record<string, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "var(--accent-fill)" },
  manual: { label: "Entered by you", tone: "#9a6bd8" },
  imported: { label: "Imported", tone: "#4a7bd8" },
};

/** Where the numbers come from: provenance counts and connected platforms with their logos. */
export function SourcesCard({ provenance, platforms, currencies, gaps, onFix }: {
  provenance: Record<string, number>; platforms: string[]; currencies: string[]; gaps: number; onFix: () => void;
}) {
  const total = Object.values(provenance).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <h3 style={{ margin: "0 0 14px", fontSize: "1.1rem", fontWeight: 500 }}>Where your numbers come from</h3>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--border)", marginBottom: 10 }} role="img" aria-label="Share of records by source">
        {Object.entries(provenance).map(([k, n]) => <div key={k} style={{ width: `${(n / total) * 100}%`, background: (PROV[k] ?? { tone: "var(--muted)" }).tone }} />)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
        {Object.entries(provenance).map(([k, n]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink)" }}>
            <i style={{ width: 8, height: 8, borderRadius: 4, background: (PROV[k] ?? { tone: "var(--muted)" }).tone }} />{(PROV[k] ?? { label: k }).label} <span className="muted">{n}</span>
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <div style={{ padding: 13, borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Platforms and channels</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {platforms.length ? platforms.map((p) => (
              <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink)" }}><BrandLogo name={p} size={18} />{p[0].toUpperCase() + p.slice(1)}</span>
            )) : <span className="muted" style={{ fontSize: 13 }}>None yet</span>}
          </div>
        </div>
        <div style={{ padding: 13, borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Currencies</div>
          <div style={{ fontSize: 15, color: "var(--ink)" }}>{currencies.length ? currencies.join(", ") : "Not set"}</div>
          {currencies.length > 1 && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Different currencies are never mixed.</div>}
        </div>
        <div style={{ padding: 13, borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Missing details</div>
          <div style={{ fontSize: 15, color: gaps ? "var(--warning)" : "var(--ink)" }}>{gaps} to fix</div>
          {gaps > 0 && <button type="button" className="link" onClick={onFix} style={{ fontSize: 12, marginTop: 4 }}>Fix in Your data →</button>}
        </div>
      </div>
    </div>
  );
}

export interface Delta { now: number; before: number }
const pct = (d: Delta) => (d.before === 0 ? (d.now === 0 ? "no change" : "new") : `${d.now >= d.before ? "+" : ""}${Math.round(((d.now - d.before) / d.before) * 100)}%`);
const up = (d: Delta, goodWhenUp = true) => (d.now === d.before ? "var(--muted)" : (d.now > d.before) === goodWhenUp ? "var(--accent)" : "var(--warning)");

/** The last 7 days against the 7 before. Plain sums of real records, in the workspace currency. */
export function WeekCard({ currency, revenue, spend, orders, enquiries, skipped, onDigest }: {
  currency: string; revenue: Delta; spend: Delta; orders: Delta; enquiries: Delta; skipped: number; onDigest: () => void;
}) {
  const tiles: [string, string, Delta, boolean][] = [
    ["Revenue", `${currency} ${revenue.now.toLocaleString()}`, revenue, true],
    ["Spend", `${currency} ${spend.now.toLocaleString()}`, spend, false],
    ["Orders", String(orders.now), orders, true],
    ["Enquiries", String(enquiries.now), enquiries, true],
  ];
  return (
    <div className="card" style={{ padding: "22px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 500 }}>What changed this week</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>The last 7 days compared with the 7 days before.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onDigest} style={{ padding: "6px 14px", fontSize: 12.5, borderRadius: 8, margin: 0 }}>Weekly summary →</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {tiles.map(([label, value, d, good]) => (
          <div key={label} style={{ padding: "13px 15px", borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--ink)" }}>{value}</div>
            <div style={{ fontSize: 12, marginTop: 3, color: up(d, good) }}>{pct(d)} <span className="muted">vs the week before</span></div>
          </div>
        ))}
      </div>
      {skipped > 0 && <p className="muted" style={{ fontSize: 12, margin: "12px 0 0" }}>{skipped} record{skipped === 1 ? "" : "s"} in another currency left out. We never mix currencies.</p>}
    </div>
  );
}

export function UnderstandHero({ busy, onGenerate, onAsk }: { busy: boolean; onGenerate: () => void; onAsk: () => void }) {
  return (
    <div className="card" style={{ padding: "26px 28px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20, background: "linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%)" }}>
      <div style={{ maxWidth: 560 }}>
        <span className="badge badge-primary">Understand</span>
        <h1 style={{ margin: "10px 0 8px", fontSize: "1.75rem", fontWeight: 500 }}>Where your numbers stand</h1>
        <p className="muted" style={{ margin: "0 0 16px", fontSize: 14.5, lineHeight: 1.55 }}>
          See how complete and fresh your data is, what changed this week and what to record next. A recommendation comes from fixed rules, applied the same way every time.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="primary" onClick={onGenerate} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", fontSize: 13.5, borderRadius: 10, margin: 0 }}>
            <Icon name="sparkle" size={17} />{busy ? "Working it out…" : "Generate a recommendation"}
          </button>
          <button type="button" className="btn-secondary" onClick={onAsk} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", fontSize: 13.5, borderRadius: 10, margin: 0 }}>
            <Icon name="help" size={17} />Ask 7Captur
          </button>
        </div>
      </div>
      <UnderstandArt size={190} />
    </div>
  );
}
