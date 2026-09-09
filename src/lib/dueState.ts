// Fälligkeit einer Aufgabe: nur „fällig" oder schon „überfällig".
//
// DAS PROBLEM, das diese Datei löst: `nachfassen_tasks` presst fünf Quellen in
// EINE Spalte `due_at timestamptz` — und vier davon sind in Wahrheit
// Tages-Werte (`date`), die die RPC nur castet. Ein `date` wird dabei zu
// Mitternacht UTC, in Berlin also 02:00. Wer die Spalte allein nach ihrem
// Datentyp liest, hält jedes Follow-up ab 02:00 morgens für überfällig — und
// weil die RPC ohnehin nur Fälliges liefert, wäre schlicht ALLES überfällig.
// Eine Dringlichkeit, die immer gilt, ist keine.
//
// Maßgeblich ist deshalb die KÖRNUNG DER QUELLE, nicht die Schreibweise des
// Werts (docs §1: /nachfassen rechnet auf Tagen, nur der Telefon-Rückruf trägt
// eine verabredete Uhrzeit). Die Regel steht hier EINMAL: Der Zähler in der
// Seitenleiste und die Karte im Board darunter müssen sie gleich lesen, sonst
// behauptet die Navigation eine Dringlichkeit, die die Seite daneben nicht
// kennt.

import { berlinDateISO } from "@/lib/apptTime";

/**
 * `day` — der Eintrag hat den ganzen Tag Zeit (LinkedIn-Follow-up,
 * Setting-/Closing-Wiedervorlage, Recycling-Versuch).
 * `moment` — es gibt eine verabredete Uhrzeit, die vorbeigehen kann
 * (Telefon-Rückruf).
 */
export type DueGranularity = "day" | "moment";

/**
 * Bezugspunkt für einen Stapel Vergleiche. Ohne ihn ermittelt jede Prüfung
 * „jetzt" selbst — bei 500 Zeilen sind das 500 Intl-Formatierungen für dieselbe
 * Antwort. Der Zähler reicht ihn deshalb einmal durch; die Karte im Board
 * braucht ihn nicht.
 */
export type DueRef = { nowMs: number; todayIso: string };

export function dueRefNow(): DueRef {
  const nowMs = Date.now();
  return { nowMs, todayIso: berlinDateISO(new Date(nowMs).toISOString()) };
}

/** Der Berliner Kalendertag eines Fälligkeitswerts — beide Schreibweisen. */
export function dueDayOf(value: string): string {
  return value.includes("T") ? berlinDateISO(value) : value.slice(0, 10);
}

/**
 * Überfällig heißt: der Zeitpunkt ist vorbei. Bei Tages-Körnung erst am
 * Folgetag, bei Uhrzeit-Körnung in der Minute danach.
 */
export function isOverdue(
  value: string | null | undefined,
  granularity: DueGranularity,
  ref?: DueRef,
): boolean {
  if (!value) return false;
  if (granularity === "day") {
    const today = ref?.todayIso ?? berlinDateISO(new Date().toISOString());
    const day = dueDayOf(value);
    return Boolean(day) && Boolean(today) && day < today;
  }
  const t = new Date(value).getTime();
  return !Number.isNaN(t) && t < (ref?.nowMs ?? Date.now());
}
