// Die Gliederung der Seitenleiste.
//
// WARUM ES DIESE DATEI GIBT: Die Blöcke sind eine Anordnung, kein Rechenweg —
// und Anordnungen gehen bei der nächsten Änderung lautlos verloren. Wer eine
// Zeile aus „Meine Arbeit" nach oben zieht, weil sie dort schneller erreichbar
// ist, nimmt ihr den Zähler-Kontext; wer das Abzeichen am zugeklappten Kopf
// entfernt, weil es doppelt aussieht, schaltet die einzige Benachrichtigung
// der App ab, sobald jemand den Block zuklappt. Beides sähe im Betrieb
// vollkommen normal aus.
//
// GEPRÜFT WIRD AM QUELLTEXT, nicht am Verhalten — dieselbe Bauart wie
// analyseVerdrahtung.test.ts und lifecycleWiring.test.ts. Die Seitenleiste ist
// eine Client Component mit JSX; der Test-Runner (`node
// --experimental-strip-types`) kann `.tsx` nicht laden, und eine Attrappe
// bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SIDEBAR = read("src/components/Sidebar.tsx");
const MOBILE = read("src/components/MobileHeader.tsx");

/** Der Abschnitt ab einem Anker bis zum nächsten `</CollapsibleSection>`. */
function block(id: string): string {
  const start = SIDEBAR.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `Block "${id}" existiert nicht mehr`);
  const end = SIDEBAR.indexOf("</CollapsibleSection>", start);
  assert.notEqual(end, -1, `Block "${id}" wird nicht geschlossen`);
  return SIDEBAR.slice(start, end);
}

function zaehle(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ------------------------------------------------------------------ *
 * Die Blöcke selbst
 * ------------------------------------------------------------------ */

describe("Gliederung", () => {
  test("es gibt genau fünf benannte Blöcke — nicht mehr", () => {
    // „Wenige, benannte Blöcke" ist die Anforderung. Ein sechster wäre wieder
    // eine Liste, die man liest statt überfliegt; deshalb steht die Zahl hier.
    const bloecke: [id: string, label: string][] = [
      ["arbeit", "Meine Arbeit"],
      ["linkedin", "LinkedIn"],
      ["telefon", "Telefon"],
      ["auswertung", "Auswertung"],
      ["verwaltung", "Verwaltung"],
    ];
    for (const [id, label] of bloecke) {
      assert.match(SIDEBAR, new RegExp(`id="${id}"`), `Block "${id}" fehlt`);
      assert.ok(block(id).includes(`label="${label}"`), `Block "${id}" heißt nicht mehr „${label}"`);
    }
    assert.equal(zaehle(SIDEBAR, "<CollapsibleSection"), bloecke.length);
  });

  test("die drei Nachfass-Mechanismen stehen zusammen in einem Block", () => {
    // docs/data-model.md §1: /nachfassen (heute fällig), /erinnerungen (nächste
    // Stunden) und /ablage (aus dem Funnel gefallen) beantworten dieselbe Frage
    // auf drei Zeitkörnungen. Getrennt in der Navigation werden sie zu drei
    // unabhängigen Werkzeugen, von denen man zwei nie öffnet.
    const arbeit = block("arbeit");
    for (const href of ["/termine", "/erinnerungen", "/nachfassen", "/ablage"]) {
      assert.ok(arbeit.includes(`href="${href}"`), `${href} steht nicht in „Meine Arbeit"`);
      // ... und nirgends sonst: eine zweite Zeile derselben Seite wäre ein
      // zweiter Zähler, der irgendwann etwas anderes zählt.
      assert.equal(zaehle(SIDEBAR, `href="${href}"`), 1, `${href} kommt mehrfach vor`);
    }
  });

  test("Einstieg und Anlege-Aktion liegen vor jeder Aufklappung", () => {
    // Suche, Heimweg und „Termin buchen" dürfen nie hinter einem zugeklappten
    // Block liegen — sie gehören zu keinem Thema.
    const ersterBlock = SIDEBAR.indexOf("<CollapsibleSection");
    assert.notEqual(ersterBlock, -1);
    for (const anker of ["<SearchTrigger", 'label="Dashboard"', ">Termin buchen<"]) {
      const pos = SIDEBAR.indexOf(anker);
      assert.notEqual(pos, -1, `${anker} nicht gefunden`);
      assert.ok(pos < ersterBlock, `${anker} ist in einen Block gerutscht`);
    }
  });

  test("nur Verwaltung startet zugeklappt", () => {
    // Alles, was heute schon sichtbar war, bleibt sichtbar — die Gliederung
    // soll ordnen, nicht wegnehmen. Export/Einstellungen/Organisationen ruft
    // man dagegen selten und gezielt auf.
    assert.ok(block("verwaltung").includes("defaultOpen={false}"));
    assert.equal(zaehle(SIDEBAR, "defaultOpen={false}"), 1);
  });
});

/* ------------------------------------------------------------------ *
 * Anforderung 1 — was aktiv ist, bleibt sichtbar
 * ------------------------------------------------------------------ */

describe("Die geöffnete Seite verschwindet nie in einem zugeklappten Block", () => {
  test("jeder Block weiß, ob die aktuelle Seite in ihm steckt", () => {
    for (const id of ["arbeit", "linkedin", "telefon", "auswertung", "verwaltung"]) {
      assert.match(
        block(id),
        /hasActive=\{containsActive\(pathname, [A-Z_]+_HREFS\)\}/,
        `Block "${id}" prüft den aktiven Pfad nicht`,
      );
    }
  });

  test("der gespeicherte Zustand kann einen aktiven Block nicht zuklappen", () => {
    // `stored || hasActive`: Der Block bleibt offen, egal was gespeichert ist.
    assert.match(SIDEBAR, /const open = stored \|\| hasActive;/);
    // Und der Schalter ist sichtbar gesperrt statt wirkungslos — ein Klick,
    // der nichts tut, ist schlimmer als einer, der fehlt.
    assert.match(SIDEBAR, /if \(!hasActive\) writeSectionOpen\(id, !open\);/);
    assert.match(SIDEBAR, /aria-disabled=\{hasActive \|\| undefined\}/);
    // `disabled` wäre falsch: es nimmt in mehreren Browsern die Maus-Ereignisse
    // mit und damit den Tooltip, der die einzige Erklärung dafür ist.
    assert.doesNotMatch(SIDEBAR, /disabled=\{hasActive\}/);
  });

  test("Unterseiten halten ihren Block offen, nicht nur die Übersichtsseite", () => {
    // /lists/<id>, /ansicht/<id> und /analyse/vergleich müssen mitzählen —
    // sonst ließe sich der Block zuklappen, in dem man gerade arbeitet.
    assert.match(SIDEBAR, /const LINKEDIN_HREFS = \["\/listen", "\/lists", "\/ansicht"\]/);
    assert.match(SIDEBAR, /const AUSWERTUNG_HREFS = \["\/team", "\/analyse"\]/);
    // Beide Seiten derselben Regel: NavLink färbt danach, der Block klappt
    // danach auf. Zwei Fassungen liefen früher oder später auseinander.
    assert.match(SIDEBAR, /const isActive = matchesHref\(pathname, href, exact\);/);
    assert.match(SIDEBAR, /return hrefs\.some\(\(h\) => matchesHref\(pathname, h\)\);/);
  });
});

/* ------------------------------------------------------------------ *
 * Anforderung 2 — der Zähler überlebt das Zuklappen
 * ------------------------------------------------------------------ */

describe("Navigations-Zähler", () => {
  test("der zugeklappte Block trägt die Summe seiner drei Zähler", () => {
    // Ein Abzeichen, das man nur nach dem Aufklappen sieht, ist keine
    // Benachrichtigung. Gezeigt wird es NUR zugeklappt (aufgeklappt stehen
    // daneben die Einzelzahlen), und es erbt den Überfällig-Ton.
    assert.match(SIDEBAR, /const badge = !open && count && count\.total > 0 \? count : null;/);
    assert.match(SIDEBAR, /data-tone=\{badge\.overdue > 0 \? "overdue" : undefined\}/);
    assert.ok(block("arbeit").includes("count={arbeitCount}"));
    assert.match(
      SIDEBAR,
      /const arbeitCount = sumNavCounts\(\[\s*navCounts\?\.erinnerungen,\s*navCounts\?\.nachfassen,\s*navCounts\?\.ablage,\s*\]\);/,
    );
  });

  test("die Einzelzähler an den Zeilen bleiben erhalten", () => {
    const arbeit = block("arbeit");
    assert.ok(arbeit.includes("count={navCounts?.erinnerungen}"));
    assert.ok(arbeit.includes("count={navCounts?.nachfassen}"));
    assert.ok(arbeit.includes("count={navCounts?.ablage}"));
    // Die Ablage zählt bewusst nur die eine Liste mit offener Handlung; ihre
    // Beschriftung kommt deshalb aus navCounts.ts, nicht von hier.
    assert.ok(arbeit.includes("countLabel={ABLAGE_COUNT_LABEL}"));
  });

  test("nicht ermittelbar wird nicht zur beruhigenden 0", () => {
    // lib/navCounts.ts: `null` heißt „keine Datengrundlage". Sind alle drei
    // Zweige null, darf am Kopf keine 0 stehen, sondern gar kein Abzeichen.
    assert.match(SIDEBAR, /return known \? \{ total, overdue \} : null;/);
  });

  test("Seitenleiste und mobiler Menü-Punkt bilden dieselbe Summe", () => {
    // Zwei eigene Summen wären zwei Gelegenheiten, dieselbe Zahl verschieden
    // zu bilden — auf genau den beiden Flächen, die nebeneinander stehen.
    assert.match(MOBILE, /import \{ MobileDrawer, sumNavCounts \} from "\.\/Sidebar";/);
    assert.match(MOBILE, /sumNavCounts\(\[navCounts\?\.nachfassen, navCounts\?\.erinnerungen, navCounts\?\.ablage\]\)/);
    assert.doesNotMatch(MOBILE, /reduce\(\(n, c\) => n \+ \(c\?\./);
  });
});

/* ------------------------------------------------------------------ *
 * Anforderung 3 — der Zustand überlebt den Seitenwechsel
 * ------------------------------------------------------------------ */

describe("Aufklapp-Zustand", () => {
  test("liegt im localStorage, nicht in der Komponente", () => {
    // Ein `useState` klappt bei jedem Seitenwechsel neu auf — die Gliederung
    // wäre dann lästiger als die flache Liste davor.
    assert.match(SIDEBAR, /const SECTION_KEY = "sidebar:sections-open";/);
    assert.match(SIDEBAR, /localStorage\.setItem\(SECTION_KEY, JSON\.stringify\(state\)\)/);
    assert.match(SIDEBAR, /localStorage\.getItem\(SECTION_KEY\)/);
  });

  test("folgt dem vorhandenen Muster der Analyse-Filterleiste", () => {
    // useSyncExternalStore + Server-Snapshot: kein Hydrations-Konflikt und
    // keine zweite Render-Runde durch useEffect+setState.
    assert.match(SIDEBAR, /useSyncExternalStore\(\s*subscribeSections,/);
    assert.match(SIDEBAR, /useCallback\(\(\) => readSectionOpen\(id, defaultOpen\), \[id, defaultOpen\]\)/);
    assert.match(SIDEBAR, /useCallback\(\(\) => defaultOpen, \[defaultOpen\]\)/);
    // Blockiertes localStorage (Private Mode) darf die Navigation nicht
    // mitnehmen — dann gelten eben die Vorbelegungen.
    assert.match(SIDEBAR, /catch \{\s*\/\* blockiert oder kaputter Wert/);
  });

  test("ein Schlüssel für alle Blöcke — Desktop-Leiste und Drawer bleiben synchron", () => {
    // Auf Mobil stehen beide gleichzeitig im DOM (MobileHeader rendert den
    // Drawer, das Layout die Leiste). Mit eigenem State je Instanz zeigten sie
    // nach dem ersten Klick verschiedene Zustände derselben Blöcke.
    assert.equal(zaehle(SIDEBAR, "sidebar:sections-open"), 2); // Schlüssel + Event
    assert.match(SIDEBAR, /window\.dispatchEvent\(new Event\(SECTION_EVENT\)\)/);
    assert.match(SIDEBAR, /window\.addEventListener\("storage", onStorage\)/);
  });
});

/* ------------------------------------------------------------------ *
 * Design-Schema
 * ------------------------------------------------------------------ */

describe("Design-Schema", () => {
  test("keine neuen Farben — Graustufen, Orange und der eine Überfällig-Ton", () => {
    // Die Farbregel steht als Kopfkommentar in der Datei. Ein eingeschleuster
    // Hexwert wäre die leiseste Art, sie zu brechen.
    const hex = SIDEBAR.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    assert.deepEqual([...new Set(hex)], ["#0a0a0b"], "neuer Hexwert in der Seitenleiste");
    assert.doesNotMatch(SIDEBAR, /\brgba?\(/);
  });

  test("die Blöcke benutzen die vorhandenen Bausteine", () => {
    // Kein zweiter Aufklapp-Baustein neben CollapsibleSection, keine eigene
    // Zähler-Pille neben .count-pill.
    assert.equal(zaehle(SIDEBAR, "function CollapsibleSection"), 1);
    assert.match(SIDEBAR, /className="count-pill"/);
    assert.match(SIDEBAR, /const titleClass = forcedOpen \? "eyebrow" : "eyebrow eyebrow-muted";/);
  });
});
