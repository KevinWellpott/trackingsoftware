"use client";

import { useState } from "react";
import {
  Bar, BarChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS_TICK, CURSOR_FILL, TOOLTIP_STYLE } from "@/components/DashboardCharts";
import { Segmented } from "@/components/ui/Segmented";
import { ownerColor } from "@/lib/ownerColor";

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
        color: "var(--text-subtle)",
        fontSize: "0.8125rem",
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
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={isRate ? (v: number) => `${v} %` : undefined}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR_FILL} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
        {seriesNames.map((name) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={ownerColor(name).fg}
            strokeWidth={2}
            dot={false}
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={CURSOR_FILL} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", color: "var(--text-subtle)" }} />
        {seriesNames.map((name) => (
          <Bar key={name} dataKey={name} fill={ownerColor(name).fg} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
