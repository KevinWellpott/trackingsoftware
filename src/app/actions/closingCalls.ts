"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/access";
import { revalidatePath } from "next/cache";

// Closing-Call bearbeiten. Terminal: gewonnen (→ CRM), verloren, nachfassen.

export type ClosingCallPatch = {
  call_at?: string | null;
  show_status?: "show" | "no_show" | null;
  closed?: boolean | null;
  deal_volume?: number | null;
  payment_type?: string | null;
  signature_received?: boolean | null;
  contract_start?: string | null;
  lost_reason?: string | null;
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

async function canAccessClosingCall(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("closing_calls").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

export async function updateClosingCall(id: string, patch: ClosingCallPatch): Promise<{ error?: string }> {
  if (!(await canAccessClosingCall(id))) return { error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { error } = await supabase.from("closing_calls").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/closing/${id}`, "page");
  revalidatePath("/closing", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}

/**
 * Terminal-Ergebnis setzen. gewonnen → closed=true (+ Deal-Daten), erscheint im CRM;
 * verloren → closed=false + lost_reason; nachfassen → follow_up_due Pflicht.
 */
export async function setClosingOutcome(input: {
  closingId: string;
  outcome: "gewonnen" | "verloren" | "nachfassen";
  dealVolume?: number | null;
  paymentType?: string | null;
  contractStart?: string | null;
  signatureReceived?: boolean | null;
  lostReason?: string | null;
  followUpDue?: string | null;
}): Promise<{ error?: string }> {
  if (!(await canAccessClosingCall(input.closingId))) return { error: "Keine Berechtigung." };
  if (input.outcome === "nachfassen" && !input.followUpDue) {
    return { error: "Für „Nachfassen“ ist ein Wiedervorlage-Datum erforderlich." };
  }
  if (input.outcome === "verloren" && !input.lostReason?.trim()) {
    return { error: "Bitte einen Verlustgrund angeben." };
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
    patch.lost_reason = input.lostReason ?? null;
    patch.follow_up_due = null;
  } else {
    patch.follow_up_due = input.followUpDue ?? null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("closing_calls").update(patch).eq("id", input.closingId);
  if (error) return { error: error.message };
  revalidatePath(`/closing/${input.closingId}`, "page");
  revalidatePath("/closing", "page");
  revalidatePath("/crm", "page");
  revalidatePath("/nachfassen", "page");
  revalidatePath("/", "layout");
  return {};
}
