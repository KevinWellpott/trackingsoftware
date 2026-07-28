"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { berlinInputToIso } from "@/lib/apptTime";
import type { SettingOutcome, SettingStatus } from "@/lib/types";
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
  status?: SettingStatus;
  follow_up_due?: string | null;
  no_show_count?: number;
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
  revalidatePath("/termine", "page");
  return {};
}

/**
 * Terminales Ergebnis eines Setting-Calls. Der Show-Status wird daraus abgeleitet,
 * statt ihn separat pflegen zu müssen:
 *   no_show → 'no_show', qualifiziert/unqualifiziert → 'show', dead → unverändert.
 *
 * no_show/unqualifiziert nehmen optional eine Wiedervorlage (YYYY-MM-DD) auf, die
 * den Call ins Nachfassen-Board hebt. qualifiziert legt direkt das Closing an.
 */
export async function setSettingOutcome(input: {
  settingId: string;
  outcome: SettingOutcome;
  followUpDue?: string | null;
}): Promise<{ error?: string; closingId?: string }> {
  if (!(await canAccessSettingCall(input.settingId))) return { error: "Keine Berechtigung." };

  // Qualifiziert = Closing. Ein Schritt, kein Zwischenstatus.
  if (input.outcome === "qualifiziert") return createClosingFromSetting(input.settingId);

  const supabase = await createClient();
  const patch: SettingCallPatch = { status: input.outcome };

  if (input.outcome === "no_show") {
    patch.show_status = "no_show";
    patch.follow_up_due = input.followUpDue ?? null;
    // Zähler trägt die No-Show-Historie über spätere Neuterminierungen hinweg.
    const { data } = await supabase
      .from("setting_calls")
      .select("no_show_count")
      .eq("id", input.settingId)
      .maybeSingle();
    patch.no_show_count = ((data as { no_show_count: number } | null)?.no_show_count ?? 0) + 1;
  } else if (input.outcome === "unqualifiziert") {
    patch.show_status = "show";
    patch.follow_up_due = input.followUpDue ?? null;
  } else {
    // dead: show_status bewusst nicht anfassen — der Lead kann vorher erschienen sein.
    patch.follow_up_due = null;
  }

  const { error } = await supabase.from("setting_calls").update(patch).eq("id", input.settingId);
  if (error) return { error: error.message };

  revalidatePath(`/setting/${input.settingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Neuen Termin für einen No-Show setzen: derselbe Datensatz wird wiederverwendet,
 * `no_show_count` bleibt stehen — sonst verschwände der No-Show aus der Show-Quote.
 *
 * Setzt den Call bewusst auf 'offen' zurück (neuer Anlauf). Zum reinen
 * Verschieben eines Termins → `moveSettingAppointment`.
 */
export async function rescheduleSetting(
  settingId: string,
  appointmentAt: string,
): Promise<{ error?: string }> {
  const appointmentIso = berlinInputToIso(appointmentAt);
  if (!appointmentIso) return { error: "Bitte einen neuen Termin angeben." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("setting_calls")
    .update({
      appointment_at: appointmentIso,
      status: "offen",
      show_status: null,
      follow_up_due: null,
    })
    .eq("id", settingId);
  if (error) return { error: error.message };

  await mirrorAppointmentToSource(settingId, appointmentIso);

  revalidatePath(`/setting/${settingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Den Termin am Ursprungs-Datensatz nachziehen, damit LinkedIn-Board und
 * Telefon-Ansicht dieselbe Uhrzeit zeigen wie der Kalender.
 */
async function mirrorAppointmentToSource(settingId: string, appointmentIso: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("setting_calls")
    .select("source_contact_id, source_phone_lead_id")
    .eq("id", settingId)
    .maybeSingle();
  const src = data as { source_contact_id?: string | null; source_phone_lead_id?: string | null } | null;
  if (src?.source_contact_id) {
    await supabase.from("contacts").update({ appointment_at: appointmentIso }).eq("id", src.source_contact_id);
  }
  if (src?.source_phone_lead_id) {
    await supabase.from("phone_leads").update({ appointment_at: appointmentIso }).eq("id", src.source_phone_lead_id);
  }
}

/**
 * Termin verschieben (Drag & Drop im Kalender) — ausschließlich der Zeitpunkt.
 * Status, Show-Status, Wiedervorlage und No-Show-Zähler bleiben unangetastet;
 * genau darin unterscheidet sich die Action von `rescheduleSetting`.
 *
 * `appointmentAt` ist Berlin-Wandzeit ("2026-07-27T10:00") oder bereits ISO-UTC.
 */
export async function moveSettingAppointment(
  settingId: string,
  appointmentAt: string,
): Promise<{ error?: string }> {
  const appointmentIso = appointmentAt.endsWith("Z") ? appointmentAt : berlinInputToIso(appointmentAt);
  if (!appointmentIso) return { error: "Ungültiger Termin." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("setting_calls")
    .update({ appointment_at: appointmentIso })
    .eq("id", settingId);
  if (error) return { error: error.message };

  await mirrorAppointmentToSource(settingId, appointmentIso);

  revalidatePath(`/setting/${settingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Aus einem qualifizierten Setting einen Closing-Call anlegen (idempotent).
 *
 * Der Closing-Termin ist PFLICHT. Vorher wurde `call_at` aus
 * `setting_calls.closing_at` uebernommen — ein Feld, das keine Oberflaeche
 * befuellt. Praktisch entstand damit jedes Closing ohne Termin und tauchte
 * weder im Kalender noch in der Wochenplanung auf.
 *
 * Ohne Datum wird deshalb nicht angelegt, sondern `needsDate` zurueckgegeben;
 * die Oberflaeche fragt dann im Modal nach. Das ist zugleich der Weg, auf dem
 * „Zum Closing →" ein bereits bestehendes Closing aufloest, ohne ein Datum
 * mitzuschicken.
 */
export async function createClosingFromSetting(
  settingId: string,
  closingAtIso?: string | null,
): Promise<{ error?: string; closingId?: string; needsDate?: boolean }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const closingAt = closingAtIso?.trim() || null;

  // Qualifiziert heißt: er war da. Wiedervorlage aus einem früheren No-Show/
  // Unqualifiziert entfällt, sonst bliebe der Call im Nachfassen-Board hängen.
  const qualifiedPatch: SettingCallPatch = {
    status: "closing_gelegt",
    closing_scheduled: true,
    show_status: "show",
    follow_up_due: null,
  };

  // Bereits vorhandenen Closing-Call wiederverwenden
  const { data: existing } = await supabase
    .from("closing_calls")
    .select("id, call_at")
    .eq("setting_call_id", settingId)
    .maybeSingle();
  if (existing) {
    // Einen bestehenden Termin NICHT ueberschreiben — nur eine Luecke fuellen.
    if (closingAt && !existing.call_at) {
      await supabase.from("closing_calls").update({ call_at: closingAt }).eq("id", existing.id);
    }
    await supabase
      .from("setting_calls")
      .update(closingAt ? { ...qualifiedPatch, closing_at: closingAt } : qualifiedPatch)
      .eq("id", settingId);
    revalidatePath("/termine", "page");
    revalidatePath("/nachfassen", "page");
    return { closingId: existing.id };
  }

  // Neu anlegen geht nur mit Termin.
  if (!closingAt) return { needsDate: true };

  const { data: rawSetting } = await supabase
    .from("setting_calls")
    .select("lead_name, company, meet_link")
    .eq("id", settingId)
    .maybeSingle();
  const setting = rawSetting as {
    lead_name?: string | null;
    company?: string | null;
    meet_link?: string | null;
  } | null;

  // Meet-Link aus dem Setting vorbefüllen — sinnvoller Default ist derselbe
  // Meet-Raum wie beim Setting-Call.
  const { data: closing, error } = await supabase
    .from("closing_calls")
    .insert({
      setting_call_id: settingId,
      lead_name: setting?.lead_name ?? null,
      company: setting?.company ?? null,
      call_at: closingAt,
      meet_link: setting?.meet_link ?? null,
      status: "offen",
    })
    .select("id")
    .single();
  if (error || !closing) return { error: error?.message ?? "Closing anlegen fehlgeschlagen." };

  await supabase
    .from("setting_calls")
    .update({ ...qualifiedPatch, closing_at: closingAt })
    .eq("id", settingId);

  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return { closingId: closing.id };
}

/**
 * Setting-Call endgültig löschen.
 *
 * Die Fremdschlüssel stehen auf `on delete set null` — ein bereits angelegtes
 * Closing bleibt also bestehen und verliert nur seinen Setting-Bezug. Genau
 * darauf weist die Oberfläche vorher hin.
 *
 * Wichtig ist das Aufräumen der QUELLE: ohne das bliebe der LinkedIn-Kontakt
 * bzw. Telefon-Lead als „Termin gesetzt" markiert, obwohl es keinen Termin
 * mehr gibt — die Listen-Filter und die Terminquote wären damit dauerhaft
 * falsch.
 */
export async function deleteSettingCall(id: string): Promise<{ error?: string }> {
  if (!(await canAccessSettingCall(id))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: raw } = await supabase
    .from("setting_calls")
    .select("source_contact_id, source_phone_lead_id")
    .eq("id", id)
    .maybeSingle();
  const src = raw as { source_contact_id: string | null; source_phone_lead_id: string | null } | null;

  if (src?.source_contact_id) {
    await supabase
      .from("contacts")
      .update({ appointment_set: false, appointment_at: null, meet_link: null, setting_call_id: null })
      .eq("id", src.source_contact_id);
  }
  if (src?.source_phone_lead_id) {
    await supabase
      .from("phone_leads")
      .update({ appointment_set: false, appointment_at: null, status: "aktiv" })
      .eq("id", src.source_phone_lead_id);
  }

  const { error } = await supabase.from("setting_calls").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}
