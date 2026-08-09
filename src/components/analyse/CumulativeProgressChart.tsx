"use client";

// Kumulativer Fortschritts-Chart — die Kurve, die über den gewählten Zeitraum
// immer weiter steigt, mit mehreren vergleichbaren Serien.
//
// Zweck (Feedback-Board): Progress sichtbar machen. Eine steigende Kurve
// motiviert, und Einbrüche liest man als Abflachung viel schneller als in
// einer zappelnden Tagesreihe.
//
// Unterschied zu `CumulativeAreaChart` (AnalyseViz.tsx): Dort sind die Serien
// PERSONEN (ownerColor, kein Umschalter). Hier sind die Serien METRIKEN — sie
// bekommen deshalb die kategoriale Palette aus viz.ts und eine
// Mehrfachauswahl. Beide bestehen nebeneinander; die Kumulationslogik ist
// bewusst dieselbe.
//
// ── Verwendung ─────────────────────────────────────────────────────────────
// Der Tab liefert ZUWÄCHSE je Bucket (nicht kumuliert) — summiert wird hier.
// Dadurch muss die Komponente keine einzige Kennzahl kennen.
//
//   const buckets = buildBuckets(from, to, granularity);
//
//   <CumulativeProgressChart
//     buckets={buckets}
//     series={[
//       { key: "termine", label: "Termine", kind: "count", values: termineByBucket },
//       { key: "shows",   label: "Shows",   kind: "count", values: showsByBucket },
//       { key: "qual",    label: "Qualifiziert", kind: "count", values: qualByBucket },
//       // Quote: Zähler in `values`, Nenner in `denominator`.
//       { key: "toClosing", label: "Zu Closing", kind: "rate",
//         values: closingsByBucket, denominator: termineByBucket, defaultOn: false },
//     ]}
//     rangeLabel="01.07. – 31.07."
//   />
//
// `values`/`denominator` sind Records `bucketKey -> Zuwachs`; fehlende Buckets
// zählen als 0. Die Bucket-Keys stammen aus `buildBuckets`/`bucketOf`
// (src/lib/analyse.ts) — dieselben Keys wie in allen anderen Charts.

import { useState } from "react";
import { Inbox } from "lucide-react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_PROPS, GRID_PROPS, LEGEND_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE, tint, vizSlot,
} from "@/lib/viz";

const INT_FMT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const PCT_FMT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * `count` — Menge, kumuliert als laufende Summe (linke Achse).
 * `rate`  — Quote, kumuliert als LAUFENDE Quote (rechte Achse, Prozent).
 */
export type CumulativeSeriesKind = "count" | "rate";

export type CumulativeSeries = {
  /** Stabiler Schlüssel: dataKey im Chart und Identität der Chip-Auswahl. */
  key: string;
  label: string;
  kind: CumulativeSeriesKind;
  /**
   * Zuwachs je Bucket-Key (`buildBuckets(...).key`). Fehlende Buckets = 0.
   * Bei `kind: "rate"` ist das der ZÄHLER.
   */
  values: Record<string, number>;
  /**
   * Nur bei `kind: "rate"`: Nenner-Zuwachs je Bucket-Key.
   * Fehlt er, bleibt die Serie leer (statt still auf eine Menge zu kippen).
   */
  denominator?: Record<string, number>;
  /** Beim ersten Rendern aktiv. Ohne Angabe: nur die erste Serie ist an. */
  defaultOn?: boolean;
};

export type CumulativeProgressChartProps = {
  /** Lückenlose Bucket-Liste aus `buildBuckets(from, to, granularity)`. */
  buckets: { key: string; label: string }[];
  /** Auswählbare Kurven. Reihenfolge = Chip- und Farbreihenfolge. */
  series: CumulativeSeries[];
  height?: number;
  /** Erscheint in der Fußnote, z. B. "01.07. – 31.07.". */
  rangeLabel?: string;
  /** Zusätzliche Fußnote unter der Standard-Fußnote (tab-spezifischer Hinweis). */
  note?: string;
};

type Point = { label: string; [series: string]: number | string | null };

/** Leerzustand nach COMPONENTS.md §14.1: Icon → Zustand → was hilft. */
function EmptyState({ height, text, hint }: { height: number; text: string; hint: string }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-3)",
        textAlign: "center",
        padding: "var(--sp-6)",
      }}
    >
      <Inbox size={20} color="var(--text-muted)" aria-hidden />
      <span style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)" }}>{text}</span>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{hint}</span>
    </div>
  );
}

/**
 * Mehrfachauswahl-Chip. Bewusst KEIN `Segmented` (COMPONENTS.md §3.6): das ist
 * Single-Select — genau das Gegenteil dessen, was hier gebraucht wird, nämlich
 * mehrere Kurven gleichzeitig.
 *
 * Der Farbpunkt trägt die Serienfarbe, damit Chip und Kurve ohne Legenden-
 * Suche zusammenfinden. Aktiv/Inaktiv hängt nie an der Farbe allein: Füllung,
 * Rahmen, Textfarbe und `aria-pressed` tragen den Zustand mit.
 */
function SeriesChip({
  label,
  color,
  active,
  onToggle,
}: {
  label: string;
  color: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 28,
        padding: "0 var(--sp-5)",
        fontSize: "var(--fs-sm)",
        fontWeight: active ? 600 : 500,
        fontFamily: "inherit",
        cursor: "pointer",
        borderRadius: "var(--r-full)",
        whiteSpace: "nowrap",
        background: active ? tint(color, 14) : "var(--surface-1)",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        border: `1px solid ${active ? tint(color, 45) : "var(--border-default)"}`,
        transition: "background var(--transition-fast), border-color var(--transition-fast)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          opacity: active ? 1 : 0.4,
          flexShrink: 0,
        }}
      />
      {label}
    </button>
  );
}

/** Standard-Auswahl: `defaultOn`, sonst die erste Serie. */
function initialSelection(series: CumulativeSeries[]): Set<string> {
  const explicit = series.filter((s) => s.defaultOn).map((s) => s.key);
  if (explicit.length > 0) return new Set(explicit);
  return new Set(series.length > 0 ? [series[0].key] : []);
}

export function CumulativeProgressChart({
  buckets,
  series,
  height = 260,
  rangeLabel,
  note,
}: CumulativeProgressChartProps) {
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(series));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Farbe hängt am Registrierungs-Index, NICHT an der Auswahl: sonst wechselte
  // eine Kurve ihre Farbe, sobald eine andere ab- oder zugeschaltet wird.
  const colorOf = (key: string): string => {
    const idx = series.findIndex((s) => s.key === key);
    return vizSlot(idx < 0 ? 0 : idx);
  };

  const active = series.filter((s) => selected.has(s.key));
  const hasCounts = active.some((s) => s.kind === "count");
  const hasRates = active.some((s) => s.kind === "rate");

  // ── Kumulation ─────────────────────────────────────────────
  // Mengen: laufende Summe.
  // Quoten: Summe(Zähler bis i) / Summe(Nenner bis i) — die LAUFENDE Quote.
  // Nicht die Summe der Bucket-Quoten: die wüchse ins Unendliche und wäre
  // ohnehin ungewichtet (ein Tag mit 1 Termin zählte wie einer mit 40).
  // Solange der Nenner 0 ist, gibt es keine Quote → `null` (Lücke im Chart,
  // `connectNulls` bleibt aus). Eine 0 wäre dort eine Behauptung.
  const running: Record<string, number> = {};
  const runningDenom: Record<string, number> = {};
  const data: Point[] = buckets.map((b) => {
    const point: Point = { label: b.label };
    for (const s of active) {
      running[s.key] = (running[s.key] ?? 0) + (s.values[b.key] ?? 0);
      if (s.kind === "rate") {
        runningDenom[s.key] = (runningDenom[s.key] ?? 0) + (s.denominator?.[b.key] ?? 0);
        const d = runningDenom[s.key];
        point[s.key] = d === 0 ? null : Math.round((running[s.key] / d) * 1000) / 10;
      } else {
        point[s.key] = running[s.key];
      }
    }
    return point;
  });

  const nothingToShow =
    buckets.length === 0 ||
    active.every((s) => (running[s.key] ?? 0) === 0 && (runningDenom[s.key] ?? 0) === 0);

  const chips = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-4)" }} role="group" aria-label="Kurven">
      {series.map((s) => (
        <SeriesChip
          key={s.key}
          label={s.label}
          color={colorOf(s.key)}
          active={selected.has(s.key)}
          onToggle={() => toggle(s.key)}
        />
      ))}
    </div>
  );

  const labelByKey = new Map(series.map((s) => [s.key, s.label]));
  const kindByKey = new Map(series.map((s) => [s.key, s.kind]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      {chips}

      {active.length === 0 ? (
        <EmptyState
          height={height}
          text="Keine Kurve ausgewählt."
          hint="Wähle oben mindestens eine Kennzahl."
        />
      ) : nothingToShow ? (
        <EmptyState
          height={height}
          text="Für diesen Zeitraum gibt es nichts zu zeigen."
          hint="Wähle einen größeren Zeitraum oder mehr Personen."
        />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {/* left: -20 zieht die linke Achse an den Rand (Konvention der übrigen
              Analyse-Charts). Ohne Mengen-Serie gibt es dort nichts zu ziehen —
              dann bliebe die Fläche links angeschnitten. */}
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: hasCounts ? -20 : 8 }}>
            {/* Gridlines nur horizontal (COMPONENTS.md §9). */}
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            {/* Zwei Achsen sind hier eine bewusste Abweichung von der Ein-Achsen-
                Regel (COMPONENTS.md §9): Mengen und Quoten in einer Skala heißt,
                dass 400 kumulierte Termine jede Quote unter 5 % platt auf die
                Nulllinie drücken — die Quotenkurve wäre nicht mehr lesbar.
                Achsen erscheinen nur, wenn eine passende Serie aktiv ist. */}
            {hasCounts && <YAxis yAxisId="menge" allowDecimals={false} {...AXIS_PROPS} />}
            {hasRates && (
              <YAxis
                yAxisId="quote"
                orientation="right"
                domain={[0, "auto"]}
                {...AXIS_PROPS}
                tickFormatter={(v: number) => `${v} %`}
              />
            )}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={{ color: "var(--text-primary)" }}
              formatter={(value, name) => {
                const key = String(name);
                const label = labelByKey.get(key) ?? key;
                if (value === null || value === undefined) return ["—", label];
                const num = Number(value);
                if (!Number.isFinite(num)) return ["—", label];
                return [
                  kindByKey.get(key) === "rate" ? `${PCT_FMT.format(num)} %` : INT_FMT.format(num),
                  label,
                ];
              }}
            />
            {active.length > 1 && (
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={LEGEND_STYLE}
                formatter={(value) => labelByKey.get(String(value)) ?? String(value)}
              />
            )}

            {/* Mengen als Fläche (max. 10 % Deckung, COMPONENTS.md §9) — die
                wachsende Fläche ist der eigentliche Motivations-Effekt.
                Quoten als reine Linie: eine gefüllte Quote suggeriert ein
                Volumen, das sie nicht hat. */}
            {active.map((s) =>
              s.kind === "count" ? (
                <Area
                  key={s.key}
                  yAxisId="menge"
                  type="monotone"
                  dataKey={s.key}
                  stroke={colorOf(s.key)}
                  strokeWidth={2}
                  fill={colorOf(s.key)}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  yAxisId="quote"
                  type="monotone"
                  dataKey={s.key}
                  stroke={colorOf(s.key)}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Nur noch der Bezugszeitraum, keine Methodik-Erklärung.
          Der Satz „Kumuliert ab dem ersten Tag …" stand hier dauerhaft unter
          jedem Chart — genau die Art Text, die der Auftraggeber hinter ein
          Info-Icon haben wollte. Er steht jetzt im `info` der umgebenden
          Sektion. Was bleibt, ist der Zeitraum selbst: Er beschriftet, worauf
          sich die Kurve bezieht, und ist damit Teil der Achse, nicht Erklärung.
          `note` bleibt für den seltenen Fall, dass ein Tab eine Zahl
          qualifizieren muss (z. B. „Log startet am …"). */}
      {(rangeLabel || note) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rangeLabel && (
            <span
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--text-subtle)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Kumuliert ab {rangeLabel}
            </span>
          )}
          {note && (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-subtle)" }}>{note}</span>
          )}
        </div>
      )}
    </div>
  );
}
