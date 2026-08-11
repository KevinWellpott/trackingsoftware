"use client";

import { ownerColor as ownerColorShared } from "@/lib/ownerColor";
import {
  AXIS_PROPS,
  BAR_RADIUS,
  CURSOR_FILL,
  GRID_PROPS,
  LEGEND_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  VIZ,
  tint,
} from "@/lib/viz";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// Charts im Ember-Glass-System (COMPONENTS.md §9):
// feste Viz-Slot-Reihenfolge, horizontales Grid, achsenlose Achsen,
// Glass-Tooltip, Balkenradius nur oben, Linienpunkte nur bei Hover.

// Serien in fixer Slot-Reihenfolge: DMs = Slot 1 (Marken-Orange),
// Antworten = Slot 2, Termine = Slot 3. Nie nach Rang umfaerben.
export const METRIC_COLORS = {
  dms: VIZ[0],
  answers: VIZ[1],
  appointments: VIZ[2],
  followups: "#d1a24f",
};

export { tint, TOOLTIP_STYLE };

// ── Owner colors (dynamic roster) ────────────────────────────
// Delegiert an die zentrale Slot-Zuordnung (src/lib/ownerColor.ts).
export function ownerColor(name: string): string {
  return ownerColorShared(name).fg;
}

export const AXIS_TICK = AXIS_PROPS.tick;
export { CURSOR_FILL };

const CHART_MARGIN = { top: 8, right: 4, bottom: 0, left: -20 };

function tooltipProps() {
  return {
    contentStyle: TOOLTIP_STYLE,
    labelStyle: TOOLTIP_LABEL_STYLE,
    itemStyle: { color: "var(--text-primary)" },
    cursor: CURSOR_FILL,
  };
}

function legendProps() {
  return { iconType: "circle" as const, iconSize: 8, wrapperStyle: LEGEND_STYLE };
}

// ── Multi-metric grouped bar chart ──────────────────────────
export type MultiMetricDay = {
  date: string;
  dms: number;
  answers: number;
  appointments: number;
};

export function MultiMetricBarChart({ data }: { data: MultiMetricDay[] }) {
  if (data.every((d) => d.dms === 0)) {
    return <EmptyState />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={8} barGap={2} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" {...AXIS_PROPS} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} />
        <Tooltip {...tooltipProps()} />
        <Legend {...legendProps()} />
        <Bar dataKey="dms" name="DMs" fill={METRIC_COLORS.dms} radius={BAR_RADIUS} />
        <Bar dataKey="answers" name="Antworten" fill={METRIC_COLORS.answers} radius={BAR_RADIUS} />
        <Bar dataKey="appointments" name="Termine" fill={METRIC_COLORS.appointments} radius={BAR_RADIUS} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Single metric bar chart ──────────────────────────────────
type DailyBar = { date: string; pitches: number };

export function PitchesBarChart({ data }: { data: DailyBar[] }) {
  if (data.every((d) => d.pitches === 0)) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} barSize={18} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="date" {...AXIS_PROPS} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} />
        <Tooltip {...tooltipProps()} />
        <Bar dataKey="pitches" name="DMs" fill={METRIC_COLORS.dms} radius={BAR_RADIUS} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Answer donut ─────────────────────────────────────────────
type AnswerDonut = { name: string; value: number; color: string };

export function AnswerDonutChart({ data }: { data: AnswerDonut[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <EmptyState text="Noch keine Antworten." height={200} />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={48}
          outerRadius={72}
          paddingAngle={3}
          dataKey="value"
          stroke="var(--surface-2)"
          strokeWidth={2}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={{ color: "var(--text-primary)" }} />
        <Legend {...legendProps()} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Mini sparkline for person cards ─────────────────────────
export type SparkPoint = { date: string; value: number };

export function SparkLineChart({ data, color }: { data: SparkPoint[]; color: string }) {
  if (data.every((d) => d.value === 0)) return <EmptyState height={60} />;
  return (
    // Sparkline: 1.5px-Linie, keine Achsen, keine Punkte (COMPONENTS.md §8).
    <ResponsiveContainer width="100%" height={60}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={{ color: "var(--text-primary)" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Personal weekly trend (DMs als Balken, Termine als Linie) ─
export type PersonalWeekPoint = { week: string; dms: number; appts: number };

export function PersonalWeeklyChart({ data }: { data: PersonalWeekPoint[] }) {
  if (data.every((d) => d.dms === 0 && d.appts === 0)) {
    return <EmptyState text="Noch keine Verlaufsdaten." />;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} barSize={18} margin={{ top: 8, right: -16, bottom: 0, left: -20 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="week" {...AXIS_PROPS} />
        <YAxis yAxisId="dms" allowDecimals={false} {...AXIS_PROPS} />
        <YAxis yAxisId="appts" orientation="right" allowDecimals={false} {...AXIS_PROPS} />
        <Tooltip {...tooltipProps()} />
        <Legend {...legendProps()} />
        <Bar yAxisId="dms" dataKey="dms" name="DMs" fill={METRIC_COLORS.dms} radius={BAR_RADIUS} />
        <Line
          yAxisId="appts"
          type="monotone"
          dataKey="appts"
          name="Termine"
          stroke={METRIC_COLORS.answers}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: METRIC_COLORS.answers }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Historical weekly duel chart (dynamic roster) ────────────
export type DuelSeries = { name: string; color: string };
export type WeeklyDuelPoint = { week: string; values: Record<string, number> };

/**
 * Ziel-Linie im Duell-Verlauf — Neutralton, kein Gold.
 *
 * Die Linie stand in `METRIC_COLORS.followups` (#d1a24f). Das ist die Farbe der
 * Nachfass-Metrik und meint hier gar nichts; auf dem Team-Dashboard war sie nur
 * noch die letzte Fremdfarbe neben der Marken-Rampe der Personen. Exportiert,
 * damit die Legende in WochenduellSection denselben Ton fuehrt wie die Linie —
 * die beiden liefen vorher schon einmal auseinander.
 */
export const DUEL_GOAL_COLOR = "var(--text-muted)";

export function WeeklyDuelChart({ data, series, goal }: { data: WeeklyDuelPoint[]; series: DuelSeries[]; goal: number }) {
  if (series.length === 0 || data.every((d) => series.every((s) => (d.values[s.name] ?? 0) === 0))) {
    return <EmptyState text="Noch keine Verlaufsdaten." />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={8} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="week" {...AXIS_PROPS} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} />
        <Tooltip {...tooltipProps()} />
        <Legend {...legendProps()} />
        {series.map((s) => (
          <Bar
            key={s.name}
            dataKey={(d: WeeklyDuelPoint) => d.values[s.name] ?? 0}
            name={s.name}
            fill={s.color}
            radius={BAR_RADIUS}
          />
        ))}
        {/* Ziel als echte Referenzlinie statt als unsichtbarer Balken. */}
        {goal > 0 && (
          <ReferenceLine
            y={goal}
            stroke={DUEL_GOAL_COLOR}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: `Ziel ${goal}`, position: "right", fill: DUEL_GOAL_COLOR, fontSize: 11 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyState({ text = "Noch keine Daten.", height = 120 }: { text?: string; height?: number }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        fontSize: "var(--fs-sm)",
      }}
    >
      {text}
    </div>
  );
}
