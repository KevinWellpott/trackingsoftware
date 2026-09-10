// Kontaktfrequenz: „Wann haben wir diesen Lead zuletzt angefasst?"
//
// Übrig sind zwei Funktionen: `dayDiff` rechnet, `lastContactLabel`
// beschriftet. Beide werden von genau zwei Stellen gelesen — der Terminliste
// (`src/components/termine/TermineList.tsx`) und dem Lead-Dossier
// (`src/lib/leadDossier.ts`). Dass die Zahl an beiden Orten wortgleich heißt,
// ist der ganze Zweck dieser Datei: Eine Zahl, die auf zwei Seiten anders
// heißt, liest sich wie zwei verschiedene Zahlen.
//
// ── Was hier NICHT mehr steht ────────────────────────────────────────────────
// Die KONTAKTFREQUENZ-WARNUNG. `CONTACT_GAP_WARN_DAYS`, `contactAgeDays`,
// `isWithinContactGap` und `contactGapWindowStart` waren der amberfarbene
// Hinweis „Zuletzt kontaktiert vor …" auf den Karten in /nachfassen und
// /erinnerungen: ein Riegel gegen zu dichtes Anschreiben. Er ist ersatzlos
// entfallen, und zwar nicht aus Versehen — die neue Arbeitsliste sagt das
// Gegenteil: „Wer offen ist, wird JEDEN TAG kontaktiert." Eine Warnung vor
// dem täglichen Kontakt wäre eine Warnung vor dem Verfahren. Was von der
// Beobachtung bleibt, ist die reine Auskunft auf der Karte („heute",
// „gestern", „vor 4 Tagen") — sie mahnt nichts an, sie erzählt nur.
//
// WICHTIG zur Reichweite: Was die Terminliste über den letzten Kontakt weiß,
// ist immer WENIGER als das Dossier. Die Liste sieht nur den Nachfass-Stempel
// (`follow_up_last_contacted_at`, Migration 0041); das Dossier sieht
// zusätzlich Pitches, Anwahlen und geführte Termine. Die Zahl auf einer Karte
// ist deshalb eine Untergrenze — „mindestens so lange her" —, und der Verweis
// ins Dossier steht daneben, statt dass die Karte eine Vollständigkeit
// behauptet, die sie nicht hat.

const DAY_MS = 86_400_000;

/**
 * Ganze Kalendertage zwischen zwei Tagesdaten (YYYY-MM-DD).
 *
 * Gerechnet wird auf UTC-Mitternacht der beiden TAGESSTRINGS, nicht auf
 * Ortszeit: In Berlin hat der 29.3. nur 23 und der 25.10. 25 Stunden — eine
 * Rechnung in Ortszeit läge zweimal im Jahr einen Tag daneben. Die Umrechnung
 * eines Zeitstempels auf den Berliner Kalendertag passiert VOR dem Aufruf
 * (`berlinDateISO`), damit hier nichts über Zeitzonen zu wissen ist.
 */
export function dayDiff(aDay: string, bDay: string): number {
  const a = Date.parse(`${aDay}T00:00:00.000Z`);
  const b = Date.parse(`${bDay}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Die Beschriftung des letzten Kontakts — wortgleich in Terminliste und
 * Dossier.
 *
 * `null` heißt „noch nie", nicht „heute". Der Unterschied ist der ganze Grund,
 * warum die Funktion einen Nullwert annimmt: Eine 0 an dieser Stelle behauptete
 * einen Kontakt, den es nie gab.
 */
export function lastContactLabel(daysAgo: number | null): string {
  if (daysAgo == null) return "noch nie kontaktiert";
  if (daysAgo === 0) return "heute";
  if (daysAgo === 1) return "gestern";
  return `vor ${daysAgo} Tagen`;
}
