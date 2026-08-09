/**
 * Follow-up-Rhythmus für den LinkedIn-Flow — EINE Quelle für beide Schreibpfade.
 *
 * Vorher rechneten `calcNextFollowUp` (src/app/actions/contacts.ts) und
 * `advanceLinkedInFollowUp` (src/app/actions/nachfassen.ts) unterschiedlich:
 * Ersteres mit der abgeschlossenen Stufe (nach FU1 → +5, korrekt laut
 * docs/data-model.md §4), Letzteres mit der Stufe davor (nach FU1 → +3).
 * Je nachdem, ob ein Follow-up im Nachfassen-Board oder im Listen-Board
 * erledigt wurde, stand eine andere Fälligkeit in der Zeile.
 *
 * Zusätzlich setzte der Nachfassen-Pfad nach FU3 noch eine Fälligkeit (+7),
 * obwohl der Flow dort endet. Das fiel nur nicht auf, weil `nachfassen_tasks`
 * und `rpc_followup_alerts` `follow_up_number = 3` ohnehin ausschließen.
 */

import { addDaysISO } from "@/lib/dates";

/**
 * Wartezeit in Tagen bis zur NÄCHSTEN Stufe, geschlüsselt nach der gerade
 * ABGESCHLOSSENEN Stufe:
 *   0 = gepitcht, noch kein Follow-up → FU1 in 3 Tagen
 *   1 = FU1 raus                     → FU2 in 5 Tagen
 *   2 = FU2 raus                     → FU3 in 7 Tagen
 *   3 = FU3 raus                     → Ende (siehe nextFollowUpAfter)
 */
export const FU_INTERVAL_DAYS: Record<0 | 1 | 2, number> = { 0: 3, 1: 5, 2: 7 };

/** Höchste Follow-up-Stufe. Der CHECK in der DB erlaubt nur null oder 1–3. */
export const FU_MAX_STAGE = 3;

/**
 * Fälligkeit der nächsten Stufe.
 *
 * @param completedStage Die gerade abgeschlossene Stufe (0 = nur gepitcht).
 *                       `null` wird wie 0 behandelt — in der DB steht für
 *                       "noch kein Follow-up" NULL, nie 0.
 * @param baseISO        Ankertag als `YYYY-MM-DD`. Beim Erledigen eines
 *                       Follow-ups ist das HEUTE, nicht das Pitch-Datum —
 *                       sonst landet die nächste Stufe bei älteren Leads
 *                       sofort in der Vergangenheit.
 * @returns `YYYY-MM-DD` oder `null`, wenn der Flow endet.
 */
export function nextFollowUpAfter(
  completedStage: number | null | undefined,
  baseISO: string,
): string | null {
  const stage = completedStage ?? 0;
  if (stage >= FU_MAX_STAGE) return null;
  const days = FU_INTERVAL_DAYS[stage as 0 | 1 | 2];
  if (!days) return null;
  return addDaysISO(baseISO, days);
}
