"use server";

import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Letzte Anwahlen EINES Leads für den Call-Modus (Redesign Phase 5).
 *
 * Zwei Zwecke, eine Abfrage:
 *   · „Letzter Verlauf" unter der Rufnummer.
 *   · Die Warnung vor dem dritten „Nicht erreicht". Sie liest dieselbe Serie
 *     wie `setPhoneLeadOutcome` (NICHT_ERREICHT_LIMIT = 3): die letzten zwei
 *     Anwahlen nach `attempt_no`, neueste zuerst. Entschieden wird weiterhin
 *     ausschließlich auf dem Server — die Warnung sagt nur an, was passiert.
 *
 * Bewusst je Lead und auf Abruf statt für die ganze Liste beim Laden: Eine
 * Importliste hat oft tausend Leads, gebraucht wird der Verlauf immer nur für
 * den einen, der gerade dran ist. RLS liegt darunter; `workspace_id` hält die
 * Organisationsgrenze zusätzlich hart.
 *
 * Fail-soft: Fehlt das Log (Migration 0028) oder scheitert die Abfrage, kommt
 * `available: false` — der Call-Modus zeigt dann keinen Verlauf und keine
 * Warnung, statt „noch nie angerufen" zu behaupten.
 */
export type PhoneHistoryRow = {
  called_at: string;
  attempt_no: number;
  outcome: string;
};

export async function loadPhoneLeadHistory(
  leadId: string,
): Promise<{ rows: PhoneHistoryRow[]; available: boolean }> {
  const access = await getAccessContext();
  if (!access) return { rows: [], available: false };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_call_attempts")
    .select("called_at, attempt_no, outcome")
    .eq("workspace_id", access.workspace_id)
    .eq("lead_id", leadId)
    .order("attempt_no", { ascending: false })
    .limit(5);
  if (error) return { rows: [], available: false };
  return { rows: (data ?? []) as PhoneHistoryRow[], available: true };
}
