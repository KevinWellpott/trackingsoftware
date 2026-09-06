"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext, type AccessContext } from "@/lib/access";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { localDateISO } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_RECYCLE_SETTINGS,
  computeNextRecycleAt,
  type RecycleOrigin,
  type RecycleSettings,
} from "@/lib/recycleCadence";

// Lead-Recycling: Wiedervorlage für terminal-negative Leads (Closing verloren,
// Telefon-/Setting-Lead dead, LinkedIn-FU-Flow ohne Antwort zu Ende) — die
// vier Stellen, an denen ein Lead heute sonst spurlos verschwindet (§ Konzept-
// Diskussion, docs/data-model.md §1 kennt sie als "tote Enden"). Fail-soft wie
// die Erinnerungs-Kaskade (src/app/actions/reminders.ts): ein fehlgeschlagener
// Recycling-Eintrag darf niemals das eigentliche Setzen des Outcomes blockieren.

const RECYCLE_SETTINGS_COLUMNS =
  "days_timing, days_preis, days_kein_bedarf, days_entscheider, days_wettbewerb, days_vertrauen, " +
  "days_ghosting_breakup, days_ghosting, days_sonstiges, days_phone_dead, days_setting_dead, " +
  "days_linkedin_exhausted, max_attempts, template_recycle_linkedin, template_recycle_telefon, " +
  "template_recycle_setting, template_recycle_closing";

async function loadRecycleSettingsRow(workspaceId: string): Promise<RecycleSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recycle_settings")
    .select(RECYCLE_SETTINGS_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data ? (data as unknown as RecycleSettings) : DEFAULT_RECYCLE_SETTINGS;
}

/** Recycling-Einstellungen der aktiven Organisation — Defaults, falls noch nichts gespeichert wurde. */
export async function getRecycleSettings(): Promise<RecycleSettings> {
  const access = await getAccessContext();
  if (!access) return DEFAULT_RECYCLE_SETTINGS;
  return loadRecycleSettingsRow(access.workspace_id);
}

/** Owner-only, org-weit (Muster reminders.ts: access.can_switch_view = role='owner' && data_scope='workspace'). */
export async function updateRecycleSettings(patch: Partial<RecycleSettings>): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!access.can_switch_view) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const current = await loadRecycleSettingsRow(access.workspace_id);
  const { error } = await supabase.from("recycle_settings").upsert(
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
  revalidatePath("/nachfassen");
  return {};
}

const NUMERIC_SETTINGS_FIELDS = new Set([
  "days_timing",
  "days_preis",
  "days_kein_bedarf",
  "days_entscheider",
  "days_wettbewerb",
  "days_vertrauen",
  "days_ghosting_breakup",
  "days_ghosting",
  "days_sonstiges",
  "days_phone_dead",
  "days_setting_dead",
  "days_linkedin_exhausted",
  "max_attempts",
]);

/** Form-Action-Wrapper — ein Feld pro Formular, Muster updateReminderSettingsForm. */
export async function updateRecycleSettingsForm(formData: FormData): Promise<void> {
  const field = String(formData.get("field") ?? "");
  if (!field) return;
  const raw = String(formData.get("value") ?? "");
  if (NUMERIC_SETTINGS_FIELDS.has(field)) {
    const value = Math.max(1, Math.round(Number(raw) || 0));
    await updateRecycleSettings({ [field]: value } as Partial<RecycleSettings>);
  } else {
    await updateRecycleSettings({ [field]: raw } as Partial<RecycleSettings>);
  }
}

const TABLE_BY_ORIGIN: Record<RecycleOrigin, string> = {
  linkedin: "contacts",
  telefon: "phone_leads",
  setting: "setting_calls",
  closing: "closing_calls",
};

/**
 * Recycling für einen frisch terminal gewordenen Lead einplanen (attempt 0).
 * Aufrufer: setClosingOutcome('verloren'), setSettingOutcome('dead'),
 * setPhoneLeadOutcome('dead'), advanceLinkedInFollowUp (FU3 ohne Antwort).
 * Fail-soft — nie geworfen, damit das eigentliche Outcome nie daran hängt.
 */
export async function scheduleRecycle(
  origin: RecycleOrigin,
  entityId: string,
  reason: string | null,
): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const settings = await loadRecycleSettingsRow(access.workspace_id);
    const nextAt = computeNextRecycleAt(origin, reason, 0, settings, localDateISO());
    const supabase = await createClient();
    const { error } = await supabase
      .from(TABLE_BY_ORIGIN[origin])
      .update({ next_recycle_at: nextAt, recycle_attempt_count: 0 })
      .eq("id", entityId)
      .eq("workspace_id", access.workspace_id);
    if (error) console.error("[scheduleRecycle]", error.message);
  } catch (e) {
    console.error("[scheduleRecycle]", e instanceof Error ? e.message : e);
  }
}

async function canAccessRecycleRow(
  access: AccessContext,
  origin: RecycleOrigin,
  entityId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .select("id")
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return Boolean(data);
}

/**
 * "Nochmal versucht, kein Ergebnis" — Versuchszähler hoch, nächste Fälligkeit
 * neu berechnen. Reicht `max_attempts` (org-weit, `recycle_settings`), endet
 * das Recycling endgültig (next_recycle_at = null) statt alle paar Monate
 * für immer weiterzulaufen (Recherche: Deckel gegen Dauer-Nerven).
 */
export async function markRecycleContacted(
  origin: RecycleOrigin,
  entityId: string,
  reason: string | null,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessRecycleRow(access, origin, entityId))) return { error: "Nicht gefunden." };

  const supabase = await createClient();
  const { data } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .select("recycle_attempt_count")
    .eq("id", entityId)
    .maybeSingle();
  const nextAttempt = ((data as { recycle_attempt_count: number } | null)?.recycle_attempt_count ?? 0) + 1;

  const settings = await loadRecycleSettingsRow(access.workspace_id);
  const nextAt =
    nextAttempt >= settings.max_attempts
      ? null
      : computeNextRecycleAt(origin, reason, nextAttempt, settings, localDateISO());

  const { error } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .update({ next_recycle_at: nextAt, recycle_attempt_count: nextAttempt })
    .eq("id", entityId);
  if (error) return { error: error.message };
  revalidatePath("/nachfassen");
  return {};
}

/** "Reagiert" — Recycling stoppen, ohne den Lead auszuschließen (er ist ja wieder im Spiel). */
export async function markRecycleResponded(origin: RecycleOrigin, entityId: string): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessRecycleRow(access, origin, entityId))) return { error: "Nicht gefunden." };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .update({ next_recycle_at: null })
    .eq("id", entityId);
  if (error) return { error: error.message };
  revalidatePath("/nachfassen");
  return {};
}

/** "Endgültig raus" — permanentes Opt-out, unabhängig von blocked_at (das kennt nur LinkedIn). */
export async function excludeFromRecycle(origin: RecycleOrigin, entityId: string): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessRecycleRow(access, origin, entityId))) return { error: "Nicht gefunden." };

  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE_BY_ORIGIN[origin])
    .update({ next_recycle_at: null, recycle_excluded_at: new Date().toISOString() })
    .eq("id", entityId);
  if (error) return { error: error.message };
  revalidatePath("/nachfassen");
  return {};
}

export type RecycleTaskRaw = {
  origin: RecycleOrigin;
  entity_id: string;
  owner_name: string | null;
  lead_name: string | null;
  company: string | null;
  due_at: string | null;
  reason: string | null;
  attempt_count: number;
};

/** Fällige Recycling-Versuche über alle vier Ursprünge — RPC `recycle_tasks` (Migration 0032). */
export async function loadRecycleTasksRaw(access: AccessContext): Promise<RecycleTaskRaw[]> {
  const supabase = await createClient();
  const scopeUserId = access.effective_user_id ?? access.user.id;
  try {
    return await fetchAllRows((from, to) =>
      supabase
        .rpc("recycle_tasks", {
          p_workspace_id: access.workspace_id,
          p_today: localDateISO(),
          p_effective_user_id: scopeUserId,
        })
        .range(from, to),
    );
  } catch (e) {
    console.error("recycle_tasks:", e instanceof Error ? e.message : e);
    return [];
  }
}
