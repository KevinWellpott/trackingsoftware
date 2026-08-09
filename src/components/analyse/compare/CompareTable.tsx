// Die Ablese-Tabelle unter dem Chart.
//
// Ein Chart zeigt den Verlauf, aber „was läuft besser" liest man daraus nur
// als Schätzung. Deshalb steht darunter je Serie: Gesamt, Ø je Periode und
// der Abstand zur ersten Serie — Letzteres ist die eigentliche Antwort.
//
// Serverseitig gerendert; die Werte sind bereits fertig gerechnet und werden
// hier nur noch formatiert.

import { MetricTable, type MetricRow } from "@/components/analyse/AnalyseTables";
import { formatDelta, formatValue, type SeriesResult } from "@/lib/compare/series";

export function CompareTable({ series }: { series: SeriesResult[] }) {
  const base = series[0];

  const rows: MetricRow[] = series.map((s, i) => ({
    key: `s${i}`,
    label: s.metric.label,
    sub: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }}
        />
        {s.filterLabel || "alle Daten"}
      </span>
    ),
    values: {
      total: formatValue(s.total, s.metric.format),
      avg: formatValue(s.avg, s.metric.format),
      // Die Referenzserie vergleicht sich nicht mit sich selbst.
      delta: i === 0 ? "—" : formatDelta(s.total, base.total, s.metric.format, base.metric.format),
    },
  }));

  return (
    <MetricTable
      label="Serie"
      columns={[
        { key: "total", label: "Gesamt", format: "text", emphasis: true },
        { key: "avg", label: "Ø je Periode", format: "text" },
        { key: "delta", label: `Δ zu „${base?.metric.label ?? "Serie 1"}"`, format: "text" },
      ]}
      rows={rows}
      minWidth={560}
      emptyHint="Noch keine Serie ausgewählt."
    />
  );
}
