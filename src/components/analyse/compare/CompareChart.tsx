"use client";

// Der Vergleichs-Chart: beliebig viele Serien nebeneinander.
//
// Bewusst reine LINIEN, auch für Mengen — anders als der
// CumulativeProgressChart, wo die wachsende Fläche der Motivations-Effekt
// ist. Hier liegen bis zu sechs Serien übereinander; gefüllte Flächen
// verdeckten einander und die Frage „welche liegt oben" wäre nicht mehr
// beantwortbar. Quoten bleiben gestrichelt: dieselbe Konvention wie im
// Fortschritts-Chart, damit man Menge und Quote ohne Legendensuche trennt.

import { AlertTriangle, Inbox } from "lucide-react";
import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_PROPS, GRID_PROPS, LEGEND_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE,
} from "@/lib/viz";
import type { MetricFormat } from "@/lib/compare/metrics";
import { formatValue } from "@/lib/compare/series";

export type ChartSeries = {
  /** Stabiler dataKey (Serien-Index) — nicht das Label, das kann doppelt sein. */
  key: string;
  label: string;
  color: string;
  format: MetricFormat;
  points: (number | null)[];
};

type Point = { label: string; [series: string]: number | string | null };

/**
 * Leerzustand.
 *
 * `notes` trägt die STRUKTURELLEN Gründe (Kennzahl und Filter können in keinem
 * Zeitraum zusammenpassen — z. B. „DMs" im Kanal Telefon). Liegt so einer vor,
 * wäre der Standardrat „Zeitraum vergrößern" eine Falschauskunft: Man könnte
 * das ganze Jahr wählen und bekäme dieselbe leere Fläche.
 */
function EmptyState({ height, notes }: { height: number; notes: string[] }) {
  const structural = notes.length > 0;
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
      {structural ? (
        <AlertTriangle size={20} color="var(--warning-fg)" aria-hidden />
      ) : (
        <Inbox size={20} color="var(--text-muted)" aria-hidden />
      )}
      <span style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)" }}>
        {structural
          ? "Diese Kombination kann keine Zahlen liefern."
          : "Für diese Serien gibt es im Zeitraum nichts zu zeigen."}
      </span>
      {structural ? (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-2)",
            fontSize: "var(--fs-xs)",
            lineHeight: 1.45,
            color: "var(--warning-fg)",
            maxWidth: "44ch",
          }}
        >
          {notes.map((n) => (
            <li key={n}>{n}.</li>
          ))}
        </ul>
      ) : (
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          Zeitraum vergrößern oder einen Filter entfernen.
        </span>
      )}
    </div>
  );
}

export function CompareChart({
  buckets,
  series,
  notes = [],
  height = 320,
}: {
  buckets: { key: string; label: string }[];
  series: ChartSeries[];
  /** Strukturelle Gründe für einen leeren Chart (siehe EmptyState). */
  notes?: string[];
  height?: number;
}) {
  const hasCounts = series.some((s) => s.format !== "pct");
  const hasRates = series.some((s) => s.format === "pct");

  const data: Point[] = buckets.map((b, i) => {
    const point: Point = { label: b.label };
    for (const s of series) point[s.key] = s.points[i] ?? null;
    return point;
  });

  const nothing =
    buckets.length === 0 ||
    series.length === 0 ||
    series.every((s) => s.points.every((v) => v === null || v === 0));

  if (nothing) return <EmptyState height={height} notes={notes} />;

  const labelByKey = new Map(series.map((s) => [s.key, s.label]));
  const formatByKey = new Map(series.map((s) => [s.key, s.format]));

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* left: -20 zieht die Mengen-Achse an den Rand (Konvention der übrigen
          Analyse-Charts); ohne Mengen-Serie gäbe es dort nichts zu ziehen. */}
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: hasCounts ? -20 : 8 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        {/* Zwei Achsen sind hier die Ausnahme von der Ein-Achsen-Regel
            (COMPONENTS.md §9) und der Grund, warum sich Mengen und Quoten
            überhaupt mischen lassen: 400 Termine drückten jede Quote unter
            5 % platt auf die Nulllinie. Beträge teilen sich die linke Achse
            mit den Mengen — wer Euro und Stückzahl mischt, sieht dasselbe
            Skalenproblem und kann eine Serie abwählen. */}
        {hasCounts && <YAxis yAxisId="menge" {...AXIS_PROPS} />}
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
            const format = formatByKey.get(key) ?? "int";
            const num = Number(value);
            return [Number.isFinite(num) ? formatValue(num, format) : "—", label];
          }}
        />
        {series.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={LEGEND_STYLE}
            formatter={(value) => labelByKey.get(String(value)) ?? String(value)}
          />
        )}
        {series.map((s) => (
          <Line
            key={s.key}
            yAxisId={s.format === "pct" ? "quote" : "menge"}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.format === "pct" ? "4 3" : undefined}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            // Lücken bleiben Lücken: eine durchgezogene Linie über eine
            // Periode ohne Nenner behauptete einen Wert, den es nicht gibt.
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
