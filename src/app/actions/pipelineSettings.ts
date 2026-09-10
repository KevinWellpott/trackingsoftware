"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";

// Die eine Konfigurationszeile je Organisation (`pipeline_settings`,
// Migration 0032).
//
// Sie stand bis zum Rückbau in `actions/reminders.ts`, weil dieselbe Zeile
// einmal die Kaskade und einmal das Recycling versorgte. Die Kaskade ist
// gefallen, `reminders.ts` mit ihr — die Zeile nicht: Sie trägt weiterhin
//
//   · `max_reschedules` — das Verschiebe-Kontingent. Es entscheidet, ab wann
//     die Terminliste einen Lead als „liegt in der Luft" statt als „ist
//     versorgt" führt, und ist damit genau die Unterscheidung, auf der die
//     neue Arbeitsfläche steht. Wäre es mit dem Erinnerungs-Modul gefallen,
//     verschwände die Warnung in `postponeAppointment` und in der
//     Lebenszyklus-Leiste — beide lautlos, weil ein fehlender Hinweis kein
//     Fehler ist.
//   · die Wartezeiten des Recyclings. Der Mechanismus bleibt, nur flach: EINE
//     Frist statt neun. `/settings` schreibt sie deshalb in jede Spalte
//     zugleich (PipelineSettingsCard) — `schedule_recycle()` (0033,
//     eingefroren) sucht sich je Ursprung und Verlustgrund eine davon aus, und
//     eine ungeschriebene Spalte trüge still die alte Staffelung weiter.
//
// Deshalb bleiben `PipelineSettings` und `SETTINGS_BOUNDS` vollständig: Der
// Typ ist die Liste, gegen die die Karte prüft, dass sie wirklich jede Spalte
// erwischt (tests/rueckbauEinstellungen.test.ts).

/**
 * Fehlt das Schema (Migration 0032 nicht eingespielt), muss das von „noch
 * nichts konfiguriert" unterscheidbar sein — sonst greifen überall die
 * Spalten-Defaults, ohne dass jemand merkt, dass gar keine Zeile existiert.
 * Muster `loadCallAttempts` (src/lib/phoneAttemptsData.ts).
 *
 * Geprüft wird der FEHLERCODE bzw. der Meldungstext, NICHT die leere
 * Ergebnismenge: eine leere Tabelle antwortet mit 200 und `[]`, eine fehlende
 * Relation mit 42P01/PGRST205.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42883", "PGRST202", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

export type PipelineSettings = {
  max_reschedules: number;
  reminder_horizon_days: number;
  days_default_closing_lost: number;
  days_default_setting_disqualified: number;
  days_default_phone_dead: number;
  days_default_setting_dead: number;
  days_default_linkedin_exhausted: number;
  days_timing: number;
  days_preis: number;
  days_kein_bedarf: number;
  days_entscheider: number;
  days_wettbewerb: number;
  days_vertrauen: number;
  days_ghosting_breakup: number;
  days_ghosting: number;
  days_sonstiges: number;
  max_attempts: number;
};

/**
 * Wörtlich die Spalten-Defaults aus Migration 0032. Sie greifen nur, solange
 * `seed_workspace_defaults()` für die Organisation noch nicht gelaufen ist —
 * ohne sie stünde bei einer frisch angelegten Organisation eine 0 in jedem
 * Feld, und eine 0-Wartezeit legte den ganzen Lead-Bestand auf morgen.
 */
const PIPELINE_DEFAULTS: PipelineSettings = {
  max_reschedules: 2,
  reminder_horizon_days: 7,
  days_default_closing_lost: 28,
  days_default_setting_disqualified: 56,
  days_default_phone_dead: 100,
  days_default_setting_dead: 100,
  days_default_linkedin_exhausted: 100,
  days_timing: 75,
  days_preis: 105,
  days_kein_bedarf: 105,
  days_entscheider: 150,
  days_wettbewerb: 270,
  days_vertrauen: 270,
  days_ghosting_breakup: 14,
  days_ghosting: 180,
  days_sonstiges: 120,
  max_attempts: 2,
};

/** Dieselben Grenzen wie die CHECKs in 0032 — beidseitig geklemmt, damit ein
    direkter POST auf die Server-Action keine rohe Postgres-Meldung erzeugt. */
const SETTINGS_BOUNDS: Record<keyof PipelineSettings, { min: number; max: number }> = {
  max_reschedules: { min: 1, max: 5 },
  reminder_horizon_days: { min: 1, max: 60 },
  max_attempts: { min: 1, max: 5 },
  days_default_closing_lost: { min: 1, max: 3650 },
  days_default_setting_disqualified: { min: 1, max: 3650 },
  days_default_phone_dead: { min: 1, max: 3650 },
  days_default_setting_dead: { min: 1, max: 3650 },
  days_default_linkedin_exhausted: { min: 1, max: 3650 },
  days_timing: { min: 1, max: 3650 },
  days_preis: { min: 1, max: 3650 },
  days_kein_bedarf: { min: 1, max: 3650 },
  days_entscheider: { min: 1, max: 3650 },
  days_wettbewerb: { min: 1, max: 3650 },
  days_vertrauen: { min: 1, max: 3650 },
  days_ghosting_breakup: { min: 1, max: 3650 },
  days_ghosting: { min: 1, max: 3650 },
  days_sonstiges: { min: 1, max: 3650 },
};

const SETTINGS_COLUMNS = Object.keys(PIPELINE_DEFAULTS).join(", ");

export type PipelineSettingsResult = {
  settings: PipelineSettings;
  /** false = Schema fehlt. Ausdrücklich NICHT dasselbe wie „noch nichts konfiguriert". */
  available: boolean;
  /** true = es gibt eine gespeicherte Zeile; false = die Spalten-Defaults greifen. */
  configured: boolean;
};

async function loadPipelineSettings(workspaceId: string): Promise<PipelineSettingsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_settings")
    .select(SETTINGS_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    const missing = isMissingSchema(error);
    if (!missing) console.error("[pipeline_settings]", error.message);
    return { settings: PIPELINE_DEFAULTS, available: !missing, configured: false };
  }
  const row = data as unknown as Partial<PipelineSettings> | null;
  return {
    settings: row ? { ...PIPELINE_DEFAULTS, ...row } : PIPELINE_DEFAULTS,
    available: true,
    configured: Boolean(row),
  };
}

/** Konfiguration der aktiven Organisation. */
export async function getPipelineSettings(): Promise<PipelineSettingsResult> {
  const access = await getAccessContext();
  if (!access) return { settings: PIPELINE_DEFAULTS, available: false, configured: false };
  return loadPipelineSettings(access.workspace_id);
}

/**
 * Owner-only, org-weit — `access.can_switch_view` ist wörtlich dasselbe
 * Prädikat wie `can_manage_org_settings()` in der RLS (Migration 0031).
 *
 * Gibt `{error}` zurück statt `Promise<void>`: die Vorgänger-Actions warfen den
 * Fehler weg, ein verletzter CHECK sprang lautlos auf den alten Wert zurück.
 */
export async function updatePipelineSettings(
  patch: Partial<PipelineSettings>,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!access.can_switch_view) return { error: "Keine Berechtigung." };

  const current = await loadPipelineSettings(access.workspace_id);
  if (!current.available) return { error: "Konfiguration nicht verfügbar — Migration 0032 fehlt." };

  const clean: Partial<PipelineSettings> = {};
  for (const [key, value] of Object.entries(patch) as [keyof PipelineSettings, unknown][]) {
    const bounds = SETTINGS_BOUNDS[key];
    if (!bounds) continue; // unbekanntes Feld: nicht durchreichen, nicht raten
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return { error: `Ungültiger Wert für ${key}.` };
    clean[key] = Math.min(bounds.max, Math.max(bounds.min, n));
  }
  if (Object.keys(clean).length === 0) return { error: "Nichts zu speichern." };

  const supabase = await createClient();
  const { error } = await supabase.from("pipeline_settings").upsert(
    {
      workspace_id: access.workspace_id,
      ...current.settings,
      ...clean,
      updated_by_user_id: access.user.id,
    },
    { onConflict: "workspace_id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/settings");
  // `/erinnerungen` stand hier bis zum Rückbau daneben — die Route ist seither
  // eine Weiterleitung und hat nichts mehr neu zu berechnen.
  revalidatePath("/nachfassen");
  revalidatePath("/termine");
  return {};
}
