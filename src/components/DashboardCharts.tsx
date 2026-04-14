"use client";

import {
  Bar, BarChart, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ── Color tokens (consistent across charts) ─────────────────
export const METRIC_COLORS = {
  dms:         "#818cf8", // indigo
  answers:     "#4ade80", // green
  appointments:"#a78bfa", // violet
  followups:   "#fbbf24", // amber
};

const TOOLTIP_STYLE = {
  background: "#18181b",
  border: "1px solid #27272a",
  borderRadius: "8px",
  fontSize: "0.8125rem",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  color: "#fafafa",
};

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
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "#71717a" }} />
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
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
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
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "#71717a" }} />
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
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => `${v}%`} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "#71717a" }} />
        <Bar dataKey="answerRate" name="Antwortrate" fill={METRIC_COLORS.answers} radius={[0, 3, 3, 0]} />
        <Bar dataKey="apptRate" name="Terminrate" fill={METRIC_COLORS.appointments} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Historical weekly duel chart ─────────────────────────────
export type WeeklyDuelPoint = { week: string; Kevin: number; Simon: number; Daniel: number };

export function WeeklyDuelChart({ data, goal }: { data: WeeklyDuelPoint[]; goal: number }) {
  if (data.every((d) => d.Kevin === 0 && d.Simon === 0 && d.Daniel === 0)) return <EmptyState text="Noch keine Verlaufsdaten." />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={8} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#52525b" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "#71717a" }} />
        <Bar dataKey="Kevin" fill={METRIC_COLORS.dms} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Simon" fill={METRIC_COLORS.appointments} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Daniel" fill="#34d399" radius={[3, 3, 0, 0]} />
        {/* Goal reference rendered as a separate thin line */}
        <Bar dataKey={() => goal} name={`Ziel (${goal})`} fill="transparent" stroke="#fbbf24" strokeWidth={1.5} radius={0} opacity={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyState({ text = "Noch keine Daten.", height = 120 }: { text?: string; height?: number }) {
  return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#52525b", fontSize: "0.8125rem" }}>
      {text}
    </div>
  );
}
