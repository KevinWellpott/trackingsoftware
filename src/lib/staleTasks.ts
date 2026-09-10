// Ab wann eine fällige Aufgabe eine ALTLAST ist.
//
// DAS PROBLEM: `/nachfassen` beantwortet „was ist heute fällig?" — und lieferte
// dafür alles aus, was jemals fällig geworden und nie abgehakt worden ist. Am
// ersten produktiven Tag standen dort 425 Aufgaben. Das ist keine Arbeitsliste
// mehr, sondern ein Archiv: Der überfällige Rückruf von gestern, um den es
// wirklich geht, liegt zwischen zweihundert Karteileichen und wird nie
// gefunden. Ein Board, das alles zeigt, zeigt nichts.
//
// WARUM DER SCHNITT BLEIBT, obwohl der LinkedIn-Zweig inzwischen gar nicht mehr
// auf der Seite steht und die Zahl damit von selbst einbricht: Keiner der drei
// verbleibenden Status läuft je von allein ab. Ein Erstgespräch bleibt
// `unqualifiziert`, ein Closing bleibt `nachfassen`, ein Lead bleibt
// `rueckruf` — bis jemand von Hand etwas anderes einträgt. Jede dieser Zeilen
// bleibt also für IMMER fällig, und der Bestand wächst monoton mit der
// Nutzungsdauer. Ohne Schnitt ist das Board nicht heute wieder voll, sondern
// in einem halben Jahr — und dann mit denselben 400 Karten.
//
// WAS HIER NICHT PASSIERT: Überfälliges pauschal ausblenden. Überfällige
// Aufgaben sind der ZWECK dieser Seite — der Schnitt liegt weit hinter dem
// Punkt, an dem eine Aufgabe überfällig wird, und trifft nur den Bestand, den
// niemand mehr abarbeitet.
//
// WARUM JE QUELLE EINE ANDERE ZAHL: Die fünf Quellen ticken in völlig
// verschiedenen Kadenzen (docs §1). Eine gemeinsame Zahl wäre für die eine
// Quelle zu scharf und für die andere wirkungslos:
//
//   · Telefon-Rückruf — 14 Tage. Der einzige Wert des Boards mit einer MIT DEM
//     LEAD VERABREDETEN Uhrzeit (`callback_at`, `DUE_GRANULARITY: moment`).
//     Zwei Wochen nach dem zugesagten Zeitpunkt ist die Verabredung kein
//     Versprechen mehr, sondern eine Notiz — anrufen darf man trotzdem, nur
//     eben nicht mehr „weil wir das so ausgemacht hatten".
//   · Setting- und Closing-Wiedervorlage — 30 Tage. Beide werden in
//     7-Tage-Schritten weitergeschoben (`FOLLOW_UP_PUSH_DAYS`). Wer vier solche
//     Schritte hat verstreichen lassen, hat den Vorgang nicht verschoben,
//     sondern liegen gelassen; er gehört in die Ablage, nicht in den Vormittag.
//   · Recycling — 90 Tage. Die Wartezeiten selbst liegen zwischen 28 und 270
//     Tagen (`pipeline_settings`, docs §5). Auf dieser Kadenz sind 30 Tage
//     Verzug nichts — ein Schnitt in der Größenordnung der anderen Quellen
//     würde hier reihenweise Leads erwischen, die planmäßig warten.
//
// LinkedIn steht bewusst NICHT in dieser Tabelle — der Zweig ist von der Seite
// verschwunden (actions/nachfassen.ts). `staleSourceOf("linkedin")` liefert
// deshalb `null`: Der Wert kommt aus der RPC weiterhin an, und eine Funktion,
// die für ihn eine Grenze behauptete, wäre eine Aussage über etwas, das die
// Seite nicht zeigt.
//
// DIE ZAHLEN STEHEN HIER UND NICHT IN DER OBERFLÄCHE: Die Server-Action
// entscheidet danach, der Navigations-Zähler schneidet mit derselben Funktion,
// und das Board beschriftet damit. Drei Kopien einer Zahl, die Aufgaben
// verschwinden lässt, laufen früher oder später auseinander — und dann nennt
// die Seite eine andere Grenze, als sie anwendet, oder das Badge zählt etwas
// anderes als die Liste darunter.

import { addDaysISO } from "@/lib/dates";
import { dueDayOf } from "@/lib/dueState";

/** Die vier Quellen mit einem Altlast-Schnitt (LinkedIn schneidet am Pitch). */
export type StaleSource = "telefon" | "setting" | "closing" | "recycling";

/** Tage NACH der Fälligkeit, ab denen eine Aufgabe als Altlast gilt. */
export const STALE_AFTER_DAYS: Record<StaleSource, number> = {
  telefon: 14,
  setting: 30,
  closing: 30,
  recycling: 90,
};

/** Beschriftung [Einzahl, Mehrzahl] für die Hinweiszeile des Boards. */
const STALE_LABELS: Record<StaleSource, [singular: string, plural: string]> = {
  telefon: ["Rückruf", "Rückrufe"],
  setting: ["Setting-Wiedervorlage", "Setting-Wiedervorlagen"],
  closing: ["Closing-Wiedervorlage", "Closing-Wiedervorlagen"],
  recycling: ["Recycling-Versuch", "Recycling-Versuche"],
};

/**
 * Trägt diese Quelle einen Altlast-Schnitt? Gibt den verengten Schlüssel
 * zurück, damit der Aufrufer ohne Typzusicherung in `StaleCounts` zählen kann.
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
 * sichtbar. Dieselbe Regel wie beim fehlenden Pitch-Datum: Wo die Seite nichts
 * über das Alter weiß, behauptet sie auch nichts (docs §5.4).
 */
export function isStaleDue(source: StaleSource, dueAt: string | null | undefined, today: string): boolean {
  if (!dueAt || !today) return false;
  const day = dueDayOf(dueAt);
  if (!day) return false;
  return day < addDaysISO(today, -STALE_AFTER_DAYS[source]);
}

export type StaleCounts = Record<StaleSource, number>;

/** Frischer Nullstand — bewusst eine Fabrik, kein geteiltes Objekt. */
export function emptyStaleCounts(): StaleCounts {
  return { telefon: 0, setting: 0, closing: 0, recycling: 0 };
}

export function staleTotal(counts: StaleCounts): number {
  return counts.telefon + counts.setting + counts.closing + counts.recycling;
}

/**
 * Die Aufschlüsselung für die Hinweiszeile: „12 Rückrufe (über 14 Tage
 * überfällig)". Quellen ohne Treffer fallen heraus — eine Null in der
 * Aufzählung erklärt nichts und macht die Zeile nur länger.
 *
 * Die Grenze steht in JEDEM Teil dabei, nicht einmal am Ende: Sie ist je
 * Quelle verschieden, und eine gemeinsame Nennung läse sich wie eine
 * gemeinsame Zahl.
 */
export function staleParts(counts: StaleCounts): string[] {
  const out: string[] = [];
  for (const source of ["telefon", "setting", "closing", "recycling"] as StaleSource[]) {
    const n = counts[source];
    if (n <= 0) continue;
    const [one, many] = STALE_LABELS[source];
    out.push(`${n} ${n === 1 ? one : many} (über ${STALE_AFTER_DAYS[source]} Tage überfällig)`);
  }
  return out;
}
