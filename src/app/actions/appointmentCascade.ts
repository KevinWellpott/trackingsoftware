"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { getCascadeSteps, getTemplateBundles } from "@/app/actions/reminders";
import { EMPTY_TEMPLATE_BUNDLE, isTemplateKey, type TemplateBundle, type TemplateKey } from "@/lib/messageTemplates";
import type { CascadeKind, CascadeStep, TouchKind } from "@/lib/cascadeEngine";
import {
  resolveCascadeChannel,
  resolveFollowUpChannel,
  type ReminderEntityType,
  type TouchChannel,
} from "@/lib/reminderCascade";

// Leseseite der Kaskade — genau EINE Frage: „was steht an diesem einen Termin?"
//
// Warum eine eigene Datei und keine Funktion in actions/reminders.ts: Die dortigen
// Leser beantworten die Frage der PERSON („was ist heute für mich fällig",
// `getDueReminderTouches`) und filtern deshalb auf `assigned_user_id` und auf ein
// Zeitfenster. Im Termin-Editor ist beides falsch — dort sollen alle Stufen dieses
// Termins stehen, auch die eines Kollegen und auch die in drei Wochen. Die Datei
// SCHREIBT bewusst nichts: Erzeugen, Entwerten und Abhaken bleiben in reminders.ts.

/**
 * Fehlt das Schema (Migration 0032 nicht eingespielt), muss das von „nichts
 * geplant" unterscheidbar sein — sonst zeigt der Editor in beiden Fällen ein
 * leeres Panel, und niemand merkt, dass gar keine Erinnerung entsteht. Muster
 * `isMissingSchema` in actions/reminders.ts; bewusst dieselbe kurze Kopie,
 * solange es die gemeinsame `schemaProbe.ts` nicht gibt.
 */
function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(e.code)) return true;
  const msg = (e?.message ?? (err instanceof Error ? err.message : "")).toLowerCase();
  return /does not exist|could not find|schema cache/.test(msg);
}

export type AppointmentCascadeTouch = {
  id: string;
  entity_type: ReminderEntityType;
  cascade_kind: CascadeKind;
  touch_kind: TouchKind;
  step_no: number;
  requires_no_response: boolean;
  template_key: TemplateKey;
  due_at: string;
  appointment_at: string;
  outcome: string | null;
  done_at: string | null;
  /** Gesetzt = entwertet (Soft-Delete). Sagt nur DASS, nie warum — der Grund wird abgeleitet. */
  superseded_at: string | null;
};

export type AppointmentCascadeView = {
  /** false = Kaskaden-Schema fehlt. Ausdrücklich NICHT „nichts geplant". */
  available: boolean;
  /** Alle konfigurierten Stufen der Organisation — auch die abgeschalteten. */
  steps: CascadeStep[];
  /** Nur die noch gültigen Touches dieses Termins (superseded_at is null). */
  touches: AppointmentCascadeTouch[];
  /**
   * Die ENTWERTETEN Touches desselben Termins (`superseded_at` gesetzt). Sie
   * kommen mit, weil eine entwertete Kaskade sonst wortlos aus dem Panel
   * verschwindet — und ein leeres Panel von einem Fehler nicht zu unterscheiden
   * ist. Dieselbe Begründung wie bei den entfallenen Stufen, die das Panel
   * schon immer im Klartext benennt.
   */
  supersededTouches: AppointmentCascadeTouch[];
  /** Live aufgelöst, nicht der Snapshot in der Zeile — eine nachgetragene Einwilligung wirkt sofort. */
  channel: TouchChannel | null;
  /** Vorlagen der ZUSTÄNDIGEN Person, nicht des Betrachters. */
  bundle: TemplateBundle;
  assignedUsername: string | null;
  leadName: string | null;
  company: string | null;
  meetLink: string | null;
  appointmentAt: string | null;
  cancelledAt: string | null;
  /**
   * Ergebnis-Zustand des Termins. Nur dafür da, die Entwertung zu BEGRÜNDEN:
   * `superseded_at` trägt keinen Grund, und eine Spalte dafür zu erfinden wäre
   * eine zweite Wahrheit neben `status`/`show_status` (Muster Ablage — die
   * Zugehörigkeit wird aus dem Zeilenzustand abgeleitet, nicht gespeichert).
   */
  status: string | null;
  showStatus: string | null;
};

const EMPTY: AppointmentCascadeView = {
  available: false,
  steps: [],
  touches: [],
  supersededTouches: [],
  channel: null,
  bundle: EMPTY_TEMPLATE_BUNDLE,
  assignedUsername: null,
  leadName: null,
  company: null,
  meetLink: null,
  appointmentAt: null,
  cancelledAt: null,
  status: null,
  showStatus: null,
};

/** Kanalquelle: beim Closing steht die WhatsApp-Nummer am verknüpften Setting. */
type ChannelSource = {
  wa_phone: string | null;
  wa_consent_at: string | null;
  wa_refused_at: string | null;
  source_type: string | null;
};

/**
 * Wörtlich `channelFor()` aus actions/reminders.ts: WhatsApp nur mit Nummer UND
 * dokumentierter Einwilligung; eine dokumentierte Verweigerung (`wa_refused_at`)
 * fällt bewusst auf den Akquise-Kanal zurück, statt wie eine Erfassungslücke zu
 * wirken. Muss dieselbe Antwort geben wie beim Erzeugen — sonst zeigt der Editor
 * einen anderen Kanal an, als die Erinnerung später trägt.
 */
function channelFor(row: ChannelSource | null): TouchChannel | null {
  if (!row) return null;
  if (row.wa_refused_at) return resolveCascadeChannel(row.source_type);
  return resolveFollowUpChannel(row);
}

const TOUCH_COLUMNS =
  "id, entity_type, cascade_kind, touch_kind, step_no, requires_no_response, template_key, " +
  "due_at, appointment_at, outcome, done_at, superseded_at";

type RawTouch = Omit<AppointmentCascadeTouch, "template_key"> & { template_key: string };

/**
 * Der Snapshot am Touch bleibt maßgeblich (eine umbenannte Stufe schreibt die
 * Historie nicht um). Kennt die App den Key nicht mehr, wird die Zeile
 * ausgelassen statt auf einen fremden Text gesetzt — ein falscher Text ginge
 * sonst wortlos an den Lead.
 */
function keepKnownTemplate(rows: RawTouch[]): AppointmentCascadeTouch[] {
  const out: AppointmentCascadeTouch[] = [];
  for (const r of rows) {
    if (!isTemplateKey(r.template_key)) {
      console.error("[appointmentCascade] unbekannter template_key:", r.template_key);
      continue;
    }
    out.push({ ...r, template_key: r.template_key });
  }
  return out;
}

/**
 * Alles, was das Kaskaden-Panel eines Termins braucht, in einem Aufruf.
 *
 * `entityId` wird gegen die AKTIVE Organisation geprüft und nicht nur gegen RLS:
 * für einen Plattform-Admin lässt RLS jede Zeile durch, eine alte URL aus einer
 * anderen Organisation zeigte sonst deren Erinnerungen an.
 */
export async function getAppointmentCascade(
  entityType: "setting" | "closing",
  entityId: string,
): Promise<AppointmentCascadeView> {
  const access = await getAccessContext();
  if (!access) return EMPTY;

  const supabase = await createClient();
  let leadName: string | null = null;
  let company: string | null = null;
  let meetLink: string | null = null;
  let appointmentAt: string | null = null;
  let cancelledAt: string | null = null;
  let status: string | null = null;
  let showStatus: string | null = null;
  let assignedUserId: string | null = null;
  let source: ChannelSource | null = null;

  if (entityType === "setting") {
    const { data } = await supabase
      .from("setting_calls")
      .select(
        "lead_name, company, meet_link, appointment_at, cancelled_at, status, show_status, assigned_user_id, created_by_user_id, source_type, wa_phone, wa_consent_at, wa_refused_at",
      )
      .eq("id", entityId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    const row = data as unknown as
      | (ChannelSource & {
          lead_name: string | null;
          company: string | null;
          meet_link: string | null;
          appointment_at: string | null;
          cancelled_at: string | null;
          status: string | null;
          show_status: string | null;
          assigned_user_id: string | null;
          created_by_user_id: string | null;
        })
      | null;
    if (!row) return EMPTY;
    leadName = row.lead_name;
    company = row.company;
    meetLink = row.meet_link;
    appointmentAt = row.appointment_at;
    cancelledAt = row.cancelled_at;
    status = row.status;
    showStatus = row.show_status;
    // personOf()-Regel: Zuweisung schlägt Ersteller (docs §2).
    assignedUserId = row.assigned_user_id ?? row.created_by_user_id;
    source = row;
  } else {
    const { data } = await supabase
      .from("closing_calls")
      .select(
        "lead_name, company, meet_link, call_at, cancelled_at, status, show_status, assigned_user_id, created_by_user_id, setting_call_id",
      )
      .eq("id", entityId)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    const row = data as unknown as {
      lead_name: string | null;
      company: string | null;
      meet_link: string | null;
      call_at: string | null;
      cancelled_at: string | null;
      status: string | null;
      show_status: string | null;
      assigned_user_id: string | null;
      created_by_user_id: string | null;
      setting_call_id: string | null;
    } | null;
    if (!row) return EMPTY;
    leadName = row.lead_name;
    company = row.company;
    meetLink = row.meet_link;
    appointmentAt = row.call_at;
    cancelledAt = row.cancelled_at;
    status = row.status;
    showStatus = row.show_status;
    assignedUserId = row.assigned_user_id ?? row.created_by_user_id;
    if (row.setting_call_id) {
      const { data: parent } = await supabase
        .from("setting_calls")
        .select("source_type, wa_phone, wa_consent_at, wa_refused_at")
        .eq("id", row.setting_call_id)
        .maybeSingle();
      source = (parent as unknown as ChannelSource | null) ?? null;
    }
  }

  const { steps, available: stepsAvailable } = await getCascadeSteps();

  let touches: AppointmentCascadeTouch[] = [];
  let supersededTouches: AppointmentCascadeTouch[] = [];
  let touchesAvailable = true;
  // Die entwerteten Zeilen kommen bewusst MIT: eine Kaskade, die nach einem
  // Ergebnis abgeräumt wurde, verschwände sonst wortlos aus dem Panel.
  const { data: rawTouches, error } = await supabase
    .from("reminder_touches")
    .select(TOUCH_COLUMNS)
    .eq("workspace_id", access.workspace_id)
    .eq("entity_id", entityId)
    .order("due_at", { ascending: true })
    .order("step_no", { ascending: true });
  if (error) {
    touchesAvailable = !isMissingSchema(error);
    if (touchesAvailable) console.error("[appointmentCascade]", error.message);
  } else {
    const rows = (rawTouches ?? []) as unknown as RawTouch[];
    touches = keepKnownTemplate(rows.filter((r) => !r.superseded_at));
    supersededTouches = keepKnownTemplate(rows.filter((r) => r.superseded_at));
  }

  const bundles = assignedUserId ? await getTemplateBundles([assignedUserId]) : null;
  let assignedUsername: string | null = null;
  if (assignedUserId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("user_id", assignedUserId)
      .maybeSingle();
    assignedUsername = (profile as { username: string } | null)?.username ?? null;
  }

  return {
    available: stepsAvailable && touchesAvailable,
    steps,
    touches,
    supersededTouches,
    channel: channelFor(source),
    bundle: (assignedUserId ? bundles?.get(assignedUserId) : null) ?? EMPTY_TEMPLATE_BUNDLE,
    assignedUsername,
    leadName,
    company,
    meetLink,
    appointmentAt,
    cancelledAt,
    status,
    showStatus,
  };
}
