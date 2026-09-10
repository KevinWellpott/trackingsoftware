"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { CANCELLED_MOVE_HINT } from "@/lib/terminMeta";
import { CLOSING_LOST_REASON_CODES, type ClosingLostReasonCode } from "@/lib/types";
import {
  createNoShowTouch,
  deleteTouchesForEntity,
  generateClosingCascade,
  generateFollowUpCascade,
  generateKeinCloseChain,
  supersedeTouches,
} from "@/app/actions/reminders";
import { scheduleRecycle } from "@/app/actions/recycle";
import { revalidatePath } from "next/cache";

// Closing-Call bearbeiten. Terminal: gewonnen (→ CRM), verloren, nachfassen.
//
// Wie viel `supersedeTouches` dabei mitnimmt, hängt am ANLASS — und zwar in
// genau zwei Abstufungen:
//
//  · Eine reine ÄNDERUNG am Termin (Kalender-Drag, neues `call_at`) grenzt nach
//    Kaskaden-Art ein: 'closing_msg' ist die geplante Bestätigungs-Kaskade und
//    wird gegen den neuen Zeitpunkt neu gerechnet. Alles andere am selben
//    Closing beschreibt Geschehenes und bleibt stehen.
//  · Ein ERGEBNIS entwertet dagegen ALLES, was an diesem Termin hängt — ohne
//    Kaskadenliste, wie `setSettingOutcome` und `cancelAppointment` es tun.
//    Eine Aufzählung müsste bei jeder neuen Kaskaden-Art nachgezogen werden,
//    und das Vergessen fiele niemandem auf; genau das war hier passiert (siehe
//    `setClosingOutcome`).
//
// Die eine Ausnahme vom Ergebnis-Fall ist die reine KORREKTUR eines
// Verlustgrunds: Sie ist kein neues Ereignis, ändert am Schicksal des Termins
// nichts — und darf deshalb auch keine laufende Kette abräumen.

export type ClosingCallPatch = {
  call_at?: string | null;
  meet_link?: string | null;
  show_status?: "show" | "no_show" | null;
  closed?: boolean | null;
  deal_volume?: number | null;
  payment_type?: string | null;
  signature_received?: boolean | null;
  contract_start?: string | null;
  /**
   * Tag des Software-Onboardings (date, Migration 0032). Steht bewusst neben
   * `contract_start` statt darin aufzugehen: Der Vertrag beginnt an dem Tag, an
   * dem gezahlt wird, das Onboarding an dem, an dem gearbeitet wird — die beiden
   * fallen regelmäßig auseinander. Bleibt leer, solange kein Termin steht.
   */
  onboarding_at?: string | null;
  lost_reason?: string | null;
  /** Zählbarer Verlustgrund (Migration 0029) — die Statistik hängt daran. */
  lost_reason_code?: ClosingLostReasonCode | null;
  follow_up_due?: string | null;
  /** Präziser Nachfass-Zeitpunkt (Migration 0031) — Basis der Erinnerungs-Kaskade. */
  follow_up_due_at?: string | null;
  /**
   * Wiedervorlage des Recyclings. Gesetzt wird sie ausschließlich von
   * `schedule_recycle()`; schreibbar ist sie hier nur, um sie beim Eintragen
   * eines Verlustgrunds ZURÜCKZUNEHMEN — siehe `setClosingOutcome`.
   */
  next_recycle_at?: string | null;
  recording_link?: string | null;
  objections_handled?: string | null;
  objections_open?: string | null;
  script_answers?: Record<string, string>;
  status?: "offen" | "gewonnen" | "verloren" | "nachfassen";
  notes?: string | null;
  lead_name?: string | null;
  company?: string | null;
};

/**
 * Hält `follow_up_due` (date) synchron zu `follow_up_due_at` (timestamptz).
 *
 * `nachfassen_tasks` liest weiter unverändert `follow_up_due` — diese eine
 * Stelle ist der einzige Ort, an dem beide Felder je nach demselben Wert
 * gesetzt werden, damit sie nie auseinanderlaufen können. Nur aktiv, wenn
 * `follow_up_due_at` im Patch tatsächlich vorkommt (nicht `undefined`) —
 * ein Patch, der nur andere Felder ändert, rührt das Datum nicht an.
 */
function withFollowUpDateSynced(patch: ClosingCallPatch): ClosingCallPatch {
  if (!("follow_up_due_at" in patch)) return patch;
  return {
    ...patch,
    follow_up_due: patch.follow_up_due_at ? berlinDateISO(patch.follow_up_due_at) : null,
  };
}

/**
 * Der CHECK aus 0032 bindet `no_show_resolution` an `show_status='no_show'`.
 * Wandert der Show-Status auf etwas anderes — oder zurück auf NULL —, muss der
 * Ausgang mitgehen, sonst weist Postgres das ganze UPDATE ab: der Nutzer sähe
 * eine Constraint-Meldung, wo er nur den No-Show-Schalter umgelegt hat.
 *
 * Bewusst als zweite kurze Kopie neben derselben Funktion in settingCalls.ts —
 * ein `"use server"`-Modul darf nur async Funktionen exportieren, ein geteilter
 * Helfer bräuchte also eine dritte Datei für vier Zeilen.
 */
function withNoShowResolutionCleared(patch: ClosingCallPatch): ClosingCallPatch & { no_show_resolution?: null } {
  if (!("show_status" in patch) || patch.show_status === "no_show") return patch;
  return { ...patch, no_show_resolution: null };
}

// Nicht nur "RLS hat die Zeile durchgelassen": fuer einen Plattform-Admin
// laesst RLS jede Zeile durch. Die aktive Organisation entscheidet.
async function canAccessClosingCall(id: string): Promise<boolean> {
  const access = await getAccessContext();
  if (!access) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("closing_calls")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", access.workspace_id)
    .maybeSingle();
  return Boolean(data);
}

export async function updateClosingCall(id: string, rawPatch: ClosingCallPatch): Promise<{ error?: string }> {
  if (!(await canAccessClosingCall(id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();

  // Vorherigen show_status lesen, BEVOR geschrieben wird — nur ein echter
  // Übergang zu 'no_show' (nicht schon vorher 'no_show') löst den Sofort-
  // Touch aus. Dasselbe Vorher-Lesen-Muster wie in setClosingOutcome.
  const patch = withFollowUpDateSynced(rawPatch);
  const appointmentChanged = "call_at" in patch;
  const showStatusChanging = "show_status" in patch;
  let previousShowStatus: "show" | "no_show" | null = null;
  if (showStatusChanging || appointmentChanged) {
    const { data: current } = await supabase
      .from("closing_calls")
      .select("show_status, cancelled_at")
      .eq("id", id)
      .maybeSingle();
    const before = current as { show_status: "show" | "no_show" | null; cancelled_at: string | null } | null;
    previousShowStatus = before?.show_status ?? null;
    // Ein abgesagtes Closing bekommt keinen neuen Termin — wortgleich zu
    // `postponeAppointment` und `moveSettingAppointment`. Ohne den Riegel trüge
    // die Zeile `cancelled_at` UND ein neues Datum, und `generateClosingCascade`
    // steigt wegen `cancelled_at` aus: ein Termin garantiert ohne Erinnerung.
    // Der Kalender-Drag landet hier, weil es kein `moveClosingAppointment` gibt.
    if (appointmentChanged && before?.cancelled_at) return { error: CANCELLED_MOVE_HINT };
  }

  const { error } = await supabase.from("closing_calls").update(withNoShowResolutionCleared(patch)).eq("id", id);
  if (error) return { error: error.message };

  // Zwei Anlässe, EIN Regenerator — Muster `updateSettingCall`:
  //
  //  · Termin geändert (Kalender-Drag oder das Feld in den Call-Details).
  //  · „Ergebnis zurücksetzen" (handleReset im Closing-Editor) dreht den Status
  //    auf 'offen'. Der Termin steht damit wieder an, seine Bestätigungs-
  //    Kaskade wurde beim Ergebnis aber entwertet. Ohne diesen Zweig bliebe das
  //    Closing dauerhaft ohne Erinnerung — und das Kaskaden-Panel begründete
  //    das mit „eine spätere Änderung am Termin hat diese Stufe abgeräumt",
  //    einem Ereignis, das es nie gab. `handleReset` schickt bewusst kein
  //    `call_at` mit (der Termin ist Arbeit, kein Ergebnis), der alte Zweig
  //    hing aber ausschließlich daran.
  const resultCleared = "status" in patch && patch.status === "offen";
  if (appointmentChanged || resultCleared) {
    // Beim Zurücksetzen zusätzlich die Bedingung „steht noch bevor": Für einen
    // vergangenen Termin findet `planScheduledCascade` keine passende Stufe
    // mehr und legt EINEN sofort fälligen Touch an. Beim Verschieben ist genau
    // der gewollt (kurzfristiger Termin), hier wäre er eine Terminbestätigung
    // für ein Gespräch, das längst gelaufen ist.
    if (appointmentChanged || (await closingAppointmentAhead(id))) {
      await generateClosingCascade(id);
    }
  }
  // Nachfass-Zeitpunkt geändert (unabhängig vom Ergebnis-Dialog, z. B. beim
  // Nachpflegen eines bestehenden Nachfassen-Closings).
  if ("follow_up_due_at" in patch) {
    await supersedeTouches("closing_followup", id);
    if (patch.follow_up_due_at) await generateFollowUpCascade(id);
  }
  // Der No-Show-Toggle im Closing-Editor läuft über genau diesen Pfad
  // (handleShowStatus → save({ show_status })), nicht über setClosingOutcome
  // — closing_calls kennt kein eigenes No-Show-Outcome, nur den Schalter.
  if (showStatusChanging && patch.show_status === "no_show" && previousShowStatus !== "no_show") {
    await createNoShowTouch("closing", id);
  } else if (showStatusChanging && patch.show_status !== "no_show" && previousShowStatus === "no_show") {
    // Der Weg ZURÜCK muss die Kette abräumen, die der Weg HIN angelegt hat.
    // Sonst liegt in /erinnerungen weiter der Text „wir waren gerade verabredet
    // — ist etwas dazwischengekommen?" für einen Lead, der erschienen ist; die
    // Karte ist eine Kopier-Werkbank, der Satz ginge real raus.
    await supersedeTouches("closing", id, ["no_show_closing"]);
  }
  // Zurückgesetztes Ergebnis heißt zusätzlich: Der Verlust ist zurückgenommen —
  // die „kein Abschluss"-Kette beschreibt ein Ereignis, das es nicht mehr gibt.
  if (resultCleared) {
    await supersedeTouches("closing", id, ["kein_close"]);
  }

  revalidatePath(`/closing/${id}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Steht der Closing-Termin noch bevor?
 *
 * Wortgleiches Gegenstück zu `settingAppointmentAhead` (settingCalls.ts) — nur
 * heißt die Zeitspalte hier `call_at`. Die Frage stellt sich ausschließlich beim
 * zurückgenommenen Ergebnis: Ein abgesagtes oder längst vergangenes Gespräch
 * bekommt keine Bestätigungs-Kaskade mehr, sonst entstünde ein sofort fälliger
 * Touch für einen Termin, der schon stattgefunden hat. Gelesen wird NACH dem
 * UPDATE — im selben Aufruf kann der Termin mitgeändert worden sein.
 */
async function closingAppointmentAhead(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("closing_calls")
    .select("call_at, cancelled_at")
    .eq("id", id)
    .maybeSingle();
  const row = data as { call_at: string | null; cancelled_at: string | null } | null;
  if (!row?.call_at || row.cancelled_at) return false;
  return Date.parse(row.call_at) > Date.now();
}

/**
 * Prüft einen Verlustgrund-Code gegen die Liste aus Migration 0029.
 *
 * Server Actions sind per direktem POST erreichbar — ohne diese Prüfung ginge
 * ein beliebiger String an die Datenbank und liefe dort in den CHECK; der
 * Nutzer sähe eine rohe Postgres-Meldung statt einer Ansage, und ein Tippfehler
 * im Client würde eine neue Kategorie in die Statistik schmuggeln.
 */
function isLostReasonCode(v: unknown): v is ClosingLostReasonCode {
  return typeof v === "string" && (CLOSING_LOST_REASON_CODES as readonly string[]).includes(v);
}

/**
 * Terminal-Ergebnis setzen. gewonnen → closed=true (+ Deal-Daten), erscheint im CRM;
 * verloren → closed=false + lost_reason_code (Pflicht) + optionaler Freitext;
 * nachfassen → follow_up_due Pflicht.
 */
export async function setClosingOutcome(input: {
  closingId: string;
  outcome: "gewonnen" | "verloren" | "nachfassen";
  dealVolume?: number | null;
  paymentType?: string | null;
  contractStart?: string | null;
  /** Tag des Software-Onboardings — optional, auch bei einem gewonnenen Deal. */
  onboardingAt?: string | null;
  signatureReceived?: boolean | null;
  /** Freitext zum Verlust — Kontext, seit 0029 NICHT mehr erzwungen. */
  lostReason?: string | null;
  /** Zählbarer Verlustgrund. Pflicht bei `outcome = 'verloren'`. */
  lostReasonCode?: ClosingLostReasonCode | null;
  followUpDue?: string | null;
  /**
   * Präziser Nachfass-Zeitpunkt (ISO, Migration 0031) — Basis der
   * Erinnerungs-Kaskade für den vereinbarten Nachfass-Kontakt. Wird
   * mitgegeben, überschreibt er `followUpDue` (das reine Datum leitet sich
   * daraus ab, siehe `withFollowUpDateSynced`).
   */
  followUpDueAt?: string | null;
}): Promise<{ error?: string }> {
  // Berechtigung IMMER als erste Anweisung — vor jeder Validierung, sonst
  // verrieten die Fehlermeldungen einem Fremden etwas über die Zeile.
  if (!(await canAccessClosingCall(input.closingId))) return { error: "Keine Berechtigung." };
  // Verlangt wird der PRÄZISE Zeitpunkt, nicht irgendeine der beiden Angaben:
  // `withFollowUpDateSynced` leitet `follow_up_due` unmittelbar aus
  // `follow_up_due_at` ab. Kommt nur das reine Datum an, überschreibt die
  // Synchronisierung es einen Schritt später mit NULL — das Closing stünde dann
  // auf „Nachfassen" ganz ohne Fälligkeit und wäre in /nachfassen unsichtbar,
  // obwohl der Dialog nach einem Datum gefragt hat. Die Oberfläche schickt den
  // Zeitpunkt längst; die Lücke stand nur für den direkten POST offen.
  if (input.outcome === "nachfassen" && !input.followUpDueAt) {
    return { error: "Für „Nachfassen“ ist ein Wiedervorlage-Zeitpunkt erforderlich." };
  }
  // Validiert wird jetzt der CODE, nicht mehr der Freitext: gezählt werden kann
  // nur der Code, und ein erzwungener Freitext hat die Auswertung jahrelang mit
  // Einzelfällen gefüllt (jede Zeile Häufigkeit 1).
  let lostReasonCode: ClosingLostReasonCode | null = null;
  if (input.outcome === "verloren") {
    if (!isLostReasonCode(input.lostReasonCode)) {
      return { error: "Bitte einen Verlustgrund auswählen." };
    }
    lostReasonCode = input.lostReasonCode;
  }

  const supabase = await createClient();

  // Den Stand VOR dem Schreiben lesen — dasselbe Muster wie in
  // `cancelAppointment` und `updateClosingCall`. Drei Entscheidungen hängen
  // daran, und alle drei wären nach dem UPDATE nicht mehr zu treffen: der
  // abgeleitete Show-Status, die Frage „neuer Verlust oder nur Grund-Korrektur"
  // und die, ob überhaupt schon eine Wiedervorlage geplant ist.
  const { data: currentRaw } = await supabase
    .from("closing_calls")
    .select("show_status, status, next_recycle_at")
    .eq("id", input.closingId)
    .maybeSingle();
  const before = currentRaw as {
    show_status: string | null;
    status: string | null;
    next_recycle_at: string | null;
  } | null;

  // Der Verlustgrund ist ausdrücklich nachträglich änderbar („Auch nachträglich
  // änderbar" steht im Dialog). Ein zweiter Durchlauf auf einer bereits
  // verlorenen Zeile ist damit eine KORREKTUR und kein neues Ereignis — genau
  // die Unterscheidung, die `cancelAppointment` über `wasCancelled` trifft.
  const correctingLoss = input.outcome === "verloren" && before?.status === "verloren";
  // Die beiden Gründe, die laut CHECK aus 0033 nie ein Recycling-Datum tragen
  // dürfen: der eine Lead hätte nie in den Funnel gehört, beim anderen hat das
  // Gespräch gezeigt, dass es nicht passt.
  const neverRecycled = lostReasonCode === "falsche_zielgruppe" || lostReasonCode === "kein_fit";

  const patch: ClosingCallPatch = { status: input.outcome };
  if (input.outcome === "gewonnen") {
    patch.closed = true;
    patch.deal_volume = input.dealVolume ?? null;
    patch.payment_type = input.paymentType ?? null;
    patch.contract_start = input.contractStart ?? null;
    // Ohne Angabe bewusst NULL statt eines geratenen Datums: „Onboarding steht
    // noch nicht" ist eine gültige Aussage, ein erfundener Tag wäre eine falsche.
    patch.onboarding_at = input.onboardingAt ?? null;
    patch.signature_received = input.signatureReceived ?? null;
    patch.follow_up_due = null;
    patch.follow_up_due_at = null;
  } else if (input.outcome === "verloren") {
    patch.closed = false;
    patch.lost_reason_code = lostReasonCode;
    // Leerer Freitext wird zu NULL statt zu "" — sonst steht in der Detailseite
    // eine leere Kontextzeile, die wie eine Angabe aussieht.
    patch.lost_reason = input.lostReason?.trim() || null;
    patch.follow_up_due = null;
    patch.follow_up_due_at = null;
    // Eine bereits geplante Wiedervorlage wird abgeräumt, wenn der neue Grund
    // keine bekommen darf: Ohne dieses Nullen scheiterte genau der Wechsel von
    // „Timing" auf „Kein Fit" am CHECK aus 0033, und der Nutzer bekäme eine rohe
    // Postgres-Meldung, obwohl er nur einen Grund umgestellt hat. Beim ERSTEN
    // Verlust ist das Nullen folgenlos — `schedule_recycle()` rechnet unmittelbar
    // danach neu.
    //
    // Was hier bewusst NICHT mehr passiert: bei einer reinen Grund-Korrektur ein
    // bestehendes Datum wegzuwerfen. Es stammt vom Tag des Verlusts; heute neu
    // gerechnet schöbe eine Korrektur den Lead stillschweigend um genau die
    // Zeit nach hinten, die seit dem Verlust vergangen ist.
    if (neverRecycled || !correctingLoss) patch.next_recycle_at = null;
  } else {
    patch.follow_up_due = input.followUpDue ?? null;
    patch.follow_up_due_at = input.followUpDueAt ?? null;
  }

  // Show-Status ableiten statt auf Erfassungsdisziplin zu hoffen: Ein Ergebnis
  // (gewonnen/verloren/nachfassen) kann es nur geben, wenn das Gespräch
  // stattgefunden hat. Ohne diese Ableitung blieb show_status meist NULL und
  // die Closing-Show-Quote maß, wer das Häkchen gesetzt hat — es gab gewonnene
  // Deals ohne Show. (Dasselbe Muster wie in setSettingOutcome.)
  //
  // Nur schreiben, wenn bisher NICHTS erfasst ist: ein bewusst gesetztes
  // 'no_show' gehört dem Nutzer und darf hier nicht überschrieben werden.
  if (before?.show_status == null) {
    patch.show_status = "show";
  }

  const { error } = await supabase
    .from("closing_calls")
    .update(withNoShowResolutionCleared(withFollowUpDateSynced(patch)))
    .eq("id", input.closingId);
  if (error) return { error: error.message };

  // Ein Ergebnis entscheidet das Schicksal des Closing-Termins — und damit ist
  // JEDE Erinnerung an diesem Termin obsolet, nicht nur eine bestimmte.
  //
  // Das Kriterium ist bewusst nicht der Outcome: Alle drei beenden den Termin.
  // Auch „Nachfassen" tut das — das Gespräch hat stattgefunden, an seine Stelle
  // tritt der vereinbarte Nachfass-Kontakt, und der hängt am eigenen
  // entity_type 'closing_followup' und bleibt von dieser Zeile unberührt.
  // Maßgeblich ist stattdessen, ob dieser Aufruf überhaupt ein neues EREIGNIS
  // ist (Muster `wasCancelled` in `cancelAppointment`): Eine reine Korrektur des
  // Verlustgrunds an einer bereits verlorenen Zeile ändert am Schicksal des
  // Termins nichts und darf deshalb auch keine laufende „kein Abschluss"-Kette
  // abräumen — deren zweite Stufe gehört zu genau diesem Verlust.
  //
  // Ohne Kaskadenliste, wie in `setSettingOutcome` und `cancelAppointment`. Am
  // entity_type 'closing' hängen die Bestätigungs-Kaskade, ihre (noch
  // abgeschaltete) Mail-Spur, die Kickoff-Nachricht nach der Qualifizierung und
  // die beiden Ereignis-Ketten (No-Show, kein Abschluss). Die frühere
  // Aufzählung nannte von diesen fünf genau zwei — und beide Auslassungen sind
  // real teuer:
  //
  //  · 'no_show_closing': Closing geplatzt, am nächsten Tag unterschreibt der
  //    Lead doch. Die Ergebnis-Knöpfe sind unabhängig vom Show-Status bedienbar,
  //    `show_status` bleibt auf 'no_show' (die Ableitung oben schreibt nur, wenn
  //    vorher NICHTS erfasst war) — Stufe 2 der Kette wird fällig und sagt
  //    „ich habe es gestern und heute nicht erreicht" zu einem Kunden, der
  //    gerade unterschrieben hat.
  //  · 'closing_kickoff': wurde im ganzen Code nie entwertet und stand nach
  //    jedem Ergebnis dauerhaft überfällig — eine Ankündigung für einen längst
  //    gelaufenen Termin. Der häufigere der beiden Fälle.
  //
  // Genau deshalb steht hier keine Liste mehr: Eine Aufzählung müsste bei jeder
  // neuen Kaskaden-Art nachgezogen werden, und das Vergessen fiele niemandem
  // auf — es ginge lautlos eine Nachricht zu viel raus. Die Karte in
  // /erinnerungen ist eine Kopier-Werkbank, der Satz ginge real raus.
  if (!correctingLoss) {
    await supersedeTouches("closing", input.closingId);
  }
  // Der vereinbarte Nachfass-Kontakt hängt am eigenen entity_type und muss
  // deshalb eigens abgeräumt werden. Bei „Nachfassen" wird er anschließend
  // gegen den neuen Zeitpunkt neu aufgebaut, bei gewonnen/verloren gibt es
  // keinen mehr.
  await supersedeTouches("closing_followup", input.closingId);
  if (input.outcome === "nachfassen") {
    await generateFollowUpCascade(input.closingId);
  }
  // Verloren ist kein Ende — der Lead bekommt ein Recycling-Datum, dessen
  // Wartezeit vom Verlustgrund abhängt. 'falsche_zielgruppe' und 'kein_fit'
  // bekommen dort bewusst keins: der eine Lead hätte nie in den Funnel gehört,
  // beim anderen hat das Gespräch gezeigt, dass es nicht passt.
  //
  // Der Code wird NICHT mitgeschickt: `schedule_recycle()` liest ihn aus der
  // Zeile, die einen Satz weiter oben geschrieben wurde. Ein vom Client
  // gelieferter Grund war per direktem POST frei wählbar — und damit jede
  // beliebige Wartezeit.
  //
  // Eingeplant wird nur beim ÜBERGANG in den Verlust — Muster `becomesHopeless`
  // in `cancelAppointment`. Die eine Ausnahme ist der Wechsel WEG von einem
  // Grund ohne Wiedervorlage („Kein Fit" → „Timing"): Dort trägt die Zeile noch
  // kein Datum und bekäme sonst nie eines. `schedule_recycle()` prüft Deckel,
  // Sperre und Status ohnehin selbst und schreibt im Zweifel gar nichts.
  if (input.outcome === "verloren") {
    const needsRecycleDate = !correctingLoss || (!neverRecycled && !before?.next_recycle_at);
    if (needsRecycleDate) await scheduleRecycle("closing", input.closingId);
    // „Kein Abschluss" ist kein Schweigen: erst die Zusammenfassung, dann —
    // falls keine Antwort kommt — das Nachhaken. Anker ist das EREIGNIS, also
    // dieser Moment, nicht der (womöglich Tage zurückliegende) Termin. Fail-soft
    // wie alle Kaskaden-Aufrufe: eine ausgefallene Kette darf ein eingetragenes
    // Ergebnis nicht zurückrollen.
    //
    // Nur beim Übergang: `apply_reminder_touches` entwertet die offenen Stufen
    // dieser Kaskade und legt sie neu an — bei einer Grund-Korrektur stünden
    // damit drei Wochen später die längst erledigten Stufen wieder unerledigt
    // da, und die „Erinnerungs-Disziplin" in /analyse zählte sie erneut.
    if (!correctingLoss) await generateKeinCloseChain(input.closingId);
  }

  revalidatePath(`/closing/${input.closingId}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Closing-Call endgültig löschen.
 *
 * Das verknüpfte Setting wandert dabei zurück auf „Offen" und verliert seine
 * Closing-Markierung — sonst stünde es dauerhaft auf „Closing gelegt", ohne
 * dass es ein Closing gäbe, und der Weg dorthin wäre in der Oberfläche
 * blockiert.
 */
export async function deleteClosingCall(id: string): Promise<{ error?: string }> {
  if (!(await canAccessClosingCall(id))) return { error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: raw } = await supabase
    .from("closing_calls")
    .select("setting_call_id")
    .eq("id", id)
    .maybeSingle();
  const settingId = (raw as { setting_call_id: string | null } | null)?.setting_call_id ?? null;

  const { error } = await supabase.from("closing_calls").delete().eq("id", id);
  if (error) return { error: error.message };

  await deleteTouchesForEntity("closing", id);
  await deleteTouchesForEntity("closing_followup", id);

  if (settingId) {
    await supabase
      .from("setting_calls")
      .update({ status: "offen", closing_scheduled: false, closing_at: null })
      .eq("id", settingId);
    revalidatePath(`/setting/${settingId}`, "page");
  }

  revalidatePath("/termine", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}
