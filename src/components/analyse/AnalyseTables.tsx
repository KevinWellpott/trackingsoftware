import type { CSSProperties, ReactNode } from "react";
import { Inbox } from "lucide-react";
import { eur, fmtPct } from "@/lib/analyse";

// Tabellarische Bausteine des Analyse-Bereichs. Rein serverseitig gerendert —
// keine Direktive, kein State.
//
//   MetricTable  Segment × Kennzahlen. Der Arbeitspferd-Baustein: jede
//                „X aufgeschlüsselt nach Y"-Frage landet hier.
//   ShareBar     100 %-Balken für eine Verteilung (Stimmung, Status …).
//   StatRow      Zwei bis vier Zahlen nebeneinander unter einer Sektion.
//
// Dichte wie ComparisonTable (COMPONENTS.md §6): 36px-Zeilen, Header 12px
// uppercase, nur horizontale Hairlines, Zahlen rechtsbündig mit tabular-nums.

const INT_FMT = new Intl.NumberFormat("de-DE");
const DEC1_FMT = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export type MetricFormat = "int" | "pct" | "eur" | "num1" | "text";

export type MetricColumn = {
  key: string;
  label: string;
  format: MetricFormat;
  /** Hebt die Spalte hervor (kräftigerer Text) — für die Leitkennzahl. */
  emphasis?: boolean;
};

export type MetricRow = {
  key: string;
  label: string;
  /** Zweite Zeile unter dem Label (Besitzer, Textsatz, Anmerkung …). */
  sub?: ReactNode;
  /** 0–1: dünner Balken unter dem Label, Anteil an der Gesamtmenge. */
  share?: number | null;
  /** Farbe des Anteil-Balkens; Default = Orange-Rampe. */
  color?: string;
  values: Record<string, number | string | null>;
};

export function formatMetric(v: number | string | null | undefined, format: MetricFormat): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (format === "pct") return fmtPct(v);
  if (format === "eur") return eur(v);
  if (format === "num1") return DEC1_FMT.format(v);
  return INT_FMT.format(v);
}

const CELL_PAD = "var(--sp-3) var(--sp-5)";

// Kopfzeile identisch zu ComparisonTable — beide Tabellen stehen auf derselben
// Seite untereinander, unterschiedliche Kopfzeilen läsen sich als zwei Systeme.
const HEAD_STYLE: CSSProperties = {
  height: "var(--h-row)",
  fontSize: "var(--fs-xs)",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "var(--ls-eyebrow)",
  color: "var(--text-muted)",
  padding: "0 var(--sp-5)",
  background: "var(--surface-1)",
  whiteSpace: "nowrap",
};

const NUM_CELL: CSSProperties = {
  padding: CELL_PAD,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontSize: "var(--fs-base)",
  fontWeight: 500,
  color: "var(--text-primary)",
  whiteSpace: "nowrap",
};

export function MetricTable({
  label = "Segment",
  columns,
  rows,
  total,
  totalLabel = "Gesamt",
  emptyHint = "Für diesen Zeitraum gibt es nichts zu zeigen.",
  minWidth = 560,
}: {
  /** Überschrift der ersten Spalte. */
  label?: string;
  columns: MetricColumn[];
  rows: MetricRow[];
  total?: Record<string, number | string | null>;
  totalLabel?: string;
  emptyHint?: string;
  minWidth?: number;
}) {
  if (rows.length === 0) {
    // Leerzustand nach COMPONENTS.md §14.1 — Icon, ein Satz, ein Hinweis.
    return (
      <div
        style={{
          padding: "var(--sp-9) 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--sp-3)",
          textAlign: "center",
        }}
      >
        <Inbox size={20} color="var(--text-muted)" aria-hidden />
        <span style={{ fontSize: "var(--fs-base)", color: "var(--text-secondary)" }}>{emptyHint}</span>
      </div>
    );
  }

  return (
    <div className="table-scroll" style={{ overflowX: "auto" }}>
      <table style={{ minWidth, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...HEAD_STYLE, textAlign: "left" }}>{label}</th>
            {columns.map((c) => (
              <th key={c.key} style={{ ...HEAD_STYLE, textAlign: "right" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="funnel-matrix-row" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: CELL_PAD, minWidth: 140 }}>
                <div style={{ fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-primary)" }}>
                  {row.label}
                </div>
                {row.sub && (
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginTop: 1 }}>{row.sub}</div>
                )}
                {row.share != null && (
                  // Schmaler als die Label-Spalte und mit sichtbarer Bahn —
                  // eine Leiste in Textbreite auf unsichtbarer Bahn liest sich
                  // sonst als Unterstreichung des Labels, nicht als Anteil.
                  <div
                    aria-hidden
                    style={{
                      marginTop: "var(--sp-3)",
                      width: 96,
                      maxWidth: "100%",
                      height: 4,
                      borderRadius: 99,
                      // Neutrale Bahn statt Tint der eigenen Farbe: bei den
                      // tiefen Stufen der Orange-Rampe wäre ein 22 %-Tint kaum
                      // vom Füllstand zu unterscheiden — der Balken sähe immer
                      // voll aus.
                      background: "var(--surface-3)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(Math.min(row.share, 1) * 100, 2)}%`,
                        borderRadius: 99,
                        background: row.color ?? "var(--viz-1)",
                      }}
                    />
                  </div>
                )}
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    ...NUM_CELL,
                    fontWeight: c.emphasis ? 600 : 500,
                    color: c.emphasis ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {formatMetric(row.values[c.key], c.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="funnel-matrix-row" style={{ borderTop: "1px solid var(--border-default)" }}>
              <td style={{ padding: CELL_PAD, fontSize: "var(--fs-base)", fontWeight: 500, color: "var(--text-muted)" }}>
                {totalLabel}
              </td>
              {columns.map((c) => (
                <td key={c.key} style={{ ...NUM_CELL, color: "var(--text-muted)" }}>
                  {formatMetric(total[c.key], c.format)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── ShareBar ─────────────────────────────────────────────────
// Eine Verteilung als ein einziger 100 %-Balken. Für Stimmungs- und
// Status-Splits deutlich lesbarer als ein Donut, wenn mehrere Splits
// untereinander VERGLICHEN werden sollen (gemeinsame Grundlinie).

export type ShareSegment = { label: string; value: number; color: string };

export function ShareBar({
  segments,
  caption,
  height = 10,
  showLegend = true,
  /** Legende ohne Zahlen — für eine gemeinsame Legende über mehreren Balken. */
  legendValues = true,
}: {
  segments: ShareSegment[];
  /** Kleine Zeile über dem Balken (z. B. Stufe + n). */
  caption?: ReactNode;
  height?: number;
  showLegend?: boolean;
  legendValues?: boolean;
}) {
  const total = segments.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      {caption && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--sp-5)",
            fontSize: "var(--fs-sm)",
            color: "var(--text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {caption}
        </div>
      )}
      <div style={{ display: "flex", height, borderRadius: 99, overflow: "hidden", background: "var(--surface-1)" }}>
        {total === 0 ? (
          <div style={{ flex: 1 }} aria-hidden />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.label}
                title={`${s.label}: ${INT_FMT.format(s.value)}`}
                style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                aria-hidden
              />
            ))
        )}
      </div>
      {showLegend && <ShareLegend segments={segments} withValues={legendValues} />}
    </div>
  );
}

/**
 * Farblegende einer Verteilung. Eigenständig nutzbar, wenn mehrere ShareBars
 * untereinander stehen: dort gehört EINE Legende über den Block, und die Zahlen
 * stehen je Balken in der Kopfzeile — eine Legende mit den Werten nur einer
 * Zeile liest sich sonst wie die Summe aller.
 */
export function ShareLegend({
  segments,
  withValues = true,
}: {
  segments: ShareSegment[];
  withValues?: boolean;
}) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3) var(--sp-6)" }}>
      {segments.map((s) => (
        <span
          key={s.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            fontSize: "var(--fs-xs)",
            color: "var(--text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} aria-hidden />
          {s.label}
          {withValues && ` ${INT_FMT.format(s.value)}`}
          {withValues && total > 0 && (
            <span style={{ color: "var(--text-subtle)" }}>· {Math.round((s.value / total) * 100)} %</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ── StatRow ──────────────────────────────────────────────────
// Ein paar nackte Zahlen unter einer Sektion, ohne eigene Karte — für
// Kontextwerte, die keine KPI-Kachel verdienen.

export function StatRow({
  items,
}: {
  items: { label: string; value: string; tone?: "default" | "success" | "warning" | "error" }[];
}) {
  const toneColor = (t?: string) =>
    t === "success" ? "var(--success-fg)" : t === "warning" ? "var(--warning-fg)" : t === "error" ? "var(--danger-fg)" : "var(--text-primary)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`,
        gap: "var(--sp-6)",
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="eyebrow eyebrow-muted">{it.label}</span>
          <span
            style={{
              fontSize: "var(--fs-lg)",
              fontWeight: 600,
              letterSpacing: "var(--ls-tight)",
              color: toneColor(it.tone),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Hinweiszeile ─────────────────────────────────────────────
// Für Methodik-Fußnoten unter einer Sektion (z. B. worauf eine Zuordnung
// beruht). Bewusst unaufgeregt: kleine, gedämpfte Zeile statt Info-Box.

export function Footnote({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: "var(--sp-5) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-subtle)", lineHeight: 1.5 }}>
      {children}
    </p>
  );
}
