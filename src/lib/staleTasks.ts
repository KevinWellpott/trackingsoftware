// Ab wann eine fällige Aufgabe eine ALTLAST ist.
//
// DAS PROBLEM: `/nachfassen` beantwortete „was ist heute fällig?" — und lieferte
// dafür alles aus, was jemals fällig geworden und nie abgehakt worden ist. Am
// ersten produktiven Tag standen dort 425 Aufgaben. Das ist keine Arbeitsliste
// mehr, sondern ein Archiv: Der überfällige Versuch von gestern, um den es
// wirklich geht, liegt zwischen zweihundert Karteileichen und wird nie
// gefunden. Ein Board, das alles zeigt, zeigt nichts.
//
// WARUM DER SCHNITT BLEIBT, obwohl auf /nachfassen nur noch das Recycling
// steht: Ein Recycling-Datum läuft nie von allein ab. `next_recycle_at` bleibt
// stehen, bis jemand „Nochmal versucht", „Reagiert" oder „Endgültig raus"
// drückt — der Bestand wächst also monoton mit der Nutzungsdauer. Ohne Schnitt
// ist das Board nicht heute wieder voll, sondern in einem halben Jahr, und dann
// mit denselben 400 Karten.
//
// WAS HIER NICHT PASSIERT: Überfälliges pauschal ausblenden. Überfällige
// Aufgaben sind der ZWECK dieser Seite — der Schnitt liegt weit hinter dem
// Punkt, an dem eine Aufgabe überfällig wird, und trifft nur den Bestand, den
// niemand mehr abarbeitet.
//
// WARUM 90 TAGE UND NICHT 30: Die Wartezeiten des Recyclings liegen selbst
// zwischen 28 und 270 Tagen (`pipeline_settings`, docs §5). Auf dieser Kadenz
// sind vier Wochen Verzug nichts — ein Schnitt in der Größenordnung einer
// Tages-Wiedervorlage würde reihenweise Leads erwischen, die planmäßig warten.
// Erst ab einem Vierteljahr ist der Versuch wirklich liegen geblieben.
//
// WAS DER RÜCKBAU AUS DIESER DATEI GENOMMEN HAT: die Zähl- und
// Beschriftungs-Maschinerie für VIER Quellen (`StaleCounts`,
// `emptyStaleCounts`, `staleTotal`, `staleParts`, `STALE_LABELS`). Sie hatte
// genau einen Aufrufer — das Nachfassen-Board —, und das zeigt seit dem Rückbau
// nur noch eine Quelle. Eine Aufzählung „12 Rückrufe, 3 Closing-Wiedervorlagen"
// über eine Liste, die keine Rückrufe mehr kennt, wäre eine Beschriftung ohne
// Gegenstand.
//
// WAS BEWUSST STEHEN BLIEB: die Tabelle mit allen vier Grenzen samt
// `staleSourceOf()`. Sie hat weiterhin einen Aufrufer, nämlich den
// Navigations-Zähler (`lib/navCounts.ts`), der noch beide Nachfassen-RPCs
// liest. Sobald der auf das Recycling zusammengezogen ist, verlieren die drei
// übrigen Einträge und `staleSourceOf()` ihren letzten Leser und die Datei
// schrumpft auf eine Zahl und eine Funktion.
//
// DIE ZAHLEN STEHEN HIER UND NICHT IN DER OBERFLÄCHE: Die Server-Action
// entscheidet danach, der Navigations-Zähler schneidet mit derselben Funktion,
// und das Board beschriftet damit. Drei Kopien einer Zahl, die Aufgaben
// verschwinden lässt, laufen früher oder später auseinander — und dann nennt
// die Seite eine andere Grenze, als sie anwendet, oder das Badge zählt etwas
// anderes als die Liste darunter.

import { addDaysISO } from "@/lib/dates";
import { dueDayOf } from "@/lib/dueState";

/**
 * Die Quellen mit einem Altlast-Schnitt.
 *
 * Auf /nachfassen ist davon nur noch `recycling` übrig; die drei anderen zählt
 * bis auf Weiteres der Navigations-Zähler mit (siehe Kopf).
 */
export type StaleSource = "telefon" | "setting" | "closing" | "recycling";

/** Tage NACH der Fälligkeit, ab denen eine Aufgabe als Altlast gilt. */
export const STALE_AFTER_DAYS: Record<StaleSource, number> = {
  telefon: 14,
  setting: 30,
  closing: 30,
  recycling: 90,
};

/**
 * Trägt diese Quelle einen Altlast-Schnitt? Gibt den verengten Schlüssel
 * zurück, damit der Aufrufer ohne Typzusicherung damit weiterrechnen kann.
 *
 * `linkedin` liefert bewusst `null`: Der Wert kommt aus `nachfassen_tasks`
 * weiterhin an, aber keine Oberfläche zeigt ihn — eine Grenze dafür wäre eine
 * Aussage über etwas, das niemand sieht.
 */
export function staleSourceOf(source: string): StaleSource | null {
  return source === "telefon" || source === "setting" || source === "closing" || source === "recycling"
    ? source
    : null;
}

/**
 * Ist diese Fälligkeit so lange vorbei, dass sie eine Altlast ist?
 *
 * `today` kommt vom Aufrufer und nicht aus `new Date()`: Ein Board voller
 * Karten würde sonst mitten im Durchlauf den Tag wechseln, und zwei Aufgaben
 * mit derselben Fälligkeit fielen verschieden aus.
 *
 * OHNE Fälligkeitswert gibt es keine Aussage — dann bleibt die Aufgabe
 * sichtbar. Wo die Seite nichts über das Alter weiß, behauptet sie auch nichts
 * (docs §5.4).
 */
export function isStaleDue(source: StaleSource, dueAt: string | null | undefined, today: string): boolean {
  if (!dueAt || !today) return false;
  const day = dueDayOf(dueAt);
  if (!day) return false;
  return day < addDaysISO(today, -STALE_AFTER_DAYS[source]);
}
