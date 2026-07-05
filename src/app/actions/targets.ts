"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Tages-/Wochenziele je Nutzer. RLS auf performance_targets erzwingt:
// Workspace-Scope (inkl. Owner) darf alle setzen; 'own'-Scope nur die eigenen.

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

// Sinnvolle Defaults, solange kein individuelles Ziel gesetzt ist
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

/** Alle sichtbaren Ziele des Workspaces (RLS-gescoped). */
export async function getTargets(): Promise<PerformanceTarget[]> {
  const access = await getAccessContext();
  if (!access) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("performance_targets")
    .select("id, workspace_id, user_id, channel, period, metric, target_value")
    .eq("workspace_id", access.workspace_id);
  return (data ?? []) as PerformanceTarget[];
}

/**
 * Ziel für einen Nutzer nachschlagen (mit Default-Fallback).
 * `targets` ist die Liste aus getTargets(), damit Aufrufer nur einmal laden.
 */
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

/** Ein Ziel setzen/aktualisieren (Upsert). workspace_id setzt der DB-Trigger. */
export async function setTarget(input: {
  user_id: string;
  channel: TargetChannel;
  period: TargetPeriod;
  metric: TargetMetric;
  target_value: number;
}): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };

  // 'own'-Scope darf nur die eigenen Ziele setzen (RLS erzwingt das zusätzlich).
  if (access.data_scope === "own" && input.user_id !== access.user.id) {
    return { error: "Keine Berechtigung." };
  }

  const value = Math.max(0, Math.round(Number(input.target_value) || 0));
  const supabase = await createClient();
  const { error } = await supabase.from("performance_targets").upsert(
    {
      workspace_id: access.workspace_id,
      user_id: input.user_id,
      channel: input.channel,
      period: input.period,
      metric: input.metric,
      target_value: value,
    },
    { onConflict: "user_id,channel,period,metric" },
  );
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/telefon");
  return {};
}

/** Form-Action-Wrapper für den TargetsEditor. */
export async function setTargetForm(formData: FormData): Promise<void> {
  await setTarget({
    user_id: String(formData.get("user_id") ?? ""),
    channel: String(formData.get("channel") ?? "linkedin") as TargetChannel,
    period: String(formData.get("period") ?? "weekly") as TargetPeriod,
    metric: String(formData.get("metric") ?? "pitches") as TargetMetric,
    target_value: Number(formData.get("target_value") ?? 0),
  });
}
