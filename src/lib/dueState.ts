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
//
// ── UND EIN FALL, DER BEWUSST NICHT HIERHER GEHÖRT ──────────────────────────
// Die zwei festen Erinnerungen vor einem Termin (`offeneErinnerung`,
// src/lib/dranRegel.ts) sind minutengenaue Zeitpunkte und sähen damit wie ein
// `moment`-Fall aus. Die RECHNUNG wäre auch dieselbe — `marke < now` —, aber die
// VOKABEL ist die falsche: „Überfällig" ist ein Urteil („du hast es
// versäumt"), eine erreichte Erinnerungs-Marke ist nur eine Ansage („jetzt geht
// die Bestätigung raus").
//
// Der Unterschied ist nicht akademisch, er ist der gemeldete Fehler: Wer heute
// um 14:00 einen Termin für heute 18:00 anlegt, hat die Vortags-Marke im Moment
// des Buchens schon überschritten. Über `isOverdue` gelesen wäre diese Zeile in
// derselben Sekunde rot, in der sie entsteht — genau das hat das alte System
// getan, und genau daran ist es zurückgewiesen worden. Es gibt für eine
// Erinnerung deshalb nur zwei Zustände: noch nicht dran, oder dran (Gold).
// Wer hier einen dritten einführt, baut den Vorwurf wieder ein.
//
// HIER STAND EIN ZWEITER FALL: der Sofort-Touch der Erinnerungs-Kaskade, dessen
// Fälligkeit sein eigener Entstehungszeitpunkt war und der deshalb gegen den
// TERMIN statt gegen sich selbst gemessen werden musste (`DueSpec`,
// `reminderDueSpec`). Die Kaskade ist mit dem Rückbau gefallen; damit gibt es
// keine Fälligkeit mehr, die nicht aus ihrem eigenen Wert zu beantworten wäre.

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
  return dueRefAt(Date.now());
}

/**
 * Derselbe Bezugspunkt aus einem bereits gemessenen „jetzt".
 *
 * Die Oberfläche darf `Date.now()` nicht im Render-Körper aufrufen (unreine
 * Funktion, react-hooks/purity) und führt die Uhrzeit deshalb minütlich per
 * Effekt nach. Damit Karte und Zähler trotzdem dieselbe Regel benutzen können,
 * nimmt der Bezugspunkt diesen Messwert entgegen, statt selbst zu messen.
 */
export function dueRefAt(nowMs: number): DueRef {
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
  spec: DueGranularity,
  ref?: DueRef,
): boolean {
  if (!value) return false;
  if (spec === "day") {
    const today = ref?.todayIso ?? berlinDateISO(new Date().toISOString());
    const day = dueDayOf(value);
    return Boolean(day) && Boolean(today) && day < today;
  }
  const t = new Date(value).getTime();
  return !Number.isNaN(t) && t < (ref?.nowMs ?? Date.now());
}
