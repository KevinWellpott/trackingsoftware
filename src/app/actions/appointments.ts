"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext, ownScopeFilter, type AccessContext } from "@/lib/access";
import { berlinInputToIso } from "@/lib/apptTime";
import { SELECTABLE_CHANNELS, type SelectableChannelKey } from "@/lib/channels";
import { ownerUserIdOfList } from "@/lib/personResolution";
import { logCallAttempt } from "@/app/actions/phoneAttempts";
import { revalidatePath } from "next/cache";

// Termin=Ja → erzeugt automatisch einen Setting-Call-Eintrag und nimmt den Lead
// aus dem Follow-up-Flow (next_follow_up_at = null, appointment_set = true).
//
// Alle drei Anlagestrecken haben früher zusätzlich die Erinnerungs-Kaskade des
// neuen Termins berechnet. Sie ist mit dem Rückbau gefallen: Ein angelegter
// Termin steht im Kalender und in der Arbeitsliste, und mehr braucht es nicht.
//
// Zwei Personenfelder, zwei Bedeutungen (docs/data-model.md §2):
//   created_by_user_id = Audit — IMMER die real angemeldete Person.
//   assigned_user_id   = Fachlichkeit — wem der Termin gehört.
// Früher stand in created_by_user_id die eingestellte *Datensicht*; dadurch
// schrieb sich ein Admin mit fremder Datensicht die Termine selbst zu.

/**
 * Termin-Art: 'link' (Meet o. ä.) oder 'telefon'.
 *
 * `null` bleibt im Typ, weil Bestandszeilen es tragen — die Oberflächen bieten
 * die frühere dritte Option „Ohne" aber nicht mehr an: Ein Termin ohne Link
 * UND ohne Nummer ist ein Termin, den niemand übernehmen kann, und genau das
 * sollte die Rufnummer am Termin verhindern.
 */
export type MeetingKind = "link" | "telefon" | null;

/**
 * Kontaktweg normalisieren — die eine Stelle, an der „Link ODER Telefon"
 * durchgesetzt wird.
 *
 * Beide Felder werden am jeweils anderen Typ verworfen, damit an einem
 * Telefon-Termin kein verwaister Meet-Link hängt (und umgekehrt keine Nummer,
 * die zum falschen Kanal gehört). Bei `null` (Bestand, kein Formular) bleibt
 * beides leer und nichts wird erzwungen.
 */
function normalizeMeeting(input: {
  meetingKind: MeetingKind;
  meetLink: string | null | undefined;
  phone?: string | null;
}): { meetingKind: MeetingKind; meetLink: string | null; phone: string | null; error?: string } {
  const kind = input.meetingKind ?? null;
  const link = input.meetLink?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (kind === "link" && !link) {
    return { meetingKind: kind, meetLink: null, phone: null, error: "Termin-Link ist erforderlich." };
  }
  if (kind === "telefon" && !phone) {
    return {
      meetingKind: kind,
      meetLink: null,
      phone: null,
      error: "Telefonnummer ist bei einem Telefon-Termin erforderlich.",
    };
  }
  return {
    meetingKind: kind,
    meetLink: kind === "link" ? link : null,
    phone: kind === "telefon" ? phone : null,
  };
}

const SELECTABLE_SOURCE_KEYS = new Set<string>(SELECTABLE_CHANNELS.map((c) => c.key));

/**
 * Quelle eines manuell gebuchten Termins prüfen.
 *
 * Serverseitig, weil die Server-Action ihre Eingaben selbst validiert: Die
 * Altwerte ('manuell', 'inbound', 'website') stehen zwar noch im CHECK der
 * Tabelle, dürfen aber nicht mehr NEU vergeben werden — sonst wächst genau die
 * Restkategorie weiter, die Migration 0029 abschaffen soll.
 */
function normalizeSource(value: string | null | undefined): SelectableChannelKey | null {
  return value && SELECTABLE_SOURCE_KEYS.has(value) ? (value as SelectableChannelKey) : null;
}

type ListOwnerRow = { owner_name: string | null; created_by_user_id: string | null };
type MemberProfileRow = { user_id: string; profiles: { username: string } | null };

/**
 * Wem gehoert ein Termin, der aus einer Liste gebucht wird? — dem, der BUCHT.
 *
 * „Wenn ich einen Termin lege, muss ich ihn an den Termin erinnern — und wenn
 * er nicht erscheint, muss weiterhin ich ihn nerven." Die Zuweisung
 * entscheidet, in wessen Arbeitsliste der Termin steht (`erinnererOf`,
 * src/lib/personResolution.ts). Erinnern muss, wer ihn gelegt hat — nicht der
 * Besitzer der Liste, aus der der Lead kam. Bis zum 15. September 2026 stand
 * hier die umgekehrte Reihenfolge (Owner der Quellliste vor dem Buchenden);
 * mit mehreren Settern, die auch fremde Listen abarbeiten, fiel damit der
 * Termin in die Liste von jemandem, der von ihm nichts wusste.
 *
 * Der Listen-Owner bleibt als RUECKFALL, und zwar genau fuer den Fall, in dem
 * der Buchende kein Mitglied ist: ein Plattform-Admin, der in einer
 * Kunden-Organisation arbeitet. Seine user_id waere eine Zuweisung ueber die
 * Org-Grenze; der Termin gehoert dann dem Kunden-Mitglied, dessen Liste es ist
 * (`owner_name` hat Vorrang, `ownerUserIdOfList` spiegelt
 * `list_owned_by_user()` in SQL).
 *
 * Alles wird gegen die Mitgliederliste der AKTIVEN Organisation geprueft — ein
 * `owner_name`/`created_by_user_id` kann nach einem Umzug auf einen
 * Ex-Kollegen zeigen. Trifft nichts, wird `null` zugewiesen; die Auswertungen
 * fallen dann auf `created_by_user_id` zurueck (`personOf`).
 */
async function assignedUserForBooking(
  access: AccessContext,
  table: "lists" | "phone_lists",
  listId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const [listRes, memberRes] = await Promise.all([
    supabase.from(table).select("owner_name, created_by_user_id").eq("id", listId).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("user_id, profiles ( username )")
      .eq("workspace_id", access.workspace_id),
  ]);

  const members = (memberRes.data ?? []) as unknown as MemberProfileRow[];
  const memberIds = new Set(members.map((row) => row.user_id));
  const usernameToUserId = new Map<string, string>();
  for (const row of members) {
    const username = row.profiles?.username;
    if (username) usernameToUserId.set(username, row.user_id);
  }

  // Der Buchende zuerst. Nur wenn er in dieser Organisation kein Mitglied ist
  // (Plattform-Admin in einer Kunden-Organisation), gehoert der Termin dem
  // Owner der Liste — der Kunde muss ihn in seiner eigenen Liste finden.
  if (memberIds.has(access.user.id)) return access.user.id;
  const owner = ownerUserIdOfList(listRes.data as ListOwnerRow | null, usernameToUserId);
  return owner && memberIds.has(owner) ? owner : null;
}

// Gibt den Zugriffskontext zurueck statt nur true/false: die Aufrufer
// brauchen daraus workspace_id fuer den Insert. Ohne explizites workspace_id
// wuerde der Trigger es aus der Mitgliedschaft ableiten — und damit beim
// Arbeiten in einer fremden Organisation in der Heim-Org des Admins landen.
async function canAccessPitchList(listId: string): Promise<AccessContext | null> {
  const access = await getAccessContext();
  if (!access) return null;
  const supabase = await createClient();
  let query = supabase
    .from("lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    query = query.or(ownScope);
  }
  const { data } = await query.maybeSingle();
  return data ? access : null;
}

/**
 * LinkedIn-Kontakt terminieren: legt einen setting_calls-Eintrag an und
 * verknüpft ihn mit dem Kontakt. Pflicht sind der Termin-Zeitpunkt und —
 * je nach Termin-Art — der Link oder die Rufnummer.
 */
export async function convertContactToSetting(input: {
  contactId: string;
  listId: string;
  meetLink: string | null;
  /** Pflicht bei `meetingKind === 'telefon'`. */
  phone?: string | null;
  meetingKind: MeetingKind;
  appointmentAt: string; // ISO datetime-local
}): Promise<{ error?: string; settingCallId?: string }> {
  const meeting = normalizeMeeting(input);
  if (meeting.error) return { error: meeting.error };
  const { meetLink, meetingKind, phone } = meeting;
  // Der datetime-local-Wert ist Berlin-Wandzeit; die Spalte will echtes UTC.
  const appointmentAt = berlinInputToIso(input.appointmentAt);
  if (!appointmentAt) return { error: "Termin-Zeitpunkt ist erforderlich." };
  const access = await canAccessPitchList(input.listId);
  if (!access) {
    return { error: "Keine Berechtigung." };
  }

  const supabase = await createClient();

  // Kontakt-Snapshot (Name/Firma) für den Setting-Eintrag
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, company, setting_call_id")
    .eq("id", input.contactId)
    .eq("list_id", input.listId)
    .maybeSingle();
  if (!contact) return { error: "Kontakt nicht gefunden." };

  // Falls schon ein Setting-Eintrag existiert: nur Termin/Link aktualisieren.
  let settingCallId = (contact as { setting_call_id?: string | null }).setting_call_id ?? null;

  if (settingCallId) {
    await supabase
      .from("setting_calls")
      .update({
        meet_link: meetLink,
        phone,
        meeting_kind: meetingKind,
        appointment_at: appointmentAt,
      })
      .eq("id", settingCallId);
  } else {
    // Nur beim Anlegen zuweisen: ein bestehender Setting-Eintrag kann laengst
    // von Hand umverteilt worden sein, den wuerde ein Nachziehen ueberschreiben.
    const assignedUserId = await assignedUserForBooking(access, "lists", input.listId);
    const { data: sc, error: scErr } = await supabase
      .from("setting_calls")
      .insert({
        workspace_id: access.workspace_id,
        created_by_user_id: access.user.id,
        assigned_user_id: assignedUserId,
        source_type: "linkedin",
        source_contact_id: contact.id,
        lead_name: contact.name,
        company: (contact as { company?: string | null }).company ?? null,
        meet_link: meetLink,
        phone,
        meeting_kind: meetingKind,
        appointment_at: appointmentAt,
        status: "offen",
      })
      .select("id")
      .single();
    if (scErr || !sc) return { error: scErr?.message ?? "Setting-Eintrag fehlgeschlagen." };
    settingCallId = sc.id;
  }

  // Kontakt terminieren + aus dem Follow-up-Flow nehmen. Kein revalidatePath:
  // das Board refresht selbst (onSaved), alle anderen Routen sind dynamisch.
  //
  // `contacts.phone` existiert seit jeher und wurde von nichts befuellt. Die
  // im Termin-Dialog erfasste Nummer landet deshalb ZUSAETZLICH dort: sie
  // gehoert zum Lead, nicht nur zu diesem einen Termin — bei einem zweiten
  // Anlauf muesste man sie sonst erneut suchen. Nur setzen, nie loeschen: ein
  // Link-Termin darf eine bereits bekannte Nummer nicht wegwerfen.
  const contactPatch: Record<string, unknown> = {
    appointment_set: true,
    appointment_at: appointmentAt,
    meet_link: meetLink,
    setting_call_id: settingCallId,
    next_follow_up_at: null,
  };
  if (phone) contactPatch.phone = phone;

  const { error: upErr } = await supabase
    .from("contacts")
    .update(contactPatch)
    .eq("id", input.contactId);
  if (upErr) return { error: upErr.message };

  return { settingCallId: settingCallId ?? undefined };
}

/**
 * Termin manuell buchen — ohne LinkedIn-Kontakt/Liste und ohne Telefon-Lead.
 * Legt direkt einen setting_calls-Eintrag an, damit der Termin im Kalender,
 * im Closing-Flow und im Analyse-Dashboard erscheint.
 *
 * `sourceType` ist PFLICHT und einer der fünf wählbaren Kanäle. Bis Migration
 * 0029 schrieb diese Action fest `'manuell'` — der Erfassungsweg, nicht die
 * Herkunft. Im Funnel war das inzwischen die umsatzstärkste und zugleich
 * aussageloseste Zeile. Die Altwerte bleiben in der Tabelle erlaubt, werden
 * hier aber nicht mehr vergeben (`normalizeSource`).
 */
export async function createManualSetting(input: {
  leadName: string;
  company?: string | null;
  sourceType: SelectableChannelKey;
  sourceDetail?: string | null;
  meetLink: string | null;
  phone?: string | null;
  meetingKind: MeetingKind;
  appointmentAt: string;
}): Promise<{ error?: string; settingCallId?: string }> {
  const leadName = input.leadName.trim();
  const company = input.company?.trim() || null;
  const sourceDetail = input.sourceDetail?.trim() || null;
  const sourceType = normalizeSource(input.sourceType);
  const meeting = normalizeMeeting(input);
  if (meeting.error) return { error: meeting.error };
  const { meetLink, meetingKind, phone } = meeting;
  const appointmentAt = berlinInputToIso(input.appointmentAt);
  if (!leadName) return { error: "Name ist erforderlich." };
  if (!sourceType) return { error: "Bitte eine Quelle wählen." };
  if (!appointmentAt) return { error: "Termin-Zeitpunkt ist erforderlich." };

  const access = await getAccessContext();
  if (!access) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: sc, error: scErr } = await supabase
    .from("setting_calls")
    .insert({
      // Ohne Quellliste gibt es keinen Owner, an dem die Zuordnung haengen
      // koennte: Wer den Termin haendisch eintraegt, hat ihn geholt.
      // Ausnahme fremde Organisation: dort ist der Plattform-Admin kein
      // Mitglied, seine user_id waere eine Zuweisung ueber die Org-Grenze.
      workspace_id: access.workspace_id,
      created_by_user_id: access.user.id,
      assigned_user_id: access.is_foreign_org ? null : access.user.id,
      source_type: sourceType,
      source_detail: sourceDetail,
      source_contact_id: null,
      source_phone_lead_id: null,
      lead_name: leadName,
      company,
      meet_link: meetLink,
      phone,
      meeting_kind: meetingKind,
      appointment_at: appointmentAt,
      status: "offen",
    })
    .select("id")
    .single();
  if (scErr || !sc) return { error: scErr?.message ?? "Termin konnte nicht angelegt werden." };

  revalidatePath("/termine", "page");
  return { settingCallId: sc.id };
}

async function canAccessPhoneList(listId: string): Promise<AccessContext | null> {
  const access = await getAccessContext();
  if (!access) return null;
  const supabase = await createClient();
  let query = supabase
    .from("phone_lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", access.workspace_id);
  const ownScope = ownScopeFilter(access);
  if (ownScope) {
    query = query.or(ownScope);
  }
  const { data } = await query.maybeSingle();
  return data ? access : null;
}

/**
 * Telefon-Lead terminieren: legt einen setting_calls-Eintrag an (source telefon),
 * setzt den Lead auf Status 'termin' + appointment_set. Pflicht sind der
 * Zeitpunkt und — je nach Termin-Art — Link oder Rufnummer; die Nummer fällt
 * hier auf die des Leads zurück (siehe unten).
 */
export async function convertPhoneLeadToSetting(input: {
  phoneLeadId: string;
  listId: string;
  meetLink: string | null;
  phone?: string | null;
  meetingKind: MeetingKind;
  appointmentAt: string;
}): Promise<{ error?: string; settingCallId?: string }> {
  const appointmentAt = berlinInputToIso(input.appointmentAt);
  if (!appointmentAt) return { error: "Termin-Zeitpunkt ist erforderlich." };
  const access = await canAccessPhoneList(input.listId);
  if (!access) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("phone_leads")
    .select("id, list_id, status, decider_name, company, phone, decider_direct_dial")
    .eq("id", input.phoneLeadId)
    .maybeSingle();
  if (!lead) return { error: "Lead nicht gefunden." };

  // Fallback auf die Nummern des Leads, bevor die Pflichtprüfung greift.
  // Bei einem Telefon-Lead ist die Nummer per Definition bekannt — ihn im
  // Call-Modus nach ihr zu fragen wäre eine Rückfrage nach etwas, das
  // buchstäblich gerade gewählt wurde. Durchwahl vor Zentrale: das Setting
  // findet mit dem Entscheider statt, nicht mit dem Gatekeeper.
  const leadRow = lead as { phone?: string | null; decider_direct_dial?: string | null };
  const meeting = normalizeMeeting({
    ...input,
    phone: input.phone ?? leadRow.decider_direct_dial ?? leadRow.phone ?? null,
  });
  if (meeting.error) return { error: meeting.error };
  const { meetLink, meetingKind, phone } = meeting;

  // Bereits vorhandenen Setting-Eintrag wiederverwenden (kein Duplikat).
  //
  // Bewusst der JÜNGSTE statt „der eine": Seit der Rückholung aus der Ablage
  // (Entscheidung K10, actions/revive.ts) kann derselbe Telefon-Lead zwei
  // Termine tragen — den terminalen ersten Anlauf und den zurückgeholten
  // zweiten. Ein `maybeSingle()` ohne Grenze wirft dort einen PostgREST-Fehler
  // und blockierte ausgerechnet das Terminieren eines zurückgeholten Leads;
  // und gemeint ist ohnehin der laufende Anlauf, nicht der abgeschlossene.
  const { data: existingSc } = await supabase
    .from("setting_calls")
    .select("id")
    .eq("source_phone_lead_id", input.phoneLeadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Nur ein NEUER Setting-Eintrag ist der Anruf, der zum Termin geführt hat.
  // Wird ein bestehender Termin nachbearbeitet (Link korrigiert, verschoben),
  // wurde nicht erneut gewählt — ein Log-Eintrag würde dort eine zweite Anwahl
  // mit Outcome 'termin' erfinden und die Terminquote nach oben verzerren.
  const isNewSetting = !existingSc?.id;

  let settingCallId: string | null = existingSc?.id ?? null;
  if (settingCallId) {
    await supabase
      .from("setting_calls")
      .update({
        meet_link: meetLink,
        phone,
        meeting_kind: meetingKind,
        appointment_at: appointmentAt,
      })
      .eq("id", settingCallId);
  } else {
    // Zustaendig ist, wer bucht (`assignedUserForBooking`). Fuer den Rueckfall
    // auf den Listen-Owner zaehlt die Liste, in der der LEAD wirklich liegt:
    // Leads wandern bei Rueckruf/Nicht-erreicht physisch in eine
    // Routing-Liste — nicht die mitgeschickte listId.
    const assignedUserId = await assignedUserForBooking(
      access,
      "phone_lists",
      (lead as { list_id: string }).list_id,
    );
    const { data: sc, error: scErr } = await supabase
      .from("setting_calls")
      .insert({
        workspace_id: access.workspace_id,
        created_by_user_id: access.user.id,
        assigned_user_id: assignedUserId,
        source_type: "telefon",
        source_phone_lead_id: lead.id,
        lead_name: (lead as { decider_name?: string | null }).decider_name ?? null,
        company: (lead as { company?: string | null }).company ?? null,
        meet_link: meetLink,
        phone,
        meeting_kind: meetingKind,
        appointment_at: appointmentAt,
        status: "offen",
      })
      .select("id")
      .single();
    if (scErr || !sc) return { error: scErr?.message ?? "Setting-Eintrag fehlgeschlagen." };
    settingCallId = sc.id;
  }

  const { error: upErr } = await supabase
    .from("phone_leads")
    .update({ status: "termin", appointment_set: true, appointment_at: appointmentAt, meet_link: meetLink })
    .eq("id", input.phoneLeadId);
  if (upErr) return { error: upErr.message };

  // Zweiter Schreibpfad des Anruf-Logs (Migration 0028): Der Termin-Button im
  // Call-Modus läuft hier vorbei, nicht über setPhoneLeadOutcome. Ohne diesen
  // Aufruf fehlte im Log ausgerechnet die Anwahl, die zum Termin führte — und
  // damit der Zähler der Terminquote. Nach dem Lead-Update, weil der Log-
  // Eintrag den Lead-Stand als Snapshot liest; fail-soft, Fehler blockieren den
  // Termin nicht.
  if (isNewSetting) {
    await logCallAttempt({
      leadId: input.phoneLeadId,
      outcome: "termin",
      // Status VOR der Umwandlung: Ein Termin aus einem vereinbarten Rueckruf
      // gehoert in den Rueckruf-Topf, nicht in den Folgeanruf-Topf.
      statusBefore: (lead as { status?: string | null }).status ?? null,
    });
  }

  revalidatePath(`/telefon/${input.listId}`, "page");
  revalidatePath("/telefon", "page");
  revalidatePath("/termine", "page");
  revalidatePath("/", "layout");
  return { settingCallId: settingCallId ?? undefined };
}

/**
 * Termin zurücknehmen: appointment_set/appointment_at/meet_link zurücksetzen.
 * Der verknüpfte Setting-Eintrag bleibt erhalten (bewusst — er kann schon
 * bearbeitet worden sein); nur die Kontakt-Markierung wird gelöst.
 */
export async function clearContactAppointment(input: {
  contactId: string;
  listId: string;
}): Promise<{ error?: string }> {
  if (!(await canAccessPitchList(input.listId))) {
    return { error: "Keine Berechtigung." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ appointment_set: false, appointment_at: null, meet_link: null })
    .eq("id", input.contactId)
    .eq("list_id", input.listId);
  if (error) return { error: error.message };
  return {};
}
