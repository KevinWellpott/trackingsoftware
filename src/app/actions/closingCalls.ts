"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
import { CANCELLED_MOVE_HINT } from "@/lib/terminMeta";
import { CLOSING_LOST_REASON_CODES, type ClosingLostReasonCode } from "@/lib/types";
import { scheduleRecycle } from "@/app/actions/recycle";
import { revalidatePath } from "next/cache";

// Closing-Call bearbeiten. Terminal: gewonnen (→ CRM), verloren, nachfassen.
//
// ── Was hier mit dem Rückbau WEGGEFALLEN ist ────────────────────────────────
// Jede Änderung an dieser Zeile hat früher zusätzlich Erinnerungs-Touches
// erzeugt und entwertet: die Bestätigungs-Kaskade vor dem Termin, die Kaskade
// vor dem vereinbarten Nachfass-Kontakt, die No-Show- und die „kein
// Abschluss"-Kette. Der ganze Überbau ist gefallen — keine Stufen, keine
// Vorlagen, keine Kanal-Logik. Die Arbeitsliste beantwortet „um wen muss ich
// mich kümmern?" aus dem Zeilenzustand heraus (src/lib/dranRegel.ts).
//
// Die Unterscheidung „neues Ereignis oder bloße Korrektur" (`correctingLoss`)
// bleibt trotzdem stehen: An ihr hängt nicht nur die Kette, sondern auch die
// Wiedervorlage des Recyclings — und die soll eine drei Wochen später
// nachgetragene Grund-Korrektur nicht um genau diese drei Wochen verschieben.

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
  /**
   * Präziser Nachfass-Zeitpunkt (Migration 0031). Er war einmal der Anker der
   * Erinnerungs-Kaskade; nach ihrem Rückbau bleibt er als Uhrzeit neben dem
   * reinen Datum stehen — `withFollowUpDateSynced` hält beide gleich, und
   * `nachfassen_tasks` liest weiterhin `follow_up_due`.
   */
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

  // Vor dem Schreiben gelesen wird nur noch für EINEN Zweck: den Riegel gegen
  // ein neues Datum auf einer abgesagten Zeile. Der frühere `show_status`-Teil
  // hing ausschließlich an der No-Show-Kette und ist mit ihr entfallen.
  const patch = withFollowUpDateSynced(rawPatch);
  const appointmentChanged = "call_at" in patch;
  if (appointmentChanged) {
    const { data: current } = await supabase
      .from("closing_calls")
      .select("cancelled_at")
      .eq("id", id)
      .maybeSingle();
    const before = current as { cancelled_at: string | null } | null;
    // Ein abgesagtes Closing bekommt keinen neuen Termin — wortgleich zu
    // `postponeAppointment` und `moveSettingAppointment`. Ohne den Riegel trüge
    // die Zeile `cancelled_at` UND ein neues Datum und stünde damit zugleich als
    // abgesagt und als terminiert da; die Arbeitsliste liest genau dieses Paar.
    // Der Kalender-Drag landet hier, weil es kein `moveClosingAppointment` gibt.
    if (before?.cancelled_at) return { error: CANCELLED_MOVE_HINT };
  }

  const { error } = await supabase.from("closing_calls").update(withNoShowResolutionCleared(patch)).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/closing/${id}`, "page");
  revalidatePath("/termine", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
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
   * Präziser Nachfass-Zeitpunkt (ISO, Migration 0031) für den vereinbarten
   * Nachfass-Kontakt. Wird er mitgegeben, überschreibt er `followUpDue` (das
   * reine Datum leitet sich daraus ab, siehe `withFollowUpDateSynced`).
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
