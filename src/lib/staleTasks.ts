// Ab wann eine Aufgabe eine ALTLAST ist.
//
// DAS PROBLEM: `/nachfassen` beantwortete „was ist heute fällig?" — und lieferte
// dafür alles aus, was jemals fällig geworden und nie abgehakt worden ist. Am
// ersten produktiven Tag standen dort 425 Aufgaben. Das ist keine Arbeitsliste
// mehr, sondern ein Archiv: Der überfällige Versuch von gestern, um den es
// wirklich geht, liegt zwischen zweihundert Karteileichen und wird nie
// gefunden. Ein Board, das alles zeigt, zeigt nichts.
//
// DIESELBE FALLE STEHT SEIT DEM RÜCKBAU IN DER TERMIN-ARBEITSLISTE, und zwar
// unverdünnt: „Zu tun" schneidet nur nach ZUSTAND, nicht nach Zeit — bei 173
// Erstgesprächen und 50 Closings landet dort am ersten Tag jede jemals angelegte
// Zeile ohne Ergebnis, alle gleichzeitig gold. Zweihundert goldene Zeilen sind
// dasselbe wie keine.
//
// WARUM DAS DEM AUFTRAGGEBER NICHT WIDERSPRICHT („Wer offen ist, wird JEDEN TAG
// kontaktiert. Ohne Ausnahme, ohne Intervall-Logik."): Der Schnitt ist KEIN
// Intervall. Er verzögert niemanden und lässt niemanden aussetzen — er nimmt
// Zeilen heraus, an denen seit einem Monat nichts passiert ist. Entscheidend
// ist, dass er sich selbst auflöst: Jeder Klick auf „Genervt" erneuert das
// Lebenszeichen, ein täglich bearbeiteter Lead kann also nie zur Altlast werden.
// Wer herausfällt, ist genau der, den niemand bearbeitet — und er wird gezählt,
// benannt und ist einen Klick entfernt (`?altlasten=1`), nicht gelöscht.
//
// WARUM DER SCHNITT AUF /nachfassen BLEIBT, obwohl dort nur noch das Recycling
// steht: Ein Recycling-Datum läuft nie von allein ab. `next_recycle_at` bleibt
// stehen, bis jemand „Nochmal versucht", „Reagiert" oder „Endgültig raus"
// drückt — der Bestand wächst also monoton mit der Nutzungsdauer. Ohne Schnitt
// ist das Board nicht heute wieder voll, sondern in einem halben Jahr, und dann
// mit denselben 400 Karten.
//
// WAS HIER NICHT PASSIERT: Überfälliges pauschal ausblenden. Überfällige
// Aufgaben sind der ZWECK dieser Seiten — der Schnitt liegt weit hinter dem
// Punkt, an dem eine Aufgabe überfällig wird, und trifft nur den Bestand, den
// niemand mehr abarbeitet.
//
// WARUM 90 TAGE UND NICHT 30 (Recycling): Die Wartezeiten des Recyclings liegen
// selbst zwischen 28 und 270 Tagen (`pipeline_settings`, docs §5). Auf dieser
// Kadenz sind vier Wochen Verzug nichts — ein Schnitt in der Größenordnung einer
// Tages-Wiedervorlage würde reihenweise Leads erwischen, die planmäßig warten.
// Erst ab einem Vierteljahr ist der Versuch wirklich liegen geblieben.
//
// WAS DER RÜCKBAU AUS DIESER DATEI GENOMMEN HAT: die Zähl- und
// Beschriftungs-Maschinerie für VIER Quellen (`StaleCounts`,
// `emptyStaleCounts`, `staleTotal`, `staleParts`, `STALE_LABELS`) und zuletzt
// `staleSourceOf()`. Letzteres übersetzte die `source`-Spalte von
// `nachfassen_tasks` in einen Schlüssel dieser Tabelle — und diese RPC liest
// seit dem Zusammenzug des Navigations-Zählers niemand mehr. Alle heutigen
// Aufrufer kennen ihre Quelle statisch.
//
// ALLE VIER GRENZEN HABEN DAMIT WIEDER EINEN LESER: `recycling` auf
// /nachfassen, `telefon` im Rückruf-Reiter der Terminliste, `setting`/`closing`
// in ihrer Arbeitsliste.
//
// DIE ZAHLEN STEHEN HIER UND NICHT IN DER OBERFLÄCHE: Die Server-Action
// entscheidet danach, der Navigations-Zähler schneidet mit derselben Funktion,
// und die Boards beschriften damit. Drei Kopien einer Zahl, die Aufgaben
// verschwinden lässt, laufen früher oder später auseinander — und dann nennt
// die Seite eine andere Grenze, als sie anwendet, oder das Badge zählt etwas
// anderes als die Liste darunter.

import { addDaysISO } from "@/lib/dates";
import { dueDayOf } from "@/lib/dueState";

/** Die Quellen mit einem Altlast-Schnitt. */
export type StaleSource = "telefon" | "setting" | "closing" | "recycling";

/**
 * Tage NACH dem letzten maßgeblichen Datum, ab denen eine Aufgabe als Altlast
 * gilt.
 *
 * Bei `telefon` und `recycling` ist das die FÄLLIGKEIT (verabredeter Rückruf,
 * geplante Wiedervorlage). Bei `setting`/`closing` ist es das letzte
 * LEBENSZEICHEN der Zeile — dort gibt es keine Fälligkeit mehr, seit „wer offen
 * ist, wird jeden Tag kontaktiert" die Wiedervorlage ersetzt hat; die Frage
 * lautet nicht „wie lange ist es überfällig", sondern „wie lange hat niemand
 * mehr hingesehen". Die Zahl ist in beiden Lesarten dieselbe Aussage: So lange
 * darf ein Vorgang liegen, bevor er als aufgegeben gilt.
 *
 * `linkedin` hat bewusst KEINEN Eintrag: Die Quelle steht auf keiner Seite —
 * eine Grenze dafür wäre eine Aussage über etwas, das niemand sieht.
 */
export const STALE_AFTER_DAYS: Record<StaleSource, number> = {
  telefon: 14,
  setting: 30,
  closing: 30,
  recycling: 90,
};

/**
 * Ist dieses Datum so lange vorbei, dass die Zeile eine Altlast ist?
 *
 * `today` kommt vom Aufrufer und nicht aus `new Date()`: Ein Board voller
 * Karten würde sonst mitten im Durchlauf den Tag wechseln, und zwei Aufgaben
 * mit demselben Datum fielen verschieden aus.
 *
 * OHNE Wert gibt es keine Aussage — dann bleibt die Aufgabe sichtbar. Wo die
 * Seite nichts über das Alter weiß, behauptet sie auch nichts (docs §5.4).
 */
export function isStaleDue(source: StaleSource, dueAt: string | null | undefined, today: string): boolean {
  if (!dueAt || !today) return false;
  const day = dueDayOf(dueAt);
  if (!day) return false;
  return day < addDaysISO(today, -STALE_AFTER_DAYS[source]);
}

/**
 * Das jüngste Lebenszeichen einer Termin-Zeile als Berliner Kalendertag —
 * `null`, wenn keines bekannt ist.
 *
 * Gefüttert wird sie mit dem Termin-Zeitpunkt und dem Nachfass-Stempel
 * (Migration 0041). Der Stempel MUSS dabei sein, sonst wäre der Schnitt doch
 * ein Intervall: Ein Lead, den das Team seit sechs Wochen täglich nervt, dessen
 * Termin aber im März war, verschwände sonst mitten aus der Arbeit heraus.
 *
 * Solange 0041 nicht eingespielt ist, kommt der Stempel gar nicht mit und der
 * Anker ist allein der Termin. Das ist unschädlich, weil ohne 0041 auch der
 * Knopf „Genervt" nicht schreiben kann — es gibt in diesem Zustand keine
 * täglich bearbeitete Zeile, die zu schützen wäre.
 */
export function letztesLebenszeichen(werte: (string | null | undefined)[]): string | null {
  let neuestes: string | null = null;
  for (const wert of werte) {
    if (!wert) continue;
    const tag = dueDayOf(wert);
    if (!tag) continue;
    if (!neuestes || tag > neuestes) neuestes = tag;
  }
  return neuestes;
}
