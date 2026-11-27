// Datenvisualisierung — Liquid Glass, hell und dunkel.
//
// Die Farben sind CSS-Variablen (globals.css, --viz-*): Recharts schreibt sie
// als `fill`/`stroke`-Attribute ins SVG, und dort loest der Browser `var()`
// je Modus auf. Feste Hexwerte waeren im Hellmodus falsch (Raster, Achsen,
// die helle Rampenstufe auf Weiss). Wer eine Farbe RECHNEN muss, nimmt
// `tint()` — color-mix versteht `var()`.
//
// WICHTIG: Die kategoriale Palette ist computational validiert — alle Farben
// ≥ 3:1 gegen den Canvas #0A0A0B, benachbarte Slots CVD-unterscheidbar
// (worst-case ΔE 14.5 bei Ziel ≥ 8). Reihenfolge NIE umsortieren und keine
// Farbe „mal eben" tauschen; das bricht die Validierung.

/** Kategoriale Palette in fixer Slot-Reihenfolge. Serie 1 → VIZ[0] usw. */
export const VIZ = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
] as const;

/** Sequenzielle Rampe (eine Hue) — fuer Funnel, Heatmaps, Intensitaet.
    Der Index steigt mit der Betonung; im Hellmodus laeuft sie nach dunkel. */
export const VIZ_RAMP = [
  "var(--viz-ramp-0)",
  "var(--viz-ramp-1)",
  "var(--viz-ramp-2)",
  "var(--viz-ramp-3)",
  "var(--viz-ramp-4)",
  "var(--viz-ramp-5)",
] as const;

/** Divergierend (Abweichung vom Ziel): Blau ← Neutral → Orange. */
export const VIZ_DIVERGING = ["var(--viz-2)", "var(--viz-neutral)", "var(--viz-1)"] as const;

/**
 * Neutral-Ton fuer Segmente ohne eigene Kategorie („keine Antwort", „offen").
 * Die Neutral-Mitte der divergierenden Rampe — hell genug, um auf Cards
 * (#151519) sichtbar zu bleiben, und ueber 3:1 gegen den Canvas. Surface-
 * Toene sind dafuer ungeeignet: sie verschwinden im Hintergrund.
 */
export const VIZ_NEUTRAL = "var(--viz-neutral)";

export const VIZ_GRID = "var(--viz-grid)";
export const VIZ_AXIS = "var(--viz-axis)";

/** Serienfarbe nach Slot — waelzt bei > 6 Serien um (dann besser gruppieren). */
export function vizSlot(index: number): string {
  return VIZ[index % VIZ.length];
}

/** Stufe der sequenziellen Rampe fuer Position i von n (tief → hell). */
export function vizRampStep(i: number, n: number): string {
  if (n <= 1) return VIZ_RAMP[3];
  const idx = Math.round((i / (n - 1)) * (VIZ_RAMP.length - 1));
  return VIZ_RAMP[idx];
}

/** Transluzente Variante einer (ggf. var()-basierten) Farbe. */
export function tint(color: string, alphaPct: number): string {
  return `color-mix(in srgb, ${color} ${alphaPct}%, transparent)`;
}

// ── Gemeinsame Recharts-Props ───────────────────────────────────────────
// Achsen ohne Linien und Ticks, Grid nur horizontal, Tooltip als Glas.

export const AXIS_TICK = { fontSize: 11, fill: VIZ_AXIS } as const;

export const AXIS_PROPS = {
  tick: AXIS_TICK,
  axisLine: false,
  tickLine: false,
} as const;

export const GRID_PROPS = {
  stroke: VIZ_GRID,
  strokeDasharray: "0",
  vertical: false,
} as const;

export const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--glass-bg-popover)",
  backdropFilter: "blur(var(--glass-blur-lg)) saturate(var(--glass-saturate))",
  WebkitBackdropFilter: "blur(var(--glass-blur-lg)) saturate(var(--glass-saturate))",
  border: "1px solid var(--glass-border)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--glass-lip), var(--shadow-overlay)",
  fontSize: "var(--fs-sm)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-primary)",
  padding: "var(--sp-4) var(--sp-5)",
};

export const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--fs-xs)",
  marginBottom: 2,
};

export const CURSOR_FILL = { fill: "var(--viz-cursor)" } as const;

export const LEGEND_STYLE: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--text-muted)",
};

/** Balken: 4px Radius nur oben (COMPONENTS.md §9). */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
