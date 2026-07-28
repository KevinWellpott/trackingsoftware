import Link from "next/link";
import type { ReactNode } from "react";

// KPI-Stat-Tile (COMPONENTS.md §8):
//   Solid Card → Eyebrow-Label → Zahl → Delta-/Status-Chip.
//
// Bewusste Abweichung von der Vorgaenger-Version: Die Zahl bleibt IMMER
// --text-primary. Status wandert in einen Chip mit Icon + Text, weil Farbe
// allein nie Bedeutung tragen darf (DESIGN.md §3.5). Der Ton faerbt zusaetzlich
// den 2px-Rail links, damit die Kachel auch im Ueberblick lesbar bleibt.

export type StatTileTone = "neutral" | "success" | "error" | "brand" | "warning";

const TONE: Record<StatTileTone, { rail: string; fg: string; bg: string; border: string }> = {
  neutral: {
    rail: "transparent",
    fg: "var(--text-secondary)",
    bg: "var(--surface-3)",
    border: "var(--border-default)",
  },
  success: {
    rail: "var(--success)",
    fg: "var(--success-fg)",
    bg: "var(--success-bg)",
    border: "rgb(63 179 127 / 0.32)",
  },
  error: {
    rail: "var(--danger)",
    fg: "var(--danger-fg)",
    bg: "var(--danger-bg)",
    border: "rgb(214 90 82 / 0.32)",
  },
  warning: {
    rail: "var(--warning)",
    fg: "var(--warning-fg)",
    bg: "var(--warning-bg)",
    border: "rgb(209 162 79 / 0.32)",
  },
  // „brand" = Fokus/Ziel uebertroffen — der einzige Orange-Ton der Kachel.
  brand: {
    rail: "var(--orange-500)",
    fg: "var(--orange-300)",
    bg: "var(--accent-muted)",
    border: "var(--border-accent)",
  },
};

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  icon,
  chip,
  filled = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTileTone;
  href?: string;
  icon?: ReactNode;
  /** Delta-/Status-Chip rechts neben der Zahl (Icon + Text, nie Farbe allein). */
  chip?: ReactNode;
  /**
   * Faerbt die ganze Kachel im Ton ein statt nur den Rail. Fuer Kennzahlen,
   * die auf einen Blick als „gut"/„zu tun" lesbar sein muessen. Das Label
   * bleibt dabei sichtbar, Farbe traegt also nie allein die Bedeutung.
   */
  filled?: boolean;
}) {
  const t = TONE[tone];
  const accent = tone !== "neutral";
  const solid = filled && accent;
  const tile = (
    <div
      className={href ? "card card-hover" : "card"}
      style={{
        position: "relative",
        padding: "var(--sp-6) var(--sp-7)",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-3)",
        ...(solid ? { background: t.bg, borderColor: t.border } : null),
      }}
    >
      {accent && !solid && (
        <span
          aria-hidden
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: t.rail }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
        {icon && (
          <span
            aria-hidden
            style={{ display: "inline-flex", color: solid ? t.fg : "var(--orange-500)", flexShrink: 0 }}
          >
            {icon}
          </span>
        )}
        <span
          className="eyebrow"
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            ...(solid ? { color: t.fg } : null),
          }}
        >
          {label}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <span className="kpi-value" style={solid ? { color: t.fg } : undefined}>
          {value}
        </span>
        {chip}
      </div>

      {sub && (
        <div
          style={{
            fontSize: "var(--fs-xs)",
            color: accent ? t.fg : "var(--text-muted)",
            opacity: solid ? 0.8 : 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
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

/** Delta-Chip: Icon + Vorzeichen + Wert — nie Farbe allein (COMPONENTS.md §8). */
export function StatChip({
  tone = "neutral",
  children,
}: {
  tone?: StatTileTone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 18,
        padding: "0 var(--sp-4)",
        borderRadius: "var(--r-full)",
        background: t.bg,
        color: t.fg,
        fontSize: "var(--fs-xs)",
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
