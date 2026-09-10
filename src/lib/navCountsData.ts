// Die Aufgaben-Zähler EINER Anfrage — einmal geladen, zweimal benutzt.
//
// WARUM DIESE DATEI ÜBERHAUPT EXISTIERT (und nicht einfach `loadNavCounts`):
// Die Zahlen brauchen jetzt zwei Stellen pro Seitenaufruf — die Seitenleiste in
// `(dashboard)/layout.tsx` und der Quicklink-Streifen auf dem Dashboard. Ein
// zweiter Aufruf von `loadNavCounts()` fährt dieselbe Abfrage ein zweites Mal
// und riskiert zusätzlich, dass beide Flächen unterschiedliche Zahlen zeigen:
// Die Abfragen laufen Sekundenbruchteile auseinander, und `dueRefNow()` ist
// eine echte Uhr. Zwei Badges nebeneinander mit verschiedenen Zahlen sind
// schlimmer als eines.
//
// WARUM `cache()` AUS REACT UND NICHT `use cache`/`unstable_cache`: Genau die
// Begründung aus `getAccessContext` (src/lib/access.ts) — die Zahlen hängen an
// Cookies (Datensicht, aktive Organisation) und am angemeldeten Konto. Ein
// Cache über Anfragen hinweg zeigte dem nächsten Nutzer fremde Aufgaben.
// `cache()` kann das strukturell nicht: Der Speicher hängt am React-Request und
// wird über AsyncLocalStorage aufgelöst, seine Reichweite ist höchstens EIN
// Render (Next-Guide „Deduplicating requests", 02-guides/caching-without-
// cache-components.md). Ohne laufenden Request — Server Action, Route Handler —
// greift gar keine Memoisierung, die Funktion läuft dann wie bisher durch.
// Layout und Seite rendern in genau einem solchen Render-Durchlauf, teilen sich
// also einen Aufruf; das ist die Konstellation, für die `cache()` gemacht ist.
//
// WARUM SIE OHNE ARGUMENTE ARBEITET: `cache()` schlüsselt über die Argumente,
// und zwar per Identität. `loadNavCounts(supabase, access)` bekäme vom Layout
// und von der Seite je einen frisch gebauten Supabase-Client — zwei
// verschiedene Referenzen, zwei Cache-Einträge, kein Gewinn. Diese Hülle nimmt
// nichts entgegen und holt sich beides selbst; `getAccessContext()` ist
// seinerseits gecacht und kostet dabei nichts.
//
// WARUM EINE EIGENE DATEI UND NICHT UNTEN IN `navCounts.ts`: Jene Datei wird
// von der Seitenleiste und vom Quicklink-Streifen importiert — beides Client
// Components. Ein Wert-Import von `@/lib/access` in `navCounts.ts` zöge
// `next/headers` in den Client-Bundle und bräche den Build. Dieselbe Trennung
// wie bei `analyse.ts` ↔ `analyseData.ts`.

import { cache } from "react";

import { getAccessContext } from "@/lib/access";
import { EMPTY_NAV_COUNTS, loadNavCounts, type NavCounts } from "@/lib/navCounts";
import { createClient } from "@/lib/supabase/server";

export const getNavCounts = cache(async function getNavCounts(): Promise<NavCounts> {
  const access = await getAccessContext();
  // Ohne Kontext gibt es keine Zahlen — und `null` heißt „nicht ermittelbar",
  // nicht „null Aufgaben" (src/lib/navCounts.ts).
  if (!access) return EMPTY_NAV_COUNTS;
  return loadNavCounts(await createClient(), access);
});
