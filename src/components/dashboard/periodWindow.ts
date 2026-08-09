import { berlinInputToIso } from "@/lib/apptTime";
import { addDaysISO } from "@/lib/dates";

/**
 * Zeitfenster-Grenzen für Filter auf `timestamptz`-Spalten der Dashboards.
 *
 * Warum eigene Funktionen statt roher Datumsstrings: PostgREST reicht
 * `gte=2026-08-03` unverändert an Postgres weiter, das den String als
 * UTC-Mitternacht liest. Im Sommer liegt Berlin-Mitternacht aber zwei Stunden
 * FRÜHER — Termine vom Montagmorgen fielen damit in die Vorwoche und die
 * Wochenzahlen von Dashboard und Termin-Kalender widersprächen sich
 * (docs/data-model.md §6).
 *
 * Gehört fachlich zu `src/lib/apptTime.ts`; liegt hier, weil die Datei im
 * laufenden Umbau von einem anderen Paket gehalten wird.
 */

/** Berlin-Mitternacht eines Kalendertags als echtes ISO-UTC. */
export function berlinDayStartIso(day: string): string {
  // Der Fallback greift nur bei kaputter Eingabe — die Aufrufer übergeben
  // ausschließlich bereits validierte ISO-Kalendertage.
  return berlinInputToIso(`${day}T00:00`) ?? `${day}T00:00:00.000Z`;
}

/**
 * Halboffenes Fenster `[from, to]` als UTC-Grenzen: untere Grenze ist
 * Berlin-Mitternacht des ersten Tags, obere Grenze Berlin-Mitternacht des
 * FOLGETAGS von `to` — damit der letzte Tag vollständig zählt.
 *
 * Verwendung: `.gte("spalte", startIso).lt("spalte", endIso)`.
 */
export function berlinWindowIso(from: string, to: string): { startIso: string; endIso: string } {
  return {
    startIso: berlinDayStartIso(from),
    endIso: berlinDayStartIso(addDaysISO(to, 1)),
  };
}
