import type { CSSProperties } from "react";

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
  style?: CSSProperties;
  subtitle?: string;
}

export function Logo({ size = 24, showText = true, className = "", style, subtitle }: LogoProps) {
  // The mark has viewBox="99 121 301 257" (aspect ratio ~ 301:257 = 1.17)
  const markHeight = size;
  const markWidth = Math.round(size * (301 / 257));

  return (
    <div
      className={`logo ${className}`}
      style={{
        fontFamily: "'Inter Tight', system-ui, sans-serif",
        fontWeight: 800,
        fontSize: Math.max(18, Math.round(size * 0.85)),
        letterSpacing: "-0.03em",
        color: "var(--ink)",
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        userSelect: "none",
        ...style,
      }}
    >
      {/* Official 7Captur SVG logo mark from 7captur.com */}
      <svg
        className="logo-mark"
        viewBox="99 121 301 257"
        width={markWidth}
        height={markHeight}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{
          color: "var(--accent-fill)",
          flexShrink: 0,
          display: "block",
        }}
      >
        <path
          d="M99,121 L400,121 L400,170 L296,170 L296,328 L400,328 L400,378 L200,378 L200,170 L99,170 Z"
          fill="currentColor"
        />
      </svg>

      {showText && (
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ color: "var(--ink)", fontWeight: 800 }}>7Captur</span>
          {subtitle && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: "var(--muted)",
                letterSpacing: "0.02em",
                fontWeight: 500,
                marginTop: 2,
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
