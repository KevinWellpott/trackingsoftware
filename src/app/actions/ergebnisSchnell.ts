"use server";

// Ergebnis direkt in der Liste eintragen (Prüfliste O1, O2, O5): Gearbeitet
// wird in Terminliste und Nachfass-Eingang, das Ergebnis ließ sich aber nur
// auf der Detailseite erfassen — 50 Erstgespräche und 33 Closings standen ohne
// Ergebnis. Diese Actions rufen die vorhandenen Ergebnis-Actions; sie bringen
// keine zweite Regel mit.

import { getAccessContext } from "@/lib/access";
import { berlinInputToIso } from "@/lib/apptTime";
import { createClient } from "@/lib/supabase/server";
import type { ClosingLostReasonCode } from "@/lib/types";
import { setNoShowResolution, setSettingOutcome, updateSettingCall } from "@/app/actions/settingCalls";
import { setClosingOutcome, updateClosingCall } from "@/app/actions/closingCalls";

type Ausgang = "antwort" | "ohne_antwort" | null;

async function vorbelegen(tabelle: "setting_calls" | "closing_calls", id: string): Promise<void> {
  const access = await getAccessContext();
  if (!access || access.is_foreign_org) return;
  const supabase = await createClient();
  await supabase
    .from(tabelle)
    .update({ conducted_by_user_id: access.user.id })
    .eq("id", id)
    .eq("workspace_id", access.workspace_id)
    .is("conducted_by_user_id", null);
}

/** Erstgespräch: erschienen. Der Vorgang wird am nächsten Werktag im Eingang fällig, bis ein Ergebnis steht. */
export async function settingErschienen(id: string): Promise<{ error?: string }> {
  const res = await updateSettingCall(id, { show_status: "show" });
  if (res.error) return res;
  await vorbelegen("setting_calls", id);
  return {};
}

/** Erstgespräch: nicht erschienen, optional gleich mit Ausgang (O5). */
export async function settingNichtErschienen(id: string, ausgang: Ausgang): Promise<{ error?: string }> {
  const res = await setSettingOutcome({ settingId: id, outcome: "no_show" });
  if (res.error) return res;
  if (ausgang) return setNoShowResolution("setting", id, ausgang);
  return {};
}

/** Closing: nicht erschienen, optional mit Ausgang. */
export async function closingNichtErschienen(id: string, ausgang: Ausgang): Promise<{ error?: string }> {
  const res = await updateClosingCall(id, { show_status: "no_show" });
  if (res.error) return res;
  if (ausgang) return setNoShowResolution("closing", id, ausgang);
  return {};
}

/** Closing: Ergebnis. „Durchgeführt von" belegt `setClosingOutcome` selbst vor (O3). */
export async function closingErgebnis(
  id: string,
  input:
    | { outcome: "gewonnen"; dealVolume: number | null }
    | { outcome: "verloren"; lostReasonCode: ClosingLostReasonCode }
    | { outcome: "nachfassen"; berlinInput: string },
): Promise<{ error?: string }> {
  if (input.outcome === "gewonnen") {
    return setClosingOutcome({ closingId: id, outcome: "gewonnen", dealVolume: input.dealVolume });
  }
  if (input.outcome === "verloren") {
    return setClosingOutcome({ closingId: id, outcome: "verloren", lostReasonCode: input.lostReasonCode });
  }
  const iso = berlinInputToIso(input.berlinInput);
  if (!iso) return { error: "Bitte den nächsten Kontakt wählen." };
  return setClosingOutcome({ closingId: id, outcome: "nachfassen", followUpDueAt: iso });
}
