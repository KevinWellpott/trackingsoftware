import type {
  CancelOutlook,
  CancelReasonCode,
  DisqualifyReasonCode,
  NoShowResolution,
} from "@/app/actions/settingCalls";

// Beschriftungen des Termin-Lebenszyklus (Migration 0032) — reines Datenmodul,
// weder "use client" noch "use server", Muster src/lib/settingLabels.ts.
//
// Die CODES stehen in actions/settingCalls.ts (dort prüft sie der Server gegen
// den CHECK), die LABELS hier. Ein `"use server"`-Modul darf nur async Funktionen
// exportieren — die Listen könnten dort also gar nicht mitkommen, und eine zweite
// Abschrift der Labels im Setting- und im Closing-Editor wären zwei Orte, an denen
// derselbe Grund unterschiedlich heißt.

/**
 * Die Lebenszyklus-Spalten aus 0032. Sie stehen bewusst NICHT in `SettingCall`/
 * `ClosingCall` (src/lib/types.ts): beide Detailseiten laden mit `select("*")`,
 * die Werte sind zur Laufzeit also da — der Typ dort ist aber gemeinsames Gut
 * vieler Auswertungen, und diese Felder braucht bisher nur der Editor.
 */
export type AppointmentLifecycle = {
  cancelled_at: string | null;
  cancel_reason_code: CancelReasonCode | null;
  cancel_reason: string | null;
  cancel_outlook: CancelOutlook | null;
  reschedule_count: number | null;
  last_reschedule_at: string | null;
  no_show_resolution: NoShowResolution | null;
};

/** Nur am Setting: der Grund, warum der Lead disqualifiziert wurde. */
export type SettingLifecycle = AppointmentLifecycle & {
  disqualify_reason_code: DisqualifyReasonCode | null;
  disqualify_reason: string | null;
  /** Dokumentierte Verweigerung „will keine Nummer rausgeben" (Entscheidung E10). */
  wa_refused_at: string | null;
};

export const CANCEL_REASON_LABELS: Record<CancelReasonCode, string> = {
  kein_neuer_termin: "Will keinen neuen Termin",
  krank: "Krank",
  familiaer: "Familiär",
  beruflich: "Beruflich",
  preis: "Preis",
  sonstiges: "Sonstiges",
};

export const CANCEL_REASON_ORDER: readonly CancelReasonCode[] = [
  "kein_neuer_termin",
  "krank",
  "familiaer",
  "beruflich",
  "preis",
  "sonstiges",
];

export const CANCEL_OUTLOOK_LABELS: Record<CancelOutlook, string> = {
  ohne_aussicht: "Ohne Aussicht auf einen neuen Termin",
  neuer_termin: "Ersatztermin folgt",
};

/**
 * Was der Ausblick praktisch bedeutet.
 *
 * Die beiden Sätze beschrieben bis zum Rückbau zwei Ablage-Ansichten. Es gibt
 * nur noch eine („Ausgeschieden“), und die zweite ist ersatzlos gefallen: Ein
 * abgesagter Termin, für den ein Ersatz aussteht, ist kein Archivfall, sondern
 * genau der Lead, der in der Terminliste steht und täglich drankommt
 * (src/lib/dropoutLists.ts). Der Unterschied zwischen den Zweigen ist deshalb
 * heute nicht mehr die Ablage, sondern die Wiedervorlage.
 */
export const CANCEL_OUTLOOK_HINTS: Record<CancelOutlook, string> = {
  ohne_aussicht: "Erscheint in der Ablage „Ausgeschieden“ und kommt nach der Recycling-Frist noch einmal hoch.",
  neuer_termin: "Bleibt in der Terminliste und leuchtet täglich, bis ein neuer Termin steht.",
};

export const NO_SHOW_RESOLUTION_LABELS: Record<NoShowResolution, string> = {
  antwort: "Antwort erhalten",
  ohne_antwort: "Keine Antwort",
  ersatztermin: "Ersatztermin",
};

/**
 * Was der Ausgang praktisch bedeutet.
 *
 * Alle drei Sätze nannten bis zum Rückbau die No-Show-Kette — zwei Stufen, von
 * denen die zweite bei einer Antwort entfiel. Die Ketten sind gefallen; was der
 * Ausgang heute noch entscheidet, ist die Wiedervorlage: „Keine Antwort" ist
 * das eine tote Ende, das `recycle_tasks` an einem Erstgespräch ohne
 * Statuswechsel überhaupt erkennt (docs §5).
 */
export const NO_SHOW_RESOLUTION_HINTS: Record<NoShowResolution, string> = {
  antwort: "Er hat sich gemeldet — der Lead bleibt in der Terminliste, bis ein Termin steht.",
  ohne_antwort: "Erscheint in der Ablage „Ausgeschieden“ und kommt nach der Recycling-Frist noch einmal hoch.",
  ersatztermin: "Danach den neuen Termin eintragen — der Vorgang startet als frischer Anlauf.",
};

export const NO_SHOW_RESOLUTION_ORDER: readonly NoShowResolution[] = ["antwort", "ohne_antwort", "ersatztermin"];

export const DISQUALIFY_REASON_LABELS: Record<DisqualifyReasonCode, string> = {
  geld: "Geld",
  kein_budget: "Kein Budget",
  kein_bedarf: "Kein Bedarf",
  falscher_zeitpunkt: "Falscher Zeitpunkt",
  kein_entscheider: "Kein Entscheider",
  falsche_zielgruppe: "Falsche Zielgruppe",
  keine_zusammenarbeit: "Zusammenarbeit macht keinen Sinn",
  sonstiges: "Sonstiges",
};

export const DISQUALIFY_REASON_ORDER: readonly DisqualifyReasonCode[] = [
  "geld",
  "kein_budget",
  "kein_bedarf",
  "falscher_zeitpunkt",
  "kein_entscheider",
  "falsche_zielgruppe",
  "keine_zusammenarbeit",
  "sonstiges",
];

/**
 * Die beiden Gründe, die KEINE Wiedervorlage bekommen — und warum. Der Text
 * steht im Dialog, weil beide Fälle irreversibel wirken: „Zusammenarbeit macht
 * keinen Sinn" setzt ein dauerhaftes Kontaktverbot (`recycle_excluded_at`),
 * „Falsche Zielgruppe" räumt ein bereits geplantes Recycling ab.
 */
export const DISQUALIFY_REASON_WARNINGS: Partial<Record<DisqualifyReasonCode, string>> = {
  keine_zusammenarbeit:
    "Der Lead wird dauerhaft gesperrt: kein Recycling, keine Wiedervorlage — er erscheint danach nur noch in der Ablage „Gesperrt“. Das gilt für das ganze Team, nicht nur für dich.",
  falsche_zielgruppe:
    "Kein Recycling — der Lead war nie der richtige Fit. Ein bereits gesetztes Wiedervorlage-Datum wird entfernt.",
};
