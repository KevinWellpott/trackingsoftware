// Die Zahlen der Navigation — serverseitig, einmal je Anfrage (`cache()`).
//
// Seit dem Nachfass-Eingang (Plan M8) liest das Badge DENSELBEN Loader wie die
// Seite `/nachfassen` (`ladeNachfassen`, src/lib/nachfassenData.ts) und zählt
// mit derselben Gruppierung: überfällig + heute + „Ergebnis fehlt", ohne den
// Reiter „Aufräumen". Ein Badge, das anders zählt als die Seite darunter, ist
// laut docs §5.4 ein Fehler — deshalb gibt es hier keine eigene Abfrage.
//
// Eigene Datei, weil src/lib/navCounts.ts von Client-Komponenten importiert
// wird und Server-Module dort nichts verloren haben.

import { cache } from "react";

import { getAccessContext } from "@/lib/access";
import { ladeNachfassen } from "@/lib/nachfassenData";
import { badgeZahl, gruppiere } from "@/lib/nachfassRegel";
import { EMPTY_NAV_COUNTS, type NavCounts } from "@/lib/navCounts";

/** Was länger braucht, liefert kein Badge, statt das Layout aufzuhalten. */
const DEADLINE_MS = 1500;

export const getNavCounts = cache(async function getNavCounts(): Promise<NavCounts> {
  const access = await getAccessContext();
  // `null` heißt „nicht ermittelbar", nicht „null Aufgaben".
  if (!access) return EMPTY_NAV_COUNTS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DEADLINE_MS);
  });
  try {
    const daten = await Promise.race([ladeNachfassen("mein"), frist]);
    if (!daten || !daten.vollstaendig || !daten.recyclingVerfuegbar) return EMPTY_NAV_COUNTS;
    return { nachfassen: badgeZahl(gruppiere(daten.eintraege, daten.today, daten.nowMs)) };
  } catch {
    return EMPTY_NAV_COUNTS;
  } finally {
    if (timer) clearTimeout(timer);
  }
});
