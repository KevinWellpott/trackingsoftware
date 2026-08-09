"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { CLOSING_LOST_REASON_CODES, type ClosingLostReasonCode } from "@/lib/types";
import { revalidatePath } from "next/cache";

// Closing-Call bearbeiten. Terminal: gewonnen (→ CRM), verloren, nachfassen.

export type ClosingCallPatch = {
  call_at?: string | null;
  meet_link?: string | null;
  show_status?: "show" | "no_show" | null;
  closed?: boolean | null;
  deal_volume?: number | null;
  payment_type?: string | null;
  signature_received?: boolean | null;
  contract_start?: string | null;
  lost_reason?: string | null;
  /** Zählbarer Verlustgrund (Migration 0029) — die Statistik hängt daran. */
  lost_reason_code?: ClosingLostReasonCode | null;
  follow_up_due?: string | null;
  recording_link?: string | null;
  objections_handled?: string | null;
  objections_open?: string | null;
  script_answers?: Record<string, string>;
  status?: "offen" | "gewonnen" | "verloren" | "nachfassen";
  notes?: string | null;
  lead_name?: string | null;
  company?: string | null;
};

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

export async function updateClosingCall(id: string, patch: ClosingCallPatch): Promise<{ error?: string }> {
  if (!(await canAccessClosingCall(id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("closing_calls").update(patch).eq("id", id);
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
  signatureReceived?: boolean | null;
  /** Freitext zum Verlust — Kontext, seit 0029 NICHT mehr erzwungen. */
  lostReason?: string | null;
  /** Zählbarer Verlustgrund. Pflicht bei `outcome = 'verloren'`. */
  lostReasonCode?: ClosingLostReasonCode | null;
  followUpDue?: string | null;
}): Promise<{ error?: string }> {
  // Berechtigung IMMER als erste Anweisung — vor jeder Validierung, sonst
  // verrieten die Fehlermeldungen einem Fremden etwas über die Zeile.
  if (!(await canAccessClosingCall(input.closingId))) return { error: "Keine Berechtigung." };
  if (input.outcome === "nachfassen" && !input.followUpDue) {
    return { error: "Für „Nachfassen“ ist ein Wiedervorlage-Datum erforderlich." };
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
    patch.signature_received = input.signatureReceived ?? null;
    patch.follow_up_due = null;
  } else if (input.outcome === "verloren") {
    patch.closed = false;
    patch.lost_reason_code = lostReasonCode;
    // Leerer Freitext wird zu NULL statt zu "" — sonst steht in der Detailseite
    // eine leere Kontextzeile, die wie eine Angabe aussieht.
    patch.lost_reason = input.lostReason?.trim() || null;
    patch.follow_up_due = null;
  } else {
    patch.follow_up_due = input.followUpDue ?? null;
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

  const { error } = await supabase.from("closing_calls").update(patch).eq("id", input.closingId);
  if (error) return { error: error.message };
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
