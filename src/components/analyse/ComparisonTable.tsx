import { ownerColor, ownerInitials } from "@/lib/ownerColor";
import { eur, fmtPct } from "@/lib/analyse";

// Server-präsentative Vergleichstabelle für den Analyse-Bereich: eine Zeile pro
// Person, formatierte Wertspalten (int/pct/eur), optionale Δ-vs-Ø-Sublabels und
// eine Ø-Fußzeile. Keine Direktive — rein serverseitig gerendert.

export type ComparisonFormat = "int" | "pct" | "eur";

export type ComparisonColumn = {
  key: string;
  label: string;
  format: ComparisonFormat;
  /** Zeigt unter dem Wert die Differenz (in pp) zum Ø an. */
  deltaVsAvg?: boolean;
};

export type ComparisonRow = {
  name: string;
  values: Record<string, number | null>;
};

const INT_FMT = new Intl.NumberFormat("de-DE");
const DELTA_FMT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatValue(v: number | null, format: ComparisonFormat): string {
  if (v === null) return "—";
  if (format === "pct") return fmtPct(v);
  if (format === "eur") return eur(v);
  return INT_FMT.format(v);
}

const CELL_PAD = "0.5rem 0.75rem";
const HEAD_STYLE = {
  fontSize: "0.6875rem",
  fontWeight: 700 as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "var(--text-subtle)",
  padding: CELL_PAD,
  whiteSpace: "nowrap" as const,
};

function DeltaSub({ value }: { value: number }) {
  const positive = value >= 0;
  const sign = positive ? "+" : "−";
  const color = positive ? "var(--color-success-text)" : "var(--color-error-text)";
  return (
    <span style={{ display: "block", fontSize: "0.625rem", fontWeight: 600, color, marginTop: 1 }}>
      {sign}
      {DELTA_FMT.format(Math.abs(value))} pp
    </span>
  );
}

export function ComparisonTable({
  columns,
  rows,
  average,
  averageLabel,
}: {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  average?: Record<string, number | null>;
  averageLabel?: string;
}) {
  return (
    <div className="table-scroll" style={{ overflowX: "auto" }}>
      <table style={{ minWidth: 640, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...HEAD_STYLE, textAlign: "left" }}>Person</th>
            {columns.map((c) => (
              <th key={c.key} style={{ ...HEAD_STYLE, textAlign: "right" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const color = ownerColor(row.name);
            return (
              <tr key={row.name} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: CELL_PAD }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: color.bg,
                        color: color.fg,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.6875rem",
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {ownerInitials(row.name)}
                    </span>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>
                      {row.name}
                    </span>
                  </span>
                </td>
                {columns.map((c) => {
                  const v = row.values[c.key] ?? null;
                  const avg = average?.[c.key] ?? null;
                  const showDelta = c.deltaVsAvg && average !== undefined && v !== null && avg !== null;
                  return (
                    <td
                      key={c.key}
                      style={{
                        padding: CELL_PAD,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: "0.8125rem",
                        color: "var(--text-primary)",
                      }}
                    >
                      {formatValue(v, c.format)}
                      {showDelta && <DeltaSub value={(v as number) - (avg as number)} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {average && (
          <tfoot>
            <tr style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: CELL_PAD, fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-muted)" }}>
                {averageLabel ?? "Ø Gesamt"}
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    padding: CELL_PAD,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "0.8125rem",
                    color: "var(--text-muted)",
                  }}
                >
                  {formatValue(average[c.key] ?? null, c.format)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
