"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext, type AccessContext } from "@/lib/access";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_OFFSET_TOUCHES,
  computeCascadeDueAts,
  resolveCascadeChannel,
  resolveFollowUpChannel,
  type ReminderEntityType,
  type ReminderSettings,
  type ReminderTouchType,
  type TouchChannel,
} from "@/lib/reminderCascade";

// Erinnerungs-Kaskade: Bestätigungs-Touches für Setting-/Closing-Termine und
// Nachfass-Termine + sofortiger No-Show-Trigger. Alles hier ist FAIL-SOFT
// (try/catch, Fehler werden geloggt statt geworfen) — dasselbe Prinzip wie
// `logCallAttempt` (src/app/actions/phoneAttempts.ts): ein fehlgeschlagener
// Reminder-Eintrag darf niemals eine Terminbuchung oder ein Ergebnis
// blockieren. Aufrufer aus appointments.ts/settingCalls.ts/closingCalls.ts
// rufen diese Funktionen deshalb "fire and forget" nach dem eigentlichen
// Schreibvorgang auf.
//
// Bewusst ohne Parameter für Termin-Zeit/Zuweisung/Kanal: jede generate*-
// Funktion liest den aktuellen Stand der Eltern-Zeile selbst aus der DB
// (nach dem erfolgreichen Haupt-Schreibvorgang garantiert aktuell) — das
// erspart es den zahlreichen Aufrufstellen, diese Werte redundant
// mitzuschleppen und synchron zu halten.

const REMINDER_SETTINGS_COLUMNS =
  "offset_1_hours, offset_2_hours, offset_3_hours, template_setting_reminder, " +
  "template_closing_reminder, template_followup_reminder, template_no_show_setting, template_no_show_closing";

async function loadReminderSettingsRow(workspaceId: string): Promise<ReminderSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reminder_settings")
    .select(REMINDER_SETTINGS_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ? (data as unknown as ReminderSettings) : DEFAULT_REMINDER_SETTINGS;
}

/** Kaskaden-Einstellungen der aktiven Organisation — Defaults, falls noch nichts gespeichert wurde. */
export async function getReminderSettings(): Promise<ReminderSettings> {
  const access = await getAccessContext();
  if (!access) return DEFAULT_REMINDER_SETTINGS;
  return loadReminderSettingsRow(access.workspace_id);
}

/** Owner-only (Muster setAssignee: access.can_switch_view = role='owner' && data_scope='workspace'). */
export async function updateReminderSettings(
  patch: Partial<ReminderSettings>,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!access.can_switch_view) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const current = await loadReminderSettingsRow(access.workspace_id);
  const { error } = await supabase.from("reminder_settings").upsert(
    {
      workspace_id: access.workspace_id,
      ...current,
      ...patch,
      updated_by_user_id: access.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/erinnerungen");
  return {};
}

const NUMERIC_SETTINGS_FIELDS = new Set(["offset_1_hours", "offset_2_hours", "offset_3_hours"]);

/** Form-Action-Wrapper — ein Feld pro Formular, Muster setTargetForm (actions/targets.ts). */
export async function updateReminderSettingsForm(formData: FormData): Promise<void> {
  const field = String(formData.get("field") ?? "");
  if (!field) return;
  const raw = String(formData.get("value") ?? "");
  if (NUMERIC_SETTINGS_FIELDS.has(field)) {
    const hours = Math.max(1, Math.round(Number(raw) || 0));
    await updateReminderSettings({ [field]: hours } as Partial<ReminderSettings>);
  } else {
    await updateReminderSettings({ [field]: raw } as Partial<ReminderSettings>);
  }
}

// ── Touch-Erzeugung ──────────────────────────────────────────

async function regenerateOffsetTouches(
  access: AccessContext,
  params: {
    entityType: ReminderEntityType;
    entityId: string;
    assignedUserId: string | null;
    appointmentAtIso: string;
    channel: TouchChannel | null;
  },
): Promise<void> {
  const supabase = await createClient();
  await supersedeTouches(params.entityType, params.entityId, REMINDER_OFFSET_TOUCHES);

  const settings = await loadReminderSettingsRow(access.workspace_id);
  const dueAts = computeCascadeDueAts(params.appointmentAtIso, settings);
  const rows = REMINDER_OFFSET_TOUCHES.filter((t) => dueAts[t]).map((touchType) => ({
    workspace_id: access.workspace_id,
    created_by_user_id: access.user.id,
    entity_type: params.entityType,
    entity_id: params.entityId,
    touch_type: touchType,
    assigned_user_id: params.assignedUserId,
    due_at: dueAts[touchType]!,
    appointment_at: params.appointmentAtIso,
    channel: params.channel,
  }));
  if (rows.length === 0) return;

  const { error } = await supabase.from("reminder_touches").insert(rows);
  if (error) console.error("[reminderCascade] insert:", error.message);
}

/** Kanal einer Closing-/Nachfass-Kaskade: über das verknüpfte Setting aufgelöst (WhatsApp vor Akquise-Kanal). */
async function resolveClosingChannel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  settingCallId: string | null,
): Promise<TouchChannel | null> {
  if (!settingCallId) return null;
  const { data } = await supabase
    .from("setting_calls")
    .select("wa_phone, wa_consent_at, source_type")
    .eq("id", settingCallId)
    .maybeSingle();
  if (!data) return null;
  return resolveFollowUpChannel(
    data as { wa_phone: string | null; wa_consent_at: string | null; source_type: string | null },
  );
}

/** Setting-Kaskade (neu erzeugen oder nach Reschedule neu berechnen). */
export async function generateSettingCascade(settingCallId: string): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const supabase = await createClient();
    const { data } = await supabase
      .from("setting_calls")
      .select("appointment_at, assigned_user_id, created_by_user_id, source_type")
      .eq("id", settingCallId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    const row = data as {
      appointment_at: string | null;
      assigned_user_id: string | null;
      created_by_user_id: string | null;
      source_type: string | null;
    } | null;
    if (!row?.appointment_at) return;

    await regenerateOffsetTouches(access, {
      entityType: "setting",
      entityId: settingCallId,
      assignedUserId: row.assigned_user_id ?? row.created_by_user_id,
      appointmentAtIso: row.appointment_at,
      channel: resolveCascadeChannel(row.source_type),
    });
  } catch (e) {
    console.error("[generateSettingCascade]", e instanceof Error ? e.message : e);
  }
}

/** Closing-Kaskade (neu erzeugen oder nach geändertem call_at neu berechnen). */
export async function generateClosingCascade(closingCallId: string): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const supabase = await createClient();
    const { data } = await supabase
      .from("closing_calls")
      .select("call_at, assigned_user_id, created_by_user_id, setting_call_id")
      .eq("id", closingCallId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    const row = data as {
      call_at: string | null;
      assigned_user_id: string | null;
      created_by_user_id: string | null;
      setting_call_id: string | null;
    } | null;
    if (!row?.call_at) return;

    const channel = await resolveClosingChannel(supabase, row.setting_call_id);
    await regenerateOffsetTouches(access, {
      entityType: "closing",
      entityId: closingCallId,
      assignedUserId: row.assigned_user_id ?? row.created_by_user_id,
      appointmentAtIso: row.call_at,
      channel,
    });
  } catch (e) {
    console.error("[generateClosingCascade]", e instanceof Error ? e.message : e);
  }
}

/** Nachfass-Termin-Kaskade (Closing im Status 'nachfassen' mit follow_up_due_at). */
export async function generateFollowUpCascade(closingCallId: string): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const supabase = await createClient();
    const { data } = await supabase
      .from("closing_calls")
      .select("follow_up_due_at, assigned_user_id, created_by_user_id, setting_call_id")
      .eq("id", closingCallId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    const row = data as {
      follow_up_due_at: string | null;
      assigned_user_id: string | null;
      created_by_user_id: string | null;
      setting_call_id: string | null;
    } | null;
    if (!row?.follow_up_due_at) return;

    const channel = await resolveClosingChannel(supabase, row.setting_call_id);
    await regenerateOffsetTouches(access, {
      entityType: "closing_followup",
      entityId: closingCallId,
      assignedUserId: row.assigned_user_id ?? row.created_by_user_id,
      appointmentAtIso: row.follow_up_due_at,
      channel,
    });
  } catch (e) {
    console.error("[generateFollowUpCascade]", e instanceof Error ? e.message : e);
  }
}

/**
 * Offene Touches eines Termins ersetzen (nicht hart löschen — die
 * Erledigungs-Historie bleibt für die Analyse zählbar). Ohne `touchTypes`
 * werden ALLE Touch-Arten ersetzt, inklusive eines offenen No-Show-Touches.
 */
export async function supersedeTouches(
  entityType: ReminderEntityType,
  entityId: string,
  touchTypes?: readonly ReminderTouchType[],
): Promise<void> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("reminder_touches")
      .update({ superseded_at: new Date().toISOString() })
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("superseded_at", null);
    if (touchTypes?.length) query = query.in("touch_type", touchTypes);
    const { error } = await query;
    if (error) console.error("[supersedeTouches]", error.message);
  } catch (e) {
    console.error("[supersedeTouches]", e instanceof Error ? e.message : e);
  }
}

/** Termin gelöscht — alle offenen Touches ersetzen (Muster deleteSettingCall/deleteClosingCall). */
export async function deleteTouchesForEntity(entityType: ReminderEntityType, entityId: string): Promise<void> {
  await supersedeTouches(entityType, entityId);
}

/**
 * Sofortiger No-Show-Trigger — kein geplanter Offset-Touch, sondern ein
 * SOFORT fälliges Item (due_at = jetzt), sobald `show_status` auf 'no_show'
 * wechselt. Ersetzt einen evtl. schon offenen No-Show-Touch derselben Zeile
 * (z. B. nach einem zweiten No-Show desselben Termins).
 */
export async function createNoShowTouch(entityType: "setting" | "closing", entityId: string): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const supabase = await createClient();

    let appointmentAtIso: string | null = null;
    let assignedUserId: string | null = null;
    let createdByUserId: string | null = null;

    if (entityType === "setting") {
      const { data } = await supabase
        .from("setting_calls")
        .select("appointment_at, assigned_user_id, created_by_user_id")
        .eq("id", entityId)
        .eq("workspace_id", access.workspace_id)
        .maybeSingle();
      const row = data as {
        appointment_at: string | null;
        assigned_user_id: string | null;
        created_by_user_id: string | null;
      } | null;
      if (!row) return;
      appointmentAtIso = row.appointment_at;
      assignedUserId = row.assigned_user_id;
      createdByUserId = row.created_by_user_id;
    } else {
      const { data } = await supabase
        .from("closing_calls")
        .select("call_at, assigned_user_id, created_by_user_id")
        .eq("id", entityId)
        .eq("workspace_id", access.workspace_id)
        .maybeSingle();
      const row = data as {
        call_at: string | null;
        assigned_user_id: string | null;
        created_by_user_id: string | null;
      } | null;
      if (!row) return;
      appointmentAtIso = row.call_at;
      assignedUserId = row.assigned_user_id;
      createdByUserId = row.created_by_user_id;
    }

    await supersedeTouches(entityType, entityId, ["no_show"]);

    const { error } = await supabase.from("reminder_touches").insert({
      workspace_id: access.workspace_id,
      created_by_user_id: access.user.id,
      entity_type: entityType,
      entity_id: entityId,
      touch_type: "no_show",
      // personOf()-Regel: Zuweisung schlägt Ersteller, nie live nachschlagen.
      assigned_user_id: assignedUserId ?? createdByUserId,
      due_at: new Date().toISOString(),
      appointment_at: appointmentAtIso ?? new Date().toISOString(),
      // Kein abgeleiteter Kanal — der Rückgriff auf WhatsApp/Akquise-Kanal
      // passt für eine geplante Erinnerung, nicht für einen spontanen
      // No-Show-Rückgriff; die Person entscheidet hier selbst.
      channel: null,
    });
    if (error) console.error("[createNoShowTouch]", error.message);
  } catch (e) {
    console.error("[createNoShowTouch]", e instanceof Error ? e.message : e);
  }
}

// ── "Meine Erinnerungen heute" ──────────────────────────────

export type ReminderTouchWithContext = {
  id: string;
  entity_type: ReminderEntityType;
  entity_id: string;
  touch_type: ReminderTouchType;
  due_at: string;
  appointment_at: string;
  channel: TouchChannel | null;
  done_at: string | null;
  assigned_user_id: string | null;
  assigned_username: string | null;
  lead_name: string | null;
  company: string | null;
};

type RawTouchRow = {
  id: string;
  entity_type: ReminderEntityType;
  entity_id: string;
  touch_type: ReminderTouchType;
  due_at: string;
  appointment_at: string;
  channel: TouchChannel | null;
  done_at: string | null;
  assigned_user_id: string | null;
};

/**
 * Fällige Touches für die "Meine Erinnerungen heute"-Ansicht. `teamView` nur
 * für `role='owner' && data_scope='workspace'` — sonst serverseitig auf den
 * Aufrufer erzwungen (Muster getNachfassenTasks).
 */
export async function getDueReminderTouches(options?: {
  teamView?: boolean;
}): Promise<ReminderTouchWithContext[]> {
  const access = await getAccessContext();
  if (!access) return [];
  const supabase = await createClient();
  const teamView = Boolean(options?.teamView) && access.role === "owner" && access.data_scope === "workspace";
  const scopeUserId = access.effective_user_id ?? access.user.id;

  let rows: RawTouchRow[] = [];
  try {
    rows = await fetchAllRows((f, t) => {
      let query = supabase
        .from("reminder_touches")
        .select("id, entity_type, entity_id, touch_type, due_at, appointment_at, channel, done_at, assigned_user_id")
        .eq("workspace_id", access.workspace_id)
        .is("superseded_at", null);
      if (!teamView) query = query.eq("assigned_user_id", scopeUserId);
      return query.order("due_at", { ascending: true }).order("id").range(f, t);
    });
  } catch (e) {
    console.error("getDueReminderTouches:", e instanceof Error ? e.message : e);
    return [];
  }
  if (rows.length === 0) return [];

  const settingIds = [...new Set(rows.filter((r) => r.entity_type === "setting").map((r) => r.entity_id))];
  const closingIds = [
    ...new Set(rows.filter((r) => r.entity_type !== "setting").map((r) => r.entity_id)),
  ];

  const entityInfo = new Map<string, { lead_name: string | null; company: string | null }>();
  if (settingIds.length > 0) {
    const { data } = await supabase.from("setting_calls").select("id, lead_name, company").in("id", settingIds);
    (data ?? []).forEach((r) => entityInfo.set(r.id, { lead_name: r.lead_name, company: r.company }));
  }
  if (closingIds.length > 0) {
    const { data } = await supabase.from("closing_calls").select("id, lead_name, company").in("id", closingIds);
    (data ?? []).forEach((r) => entityInfo.set(r.id, { lead_name: r.lead_name, company: r.company }));
  }

  const userIds = [...new Set(rows.map((r) => r.assigned_user_id).filter((v): v is string => Boolean(v)))];
  const usernameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, username").in("user_id", userIds);
    (data ?? []).forEach((r) => usernameById.set(r.user_id, r.username));
  }

  return rows.map((r) => {
    const info = entityInfo.get(r.entity_id);
    return {
      ...r,
      lead_name: info?.lead_name ?? null,
      company: info?.company ?? null,
      assigned_username: r.assigned_user_id ? (usernameById.get(r.assigned_user_id) ?? null) : null,
    };
  });
}

/** Erledigt-Häkchen — manuell, kanalunabhängig (Anforderung: kein Auto-Link zu phone_call_attempts). */
export async function setReminderTouchDone(touchId: string, done: boolean): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();

  const { data: touch } = await supabase
    .from("reminder_touches")
    .select("id")
    .eq("id", touchId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (!touch) return { error: "Erinnerung nicht gefunden." };

  const { error } = await supabase
    .from("reminder_touches")
    .update({
      done_at: done ? new Date().toISOString() : null,
      done_by_user_id: done ? access.user.id : null,
    })
    .eq("id", touchId);
  if (error) return { error: error.message };
  revalidatePath("/erinnerungen");
  return {};
}
