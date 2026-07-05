// Reine (nicht-serverseitige) Ziel-Helfer + Typen.
// Muss getrennt von den "use server"-Actions liegen, weil eine "use server"-Datei
// ausschließlich async Funktionen exportieren darf.

export type TargetChannel = "linkedin" | "telefon";
export type TargetPeriod = "daily" | "weekly";
export type TargetMetric = "pitches" | "calls" | "appointments";

export type PerformanceTarget = {
  id: string;
  workspace_id: string;
  user_id: string;
  channel: TargetChannel;
  period: TargetPeriod;
  metric: TargetMetric;
  target_value: number;
};

// Defaults, solange kein individuelles Ziel gesetzt ist
// (entspricht den bisherigen Hardcodes: 20 DMs/Tag, 100 DMs/Woche).
export const DEFAULT_TARGETS: Partial<
  Record<`${TargetChannel}:${TargetPeriod}:${TargetMetric}`, number>
> = {
  "linkedin:daily:pitches": 20,
  "linkedin:weekly:pitches": 100,
  "linkedin:daily:appointments": 1,
  "linkedin:weekly:appointments": 5,
  "telefon:daily:calls": 40,
  "telefon:weekly:calls": 200,
  "telefon:daily:appointments": 1,
  "telefon:weekly:appointments": 5,
};

export function targetKey(
  channel: TargetChannel,
  period: TargetPeriod,
  metric: TargetMetric,
): `${TargetChannel}:${TargetPeriod}:${TargetMetric}` {
  return `${channel}:${period}:${metric}`;
}

/** Ziel für einen Nutzer nachschlagen (mit Default-Fallback). */
export function resolveTarget(
  targets: PerformanceTarget[],
  userId: string,
  channel: TargetChannel,
  period: TargetPeriod,
  metric: TargetMetric,
): number {
  const hit = targets.find(
    (t) =>
      t.user_id === userId &&
      t.channel === channel &&
      t.period === period &&
      t.metric === metric,
  );
  if (hit) return hit.target_value;
  return DEFAULT_TARGETS[targetKey(channel, period, metric)] ?? 0;
}
