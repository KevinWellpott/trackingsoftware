"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { berlinInputToIso } from "@/lib/apptTime";
import { CANCELLED_MOVE_HINT } from "@/lib/terminMeta";
import type { SettingOutcome, SettingStatus } from "@/lib/types";
import { getPipelineSettings } from "@/app/actions/pipelineSettings";
import { clearRecycle, excludeFromRecycle, scheduleRecycle } from "@/app/actions/recycle";
import { revalidatePath } from "next/cache";

// Setting-Call bearbeiten (Script-Antworten + strukturierte Felder + Status)
// und bei Qualifikation einen Closing-Call erzeugen.
//
// ── Was hier mit dem Rückbau WEGGEFALLEN ist ────────────────────────────────
// Jede Statusänderung dieser Datei hat früher zusätzlich Erinnerungs-Touches
// erzeugt und entwertet — eine Bestätigungs-Kaskade vor dem Termin, eine
// No-Show-Kette danach, eine Kickoff-Nachricht nach der Qualifizierung. Der
// ganze Überbau ist gefallen: keine Stufen, keine Vorlagen, keine Kanal-Logik.
// Was von der Frage „um wen muss ich mich kümmern?" bleibt, beantwortet die
// Terminliste aus dem Zeilenzustand heraus (src/lib/dranRegel.ts).
//
// Die Aufrufe waren durchweg fail-soft und ihr Ergebnis las niemand synchron —
// das Herausschneiden ändert deshalb an keinem gespeicherten Zustand etwas. Die
// Tabelle `reminder_touches` bleibt stehen (Muster `call_assignees`), sie hat
// von hier aus nur keinen Schreiber mehr.
//
// GEBLIEBEN ist alles, was den Lead selbst betrifft: das Recycling-Datum
// (`scheduleRecycle`), die Folgen des Disqualifizierungsgrundes und die
// Verschiebe-Warnung aus `pipeline_settings`.

export type SettingCallPatch = {
  call_at?: string | null;
  branche?: string | null;
  offer_type?: string | null;
  show_status?: "show" | "no_show" | null;
  has_budget_8k?: "ja" | "nein" | "unklar" | null;
  sole_decider?: boolean | null;
  can_decide_now?: boolean | null;
  clear_need?: boolean | null;
  ist_pain?: number | null;
  soll_ziel?: string | null;
  warmth?: number | null;
  closing_scheduled?: boolean | null;
  closing_at?: string | null;
  recording_link?: string | null;
  objections_handled?: string | null;
  objections_open?: string | null;
  meet_link?: string | null;
  appointment_at?: string | null;
  script_answers?: Record<string, string>;
  status?: SettingStatus;
  follow_up_due?: string | null;
  no_show_count?: number;
  notes?: string | null;
  lead_name?: string | null;
  company?: string | null;
};

async function canAccessSettingCall(id: string): Promise<boolean> {
  return canAccessAppointment("setting", id);
}

export async function updateSettingCall(id: string, patch: SettingCallPatch): Promise<{ error?: string }> {
  if (!(await canAccessSettingCall(id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();

  // Eine Normalisierung, die kein Aufrufer vergessen können darf: der
  // No-Show-Ausgang folgt dem Show-Status (CHECK aus 0032). Davor fällt ab, was
  // gar nicht mehr erfasst wird.
  //
  // Der frühere Vorher-Lesen-Block darüber ist mit dem Rückbau entfallen: Er
  // ermittelte den alten `show_status` einzig, um beim Weg zurück auf
  // „erschienen" die No-Show-Kette zu entwerten. Ohne Kette gibt es nichts mehr
  // zu entwerten — und eine zusätzliche Abfrage vor jedem Speichern erst recht
  // nicht.
  const normalized = withNoShowResolutionCleared(ohneWhatsApp(patch));
  const { error } = await supabase.from("setting_calls").update(normalized).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/setting/${id}`, "page");
  revalidatePath("/termine", "page");
  return {};
}

/**
 * Terminales Ergebnis eines Setting-Calls. Der Show-Status wird daraus abgeleitet,
 * statt ihn separat pflegen zu müssen:
 *   no_show → 'no_show', qualifiziert/unqualifiziert → 'show', dead → unverändert.
 *
 * no_show/unqualifiziert nehmen optional eine Wiedervorlage (YYYY-MM-DD) auf, die
 * den Call ins Nachfassen-Board hebt. qualifiziert legt direkt das Closing an.
 *
 * `disqualify` ist bei 'unqualifiziert' PFLICHT und wird im SELBEN UPDATE
 * geschrieben wie der Status. Der Trigger aus Migration 0035 prueft, ob der
 * Zustand „unqualifiziert ohne Grund" in DIESEM Statement neu entsteht — ein
 * zweiter Request, der den Grund nachreicht (so lief es bis hierher ueber
 * `setDisqualifyReason`), kaeme also immer zu spaet. Nebenbei ist die Regel
 * damit auch dann nicht verletzbar, wenn zwischen zwei Requests abgebrochen
 * wird.
 */
export async function setSettingOutcome(input: {
  settingId: string;
  outcome: SettingOutcome;
  followUpDue?: string | null;
  /** Nur bei `outcome='unqualifiziert'` sinnvoll — no_show und dead haben keinen Grundcode. */
  disqualify?: { code: DisqualifyReasonCode; text?: string | null } | null;
}): Promise<{ error?: string; closingId?: string }> {
  if (!(await canAccessSettingCall(input.settingId))) return { error: "Keine Berechtigung." };

  // Qualifiziert = Closing. Ein Schritt, kein Zwischenstatus.
  if (input.outcome === "qualifiziert") return createClosingFromSetting(input.settingId);

  // Vorpruefung statt roher Postgres-Meldung (Muster `isOneOf`): Server Actions
  // sind per direktem POST erreichbar, und der Trigger wuerde einen fehlenden
  // oder erfundenen Code zwar abweisen — aber mit einer Exception, die der
  // Nutzer als Constraint-Text zu sehen bekaeme.
  let disqualify: { code: DisqualifyReasonCode; text: string | null } | null = null;
  if (input.outcome === "unqualifiziert") {
    const code = input.disqualify?.code;
    if (!isOneOf(DISQUALIFY_REASON_CODES, code)) {
      return { error: "Bitte einen Grund für die Disqualifizierung auswählen." };
    }
    // Leerer Freitext wird NULL statt "" — sonst steht in der Detailseite eine
    // leere Zeile, die wie eine Angabe aussieht (wie in `cancelAppointment`).
    disqualify = { code, text: input.disqualify?.text?.trim() || null };
  }

  const supabase = await createClient();
  // Lokal erweitert um den No-Show-Ausgang: der gehoert NICHT in
  // `SettingCallPatch`, sonst schriebe ihn ein direkter POST auf
  // `updateSettingCall` an `setNoShowResolution` und dessen Pruefung vorbei.
  //
  // Der Disqualifikationsgrund steht aus demselben Grund nicht in
  // `SettingCallPatch`: ueber `updateSettingCall` liefe er an der Pruefung UND
  // an den Folgen des Grundes (Kontaktverbot) vorbei.
  const patch: SettingCallPatch & {
    no_show_resolution?: NoShowResolution | null;
    disqualify_reason_code?: DisqualifyReasonCode | null;
    disqualify_reason?: string | null;
  } = { status: input.outcome };

  if (input.outcome === "no_show") {
    patch.show_status = "no_show";
    patch.follow_up_due = input.followUpDue ?? null;
    // Ein neuer No-Show ist ein neues Ereignis — der Ausgang des vorherigen
    // ('antwort' o. ae.) beschreibt ihn nicht mehr.
    patch.no_show_resolution = null;
    // Zähler trägt die No-Show-Historie über spätere Neuterminierungen hinweg.
    const { data } = await supabase
      .from("setting_calls")
      .select("no_show_count")
      .eq("id", input.settingId)
      .maybeSingle();
    patch.no_show_count = ((data as { no_show_count: number } | null)?.no_show_count ?? 0) + 1;
  } else if (input.outcome === "unqualifiziert") {
    patch.show_status = "show";
    patch.follow_up_due = input.followUpDue ?? null;
  } else {
    // dead: show_status bewusst nicht anfassen — der Lead kann vorher erschienen sein.
    patch.follow_up_due = null;
  }

  // Nur ein Feld im selben Objekt — genau darin liegt der ganze Punkt: EIN
  // UPDATE schreibt Status und Grund, der Trigger sieht nie einen Zwischenstand.
  if (disqualify) {
    patch.disqualify_reason_code = disqualify.code;
    patch.disqualify_reason = disqualify.text;
  }

  const { error } = await supabase
    .from("setting_calls")
    .update(withNoShowResolutionCleared(patch))
    .eq("id", input.settingId);
  if (error) return { error: error.message };

  // 'dead' UND 'unqualifiziert' sind tote Enden (§ Konzept-Diskussion) — beide
  // bekommen ein Recycling-Datum statt endgültig zu verschwinden. Ohne
  // Grund-Argument: Grund und Status liest `schedule_recycle()` selbst aus der
  // Zeile — ein vom Client geschickter Grund konnte jede beliebige Wartezeit
  // auslösen.
  //
  // 'unqualifiziert' hat dabei eine EIGENE Frist
  // (`days_default_setting_disqualified`, Default 56 Tage = „Disqualifiziert
  // 8 Wochen", Entscheidung #8) — `schedule_recycle()` wählt sie am Status.
  // Ohne diesen Aufruf blieb die Einstellung wirkungslos: `recycle_tasks`
  // fragt den Zweig `status in ('dead','unqualifiziert')` zwar ab, aber
  // niemand trug je ein Datum ein.
  //
  // Die Reihenfolge ist unkritisch: `schedule_recycle()` liest den Grundcode
  // aus derselben Zeile, in der er eine Anweisung weiter oben gelandet ist,
  // und gibt für 'falsche_zielgruppe'/'keine_zusammenarbeit' ohnehin kein
  // Datum aus. `applyDisqualifyConsequences` räumt gleich darunter zusätzlich
  // ab, was ein FRÜHERER Aufruf gesetzt haben könnte.
  if (input.outcome === "dead" || input.outcome === "unqualifiziert") {
    await scheduleRecycle("setting", input.settingId);
  }

  // Die Folgen des GRUNDES — dieselbe Funktion wie beim Nachtragen an einer
  // Bestandszeile, damit Kontaktverbot und „nie Recycling" auf beiden Wegen
  // greifen und nicht davon abhaengen, wie der Grund hereinkam.
  const consequence = disqualify
    ? await applyDisqualifyConsequences(input.settingId, disqualify.code)
    : {};

  revalidatePath(`/setting/${input.settingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  // Bewusst NACH dem Revalidieren: Status und Grund stehen bereits in der Zeile,
  // nur die Folge fehlt — die Oberflaeche muss den echten Stand zeigen und
  // trotzdem die Meldung bekommen (ein lautlos gescheitertes Kontaktverbot ist
  // keines).
  if (consequence.error) return { error: `Ergebnis gespeichert, ${consequence.error}` };
  return {};
}

/**
 * Neuen Termin für einen No-Show setzen: derselbe Datensatz wird wiederverwendet,
 * `no_show_count` bleibt stehen — sonst verschwände der No-Show aus der Show-Quote.
 *
 * Setzt den Call bewusst auf 'offen' zurück (neuer Anlauf). Zum reinen
 * Verschieben eines Termins → `moveSettingAppointment`.
 */
export async function rescheduleSetting(
  settingId: string,
  appointmentAt: string,
): Promise<{ error?: string }> {
  const appointmentIso = berlinInputToIso(appointmentAt);
  if (!appointmentIso) return { error: "Bitte einen neuen Termin angeben." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("setting_calls")
    .update({
      appointment_at: appointmentIso,
      status: "offen",
      show_status: null,
      follow_up_due: null,
      // Muss mit: der CHECK aus 0032 laesst `no_show_resolution` nur neben
      // `show_status='no_show'` stehen. Der Ersatztermin ist damit ein
      // fluechtiger Vermerk — dauerhaft bleibt die Historie in `no_show_count`
      // und im neuen `appointment_at`.
      no_show_resolution: null,
    })
    .eq("id", settingId);
  if (error) return { error: error.message };

  await mirrorAppointmentToSource(settingId, appointmentIso);

  revalidatePath(`/setting/${settingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Den Termin am Ursprungs-Datensatz nachziehen, damit LinkedIn-Board und
 * Telefon-Ansicht dieselbe Uhrzeit zeigen wie der Kalender.
 */
async function mirrorAppointmentToSource(settingId: string, appointmentIso: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("setting_calls")
    .select("source_contact_id, source_phone_lead_id")
    .eq("id", settingId)
    .maybeSingle();
  const src = data as { source_contact_id?: string | null; source_phone_lead_id?: string | null } | null;
  if (src?.source_contact_id) {
    await supabase.from("contacts").update({ appointment_at: appointmentIso }).eq("id", src.source_contact_id);
  }
  if (src?.source_phone_lead_id) {
    await supabase.from("phone_leads").update({ appointment_at: appointmentIso }).eq("id", src.source_phone_lead_id);
  }
}

/**
 * Termin verschieben (Drag & Drop im Kalender) — ausschließlich der Zeitpunkt.
 * Status, Show-Status, Wiedervorlage und No-Show-Zähler bleiben unangetastet;
 * genau darin unterscheidet sich die Action von `rescheduleSetting`.
 *
 * `appointmentAt` ist Berlin-Wandzeit ("2026-07-27T10:00") oder bereits ISO-UTC.
 *
 * Ein ABGESAGTER Termin wird hier abgewiesen — wortgleich zu
 * `postponeAppointment`. Der Riegel stand bis hierher nur dort, und der
 * Kalender-Zug war der zweite Weg zum selben kaputten Zustand: Die Zeile trüge
 * danach `cancelled_at` UND ein neues Datum und stünde damit zugleich als
 * abgesagt und als terminiert da — die Arbeitsliste liest genau dieses Paar
 * (src/lib/dranRegel.ts) und hielte den Lead für versorgt. Der Weg zurück führt
 * über „Neuen Termin ansetzen" (actions/followUpStamp.ts), das die Absage
 * ausdrücklich für überholt erklärt — und genau deshalb liest der Riegel
 * `revived_at` mit (`absageWirktNoch`): Eine zurückgeholte Zeile ist wieder
 * verschiebbar, sonst wäre sie ab dem neuen Termin für immer eingefroren. Die
 * Oberfläche sperrt den Chip inzwischen ebenfalls (`moveLockReason`); die
 * Prüfung gehört trotzdem hierher, weil eine Server Action per direktem POST
 * erreichbar ist.
 */
export async function moveSettingAppointment(
  settingId: string,
  appointmentAt: string,
): Promise<{ error?: string }> {
  const appointmentIso = appointmentAt.endsWith("Z") ? appointmentAt : berlinInputToIso(appointmentAt);
  if (!appointmentIso) return { error: "Ungültiger Termin." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("setting_calls")
    .select("cancelled_at, revived_at")
    .eq("id", settingId)
    .maybeSingle();
  if (absageWirktNoch(before as { cancelled_at: string | null; revived_at: string | null } | null)) {
    return { error: CANCELLED_MOVE_HINT };
  }

  const { error } = await supabase
    .from("setting_calls")
    .update({ appointment_at: appointmentIso })
    .eq("id", settingId);
  if (error) return { error: error.message };

  await mirrorAppointmentToSource(settingId, appointmentIso);

  revalidatePath(`/setting/${settingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Aus einem qualifizierten Setting einen Closing-Call anlegen (idempotent).
 *
 * Der Closing-Termin ist PFLICHT. Vorher wurde `call_at` aus
 * `setting_calls.closing_at` uebernommen — ein Feld, das keine Oberflaeche
 * befuellt. Praktisch entstand damit jedes Closing ohne Termin und tauchte
 * weder im Kalender noch in der Wochenplanung auf.
 *
 * Ohne Datum wird deshalb nicht angelegt, sondern `needsDate` zurueckgegeben;
 * die Oberflaeche fragt dann im Modal nach. Das ist zugleich der Weg, auf dem
 * „Zum Closing →" ein bereits bestehendes Closing aufloest, ohne ein Datum
 * mitzuschicken.
 */
export async function createClosingFromSetting(
  settingId: string,
  closingAtIso?: string | null,
): Promise<{ error?: string; closingId?: string; needsDate?: boolean }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!(await canAccessSettingCall(settingId))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const closingAt = closingAtIso?.trim() || null;

  // Qualifiziert heißt: er war da. Wiedervorlage aus einem früheren No-Show/
  // Unqualifiziert entfällt, sonst bliebe der Call im Nachfassen-Board hängen.
  const qualifiedPatch: SettingCallPatch & { no_show_resolution?: NoShowResolution | null } = {
    status: "closing_gelegt",
    closing_scheduled: true,
    show_status: "show",
    follow_up_due: null,
    // Zwingend zusammen mit `show_status`: siehe `withNoShowResolutionCleared`.
    // Ein qualifiziertes Setting ist kein No-Show mehr.
    no_show_resolution: null,
  };

  // Bereits vorhandenen Closing-Call wiederverwenden
  const { data: existing } = await supabase
    .from("closing_calls")
    .select("id, call_at")
    .eq("setting_call_id", settingId)
    .maybeSingle();
  if (existing) {
    // Einen bestehenden Termin NICHT ueberschreiben — nur eine Luecke fuellen.
    if (closingAt && !existing.call_at) {
      await supabase.from("closing_calls").update({ call_at: closingAt }).eq("id", existing.id);
    }
    await supabase
      .from("setting_calls")
      .update(closingAt ? { ...qualifiedPatch, closing_at: closingAt } : qualifiedPatch)
      .eq("id", settingId);

    revalidatePath("/termine", "page");
    revalidatePath("/nachfassen", "page");
    return { closingId: existing.id };
  }

  // Neu anlegen geht nur mit Termin.
  if (!closingAt) return { needsDate: true };

  const { data: rawSetting } = await supabase
    .from("setting_calls")
    .select("lead_name, company, meet_link, assigned_user_id")
    .eq("id", settingId)
    .maybeSingle();
  const setting = rawSetting as {
    lead_name?: string | null;
    company?: string | null;
    meet_link?: string | null;
    assigned_user_id?: string | null;
  } | null;

  // Meet-Link aus dem Setting vorbefüllen — sinnvoller Default ist derselbe
  // Meet-Raum wie beim Setting-Call.
  //
  // Die Zuweisung erbt vom Setting, weil ein Closing ausschliesslich hier
  // entsteht: Wer auf „Qualifiziert" klickt, ist damit sonst Eigentuemer jedes
  // Closings im Team — genau daran zerbrach die Personen-Zuordnung vorher.
  // In fremder Organisation faellt der Fallback weg: Ein Plattform-Admin ist
  // dort kein Mitglied und darf nicht ueber die Org-Grenze zugewiesen werden.
  const fallbackAssignee = access.is_foreign_org ? null : access.user.id;
  const { data: closing, error } = await supabase
    .from("closing_calls")
    .insert({
      workspace_id: access.workspace_id,
      created_by_user_id: access.user.id,
      assigned_user_id: setting?.assigned_user_id ?? fallbackAssignee,
      setting_call_id: settingId,
      lead_name: setting?.lead_name ?? null,
      company: setting?.company ?? null,
      call_at: closingAt,
      meet_link: setting?.meet_link ?? null,
      status: "offen",
    })
    .select("id")
    .single();
  if (error || !closing) return { error: error?.message ?? "Closing anlegen fehlgeschlagen." };

  await supabase
    .from("setting_calls")
    .update({ ...qualifiedPatch, closing_at: closingAt })
    .eq("id", settingId);

  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return { closingId: closing.id };
}

/**
 * Setting-Call endgültig löschen.
 *
 * Die Fremdschlüssel stehen auf `on delete set null` — ein bereits angelegtes
 * Closing bleibt also bestehen und verliert nur seinen Setting-Bezug. Genau
 * darauf weist die Oberfläche vorher hin.
 *
 * Wichtig ist das Aufräumen der QUELLE: ohne das bliebe der LinkedIn-Kontakt
 * bzw. Telefon-Lead als „Termin gesetzt" markiert, obwohl es keinen Termin
 * mehr gibt — die Listen-Filter und die Terminquote wären damit dauerhaft
 * falsch.
 */
export async function deleteSettingCall(id: string): Promise<{ error?: string }> {
  if (!(await canAccessSettingCall(id))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: raw } = await supabase
    .from("setting_calls")
    .select("source_contact_id, source_phone_lead_id")
    .eq("id", id)
    .maybeSingle();
  const src = raw as { source_contact_id: string | null; source_phone_lead_id: string | null } | null;

  if (src?.source_contact_id) {
    await supabase
      .from("contacts")
      .update({ appointment_set: false, appointment_at: null, meet_link: null, setting_call_id: null })
      .eq("id", src.source_contact_id);
  }
  if (src?.source_phone_lead_id) {
    await supabase
      .from("phone_leads")
      .update({ appointment_set: false, appointment_at: null, status: "aktiv" })
      .eq("id", src.source_phone_lead_id);
  }

  const { error } = await supabase.from("setting_calls").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/* ------------------------------------------------------------------ *
 * Termin-Lebenszyklus: verschoben · abgesagt · disqualifiziert · No-Show-Ausgang
 * ------------------------------------------------------------------ */

// Die Ereignisse, die im Konzept ZWISCHEN den Kästen stehen. Bisher wurden sie
// als Statuswechsel verbucht und waren danach nicht mehr auseinanderzuhalten:
// „abgesagt", „vom Lead verschoben" und „niemand erschienen" sahen alle wie ein
// stiller Sprung auf einen anderen `status` aus.
//
// Alle drei Actions liegen HIER und nicht je zur Hälfte in closingCalls.ts:
// `setting_calls` und `closing_calls` tragen seit 0032 dieselben
// Lebenszyklus-Spalten, nur die Zeitspalte heißt anders. Zwei fast gleiche
// Kopien wären zwei Stellen, an denen die Regel „nur der Lead zählt" auseinander
// laufen kann.

/** Beide Termin-Tabellen — die gemeinsamen Actions lösen den Unterschied intern auf. */
export type AppointmentEntity = "setting" | "closing";

/** Absage-Gründe (CHECK aus Migration 0032). */
export type CancelReasonCode = "kein_neuer_termin" | "krank" | "familiaer" | "beruflich" | "preis" | "sonstiges";

/** Wie es nach der Absage weitergeht. Beide Zweige haben eine Ablage-Ansicht. */
export type CancelOutlook = "ohne_aussicht" | "neuer_termin";

export type NoShowResolution = "antwort" | "ohne_antwort" | "ersatztermin";

/** Disqualifizierungs-Gründe (CHECK aus Migration 0032, nur Setting). */
export type DisqualifyReasonCode =
  | "geld"
  | "kein_budget"
  | "kein_bedarf"
  | "falscher_zeitpunkt"
  | "kein_entscheider"
  | "falsche_zielgruppe"
  | "keine_zusammenarbeit"
  | "sonstiges";

// Die Listen bleiben modul-intern: ein `"use server"`-Modul darf ausschließlich
// async Funktionen exportieren, ein exportiertes Array wäre ein Build-Fehler.
const CANCEL_REASON_CODES: readonly CancelReasonCode[] = [
  "kein_neuer_termin",
  "krank",
  "familiaer",
  "beruflich",
  "preis",
  "sonstiges",
];
const CANCEL_OUTLOOKS: readonly CancelOutlook[] = ["ohne_aussicht", "neuer_termin"];
const NO_SHOW_RESOLUTIONS: readonly NoShowResolution[] = ["antwort", "ohne_antwort", "ersatztermin"];
const DISQUALIFY_REASON_CODES: readonly DisqualifyReasonCode[] = [
  "geld",
  "kein_budget",
  "kein_bedarf",
  "falscher_zeitpunkt",
  "kein_entscheider",
  "falsche_zielgruppe",
  "keine_zusammenarbeit",
  "sonstiges",
];

const APPOINTMENT_TABLE = { setting: "setting_calls", closing: "closing_calls" } as const;

/** Der EINZIGE strukturelle Unterschied der beiden Tabellen für diese Actions. */
const APPOINTMENT_TIME_COLUMN = { setting: "appointment_at", closing: "call_at" } as const;

/**
 * Server Actions sind per direktem POST erreichbar — ohne diese Prüfung liefe
 * ein beliebiger String in den CHECK der Datenbank, und der Nutzer bekäme eine
 * rohe Postgres-Meldung statt einer Ansage. (Muster `isLostReasonCode`.)
 */
function isOneOf<T extends string>(codes: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (codes as readonly string[]).includes(value);
}

/**
 * Der CHECK aus 0032 bindet `no_show_resolution` an `show_status='no_show'`.
 * Wandert der Show-Status auf etwas anderes — oder zurück auf NULL —, muss der
 * Ausgang mitgehen, sonst weist Postgres das ganze UPDATE ab: der Nutzer sähe
 * eine Constraint-Meldung, wo er nur ein Häkchen umgelegt hat.
 */
function withNoShowResolutionCleared<T extends { show_status?: "show" | "no_show" | null }>(patch: T): T {
  if (!("show_status" in patch) || patch.show_status === "no_show") return patch;
  return { ...patch, no_show_resolution: null };
}

/**
 * Die drei WhatsApp-Spalten aus dem Patch werfen — der letzte Schreibpfad, den
 * der Rückbau übersehen hatte.
 *
 * Welle 3 hat den WhatsApp-Block aus dem Setting-Editor gestrichen; die
 * Kaskade, die einen Kanal wählen musste, gibt es nicht mehr. Geblieben war
 * eine Server Action, die eine persönliche Mobilnummer samt
 * Einwilligungs-Zeitstempel (UWG, auch B2B) entgegennahm — ohne Oberfläche,
 * also ausschließlich per direktem POST erreichbar. Die frühere Ableitung an
 * dieser Stelle ERZEUGTE den Zeitstempel sogar, wenn keiner mitkam: ein
 * Einwilligungs-NACHWEIS, den nie jemand eingeholt hat.
 *
 * ES GENÜGT NICHT, die Felder aus `SettingCallPatch` zu nehmen. Der Patch geht
 * unverändert an `.update()`; ein TypeScript-Typ ist zur Laufzeit nichts, und
 * ein POST mit `wa_phone` käme weiterhin durch. Der Riegel muss deshalb ein
 * echtes Abstreifen sein.
 *
 * Die SPALTEN bleiben in der Datenbank (so entschieden) und mit ihnen die
 * CHECKs aus 0032. Verletzen kann sie nach diesem Schritt niemand mehr: Es
 * schreibt sie schlicht nichts.
 */
function ohneWhatsApp<T extends object>(patch: T): T {
  // Auf einer KOPIE, nicht am übergebenen Objekt — dieselbe Bauart wie
  // `withNoShowResolutionCleared`: Ein Helfer, der seinem Aufrufer den Patch
  // unter den Händen verändert, ist der nächste stille Fehler.
  const rest = { ...patch } as Record<string, unknown>;
  for (const feld of ["wa_phone", "wa_consent_at", "wa_refused_at"]) delete rest[feld];
  return rest as T;
}

/**
 * Ist die Absage dieser Zeile noch WIRKSAM? — die Frage hinter allen drei
 * Termin-Riegeln.
 *
 * Eine Absage lässt `appointment_at` stehen (docs §3); erst `revived_at` sagt
 * „die Absage ist überholt, es steht wieder ein Termin" — geschrieben von
 * „Neuen Termin ansetzen" (actions/followUpStamp.ts). Wer nur `cancelled_at`
 * liest, hält eine zurückgeholte Zeile für abgesagt und sperrt sie dauerhaft:
 * Der Kalender-Zug prallt ab, die Detailseite weist ab, und weil die Zeile in
 * der Arbeitsliste als „Verlegt" gilt, hat sie dort auch keine Knöpfe mehr.
 *
 * Dasselbe PAAR liest `terminZustand()` (src/lib/dranRegel.ts), und `revived_at`
 * ist zugleich der Riegel, mit dem `recycle_tasks` eine zurückgeholte Zeile aus
 * der Wiedervorlage nimmt (docs §5). Der Termin-Riegel las bis hierher nur die
 * eine Hälfte — dieselbe Fehlerklasse wie „wer nur `status` liest, hält einen
 * abgesagten Termin für offen".
 */
function absageWirktNoch(row: { cancelled_at: string | null; revived_at?: string | null } | null): boolean {
  return Boolean(row?.cancelled_at) && !row?.revived_at;
}

// Die Pruefung stuetzt sich nicht allein darauf, dass RLS die Zeile
// durchgelassen hat: fuer einen Plattform-Admin laesst RLS JEDE Zeile durch.
// Massgeblich ist die aktive Organisation — sonst koennte eine alte URL aus
// einer anderen Organisation dort hineinschreiben.
async function canAccessAppointment(entityType: AppointmentEntity, id: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from(APPOINTMENT_TABLE[entityType])
    .select("id")
    .eq("id", id)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return Boolean(data);
}

function revalidateAppointment(entityType: AppointmentEntity, id: string): void {
  revalidatePath(`/${entityType}/${id}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
}

/** Berlin-Wandzeit ("2026-07-27T10:00") oder bereits ISO-UTC — wie `moveSettingAppointment`. */
function toAppointmentIso(value: string): string | null {
  return value.endsWith("Z") ? value : berlinInputToIso(value);
}

export type PostponeResult = {
  error?: string;
  /** Kontingent überschritten. Eine WARNUNG, keine Sperre — die Oberfläche muss sie aktiv bestätigen lassen. */
  warn?: "limit";
  /** Stand des Zählers nach dieser Verschiebung. */
  count?: number;
  max?: number;
};

/**
 * Termin verschieben — eine Action für beide Tabellen.
 *
 * `byLead` ist der ganze Punkt: `reschedule_count` zählt NUR Verschiebungen
 * durch den LEAD. Der Kalender-Drag und die interne Umplanung des Verkäufers
 * gehören nicht dazu, sonst misst der Zähler die Disziplin des eigenen Teams
 * statt der Verbindlichkeit des Leads — und die Warnung träfe die Falschen.
 * Ein Ersatztermin nach No-Show zählt ebenfalls nicht (Entscheidung E9); der
 * läuft über `rescheduleSetting`, ist ein frischer Anlauf und rührt den Zähler
 * hier gar nicht erst an.
 *
 * Über dem Kontingent wird GEMELDET, nicht blockiert (Entscheidung E6): die
 * Oberfläche zeigt die Warnung, lässt sie bestätigen und schlägt die Ablage
 * „abgesagt ohne Aussicht" vor.
 */
export async function postponeAppointment(
  entityType: AppointmentEntity,
  id: string,
  newIso: string,
  byLead: boolean,
): Promise<PostponeResult> {
  if (!(await canAccessAppointment(entityType, id))) return { error: "Keine Berechtigung." };
  const appointmentIso = toAppointmentIso(newIso);
  if (!appointmentIso) return { error: "Ungültiger Termin." };

  const supabase = await createClient();
  const table = APPOINTMENT_TABLE[entityType];
  const { data } = await supabase
    .from(table)
    .select("reschedule_count, cancelled_at, revived_at")
    .eq("id", id)
    .maybeSingle();
  const current = data as {
    reschedule_count: number | null;
    cancelled_at: string | null;
    revived_at: string | null;
  } | null;
  if (!current) return { error: "Termin nicht gefunden." };
  // Ein abgesagter Termin bekommt hier kein neues Datum: die Zeile stünde
  // danach zugleich als abgesagt und als terminiert da — genau das Paar, aus
  // dem die Arbeitsliste ablesen muss, ob der Lead versorgt ist. Der Weg zurück
  // führt über „Neuen Termin ansetzen", und weil der die Absage für überholt
  // erklärt, zählt hier das PAAR und nicht die Absage allein (`absageWirktNoch`).
  // Denselben Satz gibt der Kalender-Riegel aus, deshalb steht er als Konstante
  // daneben.
  if (absageWirktNoch(current)) return { error: CANCELLED_MOVE_HINT };

  const count = (current.reschedule_count ?? 0) + (byLead ? 1 : 0);
  const patch: Record<string, unknown> = { [APPOINTMENT_TIME_COLUMN[entityType]]: appointmentIso };
  if (byLead) {
    patch.reschedule_count = count;
    patch.last_reschedule_at = new Date().toISOString();
  }

  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) return { error: error.message };

  // Nur das Erstgespräch hat einen Ursprungs-Datensatz, an dem der Zeitpunkt
  // nachzuziehen ist; ein Closing hängt an keiner Liste.
  if (entityType === "setting") {
    await mirrorAppointmentToSource(id, appointmentIso);
  }
  revalidateAppointment(entityType, id);

  // Die Warnung hängt am STAND des Zählers, nicht am einzelnen Klick: „dieser
  // Lead hat viermal verschoben" bleibt wahr, auch wenn gerade der Verkäufer
  // umgeplant hat.
  const { settings } = await getPipelineSettings();
  const max = settings.max_reschedules;
  return count > max ? { warn: "limit", count, max } : { count, max };
}

/**
 * Termin absagen. `outlook` trennt die beiden Fälle, die im Konzept getrennt
 * bleiben müssen: 'ohne_aussicht' landet in der Ablage, 'neuer_termin' in der
 * Liste der offenen Ersatztermine — keiner der beiden darf aus der Oberfläche
 * fallen.
 *
 * Der Grund ist fachlich Pflicht („Grund der Absage muss erfasst werden!"),
 * erzwungen aber HIER über den Rückgabewert und nicht per Constraint: der
 * Trigger dazu kommt bewusst erst nach dem Verifikationsfenster, damit die
 * laufende Produktion nicht an einem Update ohne Code zerbricht.
 *
 * `status` und `show_status` bleiben unangetastet — 0032 hat für die Absage
 * absichtlich eigene Spalten bekommen: ein abgesagter Termin fällt über
 * `show_status is null` korrekt aus dem Show-Quoten-Nenner, statt als No-Show
 * zu zählen.
 *
 * Genau daraus folgt der Nachsatz für 'ohne_aussicht': Weil der Status stehen
 * bleibt, erkennt kein Statuswechsel das Ende des Vorgangs — die Wiedervorlage
 * muss hier ausdrücklich eingeplant werden, sonst verschwände der Lead in der
 * Ablage und käme nie wieder heraus. `schedule_recycle()` lässt den Zweig seit
 * derselben Migration zu, die `recycle_tasks` bereits danach fragen ließ.
 *
 * Nur beim Erstgespräch. Ein abgesagtes CLOSING bekommt hier bewusst nichts:
 * Der Zweig von `recycle_tasks`, der Closings liefert, hängt an
 * `status='verloren'`, und die Wartezeit eines Closings hängt am
 * `lost_reason_code`, den eine bloße Absage nicht hat. Ein Datum wäre dort
 * unsichtbar und grundlos zugleich. Der Weg für ein Closing, das wirklich vorbei
 * ist, führt über „verloren" mit Grund — der plant das Recycling mit der
 * richtigen Frist ein.
 */
export async function cancelAppointment(
  entityType: AppointmentEntity,
  id: string,
  input: { reasonCode: CancelReasonCode; reasonText?: string | null; outlook: CancelOutlook },
): Promise<{ error?: string }> {
  if (!(await canAccessAppointment(entityType, id))) return { error: "Keine Berechtigung." };
  if (!isOneOf(CANCEL_REASON_CODES, input.reasonCode)) return { error: "Bitte einen Grund für die Absage angeben." };
  if (!isOneOf(CANCEL_OUTLOOKS, input.outlook)) {
    return { error: "Bitte angeben, ob es einen neuen Termin geben soll." };
  }

  const supabase = await createClient();
  // Vorher lesen, wie `postponeAppointment` es tut. Der Knopf heißt bei einer
  // bereits abgesagten Zeile „Absage ändern" und ruft dieselbe Action —
  // eine reine GRUND-Korrektur darf aber weder den Absage-Zeitpunkt noch die
  // Wiedervorlage neu setzen: `cancelled_at` trägt in der Ablage die Spalte
  // „Eingang" (die Karte spränge auf heute nach oben), und `schedule_recycle()`
  // rechnet `heute + Wartezeit` — wer drei Wochen später nur den Grund
  // korrigiert, schöbe den Lead damit stillschweigend um Monate nach hinten.
  const { data: before } = await supabase
    .from(APPOINTMENT_TABLE[entityType])
    .select("cancelled_at, cancel_outlook")
    .eq("id", id)
    .maybeSingle();
  const previous = before as { cancelled_at: string | null; cancel_outlook: string | null } | null;
  const wasCancelled = Boolean(previous?.cancelled_at);

  const { error } = await supabase
    .from(APPOINTMENT_TABLE[entityType])
    .update({
      // Nur beim ERSTEN Mal stempeln — danach ist der Zeitpunkt Historie.
      ...(wasCancelled ? {} : { cancelled_at: new Date().toISOString() }),
      cancel_reason_code: input.reasonCode,
      // Leerer Freitext wird NULL statt "" — sonst steht in der Detailseite eine
      // leere Zeile, die wie eine Angabe aussieht.
      cancel_reason: input.reasonText?.trim() || null,
      cancel_outlook: input.outlook,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // „Ohne Aussicht" ist ein totes Ende wie 'dead' — also eine Wiedervorlage
  // statt eines stillen Verschwindens. Fail-soft wie jeder Kaskaden- und
  // Recycling-Aufruf: eine ausgefallene Wiedervorlage darf die Absage selbst
  // nicht zurückrollen; die Ablage zeigt den Vorgang dann ohne Datum, und
  // „Recycling vorziehen" holt ihn von Hand zurück.
  //
  // Eingeplant wird nur beim ÜBERGANG nach „ohne Aussicht" — also bei der
  // ersten Absage oder wenn eine Korrektur den Ausblick von „neuer Termin" auf
  // „ohne Aussicht" dreht. Stand er schon dort, hat die Zeile ihr Datum
  // bereits; ein zweiter Aufruf rechnete es nur von heute neu.
  const becomesHopeless = input.outlook === "ohne_aussicht" && previous?.cancel_outlook !== "ohne_aussicht";
  if (entityType === "setting" && becomesHopeless) {
    await scheduleRecycle("setting", id);
  }

  revalidateAppointment(entityType, id);
  return {};
}

/**
 * Was AUS DEM GRUND folgt — unabhängig davon, ob er zusammen mit dem Status
 * gesetzt („Unqualifiziert"-Dialog, `setSettingOutcome`) oder an einer
 * Bestandszeile nachgetragen wird (`setDisqualifyReason`).
 *
 * `keine_zusammenarbeit` ist die rote Notiz „kein weiteres kontaktieren!" aus
 * dem Konzept: Der Lead bekommt kein Wiedervorlage-Datum, sondern ein
 * Kontaktverbot. `falsche_zielgruppe` bekommt ebenfalls nie eines — dort ist
 * es keine Sperre, sondern schlicht der falsche Fit.
 *
 * Beide müssen ein BEREITS gesetztes Datum wieder abräumen: `setSettingOutcome
 * ('dead')` plant das Recycling sofort ein, der Grund wird oft erst danach
 * eingetragen. `schedule_recycle()` allein genügt hier also nicht — die
 * Funktion kennt nur den Moment ihres eigenen Aufrufs.
 *
 * Bewusst nicht fail-soft (anders als Kaskade und Recycling-Planung): ein
 * Kontaktverbot, das lautlos scheitert, ist keines. Der Aufrufer stellt der
 * Meldung voran, WAS bereits gespeichert ist.
 */
async function applyDisqualifyConsequences(
  id: string,
  code: DisqualifyReasonCode,
): Promise<{ error?: string }> {
  if (code === "keine_zusammenarbeit") {
    const res = await excludeFromRecycle("setting", id);
    if (res.error) return { error: `Kontaktverbot fehlgeschlagen: ${res.error}` };
  } else if (code === "falsche_zielgruppe") {
    const res = await clearRecycle("setting", id);
    if (res.error) return { error: `Wiedervorlage nicht entfernt: ${res.error}` };
  }
  return {};
}

/**
 * Grund der Disqualifizierung NACHTRAGEN, ohne den Status erneut zu setzen
 * (nur Setting — ein Closing hat dafür `lost_reason_code`).
 *
 * Der Weg bleibt bestehen, obwohl `setSettingOutcome` den Grund inzwischen
 * selbst mitschreibt: Bestandszeilen stehen schon auf 'unqualifiziert' (oder
 * 'dead') ohne Code und müssen aus der Ablage heraus nachpflegbar sein — genau
 * dafür lässt der Trigger aus 0035 diesen Fall ausdrücklich zu.
 */
export async function setDisqualifyReason(
  id: string,
  input: { code: DisqualifyReasonCode; text?: string | null },
): Promise<{ error?: string }> {
  if (!(await canAccessSettingCall(id))) return { error: "Keine Berechtigung." };
  if (!isOneOf(DISQUALIFY_REASON_CODES, input.code)) return { error: "Bitte einen Grund auswählen." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("setting_calls")
    .update({ disqualify_reason_code: input.code, disqualify_reason: input.text?.trim() || null })
    .eq("id", id);
  if (error) return { error: error.message };

  const consequence = await applyDisqualifyConsequences(id, input.code);

  revalidateAppointment("setting", id);
  if (consequence.error) return { error: `Grund gespeichert, ${consequence.error}` };
  return {};
}

/**
 * Ausgang eines No-Shows festhalten.
 *
 * 'ohne_antwort' ist der einzige saubere Auslöser für die Ablage-Ansicht
 * „No-Show ohne Antwort" — vorher war dieser Fall von „noch nicht nachgefasst"
 * nicht zu unterscheiden.
 *
 * Zulässig nur bei `show_status='no_show'`; genau das erzwingt auch der CHECK
 * aus 0032. Geprüft wird trotzdem hier, damit der Nutzer eine Ansage bekommt
 * statt einer Constraint-Meldung.
 */
export async function setNoShowResolution(
  entityType: AppointmentEntity,
  id: string,
  resolution: NoShowResolution,
): Promise<{ error?: string }> {
  if (!(await canAccessAppointment(entityType, id))) return { error: "Keine Berechtigung." };
  if (!isOneOf(NO_SHOW_RESOLUTIONS, resolution)) return { error: "Unbekannter No-Show-Ausgang." };

  const supabase = await createClient();
  const table = APPOINTMENT_TABLE[entityType];
  const { data } = await supabase.from(table).select("show_status").eq("id", id).maybeSingle();
  const showStatus = (data as { show_status: string | null } | null)?.show_status ?? null;
  if (showStatus !== "no_show") {
    return { error: "Nur für einen Termin, bei dem niemand erschienen ist." };
  }

  const { error } = await supabase.from(table).update({ no_show_resolution: resolution }).eq("id", id);
  if (error) return { error: error.message };

  // Bleibt die Antwort aus, ist der Vorgang zu Ende — und das Konzept sagt an
  // dieser Stelle "ABLAUF GEHT ERNEUT VON VORNE LOS". Genau das ist das
  // Recycling: der Lead kommt nach der konfigurierten Wartezeit zurueck,
  // statt in der Ablage liegen zu bleiben. Ohne diesen Aufruf fragt
  // `recycle_tasks` den Zweig zwar ab, aber niemand traegt je ein Datum ein.
  //
  // Nur fuer das Erstgespraech: der Closing-Zweig von `recycle_tasks` haengt
  // an `status='verloren'`, ein Datum auf einem bloss nicht erschienenen
  // Closing waere unsichtbar. Der saubere Weg dort ist "verloren" mit Grund,
  // weil daran auch die richtige Wartezeit haengt.
  if (entityType === "setting" && resolution === "ohne_antwort") {
    await scheduleRecycle("setting", id);
  }

  revalidateAppointment(entityType, id);
  return {};
}
