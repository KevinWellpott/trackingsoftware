"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { berlinInputToIso } from "@/lib/apptTime";
import { generateSettingCascade } from "@/app/actions/reminders";
import { SELECTABLE_CHANNELS } from "@/lib/channels";
import { reviveBlockedReason, type DropoutAppointmentEntity } from "@/lib/dropoutLists";

// „Zurückholen" aus der Ablage (Entscheidung K10).
//
// ── Warum ein NEUER Vorgang und kein zurückgedrehter alter ──────────────────
// Ein von „verloren" auf „offen" gedrehtes Closing veränderte rückwirkend die
// Abschlussquote eines bereits abgeschlossenen Zeitraums — genau das, was
// docs/data-model.md §5 verbietet („eine Zahl, die davon abhängt, wann man sie
// liest, zerstört das Vertrauen in alle anderen"). Die terminale Zeile bleibt
// deshalb terminal und bekommt nur `revived_at`; der zweite Anlauf ist immer
// ein NEUER `setting_calls`-Eintrag, der über `revived_from_setting_call_id`
// bzw. `revived_from_closing_call_id` auf seinen Vorgänger zeigt (Migration
// 0032, CHECK erlaubt höchstens einen der beiden).
//
// Der zweite Anlauf beginnt immer beim ERSTGESPRÄCH, auch wenn der Vorgänger
// ein Closing war: Ein Lead, der Monate später zurückkommt, ist nicht mehr
// qualifiziert — Budget, Bedarf und Entscheider sind neu zu prüfen. Ein direkt
// angelegtes Closing übersprünge genau die Stufe, an der das passiert.
//
// Die Datei liegt neben appointments.ts und nicht in dropout.ts: Sie legt einen
// Termin an, prüft dieselben Kontaktweg-Regeln und startet dieselbe Kaskade —
// eine Anlagestrecke, kein Ablage-Lesevorgang.

const TABLE_BY_ENTITY: Record<DropoutAppointmentEntity, string> = {
  setting: "setting_calls",
  closing: "closing_calls",
};

function isAppointmentEntity(value: unknown): value is DropoutAppointmentEntity {
  return value === "setting" || value === "closing";
}

const SELECTABLE_SOURCE_KEYS = new Set<string>(SELECTABLE_CHANNELS.map((c) => c.key));

/**
 * Die Herkunft des Vorgängers, aber nur, wenn sie heute noch vergeben wird.
 *
 * Die Altwerte ('manuell', 'inbound', 'website') stehen weiter im CHECK der
 * Tabelle — sonst ließe sich kein alter Termin mehr bearbeiten —, dürfen aber
 * NEU nicht mehr entstehen. Eine Rückholung legt eine neue Zeile an; ungefiltert
 * geerbt wüchse damit genau die Restkategorie weiter, die aus dem Funnel
 * verschwinden soll. `null` ist der ehrlichere Wert: Die Spalte darf leer sein,
 * und „Sonstige" zu raten erfände eine Herkunft, die niemand erfasst hat.
 *
 * Dieselbe Regel wie `normalizeSource` in actions/appointments.ts; beide lesen
 * die Kanal-Registry als einzige Quelle, statt die Schlüssel abzuschreiben.
 * Eine gemeinsame Funktion geht nicht: Eine „use server"-Datei darf nur
 * asynchrone Funktionen exportieren.
 */
function inheritableSource(value: string | null | undefined): string | null {
  return value && SELECTABLE_SOURCE_KEYS.has(value) ? value : null;
}

/** Termin-Art des neuen Anlaufs; `null`/fehlend = die des Vorgängers übernehmen. */
export type ReviveMeetingKind = "link" | "telefon" | null;

export type ReviveInput = {
  /** Berlin-Wandzeit ("2026-09-20T10:00") oder bereits ISO-UTC. */
  appointmentAt: string;
  meetingKind?: ReviveMeetingKind;
  /** Leer = den Link des Vorgängers übernehmen. */
  meetLink?: string | null;
  /** Leer = die Rufnummer des Vorgängers übernehmen. */
  phone?: string | null;
};

/** Was der neue Termin vom Vorgänger erbt. */
type Inherited = {
  lead_name: string | null;
  company: string | null;
  source_type: string | null;
  source_detail: string | null;
  source_contact_id: string | null;
  source_phone_lead_id: string | null;
  meeting_kind: string | null;
  meet_link: string | null;
  phone: string | null;
  assigned_user_id: string | null;
  revived_at: string | null;
  recycle_excluded_at: string | null;
  /** Nur fuer den Rollback mitgelesen — das Claim-Statement nullt beide. */
  next_recycle_at: string | null;
  recycle_reason_code: string | null;
};

const SETTING_COLUMNS =
  "id, lead_name, company, source_type, source_detail, source_contact_id, source_phone_lead_id, " +
  "meeting_kind, meet_link, phone, assigned_user_id, revived_at, recycle_excluded_at, " +
  "next_recycle_at, recycle_reason_code";

const CLOSING_COLUMNS =
  "id, lead_name, company, meet_link, setting_call_id, assigned_user_id, revived_at, " +
  "recycle_excluded_at, next_recycle_at, recycle_reason_code";

/**
 * Einen terminalen Vorgang zurückholen: neues Erstgespräch anlegen, alte Zeile
 * als zurückgeholt markieren.
 *
 * ÜBERNOMMEN wird nur, was den Lead beschreibt: Name, Firma, Herkunft
 * (`source_type`/`source_detail` und die Verweise auf Quellkontakt bzw.
 * Telefon-Lead), die zuständige Person und der Kontaktweg. Der Kanal läuft dabei
 * durch `inheritableSource()`: Ein Altwert wird nicht weitergereicht, sonst
 * entstünde beim Zurückholen eine NEUE Zeile mit einem Wert, den kein Formular
 * mehr vergibt. Der Freitext daneben bleibt — er trägt den echten Ursprung.
 *
 * BEWUSST NICHT übernommen:
 *  · `reschedule_count` und `no_show_count` — der neue Anlauf startet bei 0
 *    (Entscheidung E9, „frischer Anlauf"). Damit ist die Obergrenze aus E6
 *    theoretisch umgehbar; sichtbar wird das über die Zähler der
 *    Vorgängerzeile, die die Ablage-Karte danebenstellt (K10/§5.3).
 *  · Qualifizierung, Skript-Antworten, Notizen, Einwände — sie beschreiben ein
 *    Gespräch, das stattgefunden hat, und gehören zur alten Zeile. Ein zweiter
 *    Anlauf, der mit „Budget ja, Pain 8" vorbelegt startet, behauptet Wissen
 *    von vor Monaten als aktuellen Stand.
 *  · `wa_phone`/`wa_consent_at` — eine dokumentierte Einwilligung ist ein
 *    Nachweis mit Zeitpunkt, keine Eigenschaft, die man kopiert. Ohne sie
 *    fällt die Kaskade des neuen Termins auf den Akquise-Kanal zurück
 *    (`resolveCascadeChannel`), statt eine Einwilligung zu behaupten.
 *  · Der Zustand der QUELLE (`contacts.setting_call_id`, `appointment_set`,
 *    `phone_leads.status`) — ein Umbiegen dorthin schriebe die Vergangenheit
 *    um: `contacts.setting_call_id` trägt die Umsatz-je-Liste-Auswertung, und
 *    ein `phone_leads.status` von 'dead' auf 'termin' änderte rückwirkend die
 *    Telefon-Kennzahlen eines abgeschlossenen Zeitraums.
 */
export async function reviveDropout(
  entity: string,
  entityId: string,
  input: ReviveInput,
): Promise<{ error?: string; settingCallId?: string }> {
  const access = await getAccessContext();
  if (!access) return { error: "Nicht angemeldet." };
  if (!isAppointmentEntity(entity)) {
    // Wortgleich zum ersten Riegel in `reviveBlockedReason` — dieselbe Ursache
    // darf nicht zwei Sätze haben, nur weil sie einmal am Knopf und einmal in
    // der Action auffällt.
    return { error: "Nur für Termine lässt sich ein neuer ansetzen — ein Lead bekommt seinen Termin aus seiner Liste heraus." };
  }

  // Berlin-Wandzeit aus dem Formular; die Spalte will echtes UTC (docs §6).
  const appointmentAt = input.appointmentAt.endsWith("Z")
    ? input.appointmentAt
    : berlinInputToIso(input.appointmentAt);
  if (!appointmentAt) return { error: "Bitte einen Termin für den neuen Anlauf angeben." };

  const supabase = await createClient();
  const table = TABLE_BY_ENTITY[entity];

  // Immer mit `workspace_id`: Für einen Plattform-Admin lässt RLS jede Zeile
  // durch, maßgeblich ist die aktive Organisation (Muster canAccessAppointment).
  const { data: rawRow, error: readError } = await supabase
    .from(table)
    .select(entity === "setting" ? SETTING_COLUMNS : CLOSING_COLUMNS)
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  if (readError) return { error: readError.message };
  const row = rawRow as unknown as (Partial<Inherited> & { setting_call_id?: string | null }) | null;
  if (!row) return { error: "Nicht gefunden." };

  const blocked = reviveBlockedReason({
    entity,
    revived: Boolean(row.revived_at),
    excluded: Boolean(row.recycle_excluded_at),
  });
  if (blocked) return { error: blocked };

  // Ein Closing kennt weder Herkunft noch Termin-Art — beides steht an seinem
  // Erstgespräch. Fehlt der Bezug ganz („Ohne Setting-Bezug", docs §5.1), bleibt
  // die Herkunft leer statt geraten zu werden.
  let parent: Partial<Inherited> | null = null;
  if (entity === "closing" && row.setting_call_id) {
    const { data } = await supabase
      .from("setting_calls")
      .select(SETTING_COLUMNS)
      .eq("id", row.setting_call_id)
      .eq("workspace_id", access.workspace_id)
      .maybeSingle();
    parent = (data as unknown as Partial<Inherited> | null) ?? null;
  }

  // Der Kontaktweg des Vorgängers: beim Closing zählt sein eigener Meet-Raum
  // vor dem des Erstgesprächs — er ist der jüngere.
  const inheritedLink = row.meet_link ?? parent?.meet_link ?? null;
  const inheritedPhone = row.phone ?? parent?.phone ?? null;
  const inheritedKind = row.meeting_kind ?? parent?.meeting_kind ?? null;

  const kind = input.meetingKind ?? inheritedKind;
  if (kind !== "link" && kind !== "telefon") {
    return { error: "Bitte die Termin-Art wählen — der Vorgänger hat keine hinterlegt." };
  }
  const meetLink = kind === "link" ? input.meetLink?.trim() || inheritedLink : null;
  const phone = kind === "telefon" ? input.phone?.trim() || inheritedPhone : null;
  if (kind === "link" && !meetLink) {
    return { error: "Termin-Link fehlt — der Vorgänger hat keinen, bitte eintragen." };
  }
  if (kind === "telefon" && !phone) {
    return { error: "Rufnummer fehlt — der Vorgänger hat keine, bitte eintragen." };
  }

  // Die Markierung der alten Zeile ist zugleich die SPERRE gegen ein zweites
  // Zurückholen: `.is('revived_at', null)` macht aus dem Update ein Claim, das
  // ein zweiter, gleichzeitiger Klick nicht mehr gewinnt. Ohne das entstünden
  // zwei Nachfolger für eine Vorgängerzeile.
  //
  // `next_recycle_at` und `recycle_reason_code` fallen im SELBEN Statement —
  // bewusst nicht über `clearRecycle()`: Zwischen zwei Requests stünde die
  // Zeile sonst als „zurückgeholt UND zur Wiedervorlage eingeplant" da, und
  // genau das schließt die Invariante aus dem Zielplan aus. Dieselbe Begründung
  // wie beim Disqualifizierungsgrund in `setSettingOutcome` (ein UPDATE, kein
  // Zwischenstand).
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from(table)
    .update({ revived_at: nowIso, next_recycle_at: null, recycle_reason_code: null })
    .eq("id", entityId)
    .eq("workspace_id", access.workspace_id)
    .is("revived_at", null)
    .select("id");
  if (claimError) return { error: claimError.message };
  if (!claimed || claimed.length === 0) {
    // „Inzwischen" steht bewusst davor: Beim Öffnen des Dialogs war der Knopf
    // noch da, jemand anders war schneller. Der Kartensatz nennt denselben
    // Zustand ohne dieses Wort, und genau der Unterschied ist die Auskunft.
    return { error: "Inzwischen steht der neue Termin bereits." };
  }

  const { data: created, error: insertError } = await supabase
    .from("setting_calls")
    .insert({
      // `workspace_id` immer explizit: Der BEFORE-INSERT-Trigger leitete es
      // sonst aus der Mitgliedschaft ab — für einen Plattform-Admin in einer
      // Kunden-Organisation die falsche Organisation (docs §2).
      workspace_id: access.workspace_id,
      created_by_user_id: access.user.id,
      // Zuständig bleibt, wer den Vorgang hatte. Fehlt die Zuweisung, greift
      // dieselbe Regel wie in `createClosingFromSetting`: der Anlegende — außer
      // in fremder Organisation, wo er kein Mitglied ist und eine Zuweisung
      // über die Org-Grenze zeigte.
      assigned_user_id:
        row.assigned_user_id ?? parent?.assigned_user_id ?? (access.is_foreign_org ? null : access.user.id),
      source_type: inheritableSource(row.source_type ?? parent?.source_type),
      source_detail: row.source_detail ?? parent?.source_detail ?? null,
      source_contact_id: row.source_contact_id ?? parent?.source_contact_id ?? null,
      source_phone_lead_id: row.source_phone_lead_id ?? parent?.source_phone_lead_id ?? null,
      lead_name: row.lead_name ?? parent?.lead_name ?? null,
      company: row.company ?? parent?.company ?? null,
      meet_link: meetLink,
      phone,
      meeting_kind: kind,
      appointment_at: appointmentAt,
      status: "offen",
      [entity === "setting" ? "revived_from_setting_call_id" : "revived_from_closing_call_id"]: entityId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    // Die Markierung zurücknehmen, sonst bliebe die alte Zeile als
    // „zurückgeholt" stehen, ohne dass es einen Nachfolger gibt — und ein
    // zweiter Versuch wäre für immer gesperrt. Best effort: schlägt auch das
    // fehl, ist die Meldung des Inserts die wichtigere.
    //
    // Zurückgeschrieben werden ALLE DREI Felder des Claims. `revived_at` allein
    // genügte nicht: `next_recycle_at` bliebe genullt, und der Zweig in
    // `recycle_tasks` verlangt `next_recycle_at <= p_today` — NULL erfüllt das
    // nie. Der Vorgang stünde danach wieder in der Ablage, wäre aber lautlos aus
    // jeder Wiedervorlage verschwunden, obwohl der Nutzer nur eine
    // Fehlermeldung bekommen hat. Die Reihenfolge stimmt automatisch, weil
    // beides in EINEM Statement zurückgeht: „zurückgeholt UND eingeplant" kann
    // dabei nicht entstehen.
    await supabase
      .from(table)
      .update({
        revived_at: null,
        next_recycle_at: row.next_recycle_at ?? null,
        recycle_reason_code: row.recycle_reason_code ?? null,
      })
      .eq("id", entityId)
      .eq("workspace_id", access.workspace_id);
    return { error: insertError?.message ?? "Neuer Termin konnte nicht angelegt werden." };
  }

  // Die Kaskade des neuen Termins entsteht über den vorhandenen Weg — dieselbe
  // Funktion, die auch `createManualSetting` und `convertContactToSetting`
  // aufrufen. Fail-soft: eine ausgefallene Erinnerungs-Planung darf den Termin
  // nicht zurückrollen.
  await generateSettingCascade(created.id);

  revalidatePath("/ablage", "page");
  revalidatePath("/termine", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/erinnerungen", "page");
  revalidatePath("/", "layout");
  return { settingCallId: created.id };
}
