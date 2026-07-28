"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_PROPS, BAR_RADIUS, CURSOR_FILL, GRID_PROPS, LEGEND_STYLE,
  TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE,
} from "@/lib/viz";
import { Segmented } from "@/components/ui/Segmented";
import { ownerColor } from "@/lib/ownerColor";

const TOOLTIP_PROPS = {
  contentStyle: TOOLTIP_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
  itemStyle: { color: "var(--text-primary)" },
  cursor: CURSOR_FILL,
};
const LEGEND_PROPS = { iconType: "circle" as const, iconSize: 8, wrapperStyle: LEGEND_STYLE };

// Client-Charts für den Analyse-Bereich: Zeitreihen (Linien) mit Metrik-
// Umschalter je Flow sowie ein gruppiertes Balken-Chart pro Bucket.

export type Bucket = { key: string; label: string };

// label ist string, alle Serien-Keys sind Zahlen — Index-Signatur erlaubt beides,
// damit sich Objekt-Literale zuweisen lassen (reine Intersection wäre unbrauchbar).
type SeriesPoint = { label: string; [series: string]: number | string };

function EmptyState({ height = 240 }: { height?: number }) {
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
      Noch keine Daten.
    </div>
  );
}

function isAllZero(points: SeriesPoint[], seriesNames: string[]): boolean {
  return points.every((p) => seriesNames.every((n) => (p[n] ?? 0) === 0));
}

function SeriesChart({
  points,
  seriesNames,
  isRate,
}: {
  points: SeriesPoint[];
  seriesNames: string[];
  isRate: boolean;
}) {
  if (points.length === 0 || isAllZero(points, seriesNames)) {
    return <EmptyState />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} tickFormatter={isRate ? (v: number) => `${v} %` : undefined} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Legend {...LEGEND_PROPS} />
        {seriesNames.map((name) => (
          // Linien 2px, Punkte nur bei Hover (COMPONENTS.md §9).
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={ownerColor(name).fg}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function safeRate(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

/** Baut lückenlose Serienpunkte aus den Buckets über eine Wert-Funktion. */
function buildPoints<V>(
  buckets: Bucket[],
  perUser: Record<string, Record<string, V>>,
  valueOf: (v: V | undefined) => number,
): { points: SeriesPoint[]; seriesNames: string[] } {
  const seriesNames = Object.keys(perUser);
  const points = buckets.map((b) => {
    const point: SeriesPoint = { label: b.label };
    for (const name of seriesNames) {
      point[name] = valueOf(perUser[name]?.[b.key]);
    }
    return point;
  });
  return { points, seriesNames };
}

// ── LinkedIn ─────────────────────────────────────────────────
type LinkedInBucket = { dms: number; answers: number; appts: number };
type LinkedInMetric = "dms" | "answers" | "appts" | "answerRate" | "apptRate";

const LINKEDIN_OPTIONS = [
  { value: "dms" as const, label: "DMs" },
  { value: "answers" as const, label: "Antworten" },
  { value: "appts" as const, label: "Termine" },
  { value: "answerRate" as const, label: "Antwortquote" },
  { value: "apptRate" as const, label: "Terminquote" },
];

export function LinkedInSeriesChart({
  buckets,
  perUser,
}: {
  buckets: Bucket[];
  perUser: Record<string, Record<string, LinkedInBucket>>;
}) {
  const [metric, setMetric] = useState<LinkedInMetric>("dms");
  const isRate = metric === "answerRate" || metric === "apptRate";

  const { points, seriesNames } = buildPoints(buckets, perUser, (v) => {
    if (!v) return 0;
    switch (metric) {
      case "dms":
        return v.dms;
      case "answers":
        return v.answers;
      case "appts":
        return v.appts;
      case "answerRate":
        return safeRate(v.answers, v.dms);
      case "apptRate":
        return safeRate(v.appts, v.dms);
    }
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Segmented<LinkedInMetric> options={LINKEDIN_OPTIONS} value={metric} onChange={setMetric} size="sm" ariaLabel="Metrik" />
      <SeriesChart points={points} seriesNames={seriesNames} isRate={isRate} />
    </div>
  );
}

// ── Telefon ──────────────────────────────────────────────────
type PhoneBucket = { calls: number; decider: number; appts: number };
type PhoneMetric = "calls" | "decider" | "appts" | "apptRate";

const PHONE_OPTIONS = [
  { value: "calls" as const, label: "Calls" },
  { value: "decider" as const, label: "Entscheider" },
  { value: "appts" as const, label: "Termine" },
  { value: "apptRate" as const, label: "Terminquote" },
];

export function PhoneSeriesChart({
  buckets,
  perUser,
}: {
  buckets: Bucket[];
  perUser: Record<string, Record<string, PhoneBucket>>;
}) {
  const [metric, setMetric] = useState<PhoneMetric>("calls");
  const isRate = metric === "apptRate";

  const { points, seriesNames } = buildPoints(buckets, perUser, (v) => {
    if (!v) return 0;
    switch (metric) {
      case "calls":
        return v.calls;
      case "decider":
        return v.decider;
      case "appts":
        return v.appts;
      case "apptRate":
        return safeRate(v.appts, v.calls);
    }
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
      <Segmented<PhoneMetric> options={PHONE_OPTIONS} value={metric} onChange={setMetric} size="sm" ariaLabel="Metrik" />
      <SeriesChart points={points} seriesNames={seriesNames} isRate={isRate} />
    </div>
  );
}

// ── Gruppiertes Balken-Chart pro Bucket ──────────────────────
export function BucketBarChart({
  buckets,
  perUser,
}: {
  buckets: Bucket[];
  perUser: Record<string, Record<string, number>>;
}) {
  const seriesNames = Object.keys(perUser);
  const points: SeriesPoint[] = buckets.map((b) => {
    const point: SeriesPoint = { label: b.label };
    for (const name of seriesNames) point[name] = perUser[name]?.[b.key] ?? 0;
    return point;
  });

  if (points.length === 0 || isAllZero(points, seriesNames)) {
    return <EmptyState height={220} />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis allowDecimals={false} {...AXIS_PROPS} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Legend {...LEGEND_PROPS} />
        {seriesNames.map((name) => (
          <Bar key={name} dataKey={name} fill={ownerColor(name).fg} radius={BAR_RADIUS} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
