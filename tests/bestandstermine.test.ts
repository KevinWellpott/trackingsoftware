// Der erste Tag nach dem Deploy — drei Oberflächen, die etwas behaupten, das
// am Montag nicht stimmt.
//
// Ausgangslage (gemessen, nicht vermutet): 9 Organisationen, 173 Erstgespräche,
// 50 Closings, **0 Zeilen in `reminder_touches`**. Für die Kaskade gibt es
// bewusst KEINEN Backfill (docs/data-model.md §7) — erst was nach dem Deploy
// angelegt oder verschoben wird, erzeugt Erinnerungen. Die Entscheidung ist
// richtig; falsch war nur, wie die Oberfläche darüber spricht:
//
//  · Das Kaskaden-Panel schob die nie geplanten Stufen in die Historie und
//    schrieb darüber „Es steht keine Erinnerung mehr aus. Was war, steht
//    unten." — es war nie etwas, es steht nichts unten, und entfallen ist auch
//    nichts. Das traf JEDEN der 223 Bestandstermine.
//  · Der Leerzustand auf /erinnerungen versprach eine Karte, „sobald ein
//    Termin ansteht". Die Bedingung war am Montag erfüllt, die Zusage nicht.
//  · /nachfassen verlinkt aus zwei Sektionen auf ebendiese leere Seite und
//    benannte dabei einen Inhalt, den es dort nicht gab.
//
// Geprüft wird am QUELLTEXT: alle drei sind React-Client-Komponenten, die der
// Node-Test-Runner nicht laden kann (kein JSX-Transform). Dieselbe Bauart wie
// nachfassenBoard.test.ts und erinnerungenTermine.test.ts. Wo es geht, wird
// nicht auf einen Satz geprüft, sondern auf die STRUKTUR, die ihn trägt — ein
// Satz lässt sich beim nächsten Umbau versehentlich zurückdrehen, ein
// dreiwertiges Feld nicht.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

/** Wie oft steht `needle` in `source`? */
function countOf(source: string, needle: string): number {
  let n = 0;
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

const PANEL = read("src/components/termine/CascadePanel.tsx");
const ERINNERUNGEN = read("src/components/erinnerungen/ErinnerungenBoard.tsx");
const NACHFASSEN = read("src/components/nachfassen/NachfassenBoard.tsx");
const SETTING_ACTIONS = read("src/app/actions/settingCalls.ts");
const SETTING_EDITOR = read("src/components/scripts/SettingCallEditor.tsx");

/* ------------------------------------------------------------------ *
 * A — Kaskaden-Panel: „nie geplant" ist nicht „erledigt & entfallen"
 * ------------------------------------------------------------------ */

describe("A · Das Kaskaden-Panel trennt den Bestandstermin vom abgearbeiteten", () => {
  test("die Historie führt DREI Zustände, nicht zwei", () => {
    // Der ganze Fehler steckte in einem `done: boolean`: Was nie geplant war,
    // fiel damit zwangsläufig in denselben Topf wie das Entfallene, und die
    // Zusammenfassung darüber konnte gar nicht mehr unterscheiden.
    const typ = slice(PANEL, "type HistoryEntry", "function splitRows(");
    for (const zustand of ['"done"', '"entfallen"', '"nie_geplant"']) {
      assert.match(typ, new RegExp(zustand), `Der Zustand ${zustand} fehlt im Historien-Modell.`);
    }
    assert.doesNotMatch(typ, /done: boolean/, "Zweiwertig war genau das Problem.");
  });

  test("nur der everPlanned-Zweig erzeugt „nie geplant\" — sonst gälte jeder Termin als Bestandstermin", () => {
    // Die Gegenrichtung, ohne die die Unterscheidung lautlos verlierbar wäre:
    // Ein abgesagter Termin, einer ohne Zeitpunkt, eine zeitlich nicht mehr
    // passende und eine entwertete Stufe sind ALLE nicht „nie geplant".
    assert.equal(
      countOf(PANEL, "neverPlanned: true"),
      1,
      "Genau EIN Zweig darf einen Termin zum Bestandstermin erklären.",
    );
    const grund = slice(PANEL, "function skipReason(", "/* ---");
    const zweig = slice(grund, "if (!everPlanned)", "const due =");
    assert.match(zweig, /neverPlanned: true/, "Der everPlanned-Zweig ist es, der ihn setzt.");

    // Und die entwerteten Stufen — der Normalfall „es gab eine Kaskade, sie
    // wurde abgeräumt" — kommen ausdrücklich als `false` durch.
    const bau = slice(PANEL, "function buildGroups(", "type TouchEntry");
    assert.match(bau, /supersededReason\([\s\S]{0,200}?neverPlanned: false/, "Entwertet ist nicht „nie geplant\".");
  });

  test("die Zusammenfassung sagt beim Bestandstermin nicht mehr „Es steht keine Erinnerung mehr aus\"", () => {
    const zusammenfassung = slice(
      PANEL,
      "{pending.length === 0 && history.length > 0 && (",
      "{/* ── Historie",
    );
    // Der bestehende Fall behält seinen Satz — er ist für ihn richtig.
    assert.match(zusammenfassung, /Es steht keine Erinnerung mehr aus/);
    // Der neue Fall bekommt seinen eigenen, und er hängt an der Unterscheidung
    // statt an `pending.length === 0` allein.
    assert.match(zusammenfassung, /nurNieGeplant/, "Die Zusammenfassung muss die Unterscheidung lesen.");
    assert.match(zusammenfassung, /nie eine Erinnerung geplant/, "Der wahre Satz fehlt.");
  });

  test("und die Aufklappung heißt dann nicht „Erledigt & entfallen\"", () => {
    const historie = slice(PANEL, "{history.length > 0 && (", "</details>");
    assert.match(historie, /Erledigt & entfallen \(\$\{history\.length\}\)/, "Der bestehende Fall behält seinen Namen.");
    assert.match(historie, /Nie geplant \(\$\{history\.length\}\)/, "Der neue Fall braucht einen eigenen.");
    assert.match(historie, /nurNieGeplant/, "Auch die Aufklappung muss die Unterscheidung lesen.");
  });

  test("die Kopier-Anleitung steht nur da, wo es einen Text zu kopieren gibt", () => {
    // Unter einem Bestandstermin stand „Text kopieren, über den genannten
    // Kanal schicken" — ohne dass irgendwo ein Text stand.
    //
    // Seit dem Aufräumen der Erklärtexte sitzt die Anleitung im Kopf der Karte
    // hinter dem Info-Icon statt als Fußtext unter der Stufenliste. Ihr Riegel
    // bleibt derselbe und ist der Punkt dieses Tests: Wo es nichts zu kopieren
    // gibt, steht auch keine Anleitung zum Kopieren — auch nicht hinter einem
    // Icon, denn ein Icon, das nichts erklärt, ist eine leere Zusage.
    const karte = slice(PANEL, 'return (\n    <details className="card">', "</div>\n    </details>\n  );");
    const fuss = karte.indexOf("Nichts geht automatisch raus");
    assert.notEqual(fuss, -1, "Die Anleitung ist ganz verschwunden — gemeint war: sie soll bedingt sein.");
    const riegel = karte.lastIndexOf("{pending.length > 0 && (", fuss);
    assert.notEqual(riegel, -1, "Die Anleitung braucht ihren EIGENEN Riegel `pending.length > 0`.");
    const popover = karte.lastIndexOf("<InfoPopover", fuss);
    assert.ok(popover > riegel, "Der Riegel muss VOR dem Info-Icon stehen, nicht darin.");
  });

  test("der genannte Weg zur Kaskade funktioniert für BEIDE Termin-Arten", () => {
    // Der Hinweis darf nur nennen, was auch geht. Frühere Fassungen nannten
    // „Termin speichern oder verschieben" — speichern gibt es beim Erstgespräch
    // gar nicht: Der Setting-Editor schickt nie ein `appointment_at` mit, der
    // Zeitpunkt wandert dort ausschließlich über `postponeAppointment`,
    // `moveSettingAppointment` und `rescheduleSetting`.
    const postpone = slice(SETTING_ACTIONS, "export async function postponeAppointment(", "\n}\n");
    assert.match(postpone, /generateSettingCascade\(id\)/, "Verschieben muss die Setting-Kaskade anlegen.");
    assert.match(postpone, /generateClosingCascade\(id\)/, "… und die des Closings ebenso.");

    assert.doesNotMatch(
      SETTING_EDITOR,
      /appointment_at:/,
      "Gäbe es hier einen Speicher-Pfad für den Zeitpunkt, dürfte der Hinweis ihn auch nennen.",
    );

    const zusammenfassung = slice(
      PANEL,
      "{pending.length === 0 && history.length > 0 && (",
      "{/* ── Historie",
    );
    assert.match(zusammenfassung, /verschieb/i, "Der eine Weg, der für beide gilt, muss dastehen.");
    assert.doesNotMatch(zusammenfassung, /speicher/i, "Speichern ist beim Erstgespräch kein Weg.");
  });

  test("einem Termin, der schon gelaufen ist, wird nicht zum Verschieben geraten", () => {
    // Ein Rat, der nur eine sofort fällige Terminbestätigung für ein längst
    // geführtes Gespräch erzeugt, ist kein Rat.
    const zusammenfassung = slice(
      PANEL,
      "{pending.length === 0 && history.length > 0 && (",
      "{/* ── Historie",
    );
    assert.match(zusammenfassung, /terminAhead|appointmentAhead|stehtBevor/, "Der Rat muss am Termindatum hängen.");
  });
});

/* ------------------------------------------------------------------ *
 * B — /erinnerungen: der Leerzustand verspricht nur, was er hält
 * ------------------------------------------------------------------ */

describe("B · Der Leerzustand von /erinnerungen sagt, warum nichts dasteht", () => {
  const leer = slice(ERINNERUNGEN, '<div className="card fade-up dot-grid">', ") : (");

  test("er verspricht keine Karte mehr, „sobald ein Termin ansteht\"", () => {
    // Am Montag stehen 223 Termine an und es erscheint keine einzige Karte.
    assert.doesNotMatch(leer, /Sobald ein Setting-/, "Genau diese Zusage war am ersten Tag falsch.");
  });

  test("er nennt stattdessen die Bedingung, die wirklich gilt", () => {
    assert.match(leer, /angelegt|Anlegen/, "Erinnerungen entstehen beim Anlegen …");
    assert.match(leer, /verschoben|Verschieben/, "… oder beim Verschieben eines Termins.");
    assert.match(leer, /rückwirkend|Rückwirkend/, "Und für ältere Termine entsteht rückwirkend keine.");
  });

  test("Gegenprobe: ein Ladefehler sieht weiterhin anders aus als „nichts zu tun\"", () => {
    // Die Doktrin des Projekts — ein Ausfall darf nie wie Feierabend aussehen.
    // Der Leerzustand bleibt grün und ohne Warnfarbe, der Ausfall rot.
    assert.match(leer, /success-fg/, "Der Leerzustand bleibt der grüne.");
    assert.doesNotMatch(leer, /danger-|warning-/, "Er darf nicht wie ein Fehler aussehen.");

    const ausfall = slice(ERINNERUNGEN, "if (!inbox.available) {", "Kopfleiste");
    assert.match(ausfall, /danger-bg/, "Der Ausfall bleibt der rote Kasten.");
    assert.match(ausfall, /nicht<\/strong> dasselbe wie/, "Er sagt weiterhin ausdrücklich, dass er kein Leerstand ist.");
  });
});

/* ------------------------------------------------------------------ *
 * C — /nachfassen verweist nicht mehr auf die Kaskade
 * ------------------------------------------------------------------ */

describe("C · Kein Verweis mehr nach /erinnerungen", () => {
  // HIER STAND: „Der Verweis nach /erinnerungen benennt eine Bedingung, keinen
  // Bestand" — vier Zusicherungen an `SECTION_CROSSLINK`, den beiden Links von
  // /nachfassen nach /erinnerungen und ihrer Bedingung im Info-Popover.
  //
  // Der Rückbau hat den Gegenstand entfernt, nicht die Sorgfalt: /erinnerungen
  // ist eine Weiterleitung, die stundengenaue Kaskade hat keine Oberfläche
  // mehr, und die beiden Sektionen, die den Verweis trugen (Setting- und
  // Closing-Wiedervorlage), stehen nicht mehr auf /nachfassen. Ein Verweis auf
  // eine Kette, die niemand mehr erzeugt, wäre genau die Behauptung ohne
  // Bestand, gegen die dieser Block einmal geschrieben wurde — die Zusicherung
  // dreht sich deshalb um.

  test("weder Tabelle noch Link sind übrig geblieben", () => {
    assert.doesNotMatch(NACHFASSEN, /SECTION_CROSSLINK/);
    assert.doesNotMatch(NACHFASSEN, /href="\/erinnerungen"/);
  });

  test("Gegenprobe: die Route ist wirklich eine Weiterleitung", () => {
    // Sonst wäre die Entfernung ein Verlust statt einer Bereinigung — dann
    // gäbe es die Seite noch, nur ohne Weg dorthin.
    assert.match(read("src/app/(dashboard)/erinnerungen/page.tsx"), /redirect\("\/termine"\)/);
  });
});
