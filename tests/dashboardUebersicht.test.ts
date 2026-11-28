// Die Übersicht (Dashboard) nach dem Redesign „Liquid Glass" (Phase 6).
//
// Löst dashboardQuicklinks.test.ts ab: Der Quicklink-Streifen ist in den
// Kennzahl-Modulen und der Karte „Heute dran" aufgegangen. Seine
// Zusicherungen gelten weiter, nur an anderer Stelle:
//
//  1. DER TAGESEINSTIEG. Die Seitenleiste trägt „Heute" jetzt offen oben; die
//     Übersicht zeigt zusätzlich, WER heute dran ist — aus demselben Loader wie
//     die Seite /nachfassen und das Badge (keine eigene Abfrage).
//  2. DIE ZAHLEN. `null` heißt „nicht ermittelbar" und erscheint nie als 0
//     (docs §5.4).
//  3. DAS EINMALIGE LADEN. Layout und Seite rufen dieselbe memoisierte Hülle.
//  4. DER TRICHTER beginnt beim Termin; DMs und Anwahlen werden nie addiert.
//
// GEPRÜFT WIRD AM QUELLTEXT — dieselbe Bauart wie sidebarBloecke.test.ts.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const PAGE = read("src/app/(dashboard)/page.tsx");
const KARTEN = read("src/components/dashboard/HeuteKarten.tsx");
const MODUL = read("src/components/dashboard/KennzahlModul.tsx");
const LAYOUT = read("src/app/(dashboard)/layout.tsx");
const DATA = read("src/lib/navCountsData.ts");
const NAVCOUNTS = read("src/lib/navCounts.ts");
const SIDEBAR = read("src/components/Sidebar.tsx");

/* ------------------------------------------------------------------ *
 * 1. Heute dran — dieselbe Menge wie Seite und Badge
 * ------------------------------------------------------------------ */

describe("Heute dran", () => {
  test("liest den Loader der Seite /nachfassen, keine eigene Abfrage", () => {
    // Die schlanke Form desselben Loaders — dieselbe, die das Badge liest.
    assert.match(PAGE, /import \{ ladeNachfassenSchlank \} from "@\/lib\/nachfassenData";/);
    assert.match(PAGE, /ladeNachfassenSchlank\(\)/);
    assert.match(PAGE, /gruppiere\(nachfassen\.eintraege, nachfassen\.today, nachfassen\.nowMs\)/);
    // Genau die Gruppen des Badges: Ergebnis fehlt · überfällig · heute — ohne
    // „Aufräumen", „Demnächst" und „Wartet" (nachfassRegel.badgeZahl).
    assert.match(PAGE, /\["ergebnis_fehlt", "ueberfaellig", "heute"\] as const/);
  });

  test("die Zahl kommt aus derselben Menge wie die Liste — gezählt wie das Badge", () => {
    // Punkt 5 (28.11.): Vorher kam die Zahl aus dem Badge mit seiner Frist —
    // dauerte das Laden länger, stand „—“ neben einer vollen Liste.
    assert.match(PAGE, /const dranZahl = nfGruppen && nachfassen\?\.vollstaendig \? badgeZahl\(nfGruppen\) : null;/);
    assert.match(PAGE, /gesamt=\{dranZahl\?\.total \?\? null\}/);
  });

  test("der Quicklink-Streifen ist weg — und mit ihm keine zweite Zählweise", () => {
    assert.equal(existsSync(fileURLToPath(new URL("../src/components/dashboard/QuickLinks.tsx", import.meta.url))), false);
    assert.doesNotMatch(PAGE, /QuickLinks/);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Die Zahlen
 * ------------------------------------------------------------------ */

describe("Zähler", () => {
  test("nicht ermittelbar zeigt „—“, nie eine 0", () => {
    assert.match(PAGE, /value=\{dranZahl === null \? "—" : dranZahl\.total\.toLocaleString\("de-DE"\)\}/);
    assert.match(KARTEN, /gesamt === null \? "—"/);
    assert.doesNotMatch(PAGE, /dranZahl\?\.total \?\? 0/);
  });

  test("Gold nur am Modul der Arbeitsmenge", () => {
    // Gold heißt ausnahmslos „du bist dran" (lib/dranRegel.ts).
    assert.equal(PAGE.split("dran={").length - 1, 1);
    assert.match(MODUL, /data-dran=\{dran \? "true" : undefined\}/);
  });

  test("die Kennzahl-Definitionen sind die bisherigen", () => {
    // „Termine gelegt" = Buchung, Closings nach Gesprächsperson, Anwahlen aus
    // dem Anruf-Log (docs §5, §0.2).
    assert.match(PAGE, /supabase\.rpc\("rpc_appointments_booked"/);
    assert.match(PAGE, /\.or\(gespraechsFilter\)/);
    assert.match(PAGE, /loadDialRows\(/);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Einmal laden, zweimal benutzen
 * ------------------------------------------------------------------ */

describe("Ladeweg", () => {
  test("Layout (Badge) und Seite teilen denselben memoisierten Loader", () => {
    assert.match(LAYOUT, /import \{ getNavCounts \} from "@\/lib\/navCountsData";/);
    assert.match(LAYOUT, /getNavCounts\(\)/);
    // Das Badge liest `ladeNachfassenSchlank`, die Übersicht auch — per
    // `cache()` läuft er je Anfrage einmal.
    assert.match(DATA, /ladeNachfassenSchlank\(\)/);
    assert.match(PAGE, /ladeNachfassenSchlank\(\)/);
    assert.doesNotMatch(PAGE, /getNavCounts/);
    assert.doesNotMatch(LAYOUT, /loadNavCounts\(/);
    assert.doesNotMatch(PAGE, /loadNavCounts\(/);
  });

  test("memoisiert wird mit React cache() — pro Anfrage, nie darüber hinaus", () => {
    assert.match(DATA, /import \{ cache \} from "react";/);
    assert.match(DATA, /export const getNavCounts = cache\(async function getNavCounts\(\)/);
    assert.doesNotMatch(DATA, /from "next\/cache"/);
    assert.doesNotMatch(DATA, /^\s*"use cache";?$/m);
  });

  test("die Hülle nimmt keine Argumente — sonst greift die Memoisierung nicht", () => {
    assert.match(DATA, /getNavCounts\(\): Promise<NavCounts>/);
    assert.match(DATA, /const access = await getAccessContext\(\);/);
    assert.match(DATA, /if \(!access\) return EMPTY_NAV_COUNTS;/);
  });

  test("die Hülle liegt NICHT in navCounts.ts — dort hinge sie im Client-Bundle", () => {
    assert.match(SIDEBAR, /from "@\/lib\/navCounts"/);
    assert.doesNotMatch(NAVCOUNTS, /^import \{[^}]*\} from "@\/lib\/access";$/m);
    assert.match(NAVCOUNTS, /import type \{ AccessContext \} from "@\/lib\/access";/);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Der Trichter „Von Termin zu Geld"
 * ------------------------------------------------------------------ */

describe("Trichter", () => {
  test("beginnt beim Termin — DMs und Anwahlen stehen nicht darin", () => {
    const start = PAGE.indexOf("const trichter = [");
    const ende = PAGE.indexOf("];", start);
    const block = PAGE.slice(start, ende);
    assert.match(block, /label: "Termine gelegt", value: bookedPeriod/);
    assert.doesNotMatch(block, /periodDms|periodDials|DMs|Anwahlen/);
  });

  test("zwischen zwei verschiedenen Mengen steht keine Quote", () => {
    // Termine zählen nach Buchung, Closings nach Closing-Termin — eine
    // Durchlassquote dazwischen wäre erfunden.
    assert.match(PAGE, /label: "Closings", value: closingTotal, bruch:/);
  });
});

/* ------------------------------------------------------------------ *
 * Design-Schema
 * ------------------------------------------------------------------ */

describe("Design-Schema", () => {
  test("keine festen Farben in den neuen Bausteinen", () => {
    for (const datei of [PAGE, KARTEN, MODUL]) {
      assert.deepEqual(datei.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], []);
      assert.doesNotMatch(datei, /\brgba?\(/);
    }
  });
});
