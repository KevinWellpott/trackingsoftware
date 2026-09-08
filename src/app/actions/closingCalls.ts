"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { berlinDateISO } from "@/lib/apptTime";
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
// `supersedeTouches` grenzt jetzt nach KASKADEN-ART ein, nicht mehr nach
// Touch-Typ: 'closing_msg' ist die geplante Bestätigungs-Kaskade vor dem
// Closing-Termin. Die Ereignis-Ketten am selben Closing (Kickoff, No-Show,
// „kein Abschluss") bleiben bewusst stehen — sie beschreiben Geschehenes, keine
// Vorankündigung.

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
  const showStatusChanging = "show_status" in patch;
  let previousShowStatus: "show" | "no_show" | null = null;
  if (showStatusChanging) {
    const { data: current } = await supabase
      .from("closing_calls")
      .select("show_status")
      .eq("id", id)
      .maybeSingle();
    previousShowStatus = (current as { show_status: "show" | "no_show" | null } | null)?.show_status ?? null;
  }

  const { error } = await supabase.from("closing_calls").update(withNoShowResolutionCleared(patch)).eq("id", id);
  if (error) return { error: error.message };

  // Termin (Closing-Call selbst) verschoben — z. B. per Drag&Drop im
  // Kalender, das hier landet, weil es kein eigenes moveClosingAppointment
  // gibt: Kaskade gegen den neuen Zeitpunkt neu aufbauen.
  if ("call_at" in patch) {
    await supersedeTouches("closing", id, ["closing_msg"]);
    await generateClosingCascade(id);
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
  }

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
  if (input.outcome === "nachfassen" && !input.followUpDue && !input.followUpDueAt) {
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
    // Eine bereits geplante Wiedervorlage wird ZUERST abgeräumt. Der Grund ist
    // nachträglich änderbar („Auch nachträglich änderbar" steht im Dialog), und
    // 'falsche_zielgruppe' wie 'kein_fit' bekommen nie ein Datum — ein CHECK aus
    // 0033 hält das fest. Ohne dieses Nullen scheiterte genau der Wechsel von
    // „Timing" auf „Kein Fit" an diesem CHECK, und der Nutzer bekäme eine rohe
    // Postgres-Meldung, obwohl er nur einen Grund umgestellt hat. Für alle
    // anderen Gründe ist es folgenlos: `schedule_recycle()` rechnet die
    // Wartezeit unmittelbar danach ohnehin ab heute neu aus.
    patch.next_recycle_at = null;
  } else {
    patch.follow_up_due = input.followUpDue ?? null;
    patch.follow_up_due_at = input.followUpDueAt ?? null;
  }

  const supabase = await createClient();

  // Show-Status ableiten statt auf Erfassungsdisziplin zu hoffen: Ein Ergebnis
  // (gewonnen/verloren/nachfassen) kann es nur geben, wenn das Gespräch
  // stattgefunden hat. Ohne diese Ableitung blieb show_status meist NULL und
  // die Closing-Show-Quote maß, wer das Häkchen gesetzt hat — es gab gewonnene
  // Deals ohne Show. (Dasselbe Muster wie in setSettingOutcome.)
  //
  // Nur schreiben, wenn bisher NICHTS erfasst ist: ein bewusst gesetztes
  // 'no_show' gehört dem Nutzer und darf hier nicht überschrieben werden.
  const { data: current } = await supabase
    .from("closing_calls")
    .select("show_status")
    .eq("id", input.closingId)
    .maybeSingle();
  if ((current as { show_status: string | null } | null)?.show_status == null) {
    patch.show_status = "show";
  }

  const { error } = await supabase
    .from("closing_calls")
    .update(withNoShowResolutionCleared(withFollowUpDateSynced(patch)))
    .eq("id", input.closingId);
  if (error) return { error: error.message };

  // Ein Ergebnis entscheidet das Schicksal des Closing-Termins — dessen
  // eigene Kaskade ist damit obsolet, unabhängig vom Outcome.
  await supersedeTouches("closing", input.closingId, ["closing_msg"]);
  if (input.outcome === "nachfassen") {
    // Neuer Nachfass-Zeitpunkt: Kaskade dagegen neu aufbauen.
    await supersedeTouches("closing_followup", input.closingId);
    await generateFollowUpCascade(input.closingId);
  } else {
    // gewonnen/verloren: kein Nachfass-Termin mehr offen.
    await supersedeTouches("closing_followup", input.closingId);
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
  if (input.outcome === "verloren") {
    await scheduleRecycle("closing", input.closingId);
    // „Kein Abschluss" ist kein Schweigen: erst die Zusammenfassung, dann —
    // falls keine Antwort kommt — das Nachhaken. Anker ist das EREIGNIS, also
    // dieser Moment, nicht der (womöglich Tage zurückliegende) Termin. Fail-soft
    // wie alle Kaskaden-Aufrufe: eine ausgefallene Kette darf ein eingetragenes
    // Ergebnis nicht zurückrollen.
    await generateKeinCloseChain(input.closingId);
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
