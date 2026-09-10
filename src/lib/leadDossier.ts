// Lead-Dossier: reine Bibliothek (kein "use server"/"use client"), Muster
// dropoutLists.ts / recycleCadence.ts.
//
// ZWECK: Gespraechsvorbereitung, nicht Statistik. Wer gleich anruft, soll in
// wenigen Sekunden sehen, mit wem er spricht und was bisher lief — statt sich
// das aus /lists, /telefon, /setting und /closing zusammenzusuchen.
//
// DAS EIGENTLICHE PROBLEM: Es gibt keine Lead-Identitaet.
// Ein LinkedIn-Kontakt (`contacts`) und ein Telefon-Lead (`phone_leads`)
// derselben Firma sind zwei Zeilen ohne gemeinsamen Schluessel; ein
// `setting_calls` KANN auf beide zeigen (`source_contact_id` /
// `source_phone_lead_id`), muss aber nicht. Diese Datei loest das in zwei
// getrennten Stufen und vermischt sie nie:
//
//   1. BELEGT — `collectCore()` laeuft ausschliesslich ueber echte
//      Fremdschluessel (contact ↔ setting ↔ closing ↔ phone_lead). Nur was so
//      erreichbar ist, speist Zeitleiste, „zuletzt kontaktiert" und Notizen.
//   2. VERMUTET — `collectSuspected()` sammelt Zeilen, deren FIRMENNAME
//      normalisiert gleich ist, die aber ueber keinen Fremdschluessel haengen.
//      Sie werden NUR als Hinweis ausgewiesen und nie eingerechnet. Ein falsch
//      verschmolzenes Dossier ist schlimmer als zwei getrennte: Es behauptet
//      eine Gespraechshistorie, die es mit diesem Menschen nie gab.
//
// ZEIT: Zwei Genauigkeiten liegen in derselben Leiste. `date`-Spalten
// (pitched_at, first_call_at, next_recycle_at …) kennen nur den Tag,
// `timestamptz`-Spalten die Uhrzeit (docs §6). Beide bekommen einen
// numerischen Sortierschluessel; der Tag wird dafuer auf die Mittagszeit
// gelegt, damit er zwischen den Uhrzeit-Ereignissen desselben Tages
// plausibel einsortiert und nicht als Mitternacht alles verdraengt.
//
// EHRLICHKEIT UEBER LUECKEN: Fuer LinkedIn-Follow-ups und fuer den Ausgang
// eines Gespraechs gibt es KEIN Ereignis-Log — die App speichert nur den
// erreichten Stand (`follow_up_number`, `status`). Solche Ereignisse tragen
// `estimated: true` und werden nach `updated_at` einsortiert; die Karte sagt
// das dazu, statt einen erfundenen Zeitpunkt als Tatsache zu zeigen.
//
// FUENF QUELLEN, NICHT MEHR SECHS. Die Erinnerungs-Kaskade ist mit dem Rueckbau
// gefallen; `reminder_touches` fuellt keine Oberflaeche mehr, und eine
// Zeitleiste, die daraus liest, zeigte zuerst dauerhaft dasselbe und dann
// dauerhaft nichts. An ihre Stelle tritt der Nachfass-Stempel der Terminliste
// (`follow_up_last_contacted_at`, Migration 0041) — dasselbe Ereignis in der
// neuen, flachen Form: „hier wurde genervt, und zwar an diesem Tag". Ohne ihn
// verlöre ausgerechnet „zuletzt kontaktiert" den haeufigsten Kontakt ueberhaupt.

import { berlinDateISO } from "@/lib/apptTime";
// Tagesabstand und Beschriftung liegen in contactGap.ts: Dieselbe Zahl steht
// auch auf den Karten von /nachfassen — sie muss dort wortgleich heissen, sonst
// liest sie sich wie zwei verschiedene Zahlen.
import { dayDiff, lastContactLabel } from "@/lib/contactGap";
import { channelLabel } from "@/lib/channels";
// Deckt alle vier Grund-Familien ab. Wichtig fuer `recycle_reason_code`: bei
// einem Erstgespraech steht dort der DISQUALIFIKATIONS-Code, den die reine
// Recycling-Map nicht kennt — er stuende sonst hier roh und in der Ablage
// ausgeschrieben.
import { dropoutReasonLabel } from "@/lib/dropoutLists";
import {
  ALL_SETTING_BLOCKS,
  CLOSING_BLOCKS,
  LEGACY_CLOSING_BLOCKS,
  LEGACY_SETTING_BLOCKS,
} from "@/lib/scripts";
import { BRANCHE_LABEL, BUDGET_LABEL, SETTING_STATUS_LABEL, SHOW_STATUS_LABEL, jaNein } from "@/lib/settingLabels";
import { CLOSING_LOST_REASON_LABELS } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * Anker & Route
 * ------------------------------------------------------------------ */

/** Die vier Tabellen, von denen aus ein Dossier geoeffnet werden kann. */
export type DossierEntityKind = "contact" | "phone_lead" | "setting" | "closing";

export type DossierAnchor = { kind: DossierEntityKind; id: string };

export const DOSSIER_ENTITY_LABELS: Record<DossierEntityKind, string> = {
  contact: "LinkedIn-Kontakt",
  phone_lead: "Telefon-Lead",
  setting: "Setting",
  closing: "Closing",
};

const ENTITY_KINDS = Object.keys(DOSSIER_ENTITY_LABELS) as DossierEntityKind[];

export function isDossierEntityKind(value: unknown): value is DossierEntityKind {
  return typeof value === "string" && (ENTITY_KINDS as string[]).includes(value);
}

/**
 * Der Pfad zum Dossier. Bewusst hier und nicht in der Komponente: /nachfassen
 * und /erinnerungen verlinken spaeter dieselbe Route, und ein zweites Mal
 * zusammengebauter Pfad laeuft beim ersten Umbenennen auseinander.
 */
export function dossierPath(kind: DossierEntityKind, id: string): string {
  return `/lead/${kind}/${id}`;
}

/**
 * Warum steht hier kein Dossier? Drei Antworten, die man nicht verwechseln darf.
 *
 *  · `missing_schema` — der Datenbank fehlen Spalten (Migration nicht
 *    eingespielt). Das trifft JEDEN Lead, nicht diesen einen.
 *  · `load_failed`   — die Abfrage ist gescheitert (Netz, Zeitüberschreitung,
 *    Zugriffsrecht). Über den Lead sagt das GAR NICHTS; ein zweiter Versuch
 *    kann gelingen.
 *  · `not_found`     — geladen, und es gibt die Zeile hier wirklich nicht.
 *
 * Der mittlere Fall hatte bis hierher keine eigene Antwort und fiel auf die
 * letzte zurück: Bei jedem Fehler, der keine fehlende Migration ist, meldet die
 * Server-Action `available: true` samt Fehlertext — und die Oberfläche schrieb
 * daraufhin die definitive Aussage „Kein Lead unter dieser Adresse". Aus einer
 * abgerissenen Verbindung wurde so die Behauptung, den Menschen gebe es nicht.
 */
export type DossierEmptyKind = "missing_schema" | "load_failed" | "not_found";

export function dossierEmptyKind(available: boolean, error?: string | null): DossierEmptyKind {
  if (!available) return "missing_schema";
  return error ? "load_failed" : "not_found";
}

/* ------------------------------------------------------------------ *
 * Rohzeilen — nur die Spalten, die das Dossier wirklich liest
 * ------------------------------------------------------------------ */

/** Recycling-Spalten; identisch auf allen vier Tabellen (Migration 0033). */
type RecycleFields = {
  next_recycle_at: string | null;
  recycle_attempt_count: number | null;
  recycle_excluded_at: string | null;
  recycle_last_contacted_at: string | null;
  recycle_responded_at: string | null;
  recycle_reason_code: string | null;
};

export type DossierContact = RecycleFields & {
  id: string;
  list_id: string | null;
  list_name: string | null;
  list_owner_name: string | null;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  target_group: string | null;
  notes: string | null;
  meeting_notes: string | null;
  answer_text: string | null;
  answer_category: string | null;
  answered: boolean | null;
  pitched_at: string | null;
  follow_up_number: number | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  appointment_set: boolean | null;
  appointment_at: string | null;
  blocked_at: string | null;
  setting_call_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierPhoneLead = RecycleFields & {
  id: string;
  list_id: string | null;
  list_name: string | null;
  list_owner_name: string | null;
  decider_name: string | null;
  company: string | null;
  phone: string | null;
  decider_direct_dial: string | null;
  email: string | null;
  website: string | null;
  target_group: string | null;
  script_label: string | null;
  status: string | null;
  first_call_at: string | null;
  call_attempt: number | null;
  gatekeeper_reached: string | null;
  decider_reached: boolean | null;
  pitch_delivered: boolean | null;
  mailbox: boolean | null;
  answer_sentiment: string | null;
  callback_at: string | null;
  appointment_set: boolean | null;
  appointment_at: string | null;
  no_transfer_reason: string | null;
  no_pitch_reason: string | null;
  no_appointment_reason: string | null;
  objection_notes: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierAttempt = {
  id: string;
  lead_id: string;
  called_at: string;
  attempt_no: number;
  kind: string;
  outcome: string;
  mailbox: boolean | null;
  gatekeeper_reached: string | null;
  decider_reached: boolean | null;
  pitch_delivered: boolean | null;
  notes: string | null;
};

export type DossierSetting = RecycleFields & {
  id: string;
  lead_name: string | null;
  company: string | null;
  phone: string | null;
  wa_phone: string | null;
  wa_consent_at: string | null;
  wa_refused_at: string | null;
  source_type: string | null;
  source_detail: string | null;
  source_contact_id: string | null;
  source_phone_lead_id: string | null;
  appointment_at: string | null;
  call_at: string | null;
  meeting_kind: string | null;
  meet_link: string | null;
  status: string | null;
  show_status: string | null;
  branche: string | null;
  has_budget_8k: string | null;
  sole_decider: boolean | null;
  can_decide_now: boolean | null;
  clear_need: boolean | null;
  ist_pain: number | null;
  warmth: number | null;
  soll_ziel: string | null;
  script_answers: Record<string, string> | null;
  notes: string | null;
  objections_handled: string | null;
  objections_open: string | null;
  follow_up_due: string | null;
  /** Nachfass-Stempel der Terminliste (Migration 0041) — s. Kopf der Datei. */
  follow_up_last_contacted_at: string | null;
  follow_up_last_contacted_by_user_id: string | null;
  /** Aufgeloest in der Server-Action; null = niemand oder Konto gelöscht. */
  follow_up_last_contacted_username: string | null;
  no_show_count: number | null;
  no_show_resolution: string | null;
  cancelled_at: string | null;
  cancel_reason_code: string | null;
  cancel_reason: string | null;
  cancel_outlook: string | null;
  reschedule_count: number | null;
  last_reschedule_at: string | null;
  revived_at: string | null;
  disqualify_reason_code: string | null;
  disqualify_reason: string | null;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  assigned_username: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierClosing = RecycleFields & {
  id: string;
  setting_call_id: string | null;
  lead_name: string | null;
  company: string | null;
  call_at: string | null;
  meet_link: string | null;
  status: string | null;
  show_status: string | null;
  deal_volume: number | null;
  payment_type: string | null;
  signature_received: boolean | null;
  contract_start: string | null;
  onboarding_at: string | null;
  lost_reason_code: string | null;
  lost_reason: string | null;
  follow_up_due: string | null;
  follow_up_due_at: string | null;
  /** Nachfass-Stempel der Terminliste (Migration 0041) — s. Kopf der Datei. */
  follow_up_last_contacted_at: string | null;
  follow_up_last_contacted_by_user_id: string | null;
  /** Aufgeloest in der Server-Action; null = niemand oder Konto gelöscht. */
  follow_up_last_contacted_username: string | null;
  script_answers: Record<string, string> | null;
  notes: string | null;
  objections_handled: string | null;
  objections_open: string | null;
  cancelled_at: string | null;
  cancel_reason_code: string | null;
  cancel_reason: string | null;
  cancel_outlook: string | null;
  reschedule_count: number | null;
  last_reschedule_at: string | null;
  revived_at: string | null;
  assigned_user_id: string | null;
  created_by_user_id: string | null;
  assigned_username: string | null;
  created_at: string;
  updated_at: string;
};

export type DossierInput = {
  anchor: DossierAnchor;
  contacts: DossierContact[];
  phoneLeads: DossierPhoneLead[];
  settings: DossierSetting[];
  closings: DossierClosing[];
  attempts: DossierAttempt[];
  /** „Jetzt" als ISO — kommt vom Server, nie aus der Browser-Zone (docs §6). */
  now: string;
};

/* ------------------------------------------------------------------ *
 * Ergebnis
 * ------------------------------------------------------------------ */

export type DossierEventSource = "linkedin" | "telefon" | "setting" | "closing" | "recycling";

export type DossierEventTone = "neutral" | "success" | "warning" | "danger" | "info";

export type DossierEvent = {
  id: string;
  source: DossierEventSource;
  title: string;
  detail: string | null;
  tone: DossierEventTone;
  /** Rohwert: Tagesdatum (YYYY-MM-DD) oder Zeitstempel. */
  at: string;
  precision: "day" | "moment";
  /** Sortierschluessel in ms; Tagesereignisse liegen auf 12:00 UTC. */
  atMs: number;
  /** true = liegt noch bevor (geplant/faellig), gehoert nach `upcoming`. */
  future: boolean;
  /**
   * true = der Zeitpunkt ist NICHT erfasst und nur eingeordnet. Betrifft
   * Follow-up-Staende und Gespraechsausgaenge — dafuer gibt es kein Log.
   */
  estimated: boolean;
  /** true = an dieser Stelle wurde der Lead tatsaechlich kontaktiert. */
  contactedLead: boolean;
};

export type DossierLinkConfidence = "belegt" | "vermutet";

export type DossierLink = {
  kind: DossierEntityKind;
  id: string;
  label: string;
  /** Wie der Bezug zustande kam — der Satz steht wortgleich in der Karte. */
  via: string;
  confidence: DossierLinkConfidence;
  /** Kurzbeschreibung der Zeile (Name, Firma, Datum) fuer die Liste. */
  summary: string | null;
};

export type DossierChannel = {
  kind: "linkedin" | "email" | "phone" | "whatsapp" | "website";
  label: string;
  value: string;
  href: string | null;
  note: string | null;
};

export type DossierFact = { label: string; value: string };

export type DossierNote = { id: string; label: string; text: string; source: DossierEventSource };

export type DossierLastContact = {
  at: string | null;
  /** Genauigkeit von `at` — die Anzeige darf sie nicht aus der Länge raten. */
  precision: "day" | "moment" | null;
  /** Ganze Tage seit dem letzten Kontakt, in Berliner Kalendertagen. */
  daysAgo: number | null;
  /** „vor 5 Tagen" / „heute" / „noch nie kontaktiert". */
  label: string;
  source: DossierEventSource | null;
  /** true = der juengste Kontakt traegt keinen erfassten Zeitpunkt. */
  estimated: boolean;
  /** Was die Zahl nicht weiss — steht als Fussnote unter der Zahl. */
  caveats: string[];
};

export type LeadDossier = {
  anchor: DossierAnchor;
  found: boolean;
  name: string | null;
  company: string | null;
  role: string | null;
  targetGroup: string | null;
  ownerName: string | null;
  assigneeName: string | null;
  origin: { source: DossierEventSource; label: string; at: string | null } | null;
  channels: DossierChannel[];
  facts: DossierFact[];
  members: DossierLink[];
  suspected: DossierLink[];
  /** Vergangene Ereignisse, juengstes zuerst. */
  events: DossierEvent[];
  /** Geplante/faellige Ereignisse, naechstes zuerst. */
  upcoming: DossierEvent[];
  lastContact: DossierLastContact;
  notes: DossierNote[];
  warnings: string[];
};

/* ------------------------------------------------------------------ *
 * Kleinkram
 * ------------------------------------------------------------------ */

function clean(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t ? t : null;
}

function joinDetails(parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((p) => clean(p ?? null)).filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(" · ") : null;
}

/** Ein Tagesdatum (YYYY-MM-DD) von einem Zeitstempel unterscheiden. */
function isDayValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Sortierschluessel eines Ereignisses. Tagesdatum → 12:00 UTC: Mitternacht
 * haette jedes Tagesereignis vor alle Uhrzeit-Ereignisse desselben Tages
 * geschoben, obwohl darueber nichts bekannt ist.
 */
function toMs(value: string): number {
  const iso = isDayValue(value) ? `${value}T12:00:00.000Z` : value;
  return Date.parse(iso);
}

/**
 * Firmenname fuer den VERMUTUNGS-Vergleich normalisieren: Kleinschreibung,
 * Mehrfach-Leerzeichen eingekocht, Satzzeichen weg. Rechtsformen bleiben
 * bewusst stehen — „Meier GmbH" und „Meier AG" sind zwei Firmen, und ein
 * Abgleich, der sie zusammenzieht, erzeugt genau die falschen Hinweise.
 */
export function normalizeCompany(value: string | null | undefined): string | null {
  const t = (value ?? "")
    .toLowerCase()
    .replace(/[.,;:!?"'`´()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Unter drei Zeichen ist ein Firmenname kein Unterscheidungsmerkmal mehr.
  return t.length >= 3 ? t : null;
}

function firstOf<T>(values: (T | null | undefined)[]): T | null {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
}

/* ------------------------------------------------------------------ *
 * 1. Belegte Zugehoerigkeit — nur ueber Fremdschluessel
 * ------------------------------------------------------------------ */

export type DossierCore = {
  contactIds: Set<string>;
  leadIds: Set<string>;
  settingIds: Set<string>;
  closingIds: Set<string>;
  /** Wie jede Zeile erreicht wurde — begruendet den Satz in der Karte. */
  via: Map<string, string>;
};

function coreKey(kind: DossierEntityKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Breitensuche ueber die vier echten Fremdschluessel-Kanten:
 *
 *   contacts.setting_call_id      → setting_calls.id
 *   setting_calls.source_contact_id    → contacts.id
 *   setting_calls.source_phone_lead_id → phone_leads.id
 *   closing_calls.setting_call_id → setting_calls.id
 *
 * Alle vier sind in beide Richtungen begehbar; die Kante traegt zugleich den
 * Begruendungssatz. Nichts anderes wird als Zugehoerigkeit akzeptiert — der
 * Firmenname ist Stufe 2 (`collectSuspected`).
 *
 * DASS IN DIESEN SAETZEN SPALTENNAMEN STEHEN, IST ABSICHT — die eine bewusste
 * Ausnahme von der Regel „kein Datenbank-Vokabular auf dem Bildschirm".
 * Begruendung in docs/data-model.md §5.3: Der Satz haengt als Tooltip am Chip
 * und beantwortet eine einzige, sehr konkrete Rueckfrage — „warum gehoeren
 * diese beiden Zeilen zusammen?". Darauf ist der Feldname die pruefbare
 * Antwort; ohne ihn bliebe ein Achselzucken. Er draengt sich niemandem auf
 * (ein `title` erscheint nur auf Nachfrage), und die allgemeine Erklaerung
 * daneben — der InfoPopover „Wie das Dossier zusammengefuehrt wird" — kommt
 * bewusst ganz ohne Spaltennamen aus. Wer das hier aendert, aendert die Doku
 * mit; halb ist es eine Inkonsistenz.
 *
 * Dasselbe gilt fuer das Wort „Fremdschluessel" in den uebrigen via-Saetzen
 * (`collectSuspected`, der Rueckfall in `members`): Es benennt genau den
 * Unterschied zwischen BELEGT und VERMUTET. Ohne diesen Unterschied ist die
 * Zweistufigkeit ueberhaupt nicht erklaerbar — und sie ist die wichtigste
 * Eigenschaft des Dossiers.
 */
export function collectCore(input: DossierInput): DossierCore {
  const contactById = new Map(input.contacts.map((c) => [c.id, c]));
  const leadById = new Map(input.phoneLeads.map((l) => [l.id, l]));
  const settingById = new Map(input.settings.map((s) => [s.id, s]));
  const closingById = new Map(input.closings.map((c) => [c.id, c]));

  const core: DossierCore = {
    contactIds: new Set(),
    leadIds: new Set(),
    settingIds: new Set(),
    closingIds: new Set(),
    via: new Map(),
  };

  const seen = new Set<string>();
  const queue: { kind: DossierEntityKind; id: string; via: string }[] = [
    { kind: input.anchor.kind, id: input.anchor.id, via: "Ausgangspunkt des Dossiers." },
  ];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const key = coreKey(node.kind, node.id);
    if (seen.has(key)) continue;
    seen.add(key);
    core.via.set(key, node.via);

    if (node.kind === "contact") {
      const row = contactById.get(node.id);
      if (!row) continue;
      core.contactIds.add(row.id);
      if (row.setting_call_id) {
        queue.push({
          kind: "setting",
          id: row.setting_call_id,
          via: "Am LinkedIn-Kontakt als gebuchter Termin hinterlegt (contacts.setting_call_id).",
        });
      }
      for (const s of input.settings) {
        if (s.source_contact_id === row.id) {
          queue.push({ kind: "setting", id: s.id, via: "Termin nennt diesen LinkedIn-Kontakt als Quelle." });
        }
      }
      continue;
    }

    if (node.kind === "phone_lead") {
      const row = leadById.get(node.id);
      if (!row) continue;
      core.leadIds.add(row.id);
      for (const s of input.settings) {
        if (s.source_phone_lead_id === row.id) {
          queue.push({ kind: "setting", id: s.id, via: "Termin nennt diesen Telefon-Lead als Quelle." });
        }
      }
      continue;
    }

    if (node.kind === "setting") {
      const row = settingById.get(node.id);
      if (!row) continue;
      core.settingIds.add(row.id);
      if (row.source_contact_id) {
        queue.push({ kind: "contact", id: row.source_contact_id, via: "Quelle des Settings (source_contact_id)." });
      }
      if (row.source_phone_lead_id) {
        queue.push({
          kind: "phone_lead",
          id: row.source_phone_lead_id,
          via: "Quelle des Settings (source_phone_lead_id).",
        });
      }
      for (const c of input.contacts) {
        if (c.setting_call_id === row.id) {
          queue.push({ kind: "contact", id: c.id, via: "LinkedIn-Kontakt verweist auf dieses Setting." });
        }
      }
      for (const cc of input.closings) {
        if (cc.setting_call_id === row.id) {
          queue.push({ kind: "closing", id: cc.id, via: "Closing ist aus diesem Setting entstanden." });
        }
      }
      continue;
    }

    const row = closingById.get(node.id);
    if (!row) continue;
    core.closingIds.add(row.id);
    if (row.setting_call_id) {
      queue.push({ kind: "setting", id: row.setting_call_id, via: "Setting, aus dem dieses Closing entstand." });
    }
  }

  return core;
}

/* ------------------------------------------------------------------ *
 * 2. Vermutete Zugehoerigkeit — gleicher Firmenname, kein Fremdschluessel
 * ------------------------------------------------------------------ */

function summarizeContact(c: DossierContact): string {
  return joinDetails([c.name, c.company, c.list_name ? `Liste ${c.list_name}` : null]) ?? c.id;
}

function summarizeLead(l: DossierPhoneLead): string {
  return joinDetails([l.decider_name, l.company, l.phone]) ?? l.id;
}

function summarizeSetting(s: DossierSetting): string {
  return joinDetails([s.lead_name, s.company, s.appointment_at ?? s.call_at]) ?? s.id;
}

function summarizeClosing(c: DossierClosing): string {
  return joinDetails([c.lead_name, c.company, c.call_at]) ?? c.id;
}

/**
 * Zeilen, die denselben (normalisierten) Firmennamen tragen, aber ueber keinen
 * Fremdschluessel am Kern haengen. Sie werden ausgewiesen, nicht verschmolzen:
 * Zwei Menschen derselben Firma sind zwei Gespraechspartner, und eine
 * Zeitleiste, die beide mischt, laesst den Anrufer auf ein Gespraech Bezug
 * nehmen, das er mit jemand anderem gefuehrt hat.
 */
export function collectSuspected(input: DossierInput, core: DossierCore, companies: Set<string>): DossierLink[] {
  if (companies.size === 0) return [];
  const out: DossierLink[] = [];
  const via = "Gleicher Firmenname — kein Fremdschlüssel verbindet die Zeilen. Vermutung, nicht bestätigt.";

  for (const c of input.contacts) {
    const key = normalizeCompany(c.company);
    if (!key || !companies.has(key) || core.contactIds.has(c.id)) continue;
    out.push({ kind: "contact", id: c.id, label: DOSSIER_ENTITY_LABELS.contact, via, confidence: "vermutet", summary: summarizeContact(c) });
  }
  for (const l of input.phoneLeads) {
    const key = normalizeCompany(l.company);
    if (!key || !companies.has(key) || core.leadIds.has(l.id)) continue;
    out.push({ kind: "phone_lead", id: l.id, label: DOSSIER_ENTITY_LABELS.phone_lead, via, confidence: "vermutet", summary: summarizeLead(l) });
  }
  for (const s of input.settings) {
    const key = normalizeCompany(s.company);
    if (!key || !companies.has(key) || core.settingIds.has(s.id)) continue;
    out.push({ kind: "setting", id: s.id, label: DOSSIER_ENTITY_LABELS.setting, via, confidence: "vermutet", summary: summarizeSetting(s) });
  }
  for (const c of input.closings) {
    const key = normalizeCompany(c.company);
    if (!key || !companies.has(key) || core.closingIds.has(c.id)) continue;
    out.push({ kind: "closing", id: c.id, label: DOSSIER_ENTITY_LABELS.closing, via, confidence: "vermutet", summary: summarizeClosing(c) });
  }

  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * 3. Zeitleiste
 * ------------------------------------------------------------------ */

const PHONE_KIND_LABELS: Record<string, string> = {
  erstanruf: "Erstanruf",
  folgeanruf: "Folgeanruf",
  rueckruf: "Rückruf",
};

const PHONE_OUTCOME_LABELS: Record<string, string> = {
  termin: "Termin",
  rueckruf: "Rückruf vereinbart",
  nicht_erreicht: "Nicht erreicht",
  dead: "Toter Lead",
  kein_ergebnis: "Kein Ergebnis",
};

const PHONE_STATUS_LABELS: Record<string, string> = {
  aktiv: "Aktiv",
  rueckruf: "Rückruf",
  nicht_erreicht: "Nicht erreicht",
  termin: "Termin",
  dead: "Toter Lead",
};

const GATEKEEPER_LABELS: Record<string, string> = {
  ja: "Gatekeeper erreicht",
  nein: "Kein Gatekeeper",
  direkt: "Direkt beim Entscheider",
};

const CLOSING_STATUS_LABELS: Record<string, string> = {
  offen: "Offen",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
  nachfassen: "Nachfassen",
};

const CANCEL_OUTLOOK_LABELS: Record<string, string> = {
  ohne_aussicht: "ohne Aussicht auf einen neuen Termin",
  neuer_termin: "neuer Termin in Aussicht",
};

const NO_SHOW_RESOLUTION_LABELS: Record<string, string> = {
  antwort: "hat sich gemeldet",
  ohne_antwort: "ohne Antwort geblieben",
  ersatztermin: "Ersatztermin vereinbart",
};

const SCRIPT_LABELS = new Map<string, string>(
  [...ALL_SETTING_BLOCKS, ...LEGACY_SETTING_BLOCKS, ...CLOSING_BLOCKS, ...LEGACY_CLOSING_BLOCKS].map((b) => [
    b.key,
    b.label,
  ]),
);

function lookup(map: Record<string, string>, key: string | null): string | null {
  if (!key) return null;
  return map[key] ?? key;
}

function euro(value: number | null): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value)} €`;
}

type EventDraft = {
  id: string;
  source: DossierEventSource;
  title: string;
  detail?: string | null;
  tone?: DossierEventTone;
  at: string | null;
  estimated?: boolean;
  contactedLead?: boolean;
};

type EventBuilder = {
  /** Ein Ereignis ohne Zeitpunkt gibt es nicht — der Entwurf faellt still weg. */
  add: (draft: EventDraft) => void;
  all: () => DossierEvent[];
};

/**
 * Baukasten fuer die Zeitleiste; kapselt Sortierschluessel und Zukunfts-Flag,
 * damit keine Aufrufstelle beides von Hand rechnet (und dabei die Tages- von
 * der Uhrzeit-Genauigkeit verwechselt).
 */
function createEventBuilder(nowMs: number, todayBerlin: string): EventBuilder {
  const events: DossierEvent[] = [];
  return {
    add(draft) {
      const at = clean(draft.at);
      if (!at) return;
      const atMs = toMs(at);
      if (Number.isNaN(atMs)) return;
      const day = isDayValue(at);
      events.push({
        id: draft.id,
        source: draft.source,
        title: draft.title,
        detail: draft.detail ?? null,
        tone: draft.tone ?? "neutral",
        at,
        precision: day ? "day" : "moment",
        atMs,
        future: day ? at > todayBerlin : atMs > nowMs,
        estimated: draft.estimated ?? false,
        contactedLead: draft.contactedLead ?? false,
      });
    },
    all: () => events,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Das Dossier
 * ------------------------------------------------------------------ */

export function buildDossier(input: DossierInput): LeadDossier {
  const core = collectCore(input);
  const nowMs = Date.parse(input.now);
  const todayBerlin = berlinDateISO(input.now);

  const contacts = input.contacts.filter((c) => core.contactIds.has(c.id));
  const leads = input.phoneLeads.filter((l) => core.leadIds.has(l.id));
  const settings = input.settings
    .filter((s) => core.settingIds.has(s.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const closings = input.closings
    .filter((c) => core.closingIds.has(c.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const attempts = input.attempts
    .filter((a) => core.leadIds.has(a.lead_id))
    .sort((a, b) => a.called_at.localeCompare(b.called_at));

  const found =
    contacts.length > 0 || leads.length > 0 || settings.length > 0 || closings.length > 0;

  const b = createEventBuilder(Number.isNaN(nowMs) ? Date.now() : nowMs, todayBerlin);
  const notes: DossierNote[] = [];
  const warnings: string[] = [];
  const caveats: string[] = [];

  const note = (id: string, label: string, text: string | null, source: DossierEventSource) => {
    const t = clean(text);
    if (t) notes.push({ id, label, text: t, source });
  };

  /* ── LinkedIn ──────────────────────────────────────────────── */
  for (const c of contacts) {
    b.add({
      id: `contact:${c.id}:pitch`,
      source: "linkedin",
      title: "LinkedIn-Pitch verschickt",
      detail: joinDetails([c.list_name ? `Liste ${c.list_name}` : null, c.target_group]),
      at: c.pitched_at ?? berlinDateISO(c.created_at),
      contactedLead: true,
      estimated: !c.pitched_at,
    });

    if (c.follow_up_number && c.follow_up_number > 0) {
      // Es gibt KEIN Log je Follow-up-Stufe — nur den erreichten Stand. Der
      // Zeitpunkt ist deshalb geschaetzt und wird als solcher ausgewiesen.
      b.add({
        id: `contact:${c.id}:fu`,
        source: "linkedin",
        title: `Nachgefasst bis FU${c.follow_up_number}`,
        detail: "Zeitpunkt nicht erfasst — die App speichert nur die erreichte Stufe, kein Ereignis je Follow-up.",
        at: c.last_contacted_at ?? c.updated_at,
        estimated: true,
        contactedLead: true,
      });
      caveats.push(
        `LinkedIn-Follow-ups tragen keinen Zeitstempel — FU${c.follow_up_number} ist nach der letzten Änderung eingeordnet.`,
      );
    }

    if (c.answered) {
      b.add({
        id: `contact:${c.id}:answer`,
        source: "linkedin",
        title: "Antwort auf LinkedIn",
        detail: joinDetails([c.answer_category, c.answer_text]),
        tone: "success",
        at: c.last_contacted_at ?? c.updated_at,
        estimated: true,
      });
    }

    // „Steht an" darf nur zeigen, was auch WIRKLICH ansteht. Der Datumswert
    // allein reicht dafür nicht: `next_follow_up_at` bleibt stehen, wenn der
    // Lead antwortet, einen Termin bekommt oder uns blockiert, und in
    // Bestandsdaten steckt zusätzlich eine Fälligkeit aus der Zeit, als nach FU3
    // noch eine gesetzt wurde. Deshalb hier dieselben vier Ausschlüsse wie im
    // LinkedIn-Zweig der Wiedervorlage — sonst führt das Dossier eine Aufgabe,
    // die auf /nachfassen bewusst nicht steht, und jemand fasst gegen eine
    // laufende Unterhaltung nach.
    const imFollowUpFlow =
      c.answered !== true && c.appointment_set !== true && !c.blocked_at && (c.follow_up_number ?? 0) < 3;
    if (imFollowUpFlow) {
      b.add({
        id: `contact:${c.id}:next_fu`,
        source: "linkedin",
        title: `Follow-up fällig${c.follow_up_number ? ` (FU${Math.min(c.follow_up_number + 1, 3)})` : ""}`,
        detail: c.list_name ? `Liste ${c.list_name}` : null,
        at: c.next_follow_up_at,
        tone: "info",
      });
    }

    b.add({
      id: `contact:${c.id}:blocked`,
      source: "linkedin",
      title: "Auf LinkedIn blockiert",
      detail: "Kein weiterer Kontakt über dieses Profil.",
      tone: "danger",
      at: c.blocked_at,
    });
    if (c.blocked_at) warnings.push("Der Lead hat uns auf LinkedIn blockiert — dieser Weg ist zu.");

    // Ein Termin am Kontakt OHNE verknüpften Setting-Call ist ein loses Ende,
    // kein Fehler: er wurde vermerkt, aber nie als Termin angelegt.
    if (c.appointment_set && settings.length === 0) {
      b.add({
        id: `contact:${c.id}:appt`,
        source: "linkedin",
        title: "Termin am Kontakt vermerkt",
        detail: "Kein verknüpfter Setting-Termin — der Termin steht nur als Häkchen an der Listenzeile.",
        tone: "warning",
        at: c.appointment_at ?? c.updated_at,
        estimated: !c.appointment_at,
      });
    }

    note(`contact:${c.id}:notes`, "Notiz am LinkedIn-Kontakt", c.notes, "linkedin");
    note(`contact:${c.id}:answer_text`, "Antwort des Leads", c.answer_text, "linkedin");
    note(`contact:${c.id}:meeting`, "Gesprächsnotiz (LinkedIn-Kontakt)", c.meeting_notes, "linkedin");
    addRecycleEvents(b, "linkedin", `contact:${c.id}`, c, warnings);
  }

  /* ── Telefon ───────────────────────────────────────────────── */
  for (const l of leads) {
    const leadAttempts = attempts.filter((a) => a.lead_id === l.id);

    // Der Erstkontakt-Tag steht nur dann fuer sich, wenn das Anruf-Log leer ist
    // — sonst waere er die Dublette zum ersten Wählversuch. Das Log startete
    // bewusst leer (Migration 0028), fuer aeltere Leads gibt es nur den Tag.
    if (leadAttempts.length === 0) {
      b.add({
        id: `lead:${l.id}:first_call`,
        source: "telefon",
        title: "Erstkontakt",
        detail: joinDetails([
          l.list_name ? `Liste ${l.list_name}` : null,
          l.call_attempt ? `${l.call_attempt} Versuch(e) gezählt` : null,
          "Kein Anruf-Log für diesen Lead — nur der Tag des Erstkontakts ist erfasst.",
        ]),
        at: l.first_call_at,
        contactedLead: true,
      });
    }

    for (const a of leadAttempts) {
      b.add({
        id: `attempt:${a.id}`,
        source: "telefon",
        title: `Anwahl ${a.attempt_no} · ${lookup(PHONE_KIND_LABELS, a.kind) ?? "Anruf"}`,
        detail: joinDetails([
          lookup(PHONE_OUTCOME_LABELS, a.outcome),
          a.mailbox ? "Mailbox" : null,
          lookup(GATEKEEPER_LABELS, a.gatekeeper_reached),
          a.decider_reached === true ? "Entscheider am Apparat" : null,
          a.pitch_delivered === true ? "Pitch kam durch" : null,
          a.notes,
        ]),
        tone: a.outcome === "termin" ? "success" : a.outcome === "dead" ? "danger" : "neutral",
        at: a.called_at,
        contactedLead: true,
      });
    }

    b.add({
      id: `lead:${l.id}:callback`,
      source: "telefon",
      title: "Rückruf vereinbart",
      detail: joinDetails([l.phone, l.decider_direct_dial ? `Durchwahl ${l.decider_direct_dial}` : null]),
      tone: "info",
      at: l.callback_at,
    });

    note(`lead:${l.id}:notes`, "Notiz am Telefon-Lead", l.notes, "telefon");
    note(`lead:${l.id}:objections`, "Einwände am Telefon", l.objection_notes, "telefon");
    note(`lead:${l.id}:no_transfer`, "Nicht durchgestellt, weil", l.no_transfer_reason, "telefon");
    note(`lead:${l.id}:no_pitch`, "Kein Pitch, weil", l.no_pitch_reason, "telefon");
    note(`lead:${l.id}:no_appt`, "Kein Termin, weil", l.no_appointment_reason, "telefon");
    addRecycleEvents(b, "telefon", `lead:${l.id}`, l, warnings);
  }

  /* ── Erstgespräche ─────────────────────────────────────────── */
  for (const s of settings) {
    b.add({
      id: `setting:${s.id}:created`,
      source: "setting",
      title: "Setting gebucht",
      detail: joinDetails([channelLabel(s.source_type, "Quelle unbekannt"), s.source_detail]),
      at: s.created_at,
    });

    const outcome = joinDetails([
      lookup(SETTING_STATUS_LABEL, s.status),
      s.show_status ? lookup(SHOW_STATUS_LABEL, s.show_status) : null,
      s.disqualify_reason_code ? `Disqualifiziert: ${dropoutReasonLabel(s.disqualify_reason_code)}` : null,
      s.disqualify_reason,
      s.no_show_resolution ? `No-Show ${lookup(NO_SHOW_RESOLUTION_LABELS, s.no_show_resolution)}` : null,
    ]);
    b.add({
      id: `setting:${s.id}:appointment`,
      source: "setting",
      title: "Setting",
      detail: joinDetails([
        s.meeting_kind === "telefon" ? `Telefontermin${s.phone ? ` · ${s.phone}` : ""}` : null,
        outcome,
      ]),
      tone:
        s.status === "closing_gelegt" || s.status === "qualifiziert"
          ? "success"
          : s.status === "dead" || s.status === "unqualifiziert"
            ? "danger"
            : s.show_status === "no_show"
              ? "warning"
              : "neutral",
      at: s.appointment_at ?? s.call_at,
      contactedLead: s.show_status === "show",
    });

    if ((s.reschedule_count ?? 0) > 0) {
      b.add({
        id: `setting:${s.id}:reschedule`,
        source: "setting",
        title: `${s.reschedule_count}× verschoben`,
        detail: "Der Zähler steht am Termin; nur die letzte Verschiebung trägt einen Zeitpunkt.",
        tone: "warning",
        at: s.last_reschedule_at ?? s.updated_at,
        estimated: !s.last_reschedule_at,
      });
    }

    b.add({
      id: `setting:${s.id}:cancelled`,
      source: "setting",
      title: "Setting abgesagt",
      detail: joinDetails([
        dropoutReasonLabel(s.cancel_reason_code),
        lookup(CANCEL_OUTLOOK_LABELS, s.cancel_outlook),
        s.cancel_reason,
      ]),
      tone: "warning",
      at: s.cancelled_at,
    });

    b.add({
      id: `setting:${s.id}:revived`,
      source: "setting",
      title: "Ersatztermin eingetragen",
      detail: "Der Vorgang läuft ab hier über den neuen Termin weiter.",
      tone: "success",
      at: s.revived_at,
    });

    b.add({
      id: `setting:${s.id}:follow_up`,
      source: "setting",
      title: "Wiedervorlage Setting",
      at: s.follow_up_due,
      tone: "info",
    });

    addFollowUpStamp(b, "setting", `setting:${s.id}`, s);

    note(`setting:${s.id}:notes`, "Notiz zum Setting", s.notes, "setting");
    note(`setting:${s.id}:ziel`, "Soll / Ziel", s.soll_ziel, "setting");
    note(`setting:${s.id}:obj_handled`, "Behandelte Einwände", s.objections_handled, "setting");
    note(`setting:${s.id}:obj_open`, "Offene Einwände", s.objections_open, "setting");
    for (const [key, value] of Object.entries(s.script_answers ?? {})) {
      note(`setting:${s.id}:script:${key}`, SCRIPT_LABELS.get(key) ?? key, value, "setting");
    }
    addRecycleEvents(b, "setting", `setting:${s.id}`, s, warnings);

    if (s.wa_refused_at) warnings.push("Will keine persönliche Nummer herausgeben — WhatsApp scheidet aus.");
  }

  /* ── Closings ──────────────────────────────────────────────── */
  for (const c of closings) {
    b.add({
      id: `closing:${c.id}:created`,
      source: "closing",
      title: "Closing angelegt",
      detail: c.setting_call_id ? "Aus der Qualifizierung des Settings entstanden." : "Ohne Setting-Bezug angelegt.",
      at: c.created_at,
    });

    b.add({
      id: `closing:${c.id}:appointment`,
      source: "closing",
      title: "Abschlussgespräch",
      detail: joinDetails([
        lookup(CLOSING_STATUS_LABELS, c.status),
        c.show_status ? lookup(SHOW_STATUS_LABEL, c.show_status) : null,
        c.status === "gewonnen" ? euro(c.deal_volume) : null,
        c.status === "verloren" && c.lost_reason_code
          ? `Grund: ${CLOSING_LOST_REASON_LABELS[c.lost_reason_code as keyof typeof CLOSING_LOST_REASON_LABELS] ?? c.lost_reason_code}`
          : null,
        c.lost_reason,
      ]),
      tone: c.status === "gewonnen" ? "success" : c.status === "verloren" ? "danger" : "neutral",
      at: c.call_at,
      contactedLead: c.show_status === "show",
    });

    if ((c.reschedule_count ?? 0) > 0) {
      b.add({
        id: `closing:${c.id}:reschedule`,
        source: "closing",
        title: `${c.reschedule_count}× verschoben`,
        detail: "Der Zähler steht am Termin; nur die letzte Verschiebung trägt einen Zeitpunkt.",
        tone: "warning",
        at: c.last_reschedule_at ?? c.updated_at,
        estimated: !c.last_reschedule_at,
      });
    }

    b.add({
      id: `closing:${c.id}:cancelled`,
      source: "closing",
      title: "Closing abgesagt",
      detail: joinDetails([
        dropoutReasonLabel(c.cancel_reason_code),
        lookup(CANCEL_OUTLOOK_LABELS, c.cancel_outlook),
        c.cancel_reason,
      ]),
      tone: "warning",
      at: c.cancelled_at,
    });

    b.add({
      id: `closing:${c.id}:followup`,
      source: "closing",
      title: "Nachfass-Kontakt vereinbart",
      at: c.follow_up_due_at ?? c.follow_up_due,
      tone: "info",
    });

    addFollowUpStamp(b, "closing", `closing:${c.id}`, c);

    b.add({
      id: `closing:${c.id}:contract`,
      source: "closing",
      title: "Vertragsstart",
      detail: joinDetails([c.payment_type, c.signature_received ? "Unterschrift liegt vor" : null]),
      tone: "success",
      at: c.contract_start,
    });

    b.add({
      id: `closing:${c.id}:onboarding`,
      source: "closing",
      title: "Onboarding",
      tone: "success",
      at: c.onboarding_at,
    });

    note(`closing:${c.id}:notes`, "Notiz zum Closing", c.notes, "closing");
    note(`closing:${c.id}:obj_handled`, "Behandelte Einwände", c.objections_handled, "closing");
    note(`closing:${c.id}:obj_open`, "Offene Einwände", c.objections_open, "closing");
    for (const [key, value] of Object.entries(c.script_answers ?? {})) {
      note(`closing:${c.id}:script:${key}`, SCRIPT_LABELS.get(key) ?? key, value, "closing");
    }
    addRecycleEvents(b, "closing", `closing:${c.id}`, c, warnings);
  }

  /* ── Sortierung ────────────────────────────────────────────── */
  const all = b.all();
  // Absteigend fuer den Verlauf: Wer gleich anruft, liest von oben nach unten
  // und braucht zuerst das Juengste. Gleichstand wird ueber die ID gebrochen,
  // damit die Reihenfolge zwischen zwei Aufrufen stabil bleibt.
  const events = all
    .filter((e) => !e.future)
    .sort((a, x) => x.atMs - a.atMs || a.id.localeCompare(x.id));
  const upcoming = all
    .filter((e) => e.future)
    .sort((a, x) => a.atMs - x.atMs || a.id.localeCompare(x.id));

  /* ── Zuletzt kontaktiert ───────────────────────────────────── */
  const contactEvents = events.filter((e) => e.contactedLead);
  const last = contactEvents[0] ?? null;
  const lastDay = last ? (last.precision === "day" ? last.at : berlinDateISO(last.at)) : null;
  const daysAgo = lastDay ? Math.max(0, dayDiff(lastDay, todayBerlin)) : null;

  const lastContact: DossierLastContact = {
    at: last?.at ?? null,
    precision: last?.precision ?? null,
    daysAgo,
    label: lastContactLabel(daysAgo),
    source: last?.source ?? null,
    estimated: last?.estimated ?? false,
    caveats: [...new Set(caveats)],
  };

  /* ── Steckbrief ────────────────────────────────────────────── */
  const anchorContact = contacts.find((c) => c.id === input.anchor.id) ?? contacts[0] ?? null;
  const anchorLead = leads.find((l) => l.id === input.anchor.id) ?? leads[0] ?? null;
  const lastSetting = settings[settings.length - 1] ?? null;
  const lastClosing = closings[closings.length - 1] ?? null;

  const name = firstOf([
    clean(anchorContact?.name),
    clean(anchorLead?.decider_name),
    clean(lastSetting?.lead_name),
    clean(lastClosing?.lead_name),
  ]);
  const company = firstOf([
    clean(anchorContact?.company),
    clean(anchorLead?.company),
    clean(lastSetting?.company),
    clean(lastClosing?.company),
  ]);

  const channels: DossierChannel[] = [];
  const pushChannel = (c: DossierChannel | null) => {
    if (!c) return;
    if (channels.some((x) => x.kind === c.kind && x.value === c.value)) return;
    channels.push(c);
  };
  if (anchorContact?.linkedin_url) {
    pushChannel({
      kind: "linkedin",
      label: "LinkedIn",
      value: anchorContact.linkedin_url,
      href: anchorContact.linkedin_url,
      note: anchorContact.blocked_at ? "blockiert" : null,
    });
  }
  for (const c of contacts) pushChannel(mailChannel(c.email));
  for (const l of leads) {
    pushChannel(mailChannel(l.email));
    pushChannel(phoneChannel(l.phone, "Zentrale"));
    pushChannel(phoneChannel(l.decider_direct_dial, "Durchwahl Entscheider"));
    if (l.website) pushChannel({ kind: "website", label: "Website", value: l.website, href: l.website, note: null });
  }
  for (const c of contacts) pushChannel(phoneChannel(c.phone, "Aus der LinkedIn-Liste"));
  for (const s of settings) {
    pushChannel(phoneChannel(s.phone, "Einwahl zum Termin"));
    if (s.wa_phone) {
      pushChannel({
        kind: "whatsapp",
        label: "WhatsApp",
        value: s.wa_phone,
        href: null,
        note: s.wa_consent_at ? "Einwilligung dokumentiert" : "ohne dokumentierte Einwilligung",
      });
    }
  }

  const facts: DossierFact[] = [];
  const fact = (label: string, value: string | null | undefined) => {
    const v = clean(value ?? null);
    if (v) facts.push({ label, value: v });
  };
  fact("Zielgruppe", firstOf([clean(anchorContact?.target_group), clean(anchorLead?.target_group)]));
  fact("Branche", lookup(BRANCHE_LABEL, lastSetting?.branche ?? null));
  fact("Status Telefon-Lead", lookup(PHONE_STATUS_LABELS, anchorLead?.status ?? null));
  fact("Skript-Testarm", anchorLead?.script_label);
  fact("Stimmung am Telefon", anchorLead?.answer_sentiment);
  fact("Antwort-Kategorie", anchorContact?.answer_category);
  fact("Budget (8k)", lookup(BUDGET_LABEL, lastSetting?.has_budget_8k ?? null));
  fact("Alleinentscheider", jaNein(lastSetting?.sole_decider));
  fact("Kann sofort entscheiden", jaNein(lastSetting?.can_decide_now));
  fact("Klarer Bedarf", jaNein(lastSetting?.clear_need));
  fact("Pain (1–10)", lastSetting?.ist_pain != null ? String(lastSetting.ist_pain) : null);
  fact("Wärme (1–10)", lastSetting?.warmth != null ? String(lastSetting.warmth) : null);
  fact("Deal-Volumen", lastClosing?.status === "gewonnen" ? euro(lastClosing.deal_volume) : null);
  fact("Zahlungsart", lastClosing?.payment_type);

  const originEvent = [...events].reverse().find((e) => e.source === "linkedin" || e.source === "telefon" || e.source === "setting") ?? null;
  const origin = originEvent
    ? {
        source: originEvent.source,
        label:
          originEvent.source === "linkedin"
            ? "LinkedIn"
            : originEvent.source === "telefon"
              ? "Telefon"
              : channelLabel(lastSetting?.source_type, "Direkt angelegt"),
        at: originEvent.at,
      }
    : null;

  const members: DossierLink[] = [
    ...contacts.map<DossierLink>((c) => ({
      kind: "contact",
      id: c.id,
      label: DOSSIER_ENTITY_LABELS.contact,
      via: core.via.get(coreKey("contact", c.id)) ?? "Belegt über Fremdschlüssel.",
      confidence: "belegt",
      summary: summarizeContact(c),
    })),
    ...leads.map<DossierLink>((l) => ({
      kind: "phone_lead",
      id: l.id,
      label: DOSSIER_ENTITY_LABELS.phone_lead,
      via: core.via.get(coreKey("phone_lead", l.id)) ?? "Belegt über Fremdschlüssel.",
      confidence: "belegt",
      summary: summarizeLead(l),
    })),
    ...settings.map<DossierLink>((s) => ({
      kind: "setting",
      id: s.id,
      label: DOSSIER_ENTITY_LABELS.setting,
      via: core.via.get(coreKey("setting", s.id)) ?? "Belegt über Fremdschlüssel.",
      confidence: "belegt",
      summary: summarizeSetting(s),
    })),
    ...closings.map<DossierLink>((c) => ({
      kind: "closing",
      id: c.id,
      label: DOSSIER_ENTITY_LABELS.closing,
      via: core.via.get(coreKey("closing", c.id)) ?? "Belegt über Fremdschlüssel.",
      confidence: "belegt",
      summary: summarizeClosing(c),
    })),
  ];

  // Der Vermutungs-Abgleich laeuft ausschliesslich ueber die Firmennamen des
  // KERNS — nicht ueber die des Anrufers oder der Liste.
  const companies = new Set<string>();
  for (const value of [
    company,
    ...contacts.map((c) => c.company),
    ...leads.map((l) => l.company),
    ...settings.map((s) => s.company),
    ...closings.map((c) => c.company),
  ]) {
    const key = normalizeCompany(value);
    if (key) companies.add(key);
  }
  const suspected = collectSuspected(input, core, companies);

  return {
    anchor: input.anchor,
    found,
    name,
    company,
    // „Entscheider" ist die einzige Rolle, die die Datenbank kennt: das
    // Telefon-Feld heisst decider_name, alles andere ist ein blosser Name.
    role: anchorLead?.decider_name ? "Entscheider" : null,
    targetGroup: firstOf([clean(anchorContact?.target_group), clean(anchorLead?.target_group)]),
    ownerName: firstOf([clean(anchorContact?.list_owner_name), clean(anchorLead?.list_owner_name)]),
    assigneeName: firstOf([clean(lastClosing?.assigned_username), clean(lastSetting?.assigned_username)]),
    origin,
    channels,
    facts,
    members,
    suspected,
    events,
    upcoming,
    lastContact,
    notes,
    warnings: [...new Set(warnings)],
  };
}

/* ------------------------------------------------------------------ *
 * Nachfass-Stempel der Terminliste (Migration 0041)
 * ------------------------------------------------------------------ */

/** Die zwei Stempel-Spalten plus den in der Action aufgeloesten Namen. */
type FollowUpStamp = {
  follow_up_last_contacted_at: string | null;
  follow_up_last_contacted_username: string | null;
};

/**
 * „Abgehakt" aus der Terminliste — der Nachfolger der erledigten Erinnerung.
 *
 * Es ist der HAEUFIGSTE Kontakt im neuen Ablauf: Wer offen ist, wird jeden Tag
 * genervt, und jeder dieser Kontakte stempelt hier. Deshalb `contactedLead:
 * true` — ohne das zeigte „zuletzt kontaktiert" bei einem taeglich bearbeiteten
 * Lead das Datum seines letzten Termins, also ein Datum von vor Wochen.
 *
 * NUR DER LETZTE. Die Spalte haelt einen Zeitpunkt, keine Historie: Wer dreimal
 * nachgefasst hat, hinterlaesst eine Zeile, nicht drei. Das ist bewusst so —
 * ein Ereignis-Log je Nachfass-Klick waere genau der Ueberbau, der gerade
 * abgeraeumt wurde. Die Zeitleiste sagt es deshalb dazu, statt einen einzelnen
 * Eintrag wie den vollstaendigen Verlauf aussehen zu lassen.
 */
function addFollowUpStamp(
  b: EventBuilder,
  source: DossierEventSource,
  prefix: string,
  row: FollowUpStamp,
): void {
  b.add({
    id: `${prefix}:followed_up`,
    source,
    title: "Nachgefasst",
    detail: joinDetails([
      row.follow_up_last_contacted_username,
      "Zuletzt in der Terminliste abgehakt — frühere Nachfass-Kontakte hält die App nicht fest.",
    ]),
    at: row.follow_up_last_contacted_at,
    contactedLead: true,
  });
}

/* ------------------------------------------------------------------ *
 * Recycling — dieselben sechs Spalten auf allen vier Tabellen
 * ------------------------------------------------------------------ */

function addRecycleEvents(
  b: EventBuilder,
  source: DossierEventSource,
  prefix: string,
  row: RecycleFields,
  warnings: string[],
): void {
  b.add({
    id: `${prefix}:recycle_contacted`,
    source: "recycling",
    title: `Recycling-Versuch${row.recycle_attempt_count ? ` ${row.recycle_attempt_count}` : ""}`,
    detail: joinDetails([
      source === "linkedin" ? "LinkedIn" : source === "telefon" ? "Telefon" : null,
      row.recycle_reason_code ? dropoutReasonLabel(row.recycle_reason_code) : null,
    ]),
    at: row.recycle_last_contacted_at,
    contactedLead: true,
  });

  b.add({
    id: `${prefix}:recycle_responded`,
    source: "recycling",
    title: "Auf das Recycling reagiert",
    tone: "success",
    at: row.recycle_responded_at,
  });

  b.add({
    id: `${prefix}:recycle_excluded`,
    source: "recycling",
    title: "Dauerhaft gesperrt",
    detail: "Kontaktverbot — steht org-weit in der Sperrliste.",
    tone: "danger",
    at: row.recycle_excluded_at,
  });
  if (row.recycle_excluded_at) {
    warnings.push("Dauerhaft gesperrt (Kontaktverbot) — hier darf nicht mehr angerufen werden.");
  }

  b.add({
    id: `${prefix}:recycle_due`,
    source: "recycling",
    title: "Wiedervorlage (Recycling)",
    detail: row.recycle_reason_code ? dropoutReasonLabel(row.recycle_reason_code) : null,
    tone: "info",
    at: row.next_recycle_at,
  });
}

/* ------------------------------------------------------------------ *
 * Kontaktwege
 * ------------------------------------------------------------------ */

function mailChannel(value: string | null): DossierChannel | null {
  const v = clean(value);
  if (!v) return null;
  return { kind: "email", label: "E-Mail", value: v, href: `mailto:${v}`, note: null };
}

function phoneChannel(value: string | null, note: string): DossierChannel | null {
  const v = clean(value);
  if (!v) return null;
  return { kind: "phone", label: "Telefon", value: v, href: `tel:${v.replace(/[^\d+]/g, "")}`, note };
}
