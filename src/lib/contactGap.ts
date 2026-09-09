// Kontaktfrequenz: „Wann haben wir diesen Lead zuletzt angefasst?"
//
// Bis hierher stand die Antwort dreimal im Code — als Konstante in
// `ErinnerungenBoard` und in `actions/nachfassen.ts`, als Beschriftung noch
// einmal im Lead-Dossier. Drei Kopien einer Zahl, die eine Warnung auslöst,
// laufen früher oder später auseinander; dann warnt eine Seite und die andere
// schweigt über denselben Lead.
//
// WICHTIG zur Reichweite: Was ein Board über den letzten Kontakt weiß, ist
// immer WENIGER als das Dossier. Die Boards sehen erledigte Erinnerungen und
// Recycling-Versuche; das Dossier sieht zusätzlich Pitches, Anwahlen und
// geführte Termine. Die Zahl auf einer Karte ist deshalb eine Untergrenze —
// „mindestens so lange her" — und der Verweis ins Dossier steht daneben, statt
// dass die Karte eine Vollständigkeit behauptet, die sie nicht hat.

import { berlinDateISO } from "@/lib/apptTime";

/**
 * Weiche Warnung, wenn derselbe Lead vor weniger als so vielen Tagen schon
 * kontaktiert wurde: ein Hinweis, KEINE Sperre — die Aufgabe bleibt bedienbar.
 *
 * Bewusst eine Code-Konstante und keine Organisationseinstellung: eine
 * konfigurierbare Sperre verschöbe Fälligkeiten und kollidierte mit der
 * Kaskadenstufe „eine Stunde vorher".
 */
export const CONTACT_GAP_WARN_DAYS = 3;

const DAY_MS = 86_400_000;

/** Ganze Kalendertage zwischen zwei Tagesdaten (YYYY-MM-DD). */
export function dayDiff(aDay: string, bDay: string): number {
  const a = Date.parse(`${aDay}T00:00:00.000Z`);
  const b = Date.parse(`${bDay}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Ganze Tage seit einem Kontakt — in BERLINER Kalendertagen, nicht in
 * 24-Stunden-Blöcken: „gestern 23:00" ist gestern, auch wenn es zwei Stunden
 * her ist (docs §6).
 */
export function contactAgeDays(atIso: string | null | undefined, nowIso?: string): number | null {
  if (!atIso) return null;
  const day = atIso.includes("T") ? berlinDateISO(atIso) : atIso.slice(0, 10);
  if (!day) return null;
  const today = berlinDateISO(nowIso ?? new Date().toISOString());
  if (!today) return null;
  return Math.max(0, dayDiff(day, today));
}

/**
 * Die Beschriftung des letzten Kontakts — wortgleich in Dossier, Nachfassen
 * und Erinnerungen. Eine Zahl, die auf drei Seiten anders heißt, liest sich wie
 * drei verschiedene Zahlen.
 */
export function lastContactLabel(daysAgo: number | null): string {
  if (daysAgo == null) return "noch nie kontaktiert";
  if (daysAgo === 0) return "heute";
  if (daysAgo === 1) return "gestern";
  return `vor ${daysAgo} Tagen`;
}

/**
 * Warnt die Schwelle bei diesem Kontakt? Die EINE Stelle, an der die Zahl
 * ausgewertet wird.
 *
 * Bis hierher stand die Auswertung dreimal als Rechnung im Code
 * (`nowMs - last < CONTACT_GAP_WARN_DAYS * 86_400_000` im Erinnerungs-Board,
 * zweimal dasselbe in actions/nachfassen.ts) — und zwar in 24-STUNDEN-BLÖCKEN,
 * während die Beschriftung daneben (`contactAgeDays` → `lastContactLabel`) in
 * BERLINER KALENDERTAGEN rechnet. Beides zusammen ergab Karten, auf denen „vor
 * 3 Tagen" stand und trotzdem gewarnt wurde: Kontakt am 7.9. um 23:00, jetzt
 * der 10.9. um 01:00 — drei Kalendertage, aber erst 50 Stunden. Die Konstante
 * war zwar nur einmal definiert, ihre Bedeutung aber zweimal.
 *
 * Maßgeblich ist die Körnung der Beschriftung: Was der Nutzer liest, muss
 * erklären, was er sieht.
 */
export function isWithinContactGap(atIso: string | null | undefined, nowIso?: string): boolean {
  const days = contactAgeDays(atIso, nowIso);
  return days != null && days < CONTACT_GAP_WARN_DAYS;
}

/**
 * Untergrenze für das VORLADEN möglicher Vorkontakte (SQL-Fenster), als ISO.
 *
 * Bewusst großzügiger als `isWithinContactGap`: Ein Kontakt, der noch innerhalb
 * der Schwelle liegt, kann bis zu `CONTACT_GAP_WARN_DAYS` volle Tage alt sein
 * (00:00 des ältesten warnenden Kalendertages, betrachtet um 23:59 von heute).
 * Das Fenster muss ihn deshalb einschließen; gefiltert wird danach exakt über
 * `isWithinContactGap`. Ein knapperes Fenster verlöre genau die Randfälle, um
 * derentwillen die beiden Körnungen überhaupt getrennt sind.
 */
export function contactGapWindowStart(nowIso?: string): string {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  return new Date(now - CONTACT_GAP_WARN_DAYS * DAY_MS).toISOString();
}
