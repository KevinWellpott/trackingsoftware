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

import { buildOwnScope, type AccessContext } from "@/lib/access";
import type { CascadeKind, TouchKind } from "@/lib/cascadeEngine";
import type { ChannelKey } from "@/lib/channels";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { addDaysISO } from "@/lib/dates";
import { berlinDateISO } from "@/lib/apptTime";
import type { ClosingLostReasonCode, SettingStatus } from "@/lib/types";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Personen-Scope für Listen-gebundene Daten (Kontakte, Telefon-Leads).
 *
 * `owner_name` hat Vorrang vor `created_by_user_id` — dieselbe Regel wie
 * `list_owned_by_user()` in SQL und `buildOwnScope()` im Rest der App
 * (docs §2). Der Ausdruck gilt der ELTERNLISTE, nicht der Zeile selbst: nur
 * `lists`/`phone_lists` tragen einen Owner-Namen.
 *
 * Gefiltert wird auf den real angemeldeten Nutzer (`access.user.id` +
 * `access.username`), nicht auf den effektiven: Dieser Zweig greift nur, wenn
 * gar nicht verglichen werden darf — dann sind beide identisch.
 */
function listOwnerScope(access: AccessContext): string {
  return buildOwnScope(access.user.id, access.username);
}

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
    // FIX: Hier stand `lists.created_by_user_id.eq.<uid>`. Damit sah ein
    // Mitglied mit Datensicht „nur eigene Daten", dessen Listen ein Admin FÜR
    // ihn angelegt hat (owner_name = Mitglied, created_by = Admin), in
    // LinkedIn, Listen und Follow-ups GAR NICHTS — der owner_name-Vorrang, den
    // RLS, RPCs und Sidebar überall anwenden, fehlte als einziger hier.
    // `referencedTable` setzt den or-Ausdruck auf die eingebettete Liste; weil
    // sie mit `!inner` verbunden ist, schneidet er die Kontakte mit.
    if (!canCompare) q = q.or(listOwnerScope(access), { referencedTable: "lists" });
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
  /** Audit: wer hat den Datensatz angelegt. NICHT die Personenachse. */
  created_by_user_id: string | null;
  /** Fachliche Zuordnung (Migration 0028) — siehe `personOf` in personResolution.ts. */
  assigned_user_id: string | null;
  /** Registry-Schlüssel (src/lib/channels.ts); `string` nur für Altwerte. */
  source_type: ChannelKey | string | null;
  source_detail: string | null;
  /** Rufnummer bei Termin-Art „Telefon" (Migration 0029). */
  phone: string | null;
  /** Herkunftskette: Quellkontakt bzw. Quell-Lead des Termins. */
  source_contact_id: string | null;
  source_phone_lead_id: string | null;
  appointment_at: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: SettingStatus;
  /**
   * Absage (Migration 0032). `null` = nicht abgesagt — und das ist der
   * Normalfall, nicht die Ausnahme.
   *
   * Eine Absage lässt `status` bewusst unangetastet (meist `offen`) und setzt
   * kein `show_status`. Für die Show- und Quali-Quote fällt sie damit von
   * selbst aus dem Nenner. NICHT von selbst fällt sie aus den STUFEN des
   * Funnels: Dort ist „Termine Setting" eine reine Menge und trüge einen
   * abgesagten Termin als garantierte Null durch jede Durchlaufquote (docs §5,
   * Entscheidung K5). Deshalb liest der Funnel-Tab dieses Feld.
   */
  cancelled_at: string | null;
  /** `ohne_aussicht` | `neuer_termin` — CHECK-Paar zu `cancelled_at`. */
  cancel_outlook: "ohne_aussicht" | "neuer_termin" | null;
  /** Zählbarer Absagegrund; Beschriftung über `dropoutReasonLabel`. */
  cancel_reason_code: string | null;
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

// ACHTUNG: Die Liste ist namentlich. Fehlt eine Spalte in der Datenbank, weist
// PostgREST die GESAMTE Abfrage ab — `phone` setzt Migration 0029 voraus,
// `cancelled_at`/`cancel_outlook`/`cancel_reason_code` setzen 0032 voraus. Beide
// müssen vor dem Deploy eingespielt sein (docs §7).
const SETTING_COLUMNS =
  "id, created_by_user_id, assigned_user_id, source_type, source_detail, source_contact_id, " +
  "source_phone_lead_id, appointment_at, call_at, created_at, phone, show_status, " +
  "status, cancelled_at, cancel_outlook, cancel_reason_code, " +
  "no_show_count, meeting_kind, branche, has_budget_8k, sole_decider, can_decide_now, clear_need, " +
  "ist_pain, warmth";

/**
 * Personen-Filter für Nutzer ohne Vergleichsrecht (`data_scope='own'`).
 *
 * Vorher stand hier `created_by_user_id.eq.<uid>` — damit verschwand jeder
 * Termin, den ein Admin FÜR ein Mitglied angelegt hat, aus dessen eigener
 * Sicht, obwohl er ihm zugewiesen ist. Die Bedingung spiegelt jetzt exakt
 * `personOf()`: die Zuweisung entscheidet, der Ersteller greift nur, solange
 * keine Zuweisung existiert (Zeilen vor dem Backfill von Migration 0028).
 *
 * Als PostgREST-`or`-Ausdruck formuliert, weil beide Zweige ODER-verknüpft
 * sind; die übrigen `.eq()`-Filter der Query bleiben UND-verknüpft.
 *
 * Exportiert für `loadReminderTouches` — `reminder_touches` trägt dieselben
 * zwei Spalten (dort allerdings ist `assigned_user_id` praktisch nie NULL,
 * weil die Kaskaden-Erzeugung selbst schon auf created_by_user_id zurückfällt).
 */
export function assignedOrCreatedBy(userId: string): string {
  return `assigned_user_id.eq.${userId},and(assigned_user_id.is.null,created_by_user_id.eq.${userId})`;
}

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
    if (!canCompare) q = q.or(assignedOrCreatedBy(access.user.id));
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
  /** Audit: wer hat den Datensatz angelegt. NICHT die Personenachse. */
  created_by_user_id: string | null;
  /** Fachliche Zuordnung (Migration 0028), erbt beim Anlegen vom Setting. */
  assigned_user_id: string | null;
  setting_call_id: string | null;
  call_at: string | null;
  created_at: string;
  show_status: "show" | "no_show" | null;
  status: "offen" | "gewonnen" | "verloren" | "nachfassen";
  /** Absage (Migration 0032) — Begründung wie bei `AnalyseSettingCall`. */
  cancelled_at: string | null;
  cancel_outlook: "ohne_aussicht" | "neuer_termin" | null;
  cancel_reason_code: string | null;
  deal_volume: number | null;
  payment_type: string | null;
  /** Freitext-Notiz zum Verlust — Kontext, nicht zählbar. */
  lost_reason: string | null;
  /**
   * Zählbarer Verlustgrund (Migration 0029). Bestandszeilen stehen alle auf
   * `sonstiges`; die Verteilung wird erst mit nachgepflegten Daten aussagekräftig.
   */
  lost_reason_code: ClosingLostReasonCode | null;
  signature_received: boolean | null;
  contract_start: string | null;
};

// `lost_reason_code` setzt Migration 0029 voraus, die drei Absage-Spalten 0032
// (siehe SETTING_COLUMNS).
const CLOSING_COLUMNS =
  "id, created_by_user_id, assigned_user_id, setting_call_id, call_at, created_at, show_status, status, " +
  "cancelled_at, cancel_outlook, cancel_reason_code, " +
  "deal_volume, payment_type, lost_reason, lost_reason_code, signature_received, contract_start";

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
    if (!canCompare) q = q.or(assignedOrCreatedBy(access.user.id));
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
  list_id: string;
  created_by_user_id: string | null;
  first_call_at: string | null;
  created_at: string;
  status: string | null;
  call_attempt: number | null;
  gatekeeper_reached: "ja" | "nein" | "direkt" | null;
  gatekeeper_attempts: number | null;
  decider_reached: boolean | null;
  /**
   * Der Pitch kam durch (Migration 0028) — NICHT dasselbe wie
   * `decider_reached`. Bestandszeilen wurden aus `decider_reached` befüllt, die
   * beiden Quoten spreizen sich deshalb erst mit neu erfassten Anrufen.
   */
  pitch_delivered: boolean | null;
  answer_sentiment: "positiv" | "neutral" | "negativ" | null;
  mailbox: boolean | null;
  appointment_set: boolean | null;
  target_group: string | null;
  /**
   * Testarm des Skripts, beim Import am LEAD festgeschrieben (Migration 0030).
   * Maßgeblich für den A/B-Vergleich — der Wert an der Liste taugt dafür nicht,
   * weil ein Lead bei „Rückruf"/„Nicht erreicht" in eine Routing-Liste ohne
   * Label wandert und damit aus seinem Arm fiele.
   */
  script_label: string | null;
  no_transfer_reason: string | null;
  no_pitch_reason: string | null;
  no_appointment_reason: string | null;
  phone_lists: {
    name: string | null;
    owner_name: string | null;
    list_kind: string | null;
    /** Testarm des Skripts (Migration 0029) — die Achse des A/B-Vergleichs. */
    script_label: string | null;
    /** Listen-Default der Branche; `target_group` am Lead bleibt maßgeblich. */
    target_group: string | null;
  } | null;
};

// `script_label`/`target_group` der Liste setzen Migration 0029 voraus,
// `pitch_delivered` Migration 0028.
// `script_text` bleibt bewusst draußen: Für die Auswertung zählt der Testarm,
// der Volltext würde nur die Payload jeder Zeile aufblähen.
const PHONE_COLUMNS =
  // list_id ist noetig, damit die Vergleichsseite Telefonlisten ueber ihre ID
  // unterscheidet — ueber den Namen fielen zwei gleichnamige Listen zusammen.
  "id, list_id, created_by_user_id, first_call_at, created_at, status, call_attempt, gatekeeper_reached, " +
  "gatekeeper_attempts, decider_reached, pitch_delivered, answer_sentiment, mailbox, appointment_set, " +
  "target_group, script_label, no_transfer_reason, no_pitch_reason, no_appointment_reason, " +
  "phone_lists!inner(name, owner_name, list_kind, script_label, target_group)";

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
    // FIX (wie in loadContacts): vorher `created_by_user_id` des LEADS — der
    // trägt beim CSV-Import immer den Importierenden, nicht den Besitzer der
    // Liste. Ein Mitglied, für das ein Admin importiert hat, sah deshalb im
    // Telefon-Tab nichts. Der Scope gehört an die Telefonliste, die als
    // einzige einen `owner_name` hat.
    if (!canCompare) q = q.or(listOwnerScope(access), { referencedTable: "phone_lists" });
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

// ── Erinnerungs-Kaskade (Migration 0032) ────────────────────

export type ReminderTouchEntityType = "setting" | "closing" | "closing_followup";

export type AnalyseReminderTouch = {
  id: string;
  entity_type: ReminderTouchEntityType;
  /** Generierte Spalte: `coalesce(setting_call_id, closing_call_id)`. */
  entity_id: string;
  /**
   * WELCHE Art Touch: `cascade` = geplante Stufe VOR dem Termin · `chain` =
   * Stufe einer Kette NACH einem Ereignis (No-Show, Kein Close) · `sofort` =
   * Ersatz-Touch, wenn der Termin für jede geplante Stufe zu kurzfristig war.
   * Ersetzt zusammen mit `cascade_kind`/`step_no` das frühere `touch_type`
   * (`offset_1..3`/`no_show`) aus der nie eingespielten ersten Fassung.
   */
  touch_kind: TouchKind;
  cascade_kind: CascadeKind;
  /** Stufennummer innerhalb der Kaskade; `sofort` liegt kollisionsfrei auf 0. */
  step_no: number;
  due_at: string;
  appointment_at: string;
  channel: string | null;
  done_at: string | null;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
};

export type ReminderTouchData = {
  rows: AnalyseReminderTouch[];
  /**
   * `false` = die Abfrage ist gescheitert (Migration 0032 fehlt, Spalte
   * umbenannt, Tabelle weg). Ohne dieses Flag war „nichts geladen" von „keine
   * Erinnerungen im Zeitraum" nicht zu unterscheiden — genau daran hing der
   * Fehler, den diese Datei zuletzt still verdeckte, als sie noch die alte
   * Spalte `touch_type` selektierte. Muster: `loadCallAttempts`
   * (src/lib/phoneAttemptsData.ts).
   */
  available: boolean;
};

// ACHTUNG: namentliche Spaltenliste (siehe SETTING_COLUMNS). Alle drei
// Stufen-Spalten stammen aus `reminder_touches` v2 (Migration 0032).
const REMINDER_TOUCH_COLUMNS =
  "id, entity_type, entity_id, touch_kind, cascade_kind, step_no, due_at, appointment_at, " +
  "channel, done_at, assigned_user_id, created_by_user_id";

/**
 * Reminder-Touches für die "Erinnerungs-Disziplin"-Blöcke in Setting- und
 * Closing-Tab. Die Verknüpfung zum jeweiligen Termin läuft im aufrufenden Tab
 * über eine Map auf die bereits geladenen setting_calls/closing_calls — exakt
 * das Muster, das `ClosingTab.tsx` mit `settingById` bereits für die
 * Abschluss-Geschwindigkeit nutzt. Ein Embedded-Relation-Select wäre seit v2
 * zwar möglich (echte FKs), würde aber dieselben Termine ein zweites Mal
 * laden.
 *
 * Zählt auch superseded Touches mit, WENN sie erledigt wurden — eine
 * Neuterminierung macht einen offenen Touch obsolet, aber ein VORHER
 * erledigter bleibt ein echtes Stück Erinnerungs-Disziplin. Nur ein
 * superseded UND nie erledigter Touch (z. B. durch mehrfaches Verschieben
 * entstanden) fällt raus — sonst würde jede Neuterminierung die Quote der
 * zuständigen Person unfair drücken.
 */
export async function loadReminderTouches(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
  entityTypes: readonly ReminderTouchEntityType[],
): Promise<ReminderTouchData> {
  try {
    const rows = await fetchAllRows((f, t) => {
      let q = supabase
        .from("reminder_touches")
        .select(REMINDER_TOUCH_COLUMNS)
        .eq("workspace_id", access.workspace_id)
        .in("entity_type", entityTypes)
        .or("done_at.not.is.null,superseded_at.is.null");
      if (!canCompare) q = q.or(assignedOrCreatedBy(access.user.id));
      return q.order("id").range(f, t);
    });
    return { rows: rows as unknown as AnalyseReminderTouch[], available: true };
  } catch (err) {
    console.error("analyseData/reminderTouches:", err instanceof Error ? err.message : err);
    return { rows: [], available: false };
  }
}

// ── Lead-Recycling (Migration 0033) ─────────────────────────

/** Die vier „toten Enden", an denen ein Lead ins Recycling fällt (docs §1). */
export type RecycleOriginKey = "linkedin" | "telefon" | "setting" | "closing";

/**
 * Eine Zeile, die das Recycling angefasst hat — aus einer der VIER
 * Ursprungstabellen, auf eine gemeinsame Form gebracht (Muster:
 * `src/lib/compare/facts.ts`). Ohne diese Vereinheitlichung bräuchte die
 * Auswertung vier Schleifen für eine Kennzahl.
 */
export type AnalyseRecycleRow = {
  origin: RecycleOriginKey;
  /**
   * Grund-Code nach derselben Coalesce-Kette wie `recycle_tasks` (0033) —
   * sonst gruppiert die Auswertung anders, als das Nachfassen-Board die
   * Aufgabe beschriftet hat.
   */
  reason: string;
  /** `recycle_attempt_count` — 0 heißt: eingeplant, aber nie angefasst. */
  attempts: number;
  /** `recycle_last_contacted_at` (timestamptz) — der letzte Versuch. */
  last_contacted_at: string | null;
  /** `recycle_responded_at` — der einzige Beleg, dass Recycling wirkt. */
  responded_at: string | null;
  /** `recycle_excluded_at` — dauerhaft gesperrt, kein weiterer Versuch. */
  excluded_at: string | null;
  /** `next_recycle_at` (date) — noch im Rennen. */
  next_recycle_at: string | null;
  /** Personenachse LinkedIn/Telefon: Owner der Elternliste (docs §2). */
  owner_name: string | null;
  /**
   * Ersteller der ELTERNLISTE — der Rückfall der Personenachse, wenn kein
   * `owner_name` gesetzt ist (`list_owned_by_user()`, docs §2). Das Feld stand
   * schon immer im Select und wurde im Mapper verworfen; ohne es zählte eine
   * Liste ohne Besitzernamen bei niemandem und fiel bei aktivem Personenfilter
   * still aus der ganzen Sektion.
   */
  list_created_by_user_id: string | null;
  /** Personenachse Setting/Closing: `personOf()`-Kandidaten. */
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  /**
   * Die Felder der Status-Riegel aus `recycle_tasks` (docs §5). Sie
   * beantworten die Frage, die `next_recycle_at` allein nicht beantwortet: Ist
   * der Vorgang überhaupt noch terminal, oder kam der Lead auf anderem Weg
   * zurück? Je Ursprung ist nur eine Teilmenge gefüllt — `contacts` hat keinen
   * Status, die beiden Lead-Tabellen kein `revived_at`.
   */
  status: string | null;
  blocked_at: string | null;
  answered: boolean | null;
  appointment_set: boolean | null;
  follow_up_number: number | null;
  revived_at: string | null;
  no_show_resolution: string | null;
  cancel_outlook: string | null;
};

export type RecycleData = {
  rows: AnalyseRecycleRow[];
  /**
   * `pipeline_settings.max_attempts` der Organisation. `null` = nicht lesbar
   * (fehlende Zeile, oder ein Plattform-Admin in fremder Org, der dort kein
   * Mitglied ist) — die Kennzahl „am Deckel" entfällt dann, statt gegen einen
   * geratenen Deckel zu rechnen.
   */
  maxAttempts: number | null;
  /** false = Migration 0033 fehlt oder die Abfrage ist gescheitert. */
  available: boolean;
};

/**
 * Nur Zeilen, die das Recycling überhaupt angefasst hat. Ohne diesen Filter
 * lägen hier vier komplette Tabellen für eine Auswertung, die sich für ein
 * paar Hundert Zeilen interessiert.
 *
 * Die drei Zweige sind die drei Zustände, die es gibt: eingeplant
 * (`next_recycle_at`), mindestens einmal versucht (`recycle_attempt_count`),
 * endgültig gesperrt (`recycle_excluded_at`).
 */
const RECYCLE_TOUCHED =
  "next_recycle_at.not.is.null,recycle_attempt_count.gt.0,recycle_excluded_at.not.is.null";

/**
 * Vier Select-Ausdrücke, ausgeschrieben und ausdrücklich als `string` getippt.
 *
 * Beides ist Absicht. Ein zusammengesetzter Ausdruck (`\`… ${PARENT}!inner(…)\``)
 * bleibt ein Template-Literal-TYP, und supabase-js zerlegt den beim
 * Typprüfen — zwei weitere Einbettungen haben damit schon einmal das
 * Instanziierungs-Budget des Projekts gesprengt, woraufhin `tsc` Fehler in
 * ganz anderen Dateien meldete (siehe die Begründung an `TOUCH_CONTACT_SELECT`
 * in src/app/actions/nachfassen.ts). Als `string` entfällt die Zerlegung; die
 * Form der Antwort steht dafür ausdrücklich in `RawRecycle`.
 */
const RECYCLE_COLS =
  "recycle_reason_code, recycle_attempt_count, recycle_last_contacted_at, " +
  "recycle_responded_at, recycle_excluded_at, next_recycle_at";

/**
 * Je Ursprung zusätzlich die Spalten seines Status-Riegels — dieselben, die der
 * jeweilige Zweig von `recycle_tasks` abfragt (docs §5). Ohne sie ist der
 * Riegel auf der Anzeigeseite nicht nachbaubar: Ein fehlendes Feld käme als
 * `undefined` an und ließe den Zweig still auf „ja" zurückfallen.
 * Alle stammen aus 0032/0033 und sind damit dieselbe Deploy-Voraussetzung wie
 * `RECYCLE_COLS` selbst.
 */
const RECYCLE_CONTACT_SELECT: string =
  `id, ${RECYCLE_COLS}, blocked_at, answered, appointment_set, follow_up_number, ` +
  `lists!inner(owner_name, created_by_user_id)`;
const RECYCLE_PHONE_SELECT: string =
  `id, ${RECYCLE_COLS}, status, phone_lists!inner(owner_name, created_by_user_id)`;
const RECYCLE_SETTING_SELECT: string =
  `id, assigned_user_id, created_by_user_id, ${RECYCLE_COLS}, ` +
  `status, revived_at, no_show_resolution, cancel_outlook`;
const RECYCLE_CLOSING_SELECT: string =
  `id, assigned_user_id, created_by_user_id, ${RECYCLE_COLS}, lost_reason_code, status, revived_at`;

type RawRecycle = {
  recycle_reason_code: string | null;
  recycle_attempt_count: number | null;
  recycle_last_contacted_at: string | null;
  recycle_responded_at: string | null;
  recycle_excluded_at: string | null;
  next_recycle_at: string | null;
  assigned_user_id?: string | null;
  created_by_user_id?: string | null;
  lost_reason_code?: string | null;
  status?: string | null;
  blocked_at?: string | null;
  answered?: boolean | null;
  appointment_set?: boolean | null;
  follow_up_number?: number | null;
  revived_at?: string | null;
  no_show_resolution?: string | null;
  cancel_outlook?: string | null;
  lists?: { owner_name: string | null; created_by_user_id: string | null } | null;
  phone_lists?: { owner_name: string | null; created_by_user_id: string | null } | null;
};

/**
 * Alle Recycling-Zeilen der Organisation — BEWUSST ohne Zeitraumfilter.
 *
 * Zwei Gründe: Der maßgebliche Stichtag der Wiederbelebungsquote ist
 * `recycle_last_contacted_at`, der der Sperrungen `recycle_excluded_at` — zwei
 * Zeitachsen, die kein einzelner SQL-Filter zugleich bedient. Und die
 * Auswertung braucht den ÄLTESTEN Versuch überhaupt, um „im Zeitraum gab es
 * das noch nicht" von „niemand hat nachgefasst" zu unterscheiden (Muster
 * `loadCallAttempts`, docs §3).
 */
export async function loadRecycleData(
  supabase: Client,
  access: AccessContext,
  canCompare: boolean,
): Promise<RecycleData> {
  const ws = access.workspace_id;

  type Page = PromiseLike<{ data: RawRecycle[] | null; error: { message: string } | null }>;

  const leadPage =
    (table: "contacts" | "phone_leads", parent: "lists" | "phone_lists", select: string) =>
    (f: number, t: number): Page => {
      let q = supabase.from(table).select(select).eq("workspace_id", ws).or(RECYCLE_TOUCHED);
      // Personen-Scope an der ELTERNLISTE, mit owner_name-Vorrang — identisch
      // zu loadContacts/loadPhoneLeads.
      if (!canCompare) q = q.or(listOwnerScope(access), { referencedTable: parent });
      return q.order("id").range(f, t) as unknown as Page;
    };

  const apptPage =
    (table: "setting_calls" | "closing_calls", select: string) =>
    (f: number, t: number): Page => {
      let q = supabase.from(table).select(select).eq("workspace_id", ws).or(RECYCLE_TOUCHED);
      if (!canCompare) q = q.or(assignedOrCreatedBy(access.user.id));
      return q.order("id").range(f, t) as unknown as Page;
    };

  try {
    const [contacts, phoneLeads, settings, closings] = await Promise.all([
      fetchAllRows<RawRecycle>(leadPage("contacts", "lists", RECYCLE_CONTACT_SELECT)),
      fetchAllRows<RawRecycle>(leadPage("phone_leads", "phone_lists", RECYCLE_PHONE_SELECT)),
      fetchAllRows<RawRecycle>(apptPage("setting_calls", RECYCLE_SETTING_SELECT)),
      fetchAllRows<RawRecycle>(apptPage("closing_calls", RECYCLE_CLOSING_SELECT)),
    ]);

    // Die Coalesce-Ketten stehen wörtlich so in `recycle_tasks` (0033). Beim
    // Closing steht `lost_reason_code` dazwischen: Der Recycling-Grund wird
    // erst von `schedule_recycle()` gestempelt — eine Zeile, die vorher
    // gesperrt wurde, hätte sonst gar keinen Grund, obwohl der Verlustgrund
    // danebensteht.
    const map = (
      rows: RawRecycle[],
      origin: RecycleOriginKey,
      fallback: (r: RawRecycle) => string,
    ): AnalyseRecycleRow[] =>
      rows.map((r) => ({
        origin,
        reason: r.recycle_reason_code ?? fallback(r),
        attempts: Number(r.recycle_attempt_count) || 0,
        last_contacted_at: r.recycle_last_contacted_at ?? null,
        responded_at: r.recycle_responded_at ?? null,
        excluded_at: r.recycle_excluded_at ?? null,
        next_recycle_at: r.next_recycle_at ?? null,
        owner_name: r.lists?.owner_name ?? r.phone_lists?.owner_name ?? null,
        list_created_by_user_id:
          r.lists?.created_by_user_id ?? r.phone_lists?.created_by_user_id ?? null,
        assigned_user_id: r.assigned_user_id ?? null,
        created_by_user_id: r.created_by_user_id ?? null,
        status: r.status ?? null,
        blocked_at: r.blocked_at ?? null,
        answered: r.answered ?? null,
        appointment_set: r.appointment_set ?? null,
        follow_up_number: r.follow_up_number ?? null,
        revived_at: r.revived_at ?? null,
        no_show_resolution: r.no_show_resolution ?? null,
        cancel_outlook: r.cancel_outlook ?? null,
      }));

    const rows = [
      ...map(contacts, "linkedin", () => "fu_exhausted"),
      ...map(phoneLeads, "telefon", () => "dead"),
      ...map(settings, "setting", () => "dead"),
      ...map(closings, "closing", (r) => r.lost_reason_code ?? "sonstiges"),
    ];

    // Eigener Zweig: Ein fehlender Deckel kostet EINE Kennzahl, nicht die
    // Sektion. `maybeSingle()` liefert bei fehlender Zeile null ohne Fehler.
    const settingsRes = await supabase
      .from("pipeline_settings")
      .select("max_attempts")
      .eq("workspace_id", ws)
      .maybeSingle();
    const maxAttempts =
      settingsRes.error || !settingsRes.data
        ? null
        : Number((settingsRes.data as { max_attempts: number | null }).max_attempts) || null;

    return { rows, maxAttempts, available: true };
  } catch (err) {
    console.error("analyseData/recycle:", err instanceof Error ? err.message : err);
    return { rows: [], maxAttempts: null, available: false };
  }
}
