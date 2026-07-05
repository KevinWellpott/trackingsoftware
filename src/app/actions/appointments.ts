"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Termin=Ja → erzeugt automatisch einen Setting-Call-Eintrag und nimmt den Lead
// aus dem Follow-up-Flow (next_follow_up_at = null, appointment_set = true).
// Kein Zuweisen hier — die Zuweisung an einen Setter passiert im Setting-Eintrag.

async function canAccessPitchList(listId: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  let query = supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  if (access.effective_user_id) {
    query = query.eq("created_by_user_id", access.effective_user_id);
  }
  const { data } = await query.maybeSingle();
  return Boolean(data);
}

/**
 * LinkedIn-Kontakt terminieren: legt einen setting_calls-Eintrag an und
 * verknüpft ihn mit dem Kontakt. Pflicht: Meet-Link + Termin-Zeitpunkt.
 */
export async function convertContactToSetting(input: {
  contactId: string;
  listId: string;
  meetLink: string;
  appointmentAt: string; // ISO datetime-local
}): Promise<{ error?: string; settingCallId?: string }> {
  const meetLink = input.meetLink.trim();
  const appointmentAt = input.appointmentAt.trim();
  if (!meetLink) return { error: "Google-Meet-Link ist erforderlich." };
  if (!appointmentAt) return { error: "Termin-Zeitpunkt ist erforderlich." };
  if (!(await canAccessPitchList(input.listId))) {
    return { error: "Keine Berechtigung." };
  }

  const supabase = await createClient();

  // Kontakt-Snapshot (Name/Firma) für den Setting-Eintrag
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, company, setting_call_id")
    .eq("id", input.contactId)
    .eq("list_id", input.listId)
    .maybeSingle();
  if (!contact) return { error: "Kontakt nicht gefunden." };

  // Falls schon ein Setting-Eintrag existiert: nur Termin/Link aktualisieren.
  let settingCallId = (contact as { setting_call_id?: string | null }).setting_call_id ?? null;

  if (settingCallId) {
    await supabase
      .from("setting_calls")
      .update({ meet_link: meetLink, appointment_at: appointmentAt })
      .eq("id", settingCallId);
  } else {
    const { data: sc, error: scErr } = await supabase
      .from("setting_calls")
      .insert({
        source_type: "linkedin",
        source_contact_id: contact.id,
        lead_name: contact.name,
        company: (contact as { company?: string | null }).company ?? null,
        meet_link: meetLink,
        appointment_at: appointmentAt,
        status: "offen",
      })
      .select("id")
      .single();
    if (scErr || !sc) return { error: scErr?.message ?? "Setting-Eintrag fehlgeschlagen." };
    settingCallId = sc.id;
  }

  // Kontakt terminieren + aus dem Follow-up-Flow nehmen.
  const { error: upErr } = await supabase
    .from("contacts")
    .update({
      appointment_set: true,
      appointment_at: appointmentAt,
      meet_link: meetLink,
      setting_call_id: settingCallId,
      next_follow_up_at: null,
    })
    .eq("id", input.contactId);
  if (upErr) return { error: upErr.message };

  revalidatePath(`/lists/${input.listId}`, "page");
  revalidatePath("/setting", "page");
  revalidatePath("/follow-up", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/", "layout");
  return { settingCallId: settingCallId ?? undefined };
}

/**
 * Termin zurücknehmen: appointment_set/appointment_at/meet_link zurücksetzen.
 * Der verknüpfte Setting-Eintrag bleibt erhalten (bewusst — er kann schon
 * bearbeitet worden sein); nur die Kontakt-Markierung wird gelöst.
 */
export async function clearContactAppointment(input: {
  contactId: string;
  listId: string;
}): Promise<{ error?: string }> {
  if (!(await canAccessPitchList(input.listId))) {
    return { error: "Keine Berechtigung." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ appointment_set: false, appointment_at: null, meet_link: null })
    .eq("id", input.contactId)
    .eq("list_id", input.listId);
  if (error) return { error: error.message };
  revalidatePath(`/lists/${input.listId}`, "page");
  revalidatePath("/crm", "page");
  revalidatePath("/", "layout");
  return {};
}
