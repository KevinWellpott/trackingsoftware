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
const TABBAR = read("src/components/MobileBottomNav.tsx");
const NACHFASS_REGEL = read("src/lib/nachfassRegel.ts");

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
 * Die Gliederung selbst (Redesign Phase 4 — Prototyp-Navigation)
 * ------------------------------------------------------------------ */

// GEÄNDERTE ERWARTUNG (27.11.2026, Redesign „Liquid Glass" Phase 4): Aus den
// fünf aufklappbaren Blöcken („Meine Arbeit", LinkedIn, Telefon, Auswertung,
// Verwaltung) wurde die Gliederung des Prototyps — Einstieg oben offen
// (Übersicht · Heute · Kalender), darunter benannte Gruppen. Aufklappbar
// bleiben nur die zwei Listenbäume und die Verwaltung. Geprüft wird weiter die
// ANORDNUNG und die Prinzipien dahinter (eine Zeile je Seite, ein Badge, das
// die Menge der Seite zählt, Tooltips mit der Frage, keine toten Routen).

/** Position einer Gruppen-Überschrift. */
function gruppe(label: string): number {
  // Seit dem 28.11. sind die Bereiche einklappbar: `<NavGroup id=… label="…"`.
  const pos = SIDEBAR.indexOf(`label="${label}" hasActive=`);
  assert.notEqual(pos, -1, `Gruppe „${label}" fehlt`);
  return pos;
}

/** Der Quelltext eines NavLink mit diesem href (bis zum schließenden `/>`). */
function navLink(href: string): string {
  const start = SIDEBAR.indexOf(`href="${href}"`);
  assert.notEqual(start, -1, `${href} fehlt in der Seitenleiste`);
  const von = SIDEBAR.lastIndexOf("<NavLink", start);
  const bis = SIDEBAR.indexOf("/>", start);
  return SIDEBAR.slice(von, bis);
}

describe("Gliederung", () => {
  test("oben, offen und in dieser Reihenfolge: Übersicht · Heute · Kalender", () => {
    const uebersicht = SIDEBAR.indexOf('label="Übersicht"');
    const heute = SIDEBAR.indexOf('href="/nachfassen"');
    const kalender = SIDEBAR.indexOf('href="/termine"');
    assert.ok(uebersicht !== -1 && heute !== -1 && kalender !== -1);
    assert.ok(uebersicht < heute && heute < kalender, "Reihenfolge Übersicht · Heute · Kalender verloren");
    // Vor jeder Gruppe und jeder Aufklappung — der Tageseinstieg liegt nie
    // hinter einem zugeklappten Kopf.
    const ersteGruppe = SIDEBAR.indexOf("<NavGroup");
    const ersterBlock = SIDEBAR.indexOf("<CollapsibleSection");
    for (const pos of [uebersicht, heute, kalender]) {
      assert.ok(pos < ersteGruppe && pos < ersterBlock, "Ein Einstieg ist in eine Gruppe gerutscht");
    }
    assert.ok(navLink("/nachfassen").includes('label="Heute"'), "„Heute“ zeigt nicht auf /nachfassen");
    assert.ok(navLink("/termine").includes('label="Kalender"'), "„Kalender“ zeigt nicht auf /termine");
  });

  test("die Gruppen stehen in der Reihenfolge des Prototyps", () => {
    const reihe = ["Akquise", "Vertrieb", "Kunden", "Auswertung"].map(gruppe);
    for (let i = 1; i < reihe.length; i++) assert.ok(reihe[i - 1] < reihe[i], "Gruppen-Reihenfolge verloren");
    // Die Verwaltung bleibt unten, hinter dem Abstandhalter.
    assert.ok(SIDEBAR.indexOf('id="verwaltung"') > gruppe("Auswertung"));
  });

  test("Akquise trägt Telefon und LinkedIn mit ihren Listenbäumen", () => {
    const telefon = SIDEBAR.indexOf('id="telefon"');
    const linkedin = SIDEBAR.indexOf('id="linkedin"');
    assert.ok(telefon > gruppe("Akquise") && telefon < gruppe("Vertrieb"));
    assert.ok(linkedin > gruppe("Akquise") && linkedin < gruppe("Vertrieb"));
    assert.ok(block("telefon").includes("visiblePhoneLists.map"), "der Telefon-Listenbaum fehlt");
    assert.ok(block("linkedin").includes("visibleLists.map"), "der LinkedIn-Listenbaum fehlt");
  });

  test("Vertrieb: Setting · Closing — No-Shows und Ablage ohne eigene Zeile (28.11.)", () => {
    // /no-shows ist gestrichen (No-Shows stehen in „Heute“ und in /setting bzw.
    // /closing), die Ablage ist über „Heute → Wiedervorlage“ erreichbar.
    assert.equal(zaehle(SIDEBAR, 'href="/no-shows"'), 0);
    assert.equal(zaehle(SIDEBAR, 'href="/ablage"'), 0);
    const pos = ["/setting", "/closing"].map((h) => SIDEBAR.indexOf(`href="${h}"`));
    for (const p of pos) assert.ok(p > gruppe("Vertrieb") && p < gruppe("Kunden"), "eine Vertriebs-Zeile steht außerhalb der Gruppe");
    for (let i = 1; i < pos.length; i++) assert.ok(pos[i - 1] < pos[i], "Reihenfolge in „Vertrieb“ verloren");
  });

  test("Kunden nur dort, wo der interne Bereich sichtbar ist", () => {
    // Dieselbe Sichtbarkeitsregel wie der frühere Block „Intern" (Migration
    // 0047): nur in der Titan-Organisation, Umsatz nur mit Recht.
    assert.match(SIDEBAR, /\{intern\?\.kunden && \(\s*<NavGroup id="kunden" label="Kunden"/);
    assert.match(SIDEBAR, /\{intern\.umsatz && \(\s*<NavLink\s+href="\/umsatz"/);
    assert.ok(navLink("/umsatz").includes('label="Umsatz & Collect"'));
  });

  test("Team nur für Owner mit Team-Sicht", () => {
    assert.match(SIDEBAR, /\{dataView\?\.canSwitch && \(\s*<NavLink\s+href="\/team"/);
    // „Analyse" exakt — /analyse/vergleich hat eine eigene Zeile.
    assert.ok(navLink("/analyse").includes("exact"));
  });

  test("genau drei aufklappbare Blöcke: die zwei Listenbäume und die Verwaltung", () => {
    assert.equal(zaehle(SIDEBAR, "<CollapsibleSection"), 3);
    for (const id of ["telefon", "linkedin", "verwaltung"]) assert.match(SIDEBAR, new RegExp(`id="${id}"`));
  });

  test("jede Seite hat genau EINE Zeile", () => {
    // Eine zweite Zeile derselben Seite wäre ein zweiter Ort für einen Zähler,
    // der irgendwann etwas anderes zählt.
    for (const href of ["/nachfassen", "/termine", "/setting", "/closing", "/analyse", "/team"]) {
      assert.equal(zaehle(SIDEBAR, `href="${href}"`), 1, `${href} kommt mehrfach vor`);
    }
  });

  test("keine Zeile auf gelöschte Routen", () => {
    assert.doesNotMatch(SIDEBAR, /href="\/erinnerungen"/, "die Erinnerungs-Zeile ist zurück in der Seitenleiste");
    assert.doesNotMatch(SIDEBAR, /_HREFS = \[[^\]]*erinnerungen/, "/erinnerungen hält weiterhin einen Block offen");
    assert.doesNotMatch(SIDEBAR, /BellRing/, "das Erinnerungs-Icon wird noch importiert");
  });

  test("Einstieg und Anlege-Aktion liegen vor jeder Aufklappung", () => {
    const ersterBlock = SIDEBAR.indexOf("<CollapsibleSection");
    assert.notEqual(ersterBlock, -1);
    for (const anker of ["<SearchTrigger", 'label="Übersicht"', ">Termin buchen<"]) {
      const pos = SIDEBAR.indexOf(anker);
      assert.notEqual(pos, -1, `${anker} nicht gefunden`);
      assert.ok(pos < ersterBlock, `${anker} ist in einen Block gerutscht`);
    }
  });

  test("ALLE Blöcke starten zugeklappt", () => {
    assert.match(SIDEBAR, /const SECTION_DEFAULT_OPEN = false;/);
    assert.doesNotMatch(SIDEBAR, /defaultOpen\s*[=?:]/, "ein Block nimmt sich eine eigene Vorbelegung");
    assert.match(SIDEBAR, /useSyncExternalStore\([\s\S]{0,200}?readSectionDefault,/);
  });
});

/* ------------------------------------------------------------------ *
 * Anforderung 1 — was aktiv ist, bleibt sichtbar
 * ------------------------------------------------------------------ */

describe("Die geöffnete Seite verschwindet nie in einem zugeklappten Block", () => {
  test("jeder Block weiß, ob die aktuelle Seite in ihm steckt", () => {
    for (const id of ["linkedin", "telefon", "verwaltung"]) {
      assert.match(
        block(id),
        /hasActive=\{containsActive\(pathname, [A-Z_]+_HREFS\)\}/,
        `Block "${id}" prüft den aktiven Pfad nicht`,
      );
    }
  });

  test("auch zugeklappt vorbelegt bleibt der aktive Block offen", () => {
    assert.match(SIDEBAR, /const open = stored \|\| hasActive;/);
    assert.match(SIDEBAR, /const forcedOpen = hasActive && !stored;/);
    assert.match(SIDEBAR, /enthält die geöffnete Seite und bleibt aufgeklappt/);
  });

  test("der gespeicherte Zustand kann einen aktiven Block nicht zuklappen", () => {
    assert.match(SIDEBAR, /const open = stored \|\| hasActive;/);
    assert.match(SIDEBAR, /if \(!hasActive\) writeSectionOpen\(id, !open\);/);
    assert.match(SIDEBAR, /aria-disabled=\{hasActive \|\| undefined\}/);
    assert.doesNotMatch(SIDEBAR, /disabled=\{hasActive\}/);
  });

  test("Unterseiten halten ihren Block offen und färben ihre Zeile", () => {
    // /lists/<id> muss den LinkedIn-Block offen halten; /setting/<id> färbt
    // die Zeile „Setting" (Präfix-Regel in matchesHref).
    assert.match(SIDEBAR, /const LINKEDIN_HREFS = \["\/listen", "\/lists"\] as const;/);
    assert.match(SIDEBAR, /const isActive = matchesHref\(pathname, href, exact\);/);
    assert.match(SIDEBAR, /return hrefs\.some\(\(h\) => matchesHref\(pathname, h\)\);/);
    assert.match(SIDEBAR, /pathname === href \|\| \(href !== "\/" && pathname\.startsWith\(href \+ "\/"\)\)/);
  });
});

/* ------------------------------------------------------------------ *
 * Anforderung 2 — der Zähler zählt, was die Seite zeigt
 * ------------------------------------------------------------------ */

describe("Navigations-Zähler", () => {
  test("das einzige Abzeichen steht an „Heute“ (Entscheidung E2)", () => {
    // Es zählt dieselbe Menge wie /nachfassen (navCountsData.ts liest den
    // Loader der Seite, docs §5.4). Weitere Abzeichen nur, wenn sie exakt die
    // Menge ihrer Seite zählen — No-Shows und Ablage tun das nicht.
    assert.equal(zaehle(SIDEBAR, "count={navCounts?.nachfassen}"), 1);
    assert.ok(navLink("/nachfassen").includes("count={navCounts?.nachfassen}"));
    for (const href of ["/termine", "/setting", "/closing"]) {
      assert.doesNotMatch(navLink(href), /count=/, `${href} trägt ein Abzeichen`);
    }
    assert.doesNotMatch(SIDEBAR, /ABLAGE_COUNT_LABEL/);
  });

  test("ein zugeklappter Block trägt die Summe seiner Zähler — im selben Ton", () => {
    // Die Bauweise bleibt für jeden Block, der einmal einen Zähler trägt.
    assert.match(SIDEBAR, /const badge = !open && count && count\.total > 0 \? count : null;/);
    assert.match(SIDEBAR, /data-tone=\{badge\.overdue > 0 \? "overdue" : undefined\}/);
  });

  test("nicht ermittelbar wird nicht zur beruhigenden 0", () => {
    assert.match(SIDEBAR, /return known \? \{ total, overdue \} : null;/);
  });

  test("Seitenleiste und Tab-Leiste zeigen dieselbe Zahl", () => {
    // Am Handy steht die Zahl am Tab „Heute" — aus derselben Summe.
    assert.match(MOBILE, /import \{ MobileDrawer, sumNavCounts(, type InternNav)? \} from "\.\/Sidebar";/);
    assert.match(MOBILE, /sumNavCounts\(\[navCounts\?\.nachfassen\]\)/);
    assert.match(MOBILE, /heute=\{pending\}/);
    assert.match(TABBAR, /className="count-pill mobile-tab-count"/);
    assert.match(TABBAR, /data-tone=\{zaehler\.overdue > 0 \? "overdue" : undefined\}/);
    assert.doesNotMatch(TABBAR, /total \?\? 0/);
  });
});

/* ------------------------------------------------------------------ *
 * Tooltips: jede Zeile nennt die Frage, die sie beantwortet
 * ------------------------------------------------------------------ */

describe("Tooltips", () => {
  test("jede Navigationszeile trägt einen Tooltip", () => {
    const zeilen = SIDEBAR.match(/<NavLink\b[\s\S]*?\/>/g) ?? [];
    assert.ok(zeilen.length >= 12, "zu wenige Navigationszeilen gefunden");
    for (const z of zeilen) {
      const href = z.match(/href="([^"]+)"/)?.[1] ?? "?";
      // Die Verwaltung (Export, Einstellungen, Organisationen) erklärt sich
      // selbst; alle übrigen Zeilen beantworten eine Frage.
      if (["/export", "/settings", "/admin"].includes(href)) continue;
      assert.match(z, /title="[^"]{20,}"/, `${href} hat keinen Tooltip`);
    }
  });

  test("Heute nennt die Quellen, die dort wirklich stehen", () => {
    const zeile = navLink("/nachfassen");
    // Die fälligen toten Leads stehen seit dem 28.11. im eigenen Reiter — der
    // Tooltip sagt das, statt sie unter die Quellen zu mischen.
    for (const quelle of ["Termine ohne nächsten Schritt", "Telefon-Rückrufe", "Reiter „Wiedervorlage“"]) {
      assert.ok(zeile.includes(quelle), `Der Heute-Tooltip nennt „${quelle}" nicht`);
    }
    assert.doesNotMatch(zeile, /LinkedIn-Follow-ups/);
  });

  test("die Quellenliste des Tooltips deckt sich mit dem Typ der Seite", () => {
    assert.match(NACHFASS_REGEL, /export type NachfassQuelle = "termin" \| "rueckruf" \| "recycling";/);
  });

  test("es gibt keine Erinnerungs-Zeile mehr, die eine Kaskade verspricht", () => {
    assert.doesNotMatch(SIDEBAR, /Stundengenau/);
    assert.doesNotMatch(SIDEBAR, /label="Erinnerungen"/);
  });

  test("die Ablage bleibt erreichbar — über den Reiter „Wiedervorlage“", () => {
    // Ohne Navigationszeile wäre die Sperrliste sonst nur noch per URL zu
    // finden. Der Reiter steht immer da, auch mit 0 Einträgen.
    const eingang = readFileSync(fileURLToPath(new URL("../src/components/nachfassen/NachfassEingang.tsx", import.meta.url)), "utf8");
    assert.match(eingang, /<Link href="\/ablage"/);
    assert.match(eingang, /\{ value: "wiedervorlage" as const, label: `Wiedervorlage \$\{wiedervorlageAnzahl\}` \}/);
  });
});

/* ------------------------------------------------------------------ *
 * Handy: die Tab-Leiste
 * ------------------------------------------------------------------ */

describe("Tab-Leiste am Handy", () => {
  test("Heute · Kalender · Telefon · Mehr", () => {
    const heute = TABBAR.indexOf('href: "/nachfassen", label: "Heute"');
    const kalender = TABBAR.indexOf('href: "/termine", label: "Kalender"');
    const telefon = TABBAR.indexOf('href: "/telefon", label: "Telefon"');
    const mehr = TABBAR.indexOf("<span>Mehr</span>");
    assert.ok(heute !== -1 && kalender !== -1 && telefon !== -1 && mehr !== -1);
    assert.ok(heute < kalender && kalender < telefon && telefon < mehr);
    assert.equal(zaehle(TABBAR, "href: \""), 3);
  });

  test("im Call-Modus ausgeblendet", () => {
    assert.match(read("src/app/globals.css"), /body\[data-dialer\] \.mobile-bottom-nav \{ display: none; \}/);
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

  test("der gespeicherte Zustand schlägt die neue Vorbelegung", () => {
    // Ein Eintrag im localStorage entsteht NUR durch einen Klick — es gibt
    // keinen Schreibpfad, der einen Anfangszustand mitschreibt. Wer einen hat,
    // hat für genau diesen Block schon gesagt, wie er ihn haben will; ihn
    // zugunsten der neuen Vorgabe zu verwerfen (Schlüsselwechsel, Migration)
    // wäre genau der Verlust, gegen den Anforderung 3 steht.
    assert.match(SIDEBAR, /return typeof v === "boolean" \? v : SECTION_DEFAULT_OPEN;/);
    // Geschrieben wird ausschließlich aus einer Bedienhandlung heraus: der
    // Klick auf den Kopf und der „Neue Liste"-Knopf, der seinen Block dafür
    // aufklappen muss. Ein dritter Aufrufer wäre ein Schreibpfad, der einen
    // Zustand speichert, den niemand gewählt hat.
    // Definition + zwei Aufrufer der Blöcke + einer der einklappbaren Bereiche
    // (Schlüssel `grp:<id>`, ebenfalls nur im Klick-Handler).
    assert.equal(zaehle(SIDEBAR, "writeSectionOpen("), 4);
    assert.match(SIDEBAR, /if \(!hasActive\) writeSectionOpen\(`grp:\$\{id\}`, !open\);/);
    assert.match(SIDEBAR, /if \(!hasActive\) writeSectionOpen\(id, !open\);/);
    assert.match(SIDEBAR, /setOpen: \(next\) => writeSectionOpen\(id, next\)/);
  });

  test("folgt dem vorhandenen Muster der Analyse-Filterleiste", () => {
    // useSyncExternalStore + Server-Snapshot: kein Hydrations-Konflikt und
    // keine zweite Render-Runde durch useEffect+setState.
    assert.match(SIDEBAR, /useSyncExternalStore\(\s*subscribeSections,/);
    assert.match(SIDEBAR, /useCallback\(\(\) => readSectionOpen\(id\), \[id\]\)/);
    assert.match(SIDEBAR, /const readSectionDefault = \(\): boolean => SECTION_DEFAULT_OPEN;/);
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
    // Hexwert wäre die leiseste Art, sie zu brechen. Seit dem Liquid-Glass-
    // Umbau trägt die Leiste gar keinen Hexwert mehr — die dunkle Tinte auf
    // Orange kommt aus `--on-accent` (Hell- und Dunkelmodus).
    const hex = SIDEBAR.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    assert.deepEqual([...new Set(hex)], [], "neuer Hexwert in der Seitenleiste");
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

describe("Einklappbare Bereiche (28.11.)", () => {
  test("Akquise, Vertrieb, Kunden und Auswertung lassen sich einklappen", () => {
    for (const id of ["akquise", "vertrieb", "kunden", "auswertung"]) {
      assert.match(SIDEBAR, new RegExp(`<NavGroup id="${id}" label="[^"]+" hasActive=\\{containsActive\\(pathname, [A-Z_]+\\)\\}>`));
    }
  });
  test("Bereiche starten offen, ein Bereich mit der geöffneten Seite bleibt offen", () => {
    assert.match(SIDEBAR, /const readGroupDefault = \(\): boolean => true;/);
    assert.match(SIDEBAR, /const open = stored \|\| hasActive;/);
  });
});
