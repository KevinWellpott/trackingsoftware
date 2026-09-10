// Der Quicklink-Streifen auf dem Dashboard.
//
// WARUM ES DIESE DATEI GIBT: Die Quicklinks sind die Gegenleistung dafür, dass
// die Seitenleiste seit dem Umbau komplett zugeklappt startet. Fallen sie weg
// oder verlieren sie ihre Zahlen, verliert der Nutzer den Tageseinstieg — und
// zwar lautlos: Die Seite sähe danach vollkommen normal aus, nur eben ohne die
// eine Stelle, an der morgens steht, was offen ist. Drei Eigenschaften sind
// dabei besonders leicht zu verlieren, und jede kostet etwas anderes:
//
//  1. DIE ZIELE. Drei Wege plus die Anlege-Aktion — genau der Block „Meine
//     Arbeit" der Seitenleiste. Wer hier „Analyse" dazustellt, macht aus dem
//     Einstieg wieder eine Liste. (Es waren vier, bis der Rückbau
//     /erinnerungen abgeschaltet hat.)
//  2. DIE ZAHLEN. Ohne sie ist ein Quicklink ein Lesezeichen. Und `null` darf
//     nie als 0 erscheinen — die Doktrin des Projekts (lib/navCounts.ts).
//  3. DAS EINMALIGE LADEN. Layout und Seite brauchen dieselben vier Abfragen.
//     Zweimal geladen kostet das nicht nur einen Roundtrip, sondern erzeugt auf
//     zwei nebeneinander sichtbaren Flächen zwei verschiedene Zahlen.
//
// GEPRÜFT WIRD AM QUELLTEXT — dieselbe Bauart wie sidebarBloecke.test.ts. Der
// Streifen ist eine Client Component mit JSX; der Test-Runner (`node
// --experimental-strip-types`) kann `.tsx` nicht laden.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const QUICKLINKS = read("src/components/dashboard/QuickLinks.tsx");
const PAGE = read("src/app/(dashboard)/page.tsx");
const LAYOUT = read("src/app/(dashboard)/layout.tsx");
const DATA = read("src/lib/navCountsData.ts");
const NAVCOUNTS = read("src/lib/navCounts.ts");
const SIDEBAR = read("src/components/Sidebar.tsx");

function zaehle(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ------------------------------------------------------------------ *
 * 1. Die Ziele
 * ------------------------------------------------------------------ */

describe("Ziele", () => {
  test("die drei Wege sind der Kalender plus die zwei Aufgabenlisten", () => {
    // docs/data-model.md §1: /termine (wer steht an), /nachfassen (heute
    // fällig), /ablage (aus dem Funnel gefallen). Das ist exakt der Block
    // „Meine Arbeit" der Seitenleiste; ersetzt wird, was das Zuklappen
    // verdeckt, nicht eine neu erfundene Auswahl.
    //
    // Es waren VIER, bis der Rückbau /erinnerungen abgeschaltet hat. Nachgerückt
    // ist bewusst keine neue Kachel — der Streifen spiegelt die Seitenleiste,
    // und dort ist die Zeile ebenfalls weg.
    for (const href of ["/termine", "/nachfassen", "/ablage"]) {
      assert.ok(QUICKLINKS.includes(`href: "${href}"`), `${href} fehlt im Streifen`);
    }
    assert.equal(zaehle(QUICKLINKS, "href: \""), 3, "es sind nicht mehr genau drei Wege");
    // Geprüft am CODE, nicht am Fließtext: Der Kommentarkopf darf und soll
    // weiter erklären, warum es die vierte Kachel nicht mehr gibt.
    assert.doesNotMatch(QUICKLINKS, /href: "\/erinnerungen"/, "die Erinnerungs-Kachel ist zurück");
    assert.doesNotMatch(QUICKLINKS, /BellRing/, "das Erinnerungs-Icon wird noch importiert");
  });

  test("Termine steht vorn — die zentrale Arbeitsfläche zuerst", () => {
    // Die Terminliste wird die eine Liste je Person; die erste Kachel ist die,
    // auf die morgens der Blick fällt. Vorher stand dort „Erinnerungen".
    const termine = QUICKLINKS.indexOf('href: "/termine"');
    const nachfassen = QUICKLINKS.indexOf('href: "/nachfassen"');
    const ablage = QUICKLINKS.indexOf('href: "/ablage"');
    assert.ok(termine !== -1 && nachfassen !== -1 && ablage !== -1);
    assert.ok(termine < nachfassen, "Termine ist hinter Nachfassen gerutscht");
    assert.ok(nachfassen < ablage, "die Ablage steht vor der Tagesarbeit");
  });

  test("jeder Weg sagt, welche Frage er beantwortet", () => {
    // Ohne den Zusatz sind „Nachfassen" und „Ablage" zwei ähnlich klingende
    // Wörter — dieselbe Verwechslung, gegen die in der Seitenleiste die
    // Tooltips stehen. Hier ist der Hinweis sichtbar statt versteckt: Auf einer
    // Kachel ist Platz dafür.
    //
    // „Kalender" stand hier als Soll und war seit dem Rückbau falsch: /termine
    // öffnet in der ARBEITSLISTE, der Kalender ist der zweite Reiter. Ein
    // Hinweis, der die falsche Sache verspricht, ist schlimmer als keiner —
    // ausgerechnet auf der Kachel, die morgens als erste angeklickt wird.
    for (const hint of ["Heute fällig", "Wer liegt in der Luft", "Aus dem Funnel gefallen"]) {
      assert.ok(QUICKLINKS.includes(`hint: "${hint}"`), `Der Hinweis „${hint}" fehlt`);
    }
    assert.doesNotMatch(QUICKLINKS, /hint: "Kalender"/, "die Kachel verspricht wieder den Kalender");
  });

  test("die eine Anlege-Aktion ist dabei — und es bleibt bei einer", () => {
    // „Termin buchen" steht in der Seitenleiste außerhalb aller Blöcke und ist
    // vom Zuklappen gar nicht betroffen; hier steht sie, weil morgens häufiger
    // ein Termin entsteht als gesucht wird. Ein zweiter Knopf im Streifen wäre
    // eine Werkzeugleiste, kein Einstieg.
    assert.match(QUICKLINKS, /<ManualAppointmentModal/);
    assert.equal(zaehle(QUICKLINKS, "<button"), 1);
    assert.match(QUICKLINKS, /onSaved=\{\(\) => router\.refresh\(\)\}/);
  });

  test("der Streifen steht über den Kennzahlen", () => {
    // „Was tue ich jetzt" kommt morgens vor „wie stehe ich da" — und unter dem
    // Zahlenblock läge der Streifen auf einem kleinen Laptop hinter einem
    // Scrollvorgang. Genau das war die Rückmeldung.
    const streifen = PAGE.indexOf("<QuickLinks");
    const kpi = PAGE.indexOf("KPI-REIHE");
    const kopf = PAGE.indexOf("<header");
    assert.notEqual(streifen, -1, "der Streifen steht gar nicht auf der Seite");
    assert.notEqual(kpi, -1);
    assert.ok(kopf < streifen, "der Streifen steht über dem Seitenkopf");
    assert.ok(streifen < kpi, "der Streifen ist unter die Kennzahlen gerutscht");
  });
});

/* ------------------------------------------------------------------ *
 * 2. Die Zahlen
 * ------------------------------------------------------------------ */

describe("Zähler", () => {
  test("der Aufgaben-Weg trägt seinen Zähler", () => {
    // Ein Quicklink „Nachfassen" ohne die Zahl offener Aufgaben ist ein
    // Lesezeichen; mit ihr ist er eine Arbeitsanweisung.
    assert.ok(QUICKLINKS.includes("counts?.nachfassen ?? null"), "Der Nachfassen-Zähler fehlt");
  });

  test("die Ablage hat ihren Zähler VERLOREN — samt seiner Beschriftung", () => {
    // Er zählte `dropout_lists('ersatztermin_offen')`, die einzige
    // Ablage-Ansicht mit einer offenen Handlung — und genau die hat der Rückbau
    // aus der Ablage genommen (ihr Inhalt steht täglich in der Terminliste).
    // Das Badge zeigte danach eine Zahl aus einer Menge, die es nicht mehr gab,
    // und führte auf eine disjunkte Ansicht.
    //
    // Umgehängt wurde er nicht: Beide verbliebenen Ansichten sind
    // Aktenschränke, die nie auf null gehen — „ein Badge auf einem Archiv, das
    // nie auf null geht, ist eine Mahnung ohne Adressat" (docs §5.4).
    assert.doesNotMatch(QUICKLINKS, /counts\?\.ablage/);
    assert.doesNotMatch(QUICKLINKS, /ABLAGE_COUNT_LABEL/);
    assert.doesNotMatch(NAVCOUNTS, /ABLAGE_COUNT_LABEL/);
    // Die Kachel selbst bleibt: Der Weg in die Ablage ist weiter ein Weg, nur
    // eben keine Aufgabe.
    assert.ok(QUICKLINKS.includes('href: "/ablage"'));
  });

  test("die Arbeitsliste bekommt bewusst keinen Zähler", () => {
    // Ihr Gold ist ABGELEITET (lib/dranRegel.ts): Zustand, Absage,
    // Nachfass-Stempel, Berliner Tagesgrenze. Ein Badge müsste dieselben Zeilen
    // laden wie die Seite — auf jeder Seite — oder die Regel ein zweites Mal
    // als Filter formulieren; genau dagegen gibt es dranRegel.ts. Und /termine
    // ist die Fläche, die man ohnehin öffnet.
    assert.match(QUICKLINKS, /label: "Termine",[\s\S]{0,1200}?count: null,/);
  });

  test("nicht ermittelbar zeigt KEINE Zahl — und 0 auch nicht", () => {
    // Die Doktrin des Projekts (docs §5.4): `null` heißt „nicht ermittelbar",
    // nicht „null Aufgaben". Eine beruhigende 0 wäre eine Behauptung über die
    // Daten, die niemand geprüft hat.
    assert.match(QUICKLINKS, /const shows = Boolean\(l\.count && l\.count\.total > 0\);/);
    // Kein `?? 0` auf einer Gesamtzahl — genau so entstünde die stille 0.
    assert.doesNotMatch(QUICKLINKS, /total \?\? 0/);
    assert.doesNotMatch(QUICKLINKS, /\.total \|\| 0/);
  });

  test("Streifen und Seitenleiste zeigen dieselbe Zahl auf dieselbe Art", () => {
    // Beide Flächen sind auf dem Desktop gleichzeitig sichtbar. Ein eigener
    // Ton oder eine eigene Schwelle hier wäre zweimal dieselbe Zahl in zwei
    // Bedeutungen.
    for (const datei of [QUICKLINKS, SIDEBAR]) {
      assert.match(datei, /className="count-pill"/);
      assert.match(datei, /data-tone=\{[^}]*overdue > 0 \? "overdue" : undefined\}/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. Einmal laden, zweimal benutzen
 * ------------------------------------------------------------------ */

describe("Ladeweg", () => {
  test("Layout und Seite rufen dieselbe memoisierte Hülle auf", () => {
    // Ein zweiter `loadNavCounts`-Aufruf fährt dieselben vier Abfragen erneut —
    // und weil `dueRefNow()` eine echte Uhr ist, können Leiste und Streifen
    // danach zwei verschiedene Stände zeigen.
    assert.match(LAYOUT, /import \{ getNavCounts \} from "@\/lib\/navCountsData";/);
    assert.match(PAGE, /import \{ getNavCounts \} from "@\/lib\/navCountsData";/);
    assert.match(LAYOUT, /getNavCounts\(\)/);
    assert.match(PAGE, /getNavCounts\(\)/);
    // Und keiner von beiden greift an der Hülle vorbei.
    assert.doesNotMatch(LAYOUT, /loadNavCounts\(/);
    assert.doesNotMatch(PAGE, /loadNavCounts\(/);
  });

  test("memoisiert wird mit React cache() — pro Anfrage, nie darüber hinaus", () => {
    // `use cache`/`unstable_cache` hielten über Anfragen hinweg und zeigten dem
    // nächsten Nutzer fremde Aufgaben: Die Zahlen hängen an Cookies (Datensicht,
    // aktive Organisation) und am angemeldeten Konto. `cache()` kann das
    // strukturell nicht — dieselbe Begründung wie bei `getAccessContext`.
    assert.match(DATA, /import \{ cache \} from "react";/);
    assert.match(DATA, /export const getNavCounts = cache\(async function getNavCounts\(\)/);
    // Kein persistenter Cache: weder ein Import aus `next/cache` noch die
    // Direktive. (Im Kommentarkopf dürfen beide vorkommen — dort steht, warum
    // sie hier falsch wären.)
    assert.doesNotMatch(DATA, /from "next\/cache"/);
    assert.doesNotMatch(DATA, /^\s*"use cache";?$/m);
  });

  test("die Hülle nimmt keine Argumente — sonst greift die Memoisierung nicht", () => {
    // `cache()` schlüsselt über die Argument-IDENTITÄT. Ein durchgereichter
    // Supabase-Client wäre bei Layout und Seite je ein frisch gebautes Objekt:
    // zwei Cache-Einträge, kein Gewinn.
    assert.match(DATA, /getNavCounts\(\): Promise<NavCounts>/);
    assert.match(DATA, /const access = await getAccessContext\(\);/);
    assert.match(DATA, /if \(!access\) return EMPTY_NAV_COUNTS;/);
  });

  test("die Hülle liegt NICHT in navCounts.ts — dort hinge sie im Client-Bundle", () => {
    // Die Seitenleiste ist eine Client Component und importiert
    // ABLAGE_COUNT_LABEL aus navCounts.ts. Ein Wert-Import von `@/lib/access`
    // dort zöge `next/headers` in den Client-Bundle und bräche den Build —
    // dieselbe Trennung wie analyse.ts ↔ analyseData.ts.
    assert.match(SIDEBAR, /from "@\/lib\/navCounts"/);
    assert.doesNotMatch(NAVCOUNTS, /^import \{[^}]*\} from "@\/lib\/access";$/m);
    assert.match(NAVCOUNTS, /import type \{ AccessContext \} from "@\/lib\/access";/);
  });
});

/* ------------------------------------------------------------------ *
 * Design-Schema
 * ------------------------------------------------------------------ */

describe("Design-Schema", () => {
  test("keine neuen Farben und keine neuen Abstandsmaße", () => {
    // Ein eingeschleuster Hexwert oder ein rohes `px` wäre die leiseste Art,
    // aus dem System auszubrechen.
    assert.deepEqual(QUICKLINKS.match(/#[0-9a-fA-F]{3,8}/g) ?? [], []);
    assert.doesNotMatch(QUICKLINKS, /\brgba?\(/);
    assert.match(QUICKLINKS, /gap: "var\(--sp-6\)"/);
  });

  test("die vorhandenen Bausteine, kein neuer Kachel-Typ", () => {
    // `card`/`card-hover` und `grid-4-stat` trägt das Dashboard bereits; die
    // Kachel bricht damit auf Mobil genauso um wie die Kennzahlen darunter.
    assert.match(QUICKLINKS, /className="card card-hover"/);
    assert.match(QUICKLINKS, /className="grid-4-stat"/);
    assert.match(PAGE, /className="grid-4-stat"/);
  });
});
