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
  created_by_user_id: string | null;
  source_type: "linkedin" | "telefon" | "inbound" | "website" | "manuell" | null;
  source_detail: string | null;
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

export type ClosingCall = {
  id: string;
  workspace_id: string;
  created_by_user_id: string | null;
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
  lost_reason: string | null;
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
  gatekeeper_reached: "ja" | "nein" | "direkt" | null;
  gatekeeper_attempts: number | null;
  script: string | null;
  decider_reached: boolean | null;
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
