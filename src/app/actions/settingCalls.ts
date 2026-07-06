"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Setting-Call bearbeiten (Script-Antworten + strukturierte Felder + Status)
// und bei Qualifikation einen Closing-Call erzeugen.

export type SettingCallPatch = {
  call_at?: string | null;
  branche?: string | null;
  offer_type?: string | null;
  show_status?: "show" | "no_show" | null;
  has_budget_8k?: "ja" | "nein" | "unklar" | null;
  sole_decider?: boolean | null;
  can_decide_now?: boolean | null;
  clear_need?: boolean | null;
  ist_pain?: number | null;
  soll_ziel?: string | null;
  warmth?: number | null;
  closing_scheduled?: boolean | null;
  closing_at?: string | null;
  recording_link?: string | null;
  objections_handled?: string | null;
  objections_open?: string | null;
  meet_link?: string | null;
  appointment_at?: string | null;
  script_answers?: Record<string, string>;
  status?: "offen" | "qualifiziert" | "disqualifiziert" | "closing_gelegt" | "dead";
  notes?: string | null;
  lead_name?: string | null;
  company?: string | null;
};

async function canAccessSettingCall(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("setting_calls").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

export async function updateSettingCall(id: string, patch: SettingCallPatch): Promise<{ error?: string }> {
  if (!(await canAccessSettingCall(id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("setting_calls").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/setting/${id}`, "page");
  revalidatePath("/setting", "page");
  return {};
}

/** Aus einem qualifizierten Setting einen Closing-Call anlegen (idempotent). */
export async function createClosingFromSetting(
  settingId: string,
): Promise<{ error?: string; closingId?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();

  // Bereits vorhandenen Closing-Call wiederverwenden
  const { data: existing } = await supabase
    .from("closing_calls")
    .select("id")
    .eq("setting_call_id", settingId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("setting_calls")
      .update({ status: "closing_gelegt", closing_scheduled: true })
      .eq("id", settingId);
    revalidatePath("/setting", "page");
    revalidatePath("/closing", "page");
    return { closingId: existing.id };
  }

  const { data: rawSetting } = await supabase
    .from("setting_calls")
    .select("lead_name, company, closing_at, meet_link")
    .eq("id", settingId)
    .maybeSingle();
  const setting = rawSetting as {
    lead_name?: string | null;
    company?: string | null;
    closing_at?: string | null;
    meet_link?: string | null;
  } | null;

  // Termin + Meet-Link aus dem Setting vorbefüllen (Closing-Termin, sonst
  // sinnvoller Default: derselbe Meet-Raum wie beim Setting-Call).
  const { data: closing, error } = await supabase
    .from("closing_calls")
    .insert({
      setting_call_id: settingId,
      lead_name: setting?.lead_name ?? null,
      company: setting?.company ?? null,
      call_at: setting?.closing_at ?? null,
      meet_link: setting?.meet_link ?? null,
      status: "offen",
    })
    .select("id")
    .single();
  if (error || !closing) return { error: error?.message ?? "Closing anlegen fehlgeschlagen." };

  await supabase
    .from("setting_calls")
    .update({ status: "closing_gelegt", closing_scheduled: true })
    .eq("id", settingId);

  revalidatePath("/setting", "page");
  revalidatePath("/closing", "page");
  revalidatePath("/", "layout");
  return { closingId: closing.id };
}
