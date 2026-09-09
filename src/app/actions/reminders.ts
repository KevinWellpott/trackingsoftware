"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext, type AccessContext } from "@/lib/access";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import {
  cascadeKindFor,
  planEventChain,
  planScheduledCascade,
  type CascadeKind,
  type CascadePlan,
  type CascadeStep,
  type SkippedStep,
  type TouchKind,
} from "@/lib/cascadeEngine";
import { isTemplateKey, type TemplateBundle, type TemplateKey, type TemplateText } from "@/lib/messageTemplates";
import {
  resolveCascadeChannel,
  resolveFollowUpChannel,
  type ReminderEntityType,
  type TouchChannel,
} from "@/lib/reminderCascade";

// Erinnerungs-Kaskade: Bestätigungs-Touches vor Setting-/Closing-/Nachfass-
// Terminen und die Ketten nach einem Ereignis (No-Show, kein Abschluss).
//
// Gegenüber der ersten Fassung sprechen hier drei Dinge anders:
//
//  1. Die Stufen sind DATEN (`cascade_steps`), nicht drei feste Offset-Spalten.
//     Gerechnet wird ausschließlich in `src/lib/cascadeEngine.ts`; diese Datei
//     liest, schreibt und klärt Zuständigkeit — mehr nicht.
//  2. Entwerten und Neuanlegen laufen in EINEM Aufruf (`apply_reminder_touches`).
//     Vorher waren das zwei Statements gegen einen partiellen Unique-Index:
//     zwei dicht aufeinanderfolgende Auslöser (Umterminieren + Ergebnis) ließen
//     den Insert scheitern, und weil alles fail-soft ist, stand der Termin
//     danach ganz ohne Kaskade da.
//  3. Die Texte stehen nicht mehr in einer Settings-Spalte, sondern kommen über
//     `getTemplateBundles()` aus `message_templates` — je zuständiger Person,
//     nicht je Betrachter.
//
// Alles Erzeugende ist weiterhin FAIL-SOFT (Fehler werden geloggt und im
// Ergebnis gemeldet, nie geworfen) — dasselbe Prinzip wie `logCallAttempt`:
// eine fehlgeschlagene Erinnerung darf keine Terminbuchung blockieren. Die
// generate*-Funktionen lesen den Stand der Eltern-Zeile selbst, statt ihn sich
// von den zahlreichen Aufrufstellen mitschleppen zu lassen.

/* ------------------------------------------------------------------ *
 * Verfügbarkeits-Probe
 * ------------------------------------------------------------------ */

/**
 * Fehlt das Schema (Migration 0032 nicht eingespielt), muss das von „nichts
 * fällig" unterscheidbar sein — sonst zeigt die App in beiden Fällen denselben
 * grünen Leerzustand und niemand merkt, dass die Kaskade gar nicht läuft.
 * Muster `loadCallAttempts` (src/lib/phoneAttemptsData.ts).
 *
 * Geprüft wird der FEHLERCODE bzw. der Meldungstext, NICHT die leere
 * Ergebnismenge: eine leere Tabelle antwortet mit 200 und `[]`, eine fehlende
 * Relation mit 42P01/PGRST205, eine fehlende Funktion mit 42883/PGRST202.
 * `fetchAllRows` wirft nur die Message weiter, deshalb beide Wege.
 *
 * Bewusst in beiden Action-Dateien dupliziert, solange es die gemeinsame
 * `schemaProbe.ts` noch nicht gibt — zwei kurze Prädikate sind ehrlicher als
 * ein Import quer durch die Server-Actions.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42883", "PGRST202", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

/* ------------------------------------------------------------------ *
 * pipeline_settings — eine Konfigurationszeile je Organisation
 * ------------------------------------------------------------------ */

/**
 * Ersetzt `reminder_settings` UND `recycle_settings`. Die Recycling-Werte
 * stehen deshalb hier und nicht in recycle.ts: es gibt nur noch eine Zeile und
 * nur noch ein Formular. recycle.ts braucht sie ohnehin nicht mehr zum Rechnen
 * — Wartezeit und Deckel bestimmt seit Migration 0033 die Datenbank.
 */
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

/** Konfiguration der aktiven Organisation (Kaskade + Recycling in einer Zeile). */
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
  revalidatePath("/erinnerungen");
  revalidatePath("/nachfassen");
  return {};
}

/* ------------------------------------------------------------------ *
 * cascade_steps — die Stufen
 * ------------------------------------------------------------------ */

const STEP_COLUMNS =
  "cascade_kind, step_no, trigger_event, anchor, offset_minutes, requires_no_response, enabled, template_key";

export type CascadeStepsResult = { steps: CascadeStep[]; available: boolean };

async function loadCascadeSteps(workspaceId: string): Promise<CascadeStepsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cascade_steps")
    .select(STEP_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("cascade_kind")
    .order("step_no");

  if (error) {
    const missing = isMissingSchema(error);
    if (!missing) console.error("[cascade_steps]", error.message);
    return { steps: [], available: !missing };
  }
  // Eine Stufe mit unbekanntem template_key wird ausgelassen statt geraten: der
  // Snapshot in reminder_touches.template_key müsste sonst auf einen Text
  // zeigen, den TEMPLATE_DEFAULTS gar nicht kennt — die Karte bliebe leer.
  const steps = ((data ?? []) as unknown as (Omit<CascadeStep, "template_key"> & { template_key: string })[])
    .filter((s) => {
      if (isTemplateKey(s.template_key)) return true;
      console.error("[cascade_steps] unbekannter template_key:", s.template_key);
      return false;
    })
    .map((s) => ({ ...s, template_key: s.template_key as TemplateKey }));
  return { steps, available: true };
}

/** Die konfigurierten Stufen der aktiven Organisation (alle Kaskaden, auch abgeschaltete). */
export async function getCascadeSteps(): Promise<CascadeStepsResult> {
  const access = await getAccessContext();
  if (!access) return { steps: [], available: false };
  return loadCascadeSteps(access.workspace_id);
}

/* ------------------------------------------------------------------ *
 * Vorlagen
 * ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Die Vorlagen MEHRERER Absender in EINER Query.
 *
 * Absender ist nie der Betrachter, sondern die zuständige Person: auf
 * /erinnerungen rendert jede Karte gegen das Bundle ihres
 * `assigned_user_id`. Ein Owner in der Team-Ansicht sähe sonst seine eigenen
 * Texte unter fremden Namen. Gebündelt geladen, weil eine Query je Karte auf
 * einem vollen Board sofort n+1 wäre.
 *
 * Die Map enthält für JEDE angefragte user_id einen Eintrag — auch ohne eigene
 * Zeile —, damit die Aufrufstelle nicht zwischen „kein Bundle" und „keine
 * persönliche Vorlage" unterscheiden muss; die Auslieferungstexte hängen
 * ohnehin in `resolveTemplate()` dahinter.
 */
export async function getTemplateBundles(userIds: string[]): Promise<Map<string, TemplateBundle>> {
  const out = new Map<string, TemplateBundle>();
  const access = await getAccessContext();

  // Die IDs landen in einem PostgREST-`or`-Ausdruck, in dem Komma und Punkt
  // Trennzeichen sind — deshalb nur echte UUIDs durchlassen.
  const ids = [...new Set(userIds.filter((id) => UUID_RE.test(id)))];
  const org: Partial<Record<TemplateKey, TemplateText>> = {};
  const own = new Map<string, Partial<Record<TemplateKey, TemplateText>>>();
  ids.forEach((id) => own.set(id, {}));

  if (access) {
    const supabase = await createClient();
    let query = supabase
      .from("message_templates")
      .select("user_id, template_key, subject, body")
      .eq("workspace_id", access.workspace_id);
    query = ids.length > 0 ? query.or(`user_id.is.null,user_id.in.(${ids.join(",")})`) : query.is("user_id", null);

    const { data, error } = await query;
    if (error) {
      // Fehlt die Tabelle, greifen überall die Auslieferungstexte — das ist der
      // korrekte Rückfall der Vorrangkette und kein Ausfall.
      if (!isMissingSchema(error)) console.error("[message_templates]", error.message);
    } else {
      for (const row of (data ?? []) as unknown as {
        user_id: string | null;
        template_key: string;
        subject: string | null;
        body: string;
      }[]) {
        if (!isTemplateKey(row.template_key)) continue;
        const text: TemplateText = row.subject ? { body: row.body, subject: row.subject } : { body: row.body };
        if (row.user_id === null) {
          org[row.template_key] = text;
          continue;
        }
        const personal = own.get(row.user_id);
        if (personal) personal[row.template_key] = text;
      }
    }
  }

  for (const id of ids) out.set(id, { own: own.get(id) ?? {}, org });
  return out;
}

/* ------------------------------------------------------------------ *
 * Touch-Erzeugung
 * ------------------------------------------------------------------ */

export type CascadeResult = {
  created: number;
  /** Stufen, für die die Zeit nicht mehr reichte — im Klartext begründet. */
  skipped: SkippedStep[];
  /** Gesetzt, wenn gar nichts entstehen konnte. Fail-soft: nie geworfen. */
  error?: string;
};

const NOTHING: CascadeResult = { created: 0, skipped: [] };

type EntityRow = {
  appointment_at: string | null;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  cancelled_at: string | null;
  channel: TouchChannel | null;
};

type ChannelSource = {
  wa_phone: string | null;
  wa_consent_at: string | null;
  wa_refused_at: string | null;
  source_type: string | null;
};

/**
 * Kanal einer Kaskade: WhatsApp, sobald Nummer UND dokumentierte Einwilligung
 * am Setting stehen (UWG-Pflicht, auch B2B), sonst der Akquise-Kanal.
 *
 * `wa_refused_at` ist die dokumentierte Verweigerung („will keine Nummer
 * rausgeben") — ohne diesen Zweig wäre sie von einer bloßen Erfassungslücke
 * nicht zu unterscheiden. Der CHECK in 0032 erzwingt zwar bereits, dass dann
 * keine Nummer danebensteht; die Absicht gehört trotzdem sichtbar in den Code,
 * sonst hängt sie an einem Constraint, den hier niemand liest.
 */
function channelFor(row: ChannelSource | null): TouchChannel | null {
  if (!row) return null;
  if (row.wa_refused_at) return resolveCascadeChannel(row.source_type);
  return resolveFollowUpChannel(row);
}

const SETTING_COLUMNS =
  "appointment_at, assigned_user_id, created_by_user_id, cancelled_at, source_type, wa_phone, wa_consent_at, wa_refused_at";
const CLOSING_COLUMNS =
  "call_at, follow_up_due_at, assigned_user_id, created_by_user_id, cancelled_at, setting_call_id";

/** Setting-Zeile inklusive aufgelöstem Kanal — eine Query statt zwei. */
async function loadSettingEntity(access: AccessContext, settingCallId: string): Promise<EntityRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("setting_calls")
    .select(SETTING_COLUMNS)
    .eq("id", settingCallId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  const row = data as unknown as (ChannelSource & Omit<EntityRow, "channel">) | null;
  if (!row) return null;
  return { ...row, channel: channelFor(row) };
}

/**
 * Closing-Zeile. `which` entscheidet, welcher Zeitpunkt der Anker ist: der
 * Closing-Termin selbst oder der vereinbarte Nachfass-Kontakt. Der Kanal kommt
 * in beiden Fällen vom verknüpften Setting — nur dort steht die WhatsApp-Nummer.
 */
async function loadClosingEntity(
  access: AccessContext,
  closingCallId: string,
  which: "call" | "followup",
): Promise<EntityRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("closing_calls")
    .select(CLOSING_COLUMNS)
    .eq("id", closingCallId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  const row = data as unknown as {
    call_at: string | null;
    follow_up_due_at: string | null;
    assigned_user_id: string | null;
    created_by_user_id: string | null;
    cancelled_at: string | null;
    setting_call_id: string | null;
  } | null;
  if (!row) return null;

  let source: ChannelSource | null = null;
  if (row.setting_call_id) {
    const { data: sc } = await supabase
      .from("setting_calls")
      .select("source_type, wa_phone, wa_consent_at, wa_refused_at")
      .eq("id", row.setting_call_id)
      .maybeSingle();
    source = (sc as unknown as ChannelSource | null) ?? null;
  }

  return {
    appointment_at: which === "followup" ? row.follow_up_due_at : row.call_at,
    assigned_user_id: row.assigned_user_id,
    created_by_user_id: row.created_by_user_id,
    cancelled_at: row.cancelled_at,
    channel: channelFor(source),
  };
}

/**
 * Wem die Erinnerungen dieses Termins gehören — `personOf()`-Regel als
 * Snapshot: Zuweisung schlägt Ersteller.
 *
 * Der Ersteller-Fallback greift NICHT in fremder Organisation. Dort ist der
 * Angemeldete ein Plattform-Admin und bewusst kein Mitglied: Die Anlagepfade
 * (`createManualSetting`, `convertContactToSetting`, `createClosingFromSetting`,
 * `reviveDropout`) setzen `assigned_user_id` deshalb auf NULL, schreiben aber
 * `created_by_user_id` = seine UUID. Ohne diese Ausnahme fiele die Kaskade
 * genau darauf zurück und legte in den Kundendaten Erinnerungen an, die einem
 * Konto gehören, das dort nicht existiert: Sie tauchen in KEINEM „Meine
 * Erinnerungen" auf (der Filter ist `assigned_user_id = eigene id`), erscheinen
 * in der Team-Ansicht des Kunden unter einem fremden Namen und verletzen die
 * Invariante aus 0036 („keine aktive Erinnerung gehört einem Nicht-Mitglied").
 *
 * Mit `null` greift stattdessen der ausformulierte Abbruch in `applyPlan` — der
 * Admin sieht, dass der Termin noch niemandem gehört, statt lautlos ohne
 * Kaskade dazustehen.
 */
function assigneeFor(
  access: AccessContext,
  row: { assigned_user_id: string | null; created_by_user_id: string | null },
): string | null {
  if (access.is_foreign_org) return row.assigned_user_id;
  return row.assigned_user_id ?? row.created_by_user_id;
}

/**
 * Plan schreiben — Entwerten und Neuanlegen in EINEM Aufruf.
 *
 * Der Insert-Trigger aus 0032 weist eine Zeile ohne zuständige Person ab, und
 * das lässt den ganzen Aufruf scheitern. Deshalb wird hier vorher abgebrochen
 * und der Grund gemeldet statt geloggt-und-vergessen: In fremder Organisation
 * ist ein Plattform-Admin kein Mitglied, `assigned_user_id` bliebe NULL — der
 * Termin bekäme dort schlicht keine Kaskade, und das muss sichtbar sein.
 */
async function applyPlan(
  access: AccessContext,
  entityType: ReminderEntityType,
  entityId: string,
  kind: CascadeKind,
  plan: CascadePlan,
  assignedUserId: string | null,
  channel: TouchChannel | null,
): Promise<CascadeResult> {
  if (!assignedUserId) {
    const error = "Keine zuständige Person — ohne sie entsteht keine Erinnerung.";
    console.error(`[cascade:${kind}] ${entityId}: ${error}`);
    return { created: 0, skipped: plan.skipped, error };
  }

  const rows = plan.touches.map((t) => ({
    touch_kind: t.touch_kind,
    step_no: t.step_no,
    requires_no_response: t.requires_no_response,
    template_key: t.template_key,
    assigned_user_id: assignedUserId,
    due_at: t.due_at,
    appointment_at: t.appointment_at,
    channel,
  }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_reminder_touches", {
    p_workspace_id: access.workspace_id,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_cascade_kind: kind,
    p_rows: rows,
  });
  if (error) {
    console.error(`[apply_reminder_touches:${kind}]`, error.message);
    return { created: 0, skipped: plan.skipped, error: error.message };
  }
  revalidatePath("/erinnerungen");
  return { created: Number(data ?? rows.length), skipped: plan.skipped };
}

/**
 * Gemeinsamer Rumpf der drei Vor-Termin-Kaskaden.
 *
 * Nur die Nachrichten-Spur wird erzeugt. Die Mail-Spur ist in 0034 bewusst
 * `enabled=false` und wird im Kern weder angeboten noch gerendert — Touches
 * dafür wären Karten, die die Oberfläche nicht anzeigen kann.
 */
async function generateScheduled(
  entityType: ReminderEntityType,
  entityId: string,
  load: (access: AccessContext) => Promise<EntityRow | null>,
): Promise<CascadeResult> {
  try {
    const access = await getAccessContext();
    if (!access) return NOTHING;
    const row = await load(access);
    if (!row) return NOTHING;

    const kind = cascadeKindFor(entityType);

    // Abgesagt heißt: es gibt nichts mehr zu bestätigen. Die offenen Touches
    // müssen trotzdem weg — sonst erinnert die App an einen Termin, den beide
    // Seiten abgeräumt haben.
    if (row.cancelled_at || !row.appointment_at) {
      await supersedeTouches(entityType, entityId, [kind]);
      return NOTHING;
    }

    const { steps, available } = await loadCascadeSteps(access.workspace_id);
    if (!available) return { created: 0, skipped: [], error: "Kaskaden-Konfiguration fehlt (Migration 0032)." };

    const plan = planScheduledCascade(steps, kind, row.appointment_at);
    return applyPlan(
      access,
      entityType,
      entityId,
      kind,
      plan,
      // personOf()-Regel: Zuweisung schlägt Ersteller. Als Snapshot festgehalten,
      // damit ein späteres setAssignee() eine historische Erinnerung nicht
      // lautlos zwischen Personen verschiebt.
      assigneeFor(access, row),
      row.channel,
    );
  } catch (e) {
    console.error(`[generateScheduled:${entityType}]`, e instanceof Error ? e.message : e);
    return NOTHING;
  }
}

/** Setting-Kaskade (neu erzeugen oder nach Umterminierung neu berechnen). */
export async function generateSettingCascade(settingCallId: string): Promise<CascadeResult> {
  return generateScheduled("setting", settingCallId, (a) => loadSettingEntity(a, settingCallId));
}

/** Closing-Kaskade (neu erzeugen oder nach geändertem `call_at` neu berechnen). */
export async function generateClosingCascade(closingCallId: string): Promise<CascadeResult> {
  return generateScheduled("closing", closingCallId, (a) => loadClosingEntity(a, closingCallId, "call"));
}

/** Kaskade vor dem vereinbarten Nachfass-Kontakt (Closing im Status 'nachfassen'). */
export async function generateFollowUpCascade(closingCallId: string): Promise<CascadeResult> {
  return generateScheduled("closing_followup", closingCallId, (a) =>
    loadClosingEntity(a, closingCallId, "followup"),
  );
}

/** Gemeinsamer Rumpf der Ereignis-Ketten (No-Show, Kickoff, kein Abschluss). */
async function generateChain(
  entityType: "setting" | "closing",
  entityId: string,
  kind: CascadeKind,
): Promise<CascadeResult> {
  try {
    const access = await getAccessContext();
    if (!access) return NOTHING;
    const row =
      entityType === "setting"
        ? await loadSettingEntity(access, entityId)
        : await loadClosingEntity(access, entityId, "call");
    if (!row) return NOTHING;

    const { steps, available } = await loadCascadeSteps(access.workspace_id);
    if (!available) return { created: 0, skipped: [], error: "Kaskaden-Konfiguration fehlt (Migration 0032)." };

    // Anker ist das EREIGNIS, nicht der Termin: die Kette beginnt jetzt, auch
    // wenn der Termin schon Stunden zurückliegt.
    const nowIso = new Date().toISOString();
    const plan = planEventChain(steps, kind, nowIso, row.appointment_at ?? nowIso);
    return applyPlan(
      access,
      entityType,
      entityId,
      kind,
      plan,
      assigneeFor(access, row),
      row.channel,
    );
  } catch (e) {
    console.error(`[generateChain:${kind}]`, e instanceof Error ? e.message : e);
    return NOTHING;
  }
}

/**
 * No-Show-Kette statt eines einzelnen Sofort-Touches: sofort nachfragen, und —
 * nur falls keine Antwort kam — am Tag danach erneut. Das ist wörtlich der
 * Pfeil „keine Antwort" aus dem Konzept; die zweite Stufe trägt dafür
 * `requires_no_response` und wird von `setReminderTouchDone` entwertet, sobald
 * auf der ersten eine Antwort eingetragen wird.
 */
export async function createNoShowTouch(entityType: "setting" | "closing", entityId: string): Promise<CascadeResult> {
  return generateChain(entityType, entityId, entityType === "closing" ? "no_show_closing" : "no_show_setting");
}

/** Nachricht direkt nach der Qualifizierung — Anker ist das Anlegen des Closings. */
export async function generateClosingKickoff(closingCallId: string): Promise<CascadeResult> {
  return generateChain("closing", closingCallId, "closing_kickoff");
}

/** Kette nach einem Closing ohne Abschluss (Zusammenfassung, dann Nachhaken). */
export async function generateKeinCloseChain(closingCallId: string): Promise<CascadeResult> {
  return generateChain("closing", closingCallId, "kein_close");
}

/**
 * Offene Touches entwerten (Soft-Delete statt Hard-Delete — die
 * Erledigungs-Historie bleibt für die Analyse zählbar). Ohne `cascadeKinds`
 * trifft es ALLE Kaskaden dieses Termins.
 *
 * Der `workspace_id`-Filter ist Pflicht und war es vorher nicht: ohne ihn
 * entwertete ein Plattform-Admin die Touches einer fremden Organisation, sobald
 * er eine ID von dort in der Hand hatte.
 */
export async function supersedeTouches(
  entityType: ReminderEntityType,
  entityId: string,
  cascadeKinds?: readonly CascadeKind[],
): Promise<void> {
  try {
    const access = await getAccessContext();
    if (!access) return;
    const supabase = await createClient();
    let query = supabase
      .from("reminder_touches")
      .update({ superseded_at: new Date().toISOString() })
      .eq("workspace_id", access.workspace_id)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("superseded_at", null);
    if (cascadeKinds?.length) query = query.in("cascade_kind", cascadeKinds);
    const { error } = await query;
    if (error && !isMissingSchema(error)) console.error("[supersedeTouches]", error.message);
  } catch (e) {
    console.error("[supersedeTouches]", e instanceof Error ? e.message : e);
  }
}

/**
 * Termin gelöscht. Der FK in 0032 räumt die Touches zwar selbst ab
 * (`on delete cascade`) — der Aufruf bleibt trotzdem, weil er den Fall
 * „Termin bleibt stehen, seine Erinnerungen sollen weg" mit abdeckt und die
 * Historie dabei erhält, statt sie zu löschen.
 */
export async function deleteTouchesForEntity(entityType: ReminderEntityType, entityId: string): Promise<void> {
  await supersedeTouches(entityType, entityId);
}

/* ------------------------------------------------------------------ *
 * "Meine Erinnerungen"
 * ------------------------------------------------------------------ */

export type TouchOutcome = "antwort" | "keine_antwort" | "bestaetigt" | "abgesagt" | "verschoben";

export type ReminderTouchWithContext = {
  id: string;
  entity_type: ReminderEntityType;
  entity_id: string;
  setting_call_id: string | null;
  closing_call_id: string | null;
  touch_kind: TouchKind;
  cascade_kind: CascadeKind;
  step_no: number;
  requires_no_response: boolean;
  template_key: TemplateKey;
  due_at: string;
  appointment_at: string;
  /** Live aufgelöst, sofern die Person den Kanal nicht selbst festgelegt hat. */
  channel: TouchChannel | null;
  channel_locked: boolean;
  outcome: TouchOutcome | null;
  done_at: string | null;
  done_note: string | null;
  assigned_user_id: string | null;
  assigned_username: string | null;
  lead_name: string | null;
  company: string | null;
  meet_link: string | null;
};

type RawTouchRow = Omit<
  ReminderTouchWithContext,
  "assigned_username" | "lead_name" | "company" | "meet_link" | "template_key"
> & { template_key: string };

const TOUCH_COLUMNS =
  "id, entity_type, entity_id, setting_call_id, closing_call_id, touch_kind, cascade_kind, step_no, " +
  "requires_no_response, template_key, due_at, appointment_at, channel, channel_locked, outcome, " +
  "done_at, done_note, assigned_user_id";

export type ReminderInbox = {
  touches: ReminderTouchWithContext[];
  /** false = Schema fehlt (Migration 0032). Nicht mit „nichts fällig" verwechseln. */
  available: boolean;
  /** Wie weit nach vorn geschaut wurde — gehört als Angabe an die Oberfläche. */
  horizonDays: number;
};

const DONE_LOOKBACK_DAYS = 7;

/**
 * Der Snapshot in der Zeile bleibt maßgeblich — eine später umbenannte Stufe
 * schreibt die Historie nicht um. Kennt die App den Key gar nicht mehr, wird er
 * aus Kaskade und Stufe rekonstruiert, statt die Karte auf einen fremden Text
 * zu setzen; 'setting_msg_1' ist nur der letzte Notnagel, damit die Zeile
 * überhaupt rendert.
 */
function templateKeyOf(raw: string, cascadeKind: CascadeKind, stepNo: number): TemplateKey {
  if (isTemplateKey(raw)) return raw;
  const byStep = `${cascadeKind}_${stepNo}`;
  if (isTemplateKey(byStep)) return byStep;
  if (isTemplateKey(cascadeKind)) return cascadeKind;
  console.error("[reminder_touches] unbekannter template_key:", raw);
  return "setting_msg_1";
}

/**
 * Fällige Touches für „Meine Erinnerungen".
 *
 * Zwei Fenster, beide serverseitig: nach vorn `reminder_horizon_days`
 * (Default 7) — ohne obere Grenze stünde ein Touch in fünf Wochen unter
 * „Diese Woche" —, nach hinten nur die zuletzt erledigten, damit die
 * Erledigt-Sektion nicht unbegrenzt wächst. Überfällige Touches haben bewusst
 * KEINE untere Grenze: überfällig ist überfällig.
 *
 * `teamView` nur für `role='owner' && data_scope='workspace'`, sonst
 * serverseitig auf den Aufrufer erzwungen (Muster `getNachfassenTasks`).
 */
export async function getDueReminderTouches(options?: {
  teamView?: boolean;
  horizonDays?: number;
}): Promise<ReminderInbox> {
  const access = await getAccessContext();
  if (!access) return { touches: [], available: false, horizonDays: PIPELINE_DEFAULTS.reminder_horizon_days };

  const config = await loadPipelineSettings(access.workspace_id);
  const horizonDays = Math.min(
    SETTINGS_BOUNDS.reminder_horizon_days.max,
    Math.max(SETTINGS_BOUNDS.reminder_horizon_days.min, options?.horizonDays ?? config.settings.reminder_horizon_days),
  );

  const supabase = await createClient();
  const teamView = Boolean(options?.teamView) && access.role === "owner" && access.data_scope === "workspace";
  const scopeUserId = access.effective_user_id ?? access.user.id;
  const now = Date.now();
  const horizonEnd = new Date(now + horizonDays * 86_400_000).toISOString();
  const doneSince = new Date(now - DONE_LOOKBACK_DAYS * 86_400_000).toISOString();

  let rows: RawTouchRow[] = [];
  try {
    // Cast wie in loadCallAttempts: PostgREST kann die zusammengesetzte
    // Spaltenliste nicht typisieren und liefert sonst `GenericStringError[]`.
    const raw = await fetchAllRows((f, t) => {
      let query = supabase
        .from("reminder_touches")
        .select(TOUCH_COLUMNS)
        .eq("workspace_id", access.workspace_id)
        .is("superseded_at", null)
        .lte("due_at", horizonEnd)
        // Zeitstempel gequotet: im or-Ausdruck trennt PostgREST an Punkt und
        // Komma, und ein ISO-Zeitstempel bringt beide Zeichen mit.
        .or(`done_at.is.null,done_at.gte."${doneSince}"`);
      if (!teamView) query = query.eq("assigned_user_id", scopeUserId);
      return query.order("due_at", { ascending: true }).order("id").range(f, t);
    });
    rows = raw as unknown as RawTouchRow[];
  } catch (e) {
    const missing = isMissingSchema(e);
    if (!missing) console.error("getDueReminderTouches:", e instanceof Error ? e.message : e);
    return { touches: [], available: !missing, horizonDays };
  }
  if (rows.length === 0) return { touches: [], available: true, horizonDays };

  const settingIds = [...new Set(rows.map((r) => r.setting_call_id).filter((v): v is string => Boolean(v)))];
  const closingIds = [...new Set(rows.map((r) => r.closing_call_id).filter((v): v is string => Boolean(v)))];

  type Info = { lead_name: string | null; company: string | null; meet_link: string | null };
  const info = new Map<string, Info>();
  // Kanalquelle je Termin: beim Setting die eigene Zeile, beim Closing die des
  // verknüpften Settings — nur dort steht die WhatsApp-Nummer.
  const channelSource = new Map<string, ChannelSource | null>();

  if (settingIds.length > 0) {
    const { data } = await supabase
      .from("setting_calls")
      .select("id, lead_name, company, meet_link, source_type, wa_phone, wa_consent_at, wa_refused_at")
      .in("id", settingIds);
    for (const r of (data ?? []) as unknown as (Info & ChannelSource & { id: string })[]) {
      info.set(r.id, { lead_name: r.lead_name, company: r.company, meet_link: r.meet_link });
      channelSource.set(r.id, r);
    }
  }

  if (closingIds.length > 0) {
    const { data } = await supabase
      .from("closing_calls")
      .select("id, lead_name, company, meet_link, setting_call_id")
      .in("id", closingIds);
    const closings = (data ?? []) as unknown as (Info & { id: string; setting_call_id: string | null })[];
    for (const r of closings) info.set(r.id, { lead_name: r.lead_name, company: r.company, meet_link: r.meet_link });

    const parentIds = [
      ...new Set(
        closings
          .map((c) => c.setting_call_id)
          .filter((v): v is string => Boolean(v))
          .filter((v) => !channelSource.has(v)),
      ),
    ];
    if (parentIds.length > 0) {
      const { data: parents } = await supabase
        .from("setting_calls")
        .select("id, source_type, wa_phone, wa_consent_at, wa_refused_at")
        .in("id", parentIds);
      for (const p of (parents ?? []) as unknown as (ChannelSource & { id: string })[]) channelSource.set(p.id, p);
    }
    for (const c of closings) {
      channelSource.set(c.id, c.setting_call_id ? (channelSource.get(c.setting_call_id) ?? null) : null);
    }
  }

  const userIds = [...new Set(rows.map((r) => r.assigned_user_id).filter((v): v is string => Boolean(v)))];
  const usernameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, username").in("user_id", userIds);
    (data ?? []).forEach((r) => usernameById.set(r.user_id, r.username));
  }

  const touches: ReminderTouchWithContext[] = rows.map((r) => {
    const entity = info.get(r.entity_id);
    // Der gespeicherte Kanal ist der Snapshot für die AUSWERTUNG; die Anzeige
    // löst live auf, damit eine nachträglich erfasste Einwilligung noch wirkt.
    // `channel_locked` heißt: die Person hat bewusst gewählt — dann bleibt es.
    const live = r.channel_locked ? r.channel : (channelFor(channelSource.get(r.entity_id) ?? null) ?? r.channel);
    return {
      ...r,
      template_key: templateKeyOf(r.template_key, r.cascade_kind, r.step_no),
      channel: live,
      lead_name: entity?.lead_name ?? null,
      company: entity?.company ?? null,
      meet_link: entity?.meet_link ?? null,
      assigned_username: r.assigned_user_id ? (usernameById.get(r.assigned_user_id) ?? null) : null,
    };
  });

  return { touches, available: true, horizonDays };
}

/**
 * Erledigt-Häkchen — manuell und kanalunabhängig (bewusst NICHT mit
 * `phone_call_attempts` verknüpft: die Karte ist eine Kopier-Werkbank, kein
 * Versandsystem).
 *
 * `outcome` ist optional, damit die bisherigen Zwei-Argument-Aufrufe weiter
 * gelten. Wird „antwort" eingetragen, endet die Kette: die noch offenen
 * Folgestufen mit `requires_no_response` werden entwertet — genau dafür trägt
 * die Stufe das Merkmal. Die geplanten Vor-Termin-Kaskaden sind davon nicht
 * betroffen: der Link aus der letzten Stufe soll auch nach einer Zusage raus.
 */
export async function setReminderTouchDone(
  touchId: string,
  done: boolean,
  outcome?: TouchOutcome | null,
  note?: string | null,
): Promise<{ error?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  const supabase = await createClient();

  const { data: touch, error: loadError } = await supabase
    .from("reminder_touches")
    .select("id, entity_type, entity_id, cascade_kind, step_no")
    .eq("id", touchId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (loadError && isMissingSchema(loadError)) return { error: "Erinnerungen sind nicht verfügbar (Migration 0032)." };
  if (!touch) return { error: "Erinnerung nicht gefunden." };
  const row = touch as unknown as {
    entity_type: ReminderEntityType;
    entity_id: string;
    cascade_kind: string;
    step_no: number;
  };

  const { error } = await supabase
    .from("reminder_touches")
    .update({
      // done_at und done_by_user_id sind per CHECK ein Paar — beide oder keins.
      done_at: done ? new Date().toISOString() : null,
      done_by_user_id: done ? access.user.id : null,
      outcome: outcome ?? null,
      done_note: note?.trim() ? note.trim() : null,
    })
    .eq("id", touchId)
    .eq("workspace_id", access.workspace_id);
  if (error) return { error: error.message };

  if (done && outcome === "antwort") {
    const { error: chainError } = await supabase
      .from("reminder_touches")
      .update({ superseded_at: new Date().toISOString() })
      .eq("workspace_id", access.workspace_id)
      .eq("entity_type", row.entity_type)
      .eq("entity_id", row.entity_id)
      .eq("cascade_kind", row.cascade_kind)
      .eq("requires_no_response", true)
      .gt("step_no", row.step_no)
      .is("superseded_at", null)
      .is("done_at", null);
    if (chainError) console.error("[setReminderTouchDone] Kette beenden:", chainError.message);
  }

  revalidatePath("/erinnerungen");
  return {};
}
