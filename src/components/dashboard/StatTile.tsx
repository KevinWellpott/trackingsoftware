import Link from "next/link";
import type { ReactNode } from "react";

// Kompakte KPI-Kachel fürs persönliche Dashboard. Rein token-basiert,
// optional verlinkt (ganze Kachel klickbar) und mit Farb-Akzent links.

export type StatTileTone = "neutral" | "success" | "error" | "brand";

const TONE_COLOR: Record<StatTileTone, string> = {
  neutral: "var(--text-primary)",
  success: "var(--color-success-text)",
  error: "var(--color-error-text)",
  brand: "var(--brand-600)",
};

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTileTone;
  href?: string;
  icon?: ReactNode;
}) {
  const accent = tone !== "neutral";
  const tile = (
    <div
      className={href ? "card card-hover" : "card"}
      style={{
        padding: "1rem 1.125rem",
        height: "100%",
        borderLeft: accent ? `3px solid ${TONE_COLOR[tone]}` : undefined,
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}>
        {icon && (
          <span aria-hidden style={{ display: "inline-flex", color: accent ? TONE_COLOR[tone] : "var(--text-subtle)", flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: "1.625rem", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: TONE_COLOR[tone], fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {sub}
        </div>
      )}
    </div>
  );

  if (!href) return tile;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block", height: "100%" }}>
      {tile}
    </Link>
  );
}
