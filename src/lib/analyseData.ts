// Datenbeschaffung des Analyse-Bereichs — EINE Stelle je Tabelle.
//
// Vor dieser Datei holte sich jeder Tab seine Zeilen selbst. Zwei Probleme
// steckten darin:
//   1. `supabase.from(...).select(...)` ohne `.range()` liefert stillschweigend
//      nur die ersten 1000 Zeilen (PostgREST-Default). Bei > 1000 Terminen
//      hätten alle Setting-/Closing-Auswertungen ohne Fehlermeldung zu wenig
//      gezählt. Alles läuft hier deshalb über fetchAllRows.
//   2. Die Spaltenlisten drifteten auseinander, sobald ein Tab ein Feld mehr
//      brauchte.
//
// SERVER-ONLY: importiert `@/lib/supabase/server` (cookies()). Nur aus Server
// Components importieren.

import type { AccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { addDaysISO } from "@/lib/dates";
import { berlinDateISO } from "@/lib/apptTime";
import type { SettingStatus } from "@/lib/types";

type Client = Awaited<ReturnType<typeof createClient>>;

// ── LinkedIn: Kontakte + Listen-Metadaten ────────────────────

export type AnalyseListMeta = {
  name: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  pitch_text: string | null;
  fu1_text: string | null;
  fu2_text: string | null;
  fu3_text: string | null;
  archived_at: string | null;
};

export type AnalyseContact = {
  id: string;
  list_id: string;
  pitched_at: string | null;
  created_at: string;
  follow_up_number: number | null;
  next_follow_up_at: string | null;
  answered: boolean | null;
  answer_category: string | null;
  appointment_set: boolean | null;
  blocked_at: string | null;
  target_group: string | null;
  setting_call_id: string | null;
  lists: AnalyseListMeta | null;
};

const CONTACT_COLUMNS =
  "id, list_id, pitched_at, created_at, follow_up_number, next_follow_up_at, answered, answer_category, " +
  "appointment_set, blocked_at, target_group, setting_call_id, " +
  "lists!inner(name, owner_name, created_by_user_id, pitch_text, fu1_text, fu2_text, fu3_text, archived_at)";

/**
 * Pitch-Tag eines Kontakts — dieselbe Definition wie in `rpc_owner_day_metrics`
 * (`coalesce(pitched_at, created_at::date)`), nur über den Berlin-Kalendertag,
 * damit ein Abend-Eintrag nicht in den Vortag rutscht.
 */
export function contactDay(c: { pitched_at: string | null; created_at: string }): string {
  return c.pitched_at ?? berlinDateISO(c.created_at);
}

/**
 * Kontakte, deren Pitch im Zeitraum liegt. Der OR-Zweig holt Altbestände ohne
 * `pitched_at` über ihr Anlagedatum dazu — sonst zählte die RPC (die
 * coalesce nutzt) mehr DMs als die Kontakt-Auswertungen daneben.
 *
 * Schlägt der OR-Ausdruck fehl (PostgREST ist bei verschachtelten Ausdrücken
 * empfindlich), wird auf den einfachen `pitched_at`-Bereich zurückgefallen
 * statt eine leere Seite zu zeigen: dann fehlen höchstens Altzeilen ohne
 * Pitch-Datum, nicht die gesamte Auswertung.
 */
export async function loadContacts(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
  from: string,
  to: string,
): Promise<AnalyseContact[]> {
  const page = (withNullBranch: boolean) => (f: number, t: number) => {
    let q = supabase
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("workspace_id", access.workspace_id);
    q = withNullBranch
      ? q.or(
          `and(pitched_at.gte.${from},pitched_at.lte.${to}),` +
            `and(pitched_at.is.null,created_at.gte.${from},created_at.lt.${addDaysISO(to, 1)})`,
        )
      : q.gte("pitched_at", from).lte("pitched_at", to);
    if (!canCompare) q = q.eq("lists.created_by_user_id", access.user.id);
    return q.order("id").range(f, t);
  };

  try {
    return (await fetchAllRows(page(true))) as unknown as AnalyseContact[];
  } catch (err) {
    console.error("loadContacts (OR-Zweig):", err instanceof Error ? err.message : err);
    try {
      return (await fetchAllRows(page(false))) as unknown as AnalyseContact[];
    } catch (fallbackErr) {
      console.error("loadContacts:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      return [];
    }
  }
}

// ── Setting-Calls ────────────────────────────────────────────

export type AnalyseSettingCall = {
  id: string;
  created_by_user_id: string | null;
  source_type: string | null;
  source_detail: string | null;
  appointment_at: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: SettingStatus;
  no_show_count: number | null;
  meeting_kind: "link" | "telefon" | null;
  branche: string | null;
  has_budget_8k: "ja" | "nein" | "unklar" | null;
  sole_decider: boolean | null;
  can_decide_now: boolean | null;
  clear_need: boolean | null;
  ist_pain: number | null;
  warmth: number | null;
};

const SETTING_COLUMNS =
  "id, created_by_user_id, source_type, source_detail, appointment_at, call_at, created_at, show_status, " +
  "status, no_show_count, meeting_kind, branche, has_budget_8k, sole_decider, can_decide_now, clear_need, " +
  "ist_pain, warmth";

/**
 * Alle Setting-Calls der Organisation. Bewusst OHNE Zeitraumfilter in SQL: das
 * maßgebliche Datum ist `coalesce(appointment_at, call_at, created_at)` und
 * damit keine einzelne Spalte — der Zuschnitt passiert in JS über
 * `settingEffDate`, das auch die Vorperiode aus demselben Ergebnis bedient.
 */
export async function loadSettingCalls(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
): Promise<AnalyseSettingCall[]> {
  const rows = await fetchAllRows((f, t) => {
    let q = supabase
      .from("setting_calls")
      .select(SETTING_COLUMNS)
      .eq("workspace_id", access.workspace_id);
    if (!canCompare) q = q.eq("created_by_user_id", access.user.id);
    return q.order("id").range(f, t);
  }).catch((err) => {
    console.error("analyseData:", err instanceof Error ? err.message : err);
    return [];
  });
  return rows as unknown as AnalyseSettingCall[];
}

// ── Closing-Calls ────────────────────────────────────────────

export type AnalyseClosingCall = {
  id: string;
  created_by_user_id: string | null;
  setting_call_id: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: "offen" | "gewonnen" | "verloren" | "nachfassen";
  deal_volume: number | null;
  payment_type: string | null;
  lost_reason: string | null;
  signature_received: boolean | null;
  contract_start: string | null;
};

const CLOSING_COLUMNS =
  "id, created_by_user_id, setting_call_id, call_at, created_at, show_status, status, deal_volume, " +
  "payment_type, lost_reason, signature_received, contract_start";

export async function loadClosingCalls(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
): Promise<AnalyseClosingCall[]> {
  const rows = await fetchAllRows((f, t) => {
    let q = supabase
      .from("closing_calls")
      .select(CLOSING_COLUMNS)
      .eq("workspace_id", access.workspace_id);
    if (!canCompare) q = q.eq("created_by_user_id", access.user.id);
    return q.order("id").range(f, t);
  }).catch((err) => {
    console.error("analyseData:", err instanceof Error ? err.message : err);
    return [];
  });
  return rows as unknown as AnalyseClosingCall[];
}

// ── Telefon-Leads ────────────────────────────────────────────

export type AnalysePhoneLead = {
  id: string;
  created_by_user_id: string | null;
  first_call_at: string | null;
  created_at: string;
  status: string | null;
  call_attempt: number | null;
  gatekeeper_reached: "ja" | "nein" | "direkt" | null;
  gatekeeper_attempts: number | null;
  decider_reached: boolean | null;
  answer_sentiment: "positiv" | "neutral" | "negativ" | null;
  mailbox: boolean | null;
  appointment_set: boolean | null;
  target_group: string | null;
  no_transfer_reason: string | null;
  no_pitch_reason: string | null;
  no_appointment_reason: string | null;
  phone_lists: { name: string | null; owner_name: string | null; list_kind: string | null } | null;
};

const PHONE_COLUMNS =
  "id, created_by_user_id, first_call_at, created_at, status, call_attempt, gatekeeper_reached, " +
  "gatekeeper_attempts, decider_reached, answer_sentiment, mailbox, appointment_set, target_group, " +
  "no_transfer_reason, no_pitch_reason, no_appointment_reason, " +
  "phone_lists!inner(name, owner_name, list_kind)";

export async function loadPhoneLeads(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
): Promise<AnalysePhoneLead[]> {
  const rows = await fetchAllRows((f, t) => {
    let q = supabase
      .from("phone_leads")
      .select(PHONE_COLUMNS)
      .eq("workspace_id", access.workspace_id);
    if (!canCompare) q = q.eq("created_by_user_id", access.user.id);
    return q.order("id").range(f, t);
  }).catch((err) => {
    console.error("analyseData:", err instanceof Error ? err.message : err);
    return [];
  });
  return rows as unknown as AnalysePhoneLead[];
}

/** Erstkontakt-Tag eines Telefon-Leads (analog contactDay). */
export function phoneLeadDay(l: { first_call_at: string | null; created_at: string }): string {
  return l.first_call_at ?? berlinDateISO(l.created_at);
}
