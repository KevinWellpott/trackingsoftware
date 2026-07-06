"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area, AreaChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS_TICK, TOOLTIP_STYLE } from "@/components/DashboardCharts";
import { ownerColor } from "@/lib/ownerColor";
import { NumberTicker } from "@/components/magicui/number-ticker";

// Token-basierte Visualisierungs-Bausteine des Analyse-Bereichs
// ("Clinical Precision Analytics"): KPI-Heroes mit Sparkline + Delta-Badge,
// Donut, kumulierte Flächen, Wochentags-Balken, vertikaler Funnel,
// Verteilungs- und Gauge-Balken. Nur CSS-Variablen, keine Hex-Werte.

const INT_FMT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const DEC1_FMT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "+12,5 %" / "−3,2 %" für Delta-Badges (de-DE, 1 Nachkommastelle). */
function fmtDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${DEC1_FMT.format(delta)} %`;
}

const TONE_COLOR: Record<Exclude<Tone, "default">, string> = {
  success: "var(--color-success-text)",
  warning: "var(--color-warning-text)",
  error: "var(--color-error-text)",
};

export type Tone = "default" | "success" | "warning" | "error";

function EmptyState({ height = 120 }: { height?: number }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-subtle)",
        fontSize: "0.8125rem",
      }}
    >
      Noch keine Daten.
    </div>
  );
}

// ── 1 · SparkLine ────────────────────────────────────────────
export function SparkLine({
  values,
  color = "var(--brand-500)",
  width = 64,
  height = 24,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;

  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = values
    .map((v, i) => {
      // Ein einzelner Wert (oder konstante Serie) → flache Linie in der Mitte.
      const x = values.length === 1 ? pad + innerW / 2 : pad + (i / (values.length - 1)) * innerW;
      const y = span === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block" }}>
      {values.length === 1 ? (
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      ) : (
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

// ── 2 · KpiHero ──────────────────────────────────────────────
export function KpiHero({
  label,
  value,
  format = "int",
  delta,
  deltaLabel = "vs. Vorperiode",
  spark,
  tone = "default",
  icon,
  index = 0,
}: {
  label: string;
  value: number | null;
  format?: "int" | "pct" | "eur";
  delta?: number | null;
  deltaLabel?: string;
  spark?: number[];
  tone?: Tone;
  icon?: ReactNode;
  index?: number;
}) {
  const toneColor = tone === "default" ? null : TONE_COLOR[tone];
  const deltaColor =
    delta == null || delta === 0
      ? "var(--text-muted)"
      : delta > 0
        ? "var(--color-success-text)"
        : "var(--color-error-text)";
  const DeltaIcon = delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;

  return (
    <div
      className="card fade-up"
      style={{
        position: "relative",
        padding: "0.875rem 1rem",
        animationDelay: `${index * 60}ms`,
        ...(toneColor ? { borderLeft: `3px solid ${toneColor}` } : null),
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--text-subtle)",
          }}
        >
          {label}
        </span>
        {icon && <span style={{ color: "var(--text-subtle)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
      </div>

      <div
        style={{
          marginTop: "0.375rem",
          fontSize: "1.75rem",
          fontWeight: 800,
          letterSpacing: "-0.02em",
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
        }}
      >
        {value === null ? (
          "—"
        ) : format === "pct" ? (
          <>
            <NumberTicker value={value} decimalPlaces={1} />
            {" %"}
          </>
        ) : format === "eur" ? (
          <>
            <NumberTicker value={value} decimalPlaces={0} />
            {" €"}
          </>
        ) : (
          <NumberTicker value={value} decimalPlaces={0} />
        )}
      </div>

      {delta !== undefined && (
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", marginTop: "0.25rem" }}>
          {delta === null ? (
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-subtle)" }}>—</span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: deltaColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <DeltaIcon size={12} aria-hidden />
              {fmtDelta(delta)}
            </span>
          )}
          <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)" }}>{deltaLabel}</span>
        </div>
      )}

      {spark && spark.length > 0 && (
        <div style={{ position: "absolute", right: "1rem", bottom: "0.875rem", opacity: 0.9 }}>
          <SparkLine values={spark} color={toneColor ?? "var(--text-subtle)"} />
        </div>
      )}
    </div>
  );
}

// ── 3 · DonutChart ───────────────────────────────────────────
export function DonutChart({
  data,
  centerLabel,
  centerSub,
  height = 200,
}: {
  data: { name: string; value: number; color: string }[];
  centerLabel?: string;
  centerSub?: string;
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (data.length === 0 || total === 0) return <EmptyState height={height} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ position: "relative", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        {(centerLabel || centerSub) && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              textAlign: "center",
            }}
          >
            {centerLabel && (
              <span
                style={{
                  fontSize: "1.375rem",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.1,
                }}
              >
                {centerLabel}
              </span>
            )}
            {centerSub && (
              <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", marginTop: 2 }}>{centerSub}</span>
            )}
          </div>
        )}
      </div>
      {/* Eigene Legende (kleine Kreise) — unabhängig vom Pie-Zentrum positioniert. */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.375rem 0.875rem" }}>
        {data.map((d) => (
          <span
            key={d.name}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "var(--text-muted)" }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} aria-hidden />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 4 · CumulativeAreaChart ──────────────────────────────────
type AreaPoint = { label: string; [series: string]: number | string };

export function CumulativeAreaChart({
  buckets,
  perUser,
}: {
  buckets: { key: string; label: string }[];
  perUser: Record<string, Record<string, number>>;
}) {
  const seriesNames = Object.keys(perUser);
  if (buckets.length === 0 || seriesNames.length === 0) return <EmptyState height={240} />;

  const running: Record<string, number> = {};
  const data: AreaPoint[] = buckets.map((b) => {
    const point: AreaPoint = { label: b.label };
    for (const name of seriesNames) {
      running[name] = (running[name] ?? 0) + (perUser[name]?.[b.key] ?? 0);
      point[name] = running[name];
    }
    return point;
  });

  if (seriesNames.every((name) => (running[name] ?? 0) === 0)) return <EmptyState height={240} />;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {seriesNames.length > 1 && (
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
        )}
        {seriesNames.map((name) => {
          const c = ownerColor(name).fg;
          return (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stroke={c}
              strokeWidth={2}
              fill={c}
              fillOpacity={0.12}
              dot={false}
              activeDot={{ r: 3 }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── 5 · WeekdayBars ──────────────────────────────────────────
export function WeekdayBars({
  perDay,
  quoteLabel,
}: {
  perDay: { label: string; n: number; quote: number | null }[];
  quoteLabel?: string;
}) {
  if (perDay.length === 0 || perDay.every((d) => d.n === 0)) return <EmptyState height={140} />;

  const maxN = Math.max(...perDay.map((d) => d.n));
  // Bester Quoten-Tag (höchste nicht-null-Quote) wird hervorgehoben.
  let bestIdx = -1;
  for (let i = 0; i < perDay.length; i++) {
    const q = perDay[i].quote;
    if (q === null) continue;
    if (bestIdx === -1 || q > (perDay[bestIdx].quote ?? -Infinity)) bestIdx = i;
  }

  const BAR_AREA = 88;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${perDay.length}, 1fr)`, gap: "0.5rem" }}>
        {perDay.map((d, i) => {
          const best = i === bestIdx;
          const barH = maxN === 0 ? 4 : Math.max((d.n / maxN) * BAR_AREA, 4);
          return (
            <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", minWidth: 0 }}>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {INT_FMT.format(d.n)}
              </span>
              <div style={{ height: BAR_AREA, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div
                  style={{
                    width: "60%",
                    maxWidth: 28,
                    height: barH,
                    borderRadius: "4px 4px 0 0",
                    background: best ? "var(--color-success-text)" : "var(--brand-500)",
                  }}
                  aria-hidden
                />
              </div>
              <span style={{ fontSize: "0.6875rem", fontWeight: best ? 700 : 500, color: best ? "var(--text-primary)" : "var(--text-muted)" }}>
                {d.label}
              </span>
              <span style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}>
                {d.quote === null ? "—" : `${DEC1_FMT.format(d.quote)} %`}
              </span>
            </div>
          );
        })}
      </div>
      {quoteLabel && (
        <div style={{ fontSize: "0.6875rem", color: "var(--text-subtle)", textAlign: "right" }}>
          Untere Zeile: {quoteLabel}
        </div>
      )}
    </div>
  );
}

// ── 6 · BarFunnel ────────────────────────────────────────────
const FUNNEL_COLORS = [
  "var(--brand-500)",
  "var(--color-info-text)",
  "var(--accent-500)",
  "var(--color-warning-text)",
  "var(--color-success-text)",
];

export function BarFunnel({
  stages,
  trailing,
}: {
  stages: { label: string; value: number }[];
  trailing?: { label: string; value: string };
}) {
  if (stages.length === 0 || stages.every((s) => s.value === 0)) return <EmptyState height={160} />;

  const base = stages[0].value;

  // Innen-Beschriftung auf eigenem Scrim-Pill — in beiden Themes lesbar,
  // unabhängig von der Balkenfarbe (Text trägt Text-Tokens, nie Serienfarbe).
  const pillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "0.375rem",
    padding: "0.125rem 0.5rem",
    borderRadius: 99,
    background: "color-mix(in srgb, var(--surface-0) 82%, transparent)",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {stages.map((s, i) => {
        const widthPct = base === 0 ? 8 : Math.max((s.value / base) * 100, 8);
        const inside = widthPct >= 38;
        const conv = i > 0 ? (stages[i - 1].value === 0 ? null : (s.value / stages[i - 1].value) * 100) : null;
        const content = (
          <span style={pillStyle}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)" }}>{s.label}</span>
            <span style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {INT_FMT.format(s.value)}
            </span>
          </span>
        );

        return (
          <div key={s.label}>
            {i > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem", padding: "0.25rem 0" }}>
                <ChevronDown size={12} style={{ color: "var(--text-subtle)" }} aria-hidden />
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    background: "var(--surface-150)",
                    border: "1px solid var(--border)",
                    borderRadius: 99,
                    padding: "0.0625rem 0.5rem",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {conv === null ? "—" : `${DEC1_FMT.format(conv)} %`}
                </span>
              </div>
            )}
            <div style={{ position: "relative", height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div
                style={{
                  width: `${widthPct}%`,
                  height: 44,
                  borderRadius: "var(--radius-md)",
                  background: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {inside && content}
              </div>
              {!inside && (
                <div
                  style={{
                    position: "absolute",
                    left: `calc(50% + ${widthPct / 2}% + 0.5rem)`,
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                >
                  {content}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {trailing && (
        <div
          style={{
            marginTop: "0.375rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            padding: "0.625rem 0.875rem",
            borderRadius: "var(--radius-md)",
            background: "var(--color-success-bg)",
            border: "1px solid var(--color-success-border)",
          }}
        >
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-success-text)" }}>{trailing.label}</span>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 800,
              color: "var(--color-success-text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {trailing.value}
          </span>
        </div>
      )}
    </div>
  );
}

// ── 7 · DistBars ─────────────────────────────────────────────
export function DistBars({
  items,
  total,
  max,
}: {
  items: { label: string; value: number; color?: string }[];
  total?: number;
  max?: number;
}) {
  if (items.length === 0 || items.every((it) => it.value === 0)) return <EmptyState height={100} />;

  const shown = max !== undefined ? items.slice(0, max) : items;
  const rest = items.length - shown.length;
  const denom = total && total > 0 ? total : Math.max(...items.map((it) => it.value), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      {shown.map((it) => {
        const color = it.color ?? "var(--brand-500)";
        const widthPct = Math.min((it.value / denom) * 100, 100);
        return (
          <div key={it.label} style={{ display: "flex", flexDirection: "column", gap: "0.1875rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
              <span
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {it.label}
              </span>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {INT_FMT.format(it.value)}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: `color-mix(in srgb, ${color} 25%, transparent)` }}>
              <div style={{ height: 6, width: `${widthPct}%`, borderRadius: 99, background: color }} aria-hidden />
            </div>
          </div>
        );
      })}
      {rest > 0 && (
        <span style={{ fontSize: "0.75rem", color: "var(--text-subtle)" }}>+{rest} weitere</span>
      )}
    </div>
  );
}

// ── 8 · GaugeBar ─────────────────────────────────────────────
export function GaugeBar({
  label,
  value,
  max = 10,
}: {
  label: string;
  value: number | null;
  max?: number;
}) {
  const zoneColor =
    value === null
      ? "var(--surface-300)"
      : value < 4
        ? "var(--color-error-text)"
        : value <= 7
          ? "var(--color-warning-text)"
          : "var(--color-success-text)";
  const fillPct = value === null ? 0 : Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--text-subtle)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: "1.25rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {value === null ? "—" : DEC1_FMT.format(value)}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: "var(--surface-150)", overflow: "hidden" }}>
        <div
          style={{
            height: 8,
            width: `${fillPct}%`,
            borderRadius: 99,
            background: zoneColor,
            transition: "width 320ms ease",
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
