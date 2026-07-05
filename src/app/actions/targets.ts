"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";
import type {
  PerformanceTarget,
  TargetChannel,
  TargetPeriod,
  TargetMetric,
} from "@/lib/targets";

// Tages-/Wochenziele je Nutzer. RLS auf performance_targets erzwingt:
// Workspace-Scope (inkl. Owner) darf alle setzen; 'own'-Scope nur die eigenen.
// Reine Helfer/Typen/Defaults liegen in "@/lib/targets" (sync erlaubt).

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
