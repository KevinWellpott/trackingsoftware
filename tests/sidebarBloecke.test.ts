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
const NACHFASSEN_ACTION = read("src/app/actions/nachfassen.ts");

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

  test("die Tagesarbeit steht zusammen in einem Block", () => {
    // docs/data-model.md §1: /termine (wer steht an), /nachfassen (heute
    // fällig) und /ablage (aus dem Funnel gefallen) beantworten dieselbe Frage
    // auf verschiedenen Zeitkörnungen. Getrennt in der Navigation werden sie zu
    // drei unabhängigen Werkzeugen, von denen man zwei nie öffnet.
    //
    // /erinnerungen stand hier als vierte Zeile, bis der Rückbau die
    // Erinnerungs-Kaskade abgeräumt hat; die Route leitet nur noch weiter, und
    // eine Navigationszeile auf eine Weiterleitung wäre eine Sackgasse mit
    // Zähler.
    const arbeit = block("arbeit");
    for (const href of ["/termine", "/nachfassen", "/ablage"]) {
      assert.ok(arbeit.includes(`href="${href}"`), `${href} steht nicht in „Meine Arbeit"`);
      // ... und nirgends sonst: eine zweite Zeile derselben Seite wäre ein
      // zweiter Zähler, der irgendwann etwas anderes zählt.
      assert.equal(zaehle(SIDEBAR, `href="${href}"`), 1, `${href} kommt mehrfach vor`);
    }
    // Und die abgeklemmte Seite ist wirklich raus — auch aus der Liste, die
    // einen Block aufgeklappt hält. (Geprüft am CODE, nicht am Fließtext: Der
    // Kommentarkopf darf weiter erklären, warum es die Zeile nicht mehr gibt.)
    assert.doesNotMatch(SIDEBAR, /href="\/erinnerungen"/, "die Erinnerungs-Zeile ist zurück in der Seitenleiste");
    assert.doesNotMatch(SIDEBAR, /ARBEIT_HREFS = \[[^\]]*erinnerungen/, "/erinnerungen hält weiterhin einen Block offen");
    assert.doesNotMatch(SIDEBAR, /BellRing/, "das Erinnerungs-Icon wird noch importiert");
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

  test("ALLE Blöcke starten zugeklappt", () => {
    // Die Rückmeldung war „standardmäßig alles eingeklappt". Früher startete
    // nur „Verwaltung" zu; jetzt gilt die Vorbelegung für die ganze Leiste und
    // steht deshalb als EINE Konstante da, nicht als Prop je Block. Ein
    // `defaultOpen` an einer einzelnen Zeile wäre die leiseste Art, die Regel
    // bei der nächsten Änderung wieder aufzuweichen.
    assert.match(SIDEBAR, /const SECTION_DEFAULT_OPEN = false;/);
    // Weder als Prop-Deklaration (`defaultOpen?:`, `defaultOpen =`) noch als
    // JSX-Attribut (`defaultOpen={…}`). Im Fließtext des Kommentars darf das
    // Wort stehen — dort steht, warum es die Prop nicht mehr gibt.
    assert.doesNotMatch(SIDEBAR, /defaultOpen\s*[=?:]/, "ein Block nimmt sich eine eigene Vorbelegung");
    assert.match(SIDEBAR, /useSyncExternalStore\([\s\S]{0,200}?readSectionDefault,/);
  });

  test("die Quicklinks sind die Gegenleistung fürs Zuklappen", () => {
    // Die beiden Änderungen gehören zusammen: Zugeklappt verliert die Leiste
    // den Überblick auf einen Blick, und den gibt der Dashboard-Streifen
    // zurück. Steht der Hinweis nicht mehr in der Datei, hat jemand das eine
    // ohne das andere angefasst.
    assert.match(SIDEBAR, /SECTION_DEFAULT_OPEN/);
    assert.match(SIDEBAR, /QuickLinks\.tsx/);
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

  test("auch zugeklappt vorbelegt bleibt der aktive Block offen", () => {
    // Die schärfste Fassung der Anforderung: Seit ALLE Blöcke zu starten, ist
    // dies der einzige Grund, aus dem beim ersten Aufruf überhaupt noch etwas
    // aufgeklappt ist. Fiele `hasActive` weg, stünde man auf /nachfassen vor
    // fünf geschlossenen Köpfen und ohne jede Markierung, wo man ist.
    assert.match(SIDEBAR, /const open = stored \|\| hasActive;/);
    assert.match(SIDEBAR, /const forcedOpen = hasActive && !stored;/);
    // …und der Grund steht sichtbar auf dem Bildschirm, nicht nur im Code:
    // der Titel färbt sich, der Schalter erklärt sich im Tooltip.
    assert.match(SIDEBAR, /enthält die geöffnete Seite und bleibt aufgeklappt/);
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
  test("der zugeklappte Block trägt die Summe seiner Zähler", () => {
    // Ein Abzeichen, das man nur nach dem Aufklappen sieht, ist keine
    // Benachrichtigung. Gezeigt wird es NUR zugeklappt (aufgeklappt stehen
    // daneben die Einzelzahlen), und es erbt den Überfällig-Ton.
    //
    // Es sind seit dem Rückbau zwei statt drei: Der Erinnerungs-Zähler ist mit
    // seiner Seite gefallen (lib/navCounts.ts).
    assert.match(SIDEBAR, /const badge = !open && count && count\.total > 0 \? count : null;/);
    assert.match(SIDEBAR, /data-tone=\{badge\.overdue > 0 \? "overdue" : undefined\}/);
    assert.ok(block("arbeit").includes("count={arbeitCount}"));
    assert.match(SIDEBAR, /const arbeitCount = sumNavCounts\(\[navCounts\?\.nachfassen, navCounts\?\.ablage\]\);/);
  });

  test("die Einzelzähler an den Zeilen bleiben erhalten", () => {
    const arbeit = block("arbeit");
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
    assert.match(MOBILE, /sumNavCounts\(\[navCounts\?\.nachfassen, navCounts\?\.ablage\]\)/);
    assert.doesNotMatch(MOBILE, /reduce\(\(n, c\) => n \+ \(c\?\./);
  });
});

/* ------------------------------------------------------------------ *
 * Die Tooltips sind die Abgrenzung der drei Mechanismen
 * ------------------------------------------------------------------ */

describe("Tooltips", () => {
  test("Nachfassen nennt die Quelle, die dort wirklich steht", () => {
    // Der LinkedIn-Zweig ist aus /nachfassen entfernt; der Tooltip war danach
    // die letzte Stelle der Oberfläche, die ihn noch behauptete. Ein Tooltip,
    // der eine Quelle verspricht, die auf der Seite fehlt, ist schlimmer als
    // gar keiner — man sucht dann dort, wo nichts ist.
    const arbeit = block("arbeit");
    assert.doesNotMatch(arbeit, /Tägliche Wiedervorlage: LinkedIn-Follow-ups/);
    assert.ok(arbeit.includes("Recycling-Versuche"), "Der Nachfassen-Tooltip nennt die Recycling-Versuche nicht");
    // Das LinkedIn-RECYCLING ist geblieben — nur die Follow-ups sind weg. Der
    // Tooltip muss beides sagen, sonst liest er sich wie „LinkedIn kommt hier
    // gar nicht mehr vor".
    assert.ok(arbeit.includes("LinkedIn-Follow-ups erledigt das Listen-Board"));

    // WAS HIER NICHT MEHR STEHT, und warum: „Telefon-Rückrufe" und „Setting-
    // und Closing-Wiedervorlagen" waren bis zum Rückbau Pflichtbestandteile
    // dieses Tooltips. Beide Quellen sind aus /nachfassen in die Terminliste
    // gewandert; sie hier weiter einzufordern hieße, den Tooltip auf eine
    // Aussage festzunageln, die inzwischen falsch ist — genau der Fehler, den
    // die erste Zeile dieses Tests verhindern soll. Der Tooltip-TEXT selbst
    // wird zentral nachgezogen (Sidebar.tsx gehört keiner Spur dieser Welle).
  });

  test("die Quellenliste des Tooltips deckt sich mit dem Typ der Seite", () => {
    // Die eine Stelle, an der steht, was /nachfassen zeigt. Aus vier Quellen
    // ist eine geworden — und damit aus der `source`-Union der URSPRUNG des
    // Leads: dieselbe Zeile beantwortet jetzt, aus welcher der vier
    // Ursprungstabellen er stammt.
    assert.doesNotMatch(NACHFASSEN_ACTION, /export type NachfassenSource/);
    assert.match(NACHFASSEN_ACTION, /export type RecycleTask = \{\n {2}origin: RecycleOrigin;/);
  });

  test("es gibt keine Erinnerungs-Zeile mehr, die eine Kaskade verspricht", () => {
    // Die Zeile beschrieb die stundengenaue Kaskade („Stundengenau vor
    // Setting-, Closing- und Nachfass-Terminen … Ketten nach No-Show"). Mit dem
    // Rückbau gibt es weder Stufen noch Ketten; ein Tooltip, der sie weiterhin
    // verspricht, schickt jemanden auf eine Weiterleitung.
    const arbeit = block("arbeit");
    assert.doesNotMatch(arbeit, /Stundengenau/);
    assert.doesNotMatch(arbeit, /label="Erinnerungen"/);
  });

  test("Ablage grenzt sich als Gegenrichtung ab", () => {
    // Die beiden Zeilen darüber zeigen, was ansteht — diese, was herausgefallen
    // ist. Ohne diesen Satz sind es drei ähnlich klingende Wörter.
    const arbeit = block("arbeit");
    assert.ok(arbeit.includes("Ausgeschiedene Vorgänge"));
    assert.ok(arbeit.includes("Sperrliste"));
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
    assert.equal(zaehle(SIDEBAR, "writeSectionOpen("), 3); // Definition + zwei Aufrufer
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
