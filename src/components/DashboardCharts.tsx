"use client";

import { ownerColor as ownerColorShared } from "@/lib/ownerColor";
import {
  Bar, BarChart, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ── Color tokens (consistent across charts) ─────────────────
export const METRIC_COLORS = {
  dms:         "var(--brand-500)",
  answers:     "var(--color-success-text)",
  appointments:"var(--accent-500)",
  followups:   "var(--color-warning-text)",
};

/** Translucent variant of a (possibly var()-based) color. */
export function tint(color: string, alphaPct: number): string {
  return `color-mix(in srgb, ${color} ${alphaPct}%, transparent)`;
}

// ── Owner colors (dynamic roster) ────────────────────────────
// Delegiert an die zentrale Slot-Zuordnung (src/lib/ownerColor.ts).
// CSS-Variablen funktionieren auch in SVG-Fills (recharts).
export function ownerColor(name: string): string {
  return ownerColorShared(name).fg;
}

const TOOLTIP_STYLE = {
  background: "var(--surface-100)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "0.8125rem",
  boxShadow: "var(--shadow-md)",
  color: "var(--text-primary)",
};

const AXIS_TICK = { fontSize: 10, fill: "var(--text-subtle)" };
const CURSOR_FILL = { fill: "var(--surface-150)" };

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
      <BarChart data={data} barSize={8} barGap={2} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
        <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR_FILL} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
        <Bar dataKey="dms" name="DMs" fill={METRIC_COLORS.dms} radius={[3, 3, 0, 0]} />
        <Bar dataKey="answers" name="Antworten" fill={METRIC_COLORS.answers} radius={[3, 3, 0, 0]} />
        <Bar dataKey="appointments" name="Termine" fill={METRIC_COLORS.appointments} radius={[3, 3, 0, 0]} />
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
      <BarChart data={data} barSize={18} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
        <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR_FILL} />
        <Bar dataKey="pitches" name="DMs" fill={METRIC_COLORS.dms} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Answer donut ─────────────────────────────────────────────
type AnswerDonut = { name: string; value: number; color: string };

export function AnswerDonutChart({ data }: { data: AnswerDonut[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <EmptyState text="Noch keine Antworten." />;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={3} dataKey="value">
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Mini sparkline for person cards ─────────────────────────
export type SparkPoint = { date: string; value: number };

export function SparkLineChart({ data, color }: { data: SparkPoint[]; color: string }) {
  if (data.every((d) => d.value === 0)) return <EmptyState height={60} />;
  return (
    <ResponsiveContainer width="100%" height={60}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Horizontal bar for list comparison ──────────────────────
export type ListBar = { name: string; answerRate: number; apptRate: number };

export function ListComparisonChart({ data }: { data: ListBar[] }) {
  if (data.length === 0) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 44)}>
      <BarChart data={data} layout="vertical" barSize={10} barGap={3} margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
        <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `${v}%`} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
        <Bar dataKey="answerRate" name="Antwortrate" fill={METRIC_COLORS.answers} radius={[0, 3, 3, 0]} />
        <Bar dataKey="apptRate" name="Terminrate" fill={METRIC_COLORS.appointments} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Historical weekly duel chart (dynamic roster) ────────────
export type DuelSeries = { name: string; color: string };
export type WeeklyDuelPoint = { week: string; values: Record<string, number> };

export function WeeklyDuelChart({ data, series, goal }: { data: WeeklyDuelPoint[]; series: DuelSeries[]; goal: number }) {
  if (series.length === 0 || data.every((d) => series.every((s) => (d.values[s.name] ?? 0) === 0))) {
    return <EmptyState text="Noch keine Verlaufsdaten." />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={8} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <XAxis dataKey="week" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR_FILL} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
        {series.map((s) => (
          <Bar
            key={s.name}
            dataKey={(d: WeeklyDuelPoint) => d.values[s.name] ?? 0}
            name={s.name}
            fill={s.color}
            radius={[3, 3, 0, 0]}
          />
        ))}
        {/* Goal reference rendered as a separate thin line */}
        <Bar dataKey={() => goal} name={`Ziel (${goal})`} fill="transparent" stroke="var(--color-warning-text)" strokeWidth={1.5} radius={0} opacity={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyState({ text = "Noch keine Daten.", height = 120 }: { text?: string; height?: number }) {
  return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)", fontSize: "0.8125rem" }}>
      {text}
    </div>
  );
}
