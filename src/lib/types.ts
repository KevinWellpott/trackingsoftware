import type { ChannelKey } from "@/lib/channels";

export type Workspace = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
};

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  data_scope: "workspace" | "own";
};

export type Profile = {
  user_id: string;
  username: string;
  created_at: string;
};

export type PitchList = {
  id: string;
  workspace_id: string;
  name: string;
  pitch_text: string | null;
  /** Nachfass-Sequenz dieser Liste; leer = Nutzer-Vorlage bzw. Standardtext. */
  fu1_text: string | null;
  fu2_text: string | null;
  fu3_text: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
};

export type PipelineStage = {
  id: string;
  list_id: string;
  name: string;
  probability_pct: number | null;
  sort_order: number;
  exclude_from_followup: boolean;
  created_at: string;
};

// ─── Telefonakquise (Tracking 2.0) ─────────────────────────────
export type PhoneListKind = "akquise" | "rueckruf" | "nicht_erreicht";

export type PhoneList = {
  id: string;
  workspace_id: string;
  created_by_user_id: string | null;
  owner_name: string | null;
  name: string;
  list_kind: PhoneListKind;
  source_import_id: string | null;
  /**
   * Gesprächsleitfaden dieser Liste (Migration 0029). `phone_leads.script`
   * existiert zwar schon, ist aber pro Lead und damit als Testachse unbrauchbar.
   */
  script_text: string | null;
  /**
   * Testarm des Skripts — die GRUPPIERUNGSachse des A/B-Tests.
   * Ohne Label zersplittert jeder CSV-Import den Test in eine eigene Liste
   * (und damit in eine eigene, viel zu kleine Fallzahl); mit Label lassen sich
   * zehn Listen zu zwei Armen bündeln.
   */
  script_label: string | null;
  /**
   * Listen-Default für die Ziel-Branche. `phone_leads.target_group` bleibt je
   * Lead maßgeblich; die Liste liefert nur den Wert beim Import.
   */
  target_group: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
};

/** `qualifiziert` wird vom UI nicht mehr vergeben (Klick legt direkt das Closing an),
 *  bleibt aber für Bestandsdaten gültig. */
export type SettingStatus =
  | "offen"
  | "no_show"
  | "qualifiziert"
  | "closing_gelegt"
  | "unqualifiziert"
  | "dead";

/** Terminale Ergebnisse, die der Nutzer im Setting-Call setzen kann. */
export type SettingOutcome = "no_show" | "qualifiziert" | "unqualifiziert" | "dead";

export type SettingCall = {
  id: string;
  workspace_id: string;
  /** Audit: wer hat den Datensatz angelegt (immer die real angemeldete Person). */
  created_by_user_id: string | null;
  /**
   * Fachliche Zuordnung: wem gehört der Termin. Genau EINE Person.
   * Wird beim Anlegen gesetzt (Owner der Quellliste, sonst der Anlegende) und
   * ist die maßgebliche Personenachse aller Auswertungen — siehe
   * src/lib/personResolution.ts und docs/data-model.md §2.
   */
  assigned_user_id: string | null;
  /**
   * Herkunft des Termins. Die erlaubten Werte stehen NICHT hier, sondern in
   * der Kanal-Registry (`ChannelKey`, src/lib/channels.ts) — dieselbe Liste,
   * die auch der CHECK aus Migration 0029 kennt. Ein neuer Kanal ist damit ein
   * Registry-Eintrag und keine Typ-Änderung.
   * Enthält seit 0029 zusätzlich `social_media` | `ads` | `sonstige`; die
   * Altwerte `inbound` | `website` | `manuell` bleiben für Bestandszeilen.
   */
  source_type: ChannelKey | null;
  source_detail: string | null;
  /**
   * Rufnummer für Termine mit `meeting_kind = 'telefon'` (Migration 0029).
   * Bewusst am Termin und nicht am Lead: `phone_leads.phone` ist die
   * Firmenzentrale, und manuelle bzw. LinkedIn-Termine haben gar keinen Lead.
   * Nullable — die Pflicht sitzt im Formular, nicht in der Tabelle.
   */
  phone: string | null;
  source_contact_id: string | null;
  source_phone_lead_id: string | null;
  lead_name: string | null;
  company: string | null;
  call_at: string | null;
  branche: "agentur" | "coach" | "consultant" | "sonstiges" | null;
  offer_type: string | null;
  show_status: "show" | "no_show" | null;
  has_budget_8k: "ja" | "nein" | "unklar" | null;
  sole_decider: boolean | null;
  can_decide_now: boolean | null;
  clear_need: boolean | null;
  ist_pain: number | null;
  soll_ziel: string | null;
  warmth: number | null;
  closing_scheduled: boolean;
  closing_at: string | null;
  recording_link: string | null;
  objections_handled: string | null;
  objections_open: string | null;
  meet_link: string | null;
  /** Termin-Art: 'link' (Meet o. ä.), 'telefon', null = keine Angabe. */
  meeting_kind: "link" | "telefon" | null;
  appointment_at: string | null;
  script_answers: Record<string, string>;
  status: SettingStatus;
  /** Wiedervorlage für No-Show / Unqualifiziert (YYYY-MM-DD). */
  follow_up_due: string | null;
  /** Zählt No-Shows über Neuterminierungen hinweg — Basis der Show-Quote. */
  no_show_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Codierter Verlustgrund eines Closings (CHECK aus Migration 0029).
 *
 * Warum zusätzlich zum Freitext `lost_reason`: „zu teuer", „Preis",
 * „Budget nicht da" sind drei Zeilen in jeder Auswertung — zählbar wird der
 * Grund erst über einen festen Code. Der Freitext bleibt als Kontext daneben.
 *
 * `falsche_zielgruppe` ist der einzige Code, der nicht das Closing bewertet,
 * sondern die Stufe davor: Er macht messbar, wer falsch qualifiziert.
 */
export type ClosingLostReasonCode =
  | "preis"
  | "timing"
  | "kein_bedarf"
  | "entscheider"
  | "wettbewerb"
  | "vertrauen"
  | "ghosting"
  | "falsche_zielgruppe"
  | "sonstiges";

/** Auswahl-Reihenfolge im UI: häufigste Gründe zuerst, „Sonstiges" zuletzt. */
export const CLOSING_LOST_REASON_CODES: readonly ClosingLostReasonCode[] = [
  "preis",
  "timing",
  "kein_bedarf",
  "entscheider",
  "wettbewerb",
  "vertrauen",
  "ghosting",
  "falsche_zielgruppe",
  "sonstiges",
];

/**
 * Labels an EINER Stelle — sonst erfindet sie jeder Tab neu, und die
 * Verlustgrund-Statistik heißt in Closing-Tab, Funnel und Export anders.
 */
export const CLOSING_LOST_REASON_LABELS: Record<ClosingLostReasonCode, string> = {
  preis: "Preis",
  timing: "Timing",
  kein_bedarf: "Kein Bedarf",
  entscheider: "Entscheider",
  wettbewerb: "Wettbewerb",
  vertrauen: "Vertrauen",
  ghosting: "Ghosting",
  falsche_zielgruppe: "Falsche Zielgruppe",
  sonstiges: "Sonstiges",
};

export type ClosingCall = {
  id: string;
  workspace_id: string;
  /** Audit: wer hat den Datensatz angelegt (immer die real angemeldete Person). */
  created_by_user_id: string | null;
  /** Fachliche Zuordnung, erbt beim Anlegen vom Setting. Siehe SettingCall. */
  assigned_user_id: string | null;
  setting_call_id: string | null;
  lead_name: string | null;
  company: string | null;
  call_at: string | null;
  meet_link: string | null;
  show_status: "show" | "no_show" | null;
  closed: boolean | null;
  deal_volume: number | null;
  payment_type: string | null;
  signature_received: boolean | null;
  contract_start: string | null;
  /** Freitext-Notiz zum Verlust. Bleibt neben dem Code bestehen (Kontext). */
  lost_reason: string | null;
  /**
   * Zählbarer Verlustgrund (Migration 0029). Alle Bestandszeilen mit
   * `status='verloren'` stehen auf `sonstiges` und sind von Hand nachzupflegen
   * — bewusst kein automatisches Mapping aus dem Freitext.
   */
  lost_reason_code: ClosingLostReasonCode | null;
  follow_up_due: string | null;
  recording_link: string | null;
  objections_handled: string | null;
  objections_open: string | null;
  script_answers: Record<string, string>;
  status: "offen" | "gewonnen" | "verloren" | "nachfassen";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PhoneLeadStatus = "aktiv" | "rueckruf" | "nicht_erreicht" | "termin" | "dead";

export type PhoneLead = {
  id: string;
  list_id: string;
  workspace_id: string;
  created_by_user_id: string | null;
  first_call_at: string | null;
  decider_name: string | null;
  company: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  decider_direct_dial: string | null;
  call_attempt: number | null;
  /**
   * Testarm des Skripts, beim Import AM LEAD festgeschrieben (Migration 0030).
   * Umzugsfest — anders als `phone_lists.script_label`, das der Lead verliert,
   * sobald er bei „Rückruf"/„Nicht erreicht" in eine Routing-Liste wandert.
   * Ohne diesen Stempel fielen genau die schlechten Ausgänge aus dem A/B-Test.
   */
  script_label: string | null;
  gatekeeper_reached: "ja" | "nein" | "direkt" | null;
  gatekeeper_attempts: number | null;
  script: string | null;
  /** Entscheider war am Apparat. */
  decider_reached: boolean | null;
  /**
   * Der Pitch kam tatsächlich durch — NICHT dasselbe wie `decider_reached`.
   * Bis Migration 0028 beschriftete der Call-Modus einen einzigen Schalter als
   * "Entscheider gepitcht?", speicherte ihn aber als `decider_reached`; beide
   * Kennzahlen waren dadurch identisch. Bestandszeilen wurden aus
   * `decider_reached` übernommen, die Spreizung beginnt erst mit neuen Daten.
   */
  pitch_delivered: boolean | null;
  callback_at: string | null;
  answer_sentiment: "positiv" | "neutral" | "negativ" | null;
  objection_notes: string | null;
  no_transfer_reason: string | null;
  no_pitch_reason: string | null;
  no_appointment_reason: string | null;
  status: PhoneLeadStatus;
  mailbox: boolean | null;
  appointment_set: boolean;
  appointment_at: string | null;
  meet_link: string | null;
  yt_video_link: string | null;
  target_group: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Topf eines Anrufs — die Achse für "lohnt Nachfassen oder neue Leads scrapen?".
 * `rueckruf` = terminierter Zweitanruf, `folgeanruf` = erneuter Versuch ohne
 * Verabredung.
 */
export type PhoneCallKind = "erstanruf" | "folgeanruf" | "rueckruf";

/** Ergebnis eines Anrufs — 1:1 die Outcome-Buttons im Call-Modus. */
export type PhoneCallOutcome =
  | "termin"
  | "rueckruf"
  | "nicht_erreicht"
  | "dead"
  | "kein_ergebnis";

/**
 * Ein einzelner Wählversuch (Tabelle `phone_call_attempts`, Migration 0028).
 *
 * Vorher zählte "Anwahlen" Leads mit Erstkontakt — wer denselben Lead dreimal
 * anrief, erzeugte eine Zählung. `phone_leads.call_attempt` läuft als
 * denormalisiertes Maximum weiter, damit Telefon-Tab und CSV-Export unverändert
 * funktionieren; die genaue Zahl trägt diese Tabelle.
 *
 * `list_id` und `owner_name` sind SNAPSHOTS zum Zeitpunkt des Anrufs: Der Lead
 * wandert bei Rückruf/Nicht-erreicht physisch in eine Routing-Liste, ein Join
 * über die aktuelle Liste würde die Historie rückwirkend umschreiben.
 */
export type PhoneCallAttempt = {
  id: string;
  workspace_id: string;
  created_by_user_id: string | null;
  lead_id: string;
  list_id: string | null;
  owner_name: string | null;
  called_at: string;
  attempt_no: number;
  kind: PhoneCallKind;
  outcome: PhoneCallOutcome;
  mailbox: boolean;
  gatekeeper_reached: "ja" | "nein" | "direkt" | null;
  decider_reached: boolean | null;
  pitch_delivered: boolean | null;
  /** `backfill` markiert nachträglich synthetisierte Ereignisse. Heute immer `app`. */
  source: "app" | "backfill";
  notes: string | null;
  created_at: string;
};

export type Contact = {
  id: string;
  list_id: string;
  workspace_id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage_id: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  deal_value: number | null;
  custom_fields: Record<string, unknown>;
  // Neue Felder
  pitched_at: string | null;
  follow_up_number: 1 | 2 | 3 | null;
  answered: boolean | null;
  appointment_set: boolean | null;
  answer_text: string | null;
  answer_category: string | null;
  meeting_notes: string | null;
  deal_closed: boolean;
  deal_lost_reason: string | null;
  // Tracking 2.0
  linkedin_url: string | null;
  appointment_at: string | null;
  meet_link: string | null;
  target_group: string | null;
  setting_call_id: string | null;
  /** Lead hat uns auf LinkedIn blockiert → raus aus dem Follow-up-Flow. */
  blocked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactWithStage = Contact & {
  pipeline_stages: PipelineStage | null;
};

/** Schlanke Projektion für das Listen-Board — nur die Spalten, die die
 *  Detailseite wirklich rendert (hält Payload + Re-Renders klein). */
export type ListContact = Pick<
  Contact,
  | "id"
  | "list_id"
  | "name"
  | "notes"
  | "pitched_at"
  | "follow_up_number"
  | "answered"
  | "answer_category"
  | "answer_text"
  | "appointment_set"
  | "appointment_at"
  | "meet_link"
  | "linkedin_url"
  | "next_follow_up_at"
  | "blocked_at"
  | "created_at"
>;

/** Spaltenliste passend zu ListContact für die Supabase-Select-Query. */
export const LIST_CONTACT_COLUMNS =
  "id, list_id, name, notes, pitched_at, follow_up_number, answered, answer_category, answer_text, appointment_set, appointment_at, meet_link, linkedin_url, next_follow_up_at, blocked_at, created_at";
