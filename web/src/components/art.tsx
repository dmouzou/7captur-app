/**
 * Small illustrations for the app, drawn with the theme variables so they work in dark and light.
 * Same visual language as the marketing site: lime accents, soft cards, one idea per picture.
 */
const card = { fill: "var(--surface)", stroke: "var(--border)" } as const;
const lime = "var(--accent-fill)";

export function AddArt({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 132 95" role="img" aria-label="Records flowing into your workspace">
      <path d="M30 20 C 56 20, 52 47, 78 47" fill="none" stroke={lime} strokeWidth="2" strokeDasharray="4 5" />
      <path d="M30 47 H78" fill="none" stroke={lime} strokeWidth="2" strokeDasharray="4 5" />
      <path d="M30 74 C 56 74, 52 47, 78 47" fill="none" stroke={lime} strokeWidth="2" strokeDasharray="4 5" />
      {[20, 47, 74].map((y, i) => (
        <g key={y} transform={`translate(6 ${y - 11})`}>
          <rect width="30" height="22" rx="7" {...card} />
          <rect x="7" y="7" width={[14, 10, 12][i]} height="3.5" rx="1.7" fill={lime} />
          <rect x="7" y="13" width="16" height="3" rx="1.5" fill="var(--border)" />
        </g>
      ))}
      <g transform="translate(78 24)">
        <rect width="48" height="46" rx="10" fill="var(--surface)" stroke="var(--accent-line)" />
        <rect x="9" y="10" width="30" height="5" rx="2.5" fill={lime} />
        <rect x="9" y="21" width="22" height="5" rx="2.5" fill={lime} opacity=".6" />
        <rect x="9" y="32" width="26" height="5" rx="2.5" fill={lime} opacity=".35" />
      </g>
    </svg>
  );
}

export function UnderstandArt({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 132 95" role="img" aria-label="Evidence meter with three levels">
      <rect x="6" y="8" width="120" height="79" rx="12" {...card} />
      <rect x="18" y="22" width="26" height="7" rx="3.5" fill={lime} opacity=".45" />
      <rect x="48" y="22" width="36" height="7" rx="3.5" fill={lime} />
      <rect x="88" y="22" width="26" height="7" rx="3.5" fill="var(--border)" />
      <path d="M62 12h8l-4 7z" fill={lime} />
      {[40, 54, 68].map((y, i) => (
        <g key={y}>
          <circle cx="24" cy={y + 3} r="5" fill={i < 2 ? lime : "none"} stroke={i < 2 ? "none" : "var(--muted)"} strokeDasharray={i < 2 ? undefined : "2 2"} />
          <rect x="34" y={y} width={[62, 52, 44][i]} height="6" rx="3" fill="var(--border)" />
        </g>
      ))}
    </svg>
  );
}

export function DecideArt({ size = 132 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 132 95" role="img" aria-label="One recommended next move">
      <rect x="6" y="8" width="120" height="79" rx="12" {...card} />
      <rect x="16" y="18" width="100" height="26" rx="8" fill="var(--accent-soft)" />
      <rect x="16" y="18" width="4" height="26" rx="2" fill={lime} />
      <rect x="27" y="25" width="74" height="4" rx="2" fill={lime} />
      <rect x="27" y="33" width="52" height="4" rx="2" fill={lime} opacity=".6" />
      <rect x="16" y="54" width="70" height="4" rx="2" fill="var(--border)" />
      <rect x="16" y="63" width="56" height="4" rx="2" fill="var(--border)" />
      <rect x="16" y="73" width="38" height="9" rx="4.5" fill={lime} />
    </svg>
  );
}

export function EmptyArt({ kind = "data", size = 150 }: { kind?: "data" | "decision"; size?: number }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 150 105" role="img" aria-label={kind === "data" ? "No data yet" : "No decisions yet"}>
      <ellipse cx="75" cy="52" rx="62" ry="44" fill="var(--accent-soft)" />
      <rect x="35" y="22" width="80" height="60" rx="12" {...card} />
      <rect x="47" y="35" width="40" height="6" rx="3" fill={lime} />
      <rect x="47" y="47" width="56" height="5" rx="2.5" fill="var(--border)" />
      <rect x="47" y="58" width="34" height="5" rx="2.5" fill="var(--border)" />
      <circle cx="108" cy="76" r="13" fill={lime} />
      <path d="M108 70v12M102 76h12" stroke="#10200a" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Brand logos used in the app (same files as the marketing site). */
export const LOGO: Record<string, string> = {
  shopify: "/logos/shopify.svg", meta: "/logos/meta.svg", googleads: "/logos/googleads.svg",
  woocommerce: "/logos/woocommerce.svg", instagram: "/logos/instagram.svg",
};
export function BrandLogo({ name, size = 22 }: { name: string; size?: number }) {
  const src = LOGO[name.toLowerCase().replace(/[^a-z]/g, "")];
  return src ? <img src={src} width={size} height={size} alt="" style={{ display: "block" }} /> : null;
}
