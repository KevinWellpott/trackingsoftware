// Datenvisualisierung — Ember Glass (DESIGN.md §3.7, COMPONENTS.md §9).
//
// Recharts kann CSS-Variablen nicht in allen Props lesen (Gradient-Stops,
// Berechnungen), deshalb liegt die Palette hier zusaetzlich als Konstante.
//
// WICHTIG: Die kategoriale Palette ist computational validiert — alle Farben
// ≥ 3:1 gegen den Canvas #0A0A0B, benachbarte Slots CVD-unterscheidbar
// (worst-case ΔE 14.5 bei Ziel ≥ 8). Reihenfolge NIE umsortieren und keine
// Farbe „mal eben" tauschen; das bricht die Validierung.

/** Kategoriale Palette in fixer Slot-Reihenfolge. Serie 1 → VIZ[0] usw. */
export const VIZ = ["#ea580c", "#4e80d6", "#3fa36f", "#d946ef", "#0d9488", "#8b5cf6"] as const;

/** Sequenzielle Rampe (eine Hue) — fuer Funnel, Heatmaps, Intensitaet. */
export const VIZ_RAMP = ["#431407", "#7c2d12", "#c2410c", "#ea580c", "#f97316", "#fdba74"] as const;

/** Divergierend (Abweichung vom Ziel): Blau ← Neutral → Orange. */
export const VIZ_DIVERGING = ["#4e80d6", "#6e7076", "#ea580c"] as const;

/**
 * Neutral-Ton fuer Segmente ohne eigene Kategorie („keine Antwort", „offen").
 * Die Neutral-Mitte der divergierenden Rampe — hell genug, um auf Cards
 * (#151519) sichtbar zu bleiben, und ueber 3:1 gegen den Canvas. Surface-
 * Toene sind dafuer ungeeignet: sie verschwinden im Hintergrund.
 */
export const VIZ_NEUTRAL = "#6e7076";

export const VIZ_GRID = "rgba(255, 255, 255, 0.06)";
export const VIZ_AXIS = "#8a8b90";

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

export const CURSOR_FILL = { fill: "rgba(255, 255, 255, 0.04)" } as const;

export const LEGEND_STYLE: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--text-muted)",
};

/** Balken: 4px Radius nur oben (COMPONENTS.md §9). */
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
