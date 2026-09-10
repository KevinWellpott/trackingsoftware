// Rückbau, Spur /nachfassen: Die Seite ist auf das Recycling zusammengeschrumpft.
//
// WARUM ES DIESE DATEI GIBT: Entfernungen haben keinen Anker. Eine gelöschte
// Sektion hinterlässt nichts, was bei der nächsten Runde widerspricht — und
// ausgerechnet Filterreihen, Sektionsköpfe und Kopiertexte kommen leicht
// zurück, weil sie billig sind und nach einer Verbesserung aussehen. Vier
// Pillen mehr, ein Textfeld mehr, und die Seite ist wieder das Board mit fünf
// Quellen, das der Auftraggeber zurückgewiesen hat.
//
// SIE LÖST DREI DATEIEN AB — nachfassenBoard, nachfassenKarten und
// nachfassenAbarbeiten. Drei Dateien für eine Seite mit einer Quelle und drei
// Knöpfen wären mehr Prüfgerüst als Gegenstand; jede Zusicherung von dort, die
// den Rückbau überlebt hat, steht hier wieder. Was ersatzlos entfällt, steht
// unten in Block 1 mit dem Grund dabei.
//
// GEPRÜFT WIRD AM QUELLTEXT — dieselbe Bauart und Begründung wie in
// tests/rueckbauNavigation.test.ts und tests/sidebarBloecke.test.ts: Der
// Test-Runner (`node --experimental-strip-types`) kann `.tsx` nicht laden und
// eine Server Action nicht ausführen; eine Attrappe bewiese nur, dass die
// Attrappe stimmt. Das VERHALTEN des Altlast-Schnitts prüft
// tests/nachfassenAltlasten.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen: Das Projekt hat keine `.gitattributes`, und
  // `core.autocrlf=true` legt die Quelldateien unter Windows mit CRLF ab.
  // Mehrere Anker unten tragen ein `\n` — ohne diese Zeile wäre die Datei auf
  // einem frischen Klon rot, ohne dass am geprüften Code etwas fehlte.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Wie oft steht `needle` in `source`?
 *
 * `assert.match` kann das nicht beantworten: Ein zweites Vorkommen bricht
 * keinen Treffer. Genau daran ist einmal ein doppelter Fehler-Span unbemerkt
 * durchgekommen — jede einzelne Zusicherung war grün, und auf der Karte stand
 * jede Meldung zweimal.
 */
function countOf(source: string, needle: string): number {
  let n = 0;
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * Derselbe Quelltext ohne Kommentare.
 *
 * Nötig für jede „das gibt es nicht mehr"-Zusicherung: Die Kommentarköpfe
 * dieser Dateien ERKLÄREN, was entfernt wurde, und nennen die entfernten
 * Bezeichner dabei beim Namen — das ist erwünscht und soll stehen bleiben.
 * Ohne diesen Schnitt schlüge jede Gegenprobe an ihrer eigenen Begründung an.
 *
 * Der Stripper ist bewusst simpel (Blockkommentar, dann Zeilenkommentar):
 * Weder die Action noch das Board enthält eine Zeichenkette mit `//` — geprüft
 * ist das, und ein `://` wäre in beiden Dateien ohnehin ein Fremdkörper.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Der Rumpf zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const ACTION = read("src/app/actions/nachfassen.ts");
const BOARD = read("src/components/nachfassen/NachfassenBoard.tsx");
const SEITE = read("src/app/(dashboard)/nachfassen/page.tsx");
const BACKLINK = read("src/components/ui/BackLink.tsx");

/** Für die Gegenproben: derselbe Text ohne die Kommentare, die ihn erklären. */
const ACTION_CODE = codeOnly(ACTION);
const BOARD_CODE = codeOnly(BOARD);

/* ------------------------------------------------------------------ *
 * 1 — Drei Quellen und der ganze Überbau sind weg
 * ------------------------------------------------------------------ */

describe("1 · Was gefallen ist, bleibt gefallen", () => {
  test("die Union-RPC wird nicht mehr gelesen — nur noch das Recycling", () => {
    // Telefon-Rückruf, Setting- und Closing-Wiedervorlage sind Zeilen, die „in
    // der Luft liegen", und stehen in der Terminliste. Geblieben ist die eine
    // Quelle, die dort nicht hingehört: eine Wiedervorlage nach Wochen bis
    // Monaten statt eines täglichen Kontakts.
    assert.doesNotMatch(ACTION_CODE, /\.rpc\("nachfassen_tasks"/, "Die Union-RPC wird nicht mehr gelesen.");
    assert.match(ACTION, /const recycle = await loadRecycleTasks\(\);/);
    // Genau EINE Quelle heißt: kein `source`-Feld mehr, das zwischen mehreren
    // unterscheidet. Die interessante Achse ist der URSPRUNG des Leads.
    assert.doesNotMatch(ACTION_CODE, /export type NachfassenSource/);
    assert.match(ACTION, /export type RecycleTask = \{\n {2}origin: RecycleOrigin;/);
  });

  test("die RPC selbst bleibt unangetastet — sie ist eingefroren", () => {
    // `nachfassen_tasks` liegt produktiv auf der Datenbank. Ein DROP FUNCTION
    // für eine Anzeigefrage wäre der falsche Preis: Er bräuchte eine neue
    // Migration, nähme die Grants mit und brächte nichts ein.
    //
    // NACHGEZOGEN: Hier stand als Begründung, der Navigations-Zähler lese sie
    // weiterhin — und genau das war der Fehler, nicht die Rechtfertigung. Der
    // Zähler zählte damit drei Zweige, die die Seite nicht mehr zeigt (Badge
    // 14, Seite zwei Karten). Er liest die Funktion nicht mehr; die Funktion
    // bleibt trotzdem stehen, und das ist die Zusicherung.
    for (const datei of ["src/lib/navCounts.ts", "src/app/actions/nachfassen.ts"]) {
      assert.doesNotMatch(codeOnly(read(datei)), /nachfassen_tasks/, `${datei} liest die Union-RPC wieder`);
    }
    assert.doesNotMatch(
      read("supabase/migrations/20260404000028_fundament.sql"),
      /drop function[^\n]*nachfassen_tasks/i,
      "Die eingefrorene RPC wurde gedroppt",
    );
  });

  test("die drei Schreibpfade der Tages-Wiedervorlagen sind mitentfernt", () => {
    // Sie hatten je einen Aufrufer, und der steht nicht mehr auf der Seite.
    // Server Actions sind per direktem POST erreichbar — ein Schreibpfad ohne
    // Bedienung ist kein Rest, sondern eine offene Tür.
    //
    // Geprüft am CODE, nicht am Fließtext: Die Kommentare dürfen weiter
    // erklären, warum es die drei nicht mehr gibt.
    assert.doesNotMatch(ACTION_CODE, /export async function (pushFollowUpDue|pushPhoneCallback)/);
    assert.doesNotMatch(BOARD_CODE, /pushFollowUpDue|pushPhoneCallback|DateTimeField/);
    assert.match(ACTION, /export type UndoKind = "recycling_versuch" \| "recycling_reaktion";/);
    const spalten = slice(ACTION, "const UNDO_COLUMNS", "\n};");
    for (const tot of ["telefon_rueckruf", "setting_wiedervorlage", "closing_wiedervorlage"]) {
      assert.doesNotMatch(spalten, new RegExp(tot), `${tot} hat keinen Knopf mehr.`);
    }
  });

  test("kein Kopiertext, keine Vorlagen-Auflösung, keine Kanal-Ableitung", () => {
    // „Es ist vollkommen egal, WIE jemand kontaktiert wird" — die Karte sagt
    // WER dran ist und WARUM, nicht was zu schreiben ist. Mit dem Text fallen
    // die Vorrangkette des Vorlagen-Katalogs, ihr Herkunfts-Badge und der
    // Kopier-Knopf.
    for (const rest of ["renderResolved", "getTemplateBundles", "messageTemplates", "renderRecycleTemplate", "prepared_text"]) {
      assert.doesNotMatch(ACTION_CODE, new RegExp(rest), `Die Action schleppt noch „${rest}" mit.`);
      assert.doesNotMatch(BOARD_CODE, new RegExp(rest), `Das Board schleppt noch „${rest}" mit.`);
    }
    assert.doesNotMatch(BOARD_CODE, /navigator\.clipboard|TEMPLATE_SOURCE_LABELS/, "Kein Kopier-Knopf mehr.");
  });

  test("keine Kontaktfrequenz-Warnung — ihre Quelle war die Kaskade", () => {
    // Sie las erledigte `reminder_touches`; die Kaskade hat keine Oberfläche
    // mehr. Die einzige verbliebene Quelle wäre der letzte Versuch DESSELBEN
    // Vorgangs gewesen, den sie ausdrücklich ausschloss — ein Roundtrip je
    // Seitenaufruf für eine Warnung, die nie angeschlagen hätte.
    assert.doesNotMatch(ACTION_CODE, /reminder_touches|contactGap|loadRecentContacts/);
    assert.doesNotMatch(BOARD_CODE, /contactGap|lastContactLabel|Zuletzt kontaktiert/);
    // Was von ihr bleibt, ist eine schlichte Angabe ohne Warnfarbe: Auf dieser
    // Kadenz ist „vor zwei Monaten zuletzt versucht" der Normalfall.
    assert.match(BOARD, /Zuletzt versucht \{formatShort\(task\.last_contacted_at\)\}/);
    const angabe = slice(BOARD, "{task.last_contacted_at && (", "</span>");
    assert.doesNotMatch(angabe, /warning-|AlertTriangle/, "Der letzte Versuch ist eine Angabe, keine Warnung.");
  });

  test("keine Filterreihe, keine Sektionen, kein Überfällig-Schalter", () => {
    // Fünf Kanal-Pillen über einer Liste mit einer Quelle filtern nichts; eine
    // Sektion, die alles enthält, ist keine; und ein Filter, der die letzte
    // Karte wegnehmen kann, braucht einen Ausweg, der wieder eine Bedienung
    // ist. Die Liste steht ohnehin nach Fälligkeit sortiert, das Älteste oben.
    for (const tot of ["ChannelFilter", "CHANNEL_META", "const FILTERS", "CollapsibleSection", "SECTION_META", "overdueOnly", "collapsedMap"]) {
      assert.doesNotMatch(BOARD_CODE, new RegExp(tot), `„${tot}" gehört zur Vielfalt, die es nicht mehr gibt.`);
    }
    assert.doesNotMatch(BOARD_CODE, /Keine Aufgaben in dieser Auswahl/, "Ohne Filter gibt es keinen Auswahl-Leerzustand.");
  });

  test("kein Verweis mehr nach /erinnerungen — die Route ist eine Weiterleitung", () => {
    // `SECTION_CROSSLINK` zeigte auf die stundengenaue Kaskade. Die gibt es
    // nicht mehr; der Link führte über eine Weiterleitung in den Kalender und
    // versprach dabei eine Kette, die niemand mehr erzeugt.
    assert.doesNotMatch(BOARD_CODE, /SECTION_CROSSLINK|href="\/erinnerungen"/);
    assert.match(read("src/app/(dashboard)/erinnerungen/page.tsx"), /redirect\("\/termine"\)/, "Gegenprobe: die Route leitet weiter.");
  });

  test("die Route selbst bleibt — nur der Titel sagt, was sie heute ist", () => {
    // /nachfassen wird NICHT abgeklemmt: Die Seite trägt weiterhin echte
    // Arbeit, und der Rückweg der Detailseiten hängt an `?from=nachfassen`.
    assert.doesNotMatch(codeOnly(SEITE), /redirect\(/, "Die Seite ist keine Weiterleitung geworden.");
    assert.match(SEITE, /Recycling\n\s*<InfoPopover/, "Der Titel muss sagen, was die Seite zeigt.");
    assert.match(BACKLINK, /nachfassen: \{ href: "\/nachfassen"/, "Der Rückweg der Detailseiten hängt weiter daran.");
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Was geblieben ist, weil es mit dem Überbau nichts zu tun hatte
 * ------------------------------------------------------------------ */

describe("2 · Ein Ausfall sieht nicht aus wie Feierabend", () => {
  test("die Server-Action reicht die Verfügbarkeit durch", () => {
    // Fehlt Migration 0033, wäre eine leere Liste nicht von „nichts fällig"
    // unterscheidbar — und genau diese Verwechslung ist hier die teuerste: Sie
    // sieht aus wie Feierabend.
    assert.match(ACTION, /recyclingAvailable: boolean/);
    assert.match(ACTION, /recyclingAvailable: recycle\.available/);
    // Ohne Anmeldung gibt es keine Aussage über das Schema — dort ist `true`
    // die ehrliche Antwort, sonst behauptete die leere Seite eine fehlende
    // Migration.
    assert.match(ACTION, /if \(!access\) return \{ tasks: \[\], hiddenStale: 0, recyclingAvailable: true \};/);
  });

  test("das Board zeigt dafür den roten Kasten statt des grünen Leerzustands", () => {
    assert.match(BOARD, /recyclingAvailable: boolean/);
    assert.match(BOARD, /\{!recyclingAvailable && \(\s*<UnavailableNotice/);
    // Der grüne Leerzustand ist eine BEHAUPTUNG und darf ohne geantwortete RPC
    // gar nicht erst fallen.
    const leerzustand = slice(BOARD, "{sorted.length === 0 ? (", "Kein Lead wartet");
    assert.match(leerzustand, /!recyclingAvailable \? null/);
    // Und der Kasten sagt ausdrücklich, dass er kein Leerstand ist.
    assert.match(BOARD, /nicht<\/strong> wiedervorgelegt/);
  });

  test("rohe Datenbank-Meldungen erscheinen nicht auf der Karte — und genau EINMAL", () => {
    // Ein durchgereichtes „new row violates row-level security policy" sagt
    // dem Vertrieb nichts, das er tun könnte. Der Klartext-Hinweis zur
    // fehlenden Migration geht dagegen wörtlich durch.
    const mapper = slice(BOARD, "function friendlyError(", "function TaskCard(");
    assert.match(mapper, /KNOWN_ERROR_MESSAGES\.has\(text\)/);
    assert.match(mapper, /Recycling ist gerade nicht verfügbar/);
    assert.match(mapper, /return GENERIC_ERROR_MESSAGE;/);
    assert.equal(countOf(BOARD, "{error && ("), 1, "Nur EIN Fehler-Span in der Knopfreihe.");
    assert.equal(countOf(BOARD, "{friendlyError(error)}"), 1, "Nur EINE gerenderte Meldung.");
  });

  test("der Fehler steht VOR „Endgültig raus\", nicht dahinter", () => {
    // Der Knopf sperrt den Lead endgültig; er darf nicht in dem Moment nach
    // unten unter den Zeiger wandern, in dem gerade ein Fehler erschienen ist
    // und der Zeiger noch auf „Nochmal versucht" steht.
    const fehler = BOARD.indexOf("{error && (");
    const sperren = BOARD.indexOf("Endgültig sperren?");
    assert.notEqual(fehler, -1);
    assert.notEqual(sperren, -1);
    assert.ok(fehler < sperren, "Der Fehler-Span gehört vor den Sperr-Knopf.");
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Rückgängig
 * ------------------------------------------------------------------ */

describe("3 · Ein Fehlklick ist kein Endzustand", () => {
  test("die Karte verschwindet nicht sofort, sondern trägt einen Rückweg", () => {
    // „Nochmal versucht" verbrennt einen von standardmäßig zwei erlaubten
    // Versuchen — auf einem Knopf, der einen Klick neben „Reagiert" liegt.
    assert.match(BOARD, /icon=\{<Undo2 size=\{14\} \/>\}/);
    assert.match(BOARD, /^\s*Rückgängig$/m);
    assert.doesNotMatch(BOARD_CODE, /setHidden/, "Kein stilles Wegblenden.");
    // Nur, wenn die Aktion einen Rückweg mitgeliefert hat — ein Knopf, der
    // einen Zustand rät, ist schlimmer als keiner.
    assert.match(BOARD, /\{doneEntry\.undo && \(/);
  });

  test("die erledigte Karte überlebt den Refresh — sonst wäre das Fenster eine Behauptung", () => {
    // `router.refresh()` läuft sofort und MUSS es: Ohne ihn bliebe der Prop
    // `tasks` auf dem Stand von vor der Aktion, und nach Ablauf des Fensters
    // käme dieselbe Karte als normale, wieder anklickbare Aufgabe zurück.
    // Danach liefert der Server sie nicht mehr — ohne den Merge wäre die Karte
    // samt Rückweg im selben Augenblick weg.
    assert.match(BOARD, /router\.refresh\(\);/);
    const merge = slice(BOARD, "const withDone = useMemo(", "const sorted = useMemo");
    assert.match(merge, /Object\.values\(doneMap\)/);
    assert.match(merge, /!known\.has\(taskKey\(e\.task\)\)/, "Ein weiterhin gelieferter Eintrag darf sich nicht verdoppeln.");
    // Und die Liste rechnet auf dem gemischten Stand, nicht mehr auf dem rohen
    // `tasks` — sonst stünde weniger auf dem Schirm, als es gibt.
    assert.match(BOARD, /\[\.\.\.withDone\]\.sort/);
  });

  test("„Endgültig raus\" bekommt bewusst KEINEN Rückweg", () => {
    // Der Bestätigungsdialog sagt wörtlich zu, dass sich das nicht rückgängig
    // machen lässt, und `reviveBlockedReason()` verweigert danach jede
    // Rückholung. Ein Rückgängig hier widerspräche der eben gegebenen Zusage.
    const spalten = slice(ACTION, "const UNDO_COLUMNS", "\n};");
    assert.doesNotMatch(spalten, /recycle_excluded_at/);
    assert.match(BOARD, /runAction\(excludeFromRecycle\(task\.origin, task\.entity_id\), "Endgültig gesperrt"\)/);
    const knopf = slice(BOARD, "Endgültig sperren?", "Endgültig raus");
    assert.match(knopf, /destructive: true/);
    assert.match(knopf, /nicht rückgängig machen/);
    assert.match(knopf, /if \(ok\) runAction\(excludeFromRecycle/);
  });

  test("zurückgeschrieben wird GENAU das, was die Aktion überschrieben hat", () => {
    const spalten = slice(ACTION, "const UNDO_COLUMNS", "\n};");
    // Die vier Spalten, die `recycle_attempt()` + `schedule_recycle()` zusammen
    // anfassen: sonst bliebe nach dem Rückgängig ein Versuchszähler stehen.
    assert.match(
      spalten,
      /recycling_versuch: \["recycle_attempt_count", "recycle_last_contacted_at", "next_recycle_at", "recycle_reason_code"\]/,
    );
    assert.match(spalten, /recycling_reaktion: \["next_recycle_at", "recycle_responded_at"\]/);
  });

  test("die Werte werden VOR dem Schreiben gelesen — danach sind sie weg", () => {
    // Die Hülle liest den Stand VOR dem Klick; ein zweiter Roundtrip wäre zu
    // spät, und ein Fehlgriff verbrennte sonst einen von zwei Versuchen ohne
    // Weg zurück.
    const versuch = slice(ACTION, "export async function recycleContactedUndoable", '/** „Reagiert"');
    const lesen = versuch.indexOf("const values = await recycleSnapshot(");
    const schreiben = versuch.indexOf("await markRecycleContacted(");
    assert.ok(lesen !== -1 && schreiben !== -1 && lesen < schreiben, "Sonst steht im Rückweg der Stand von gerade eben.");
  });

  test("Tabelle und Spalten bestimmt der Server, nicht das mitgeschickte Token", () => {
    // Server Actions sind per direktem POST erreichbar. Käme die Spaltenliste
    // vom Aufrufer, wäre `undoNachfassenTask` ein beliebiges UPDATE auf vier
    // Tabellen statt der Rücknahme genau einer bekannten Aktion.
    const undo = slice(ACTION, "export async function undoNachfassenTask", "Die beiden Aktionen");
    assert.match(undo, /const columns = kind \? UNDO_COLUMNS\[kind\] : undefined;/);
    assert.match(undo, /const table = undo\.origin \? TABLE_BY_ORIGIN\[undo\.origin\] : null;/);
    assert.match(undo, /for \(const col of columns\)/);
    assert.doesNotMatch(undo, /Object\.keys\(undo\.values\)/, "Die Spalten dürfen nicht aus dem Token stammen.");
    // Dieselbe Zugriffsprüfung wie bei den Nachbarn: Lesen über den
    // Nutzer-Client UND Filter auf die aktive Organisation (für einen
    // Plattform-Admin lässt RLS sonst jede Zeile der Plattform durch).
    assert.match(undo, /await getAccessContext\(\)/);
    assert.equal(
      countOf(undo, '.eq("workspace_id", access.workspace_id)'),
      countOf(undo, '.eq("id", undo.entity_id)'),
      "Jeder Zugriff auf die Zeile — Prüfung wie Schreibvorgang — trägt den Org-Filter.",
    );
  });

  test("beide Aktionen fahren dieselbe Zugriffsprüfung wie ihre Nachbarn", () => {
    for (const [name, bis] of [
      ["export async function recycleContactedUndoable", '/** „Reagiert"'],
      ["export async function recycleRespondedUndoable", "\n}\n"],
    ] as const) {
      const body = slice(ACTION, name, bis);
      assert.match(body, /const access = await getAccessContext\(\);/, name);
      assert.match(body, /if \(!access\) return \{ error: "Nicht angemeldet\." \};/, name);
      // Geschrieben wird ausschließlich über actions/recycle.ts — dort sitzen
      // Besitzprüfung, Deckel und die beiden RPCs.
      assert.doesNotMatch(body, /\.update\(/, `${name} schreibt an actions/recycle.ts vorbei.`);
    }
    assert.match(ACTION, /await markRecycleContacted\(origin, entityId\)/);
    assert.match(ACTION, /await markRecycleResponded\(origin, entityId\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Die Karte: Anordnung, Wege, Farbe
 * ------------------------------------------------------------------ */

describe("4 · Der Knopf-Stapel und die vier Ursprünge", () => {
  test("die Knopfzone ist eine Spalte, keine umbrechende Reihe", () => {
    // Auf 300 Pixel Kartenbreite bräche eine Reihe ohnehin um — und WO sie
    // umbricht, entschiede die Länge der Beschriftungen.
    const stack = slice(BOARD, "const actionStackStyle: React.CSSProperties = {", "};");
    assert.match(stack, /flexDirection: "column"/);
    assert.match(stack, /alignItems: "stretch"/);
    assert.doesNotMatch(stack, /flexWrap/, "Eine umbrechende Knopfzone ist genau das, was hier abgelöst wurde.");
    assert.match(BOARD, /<div style=\{actionStackStyle\}>/);
  });

  test("genau EIN Hauptknopf, die Zweitaktion ungefüllt, „Endgültig raus\" abgesetzt", () => {
    // Zwei gefüllte Knöpfe übereinander hätten gar keinen Hauptknopf mehr —
    // dann liest man wieder jeden einzeln, dreißigmal am Vormittag.
    assert.equal(countOf(BOARD, 'variant="primary"'), 1, "„Nochmal versucht“ ist der eine CTA.");
    assert.equal(countOf(BOARD, 'variant="success"'), 1, "„Reagiert“ ist die Ausnahme daneben.");
    assert.equal(countOf(BOARD, 'variant="danger"'), 1, "„Endgültig raus“ ist der einzige Danger-Knopf.");
    assert.doesNotMatch(slice(BOARD, "Nochmal versucht", "Rohmeldung nur im"), /var\(--success-bg\)/, "Keine gefüllte Fläche für die Zweitaktion.");

    // Vier Knöpfe, drei davon vollbreit — der vierte ist der abgesetzte.
    assert.equal(countOf(BOARD, "<Button"), 4, "Rückgängig, Nochmal versucht, Reagiert, Endgültig raus.");
    assert.equal(countOf(BOARD, "fullWidth"), 3);
    const danger = slice(BOARD, "<div style={dangerRowStyle}>", "</div>");
    assert.doesNotMatch(danger, /fullWidth/, "„Endgültig raus“ ist der eine Knopf ohne volle Breite.");

    // Vier Dinge setzen ihn ab, KEINS davon ist eine neue Farbe: Position,
    // Trennlinie, Breite und Ausrichtung.
    const row = slice(BOARD, "const dangerRowStyle: React.CSSProperties = {", "};");
    assert.match(row, /justifyContent: "flex-end"/);
    assert.match(row, /borderTop: "1px solid var\(--border-subtle\)"/);
    const jumps = BOARD.indexOf("<div style={jumpRowStyle}>");
    const dangerPos = BOARD.indexOf("<div style={dangerRowStyle}>");
    assert.ok(jumps !== -1 && dangerPos !== -1 && jumps < dangerPos, "Der unwiderrufliche Knopf gehört ans Ende, unter die Wege.");
  });

  test("die Knöpfe kommen aus der Button-Familie, nicht aus Inline-Kopien", () => {
    assert.match(BOARD, /import \{ Button \} from "@\/components\/ui\/Button";/);
    for (const alt of ["primaryBtnStyle", "linkBtnStyle", "navBtnStyle", "dangerBtnStyle"]) {
      assert.doesNotMatch(BOARD_CODE, new RegExp(alt), `${alt} ist durch die Button-Komponente abgelöst.`);
    }
  });

  test("die Wege stehen zusammen in EINER leisen Zeile, nicht im Stapel", () => {
    // Sie schreiben nichts, sie führen nur woandershin. Als weitere vollbreite
    // Knöpfe stünden sie gleichrangig neben den Aktionen.
    const row = slice(BOARD, "const jumpRowStyle: React.CSSProperties = {", "};");
    assert.match(row, /flexWrap: "wrap"/, "Die Wege-Zeile darf umbrechen — die Aktionen darüber nicht.");
    assert.match(row, /borderTop: "1px solid var\(--border-subtle\)"/, "Hairline statt eigener Fläche.");
    // Drei Wege: der Ursprungs-Link, die Rufnummer und das Dossier. Alle
    // tragen dieselbe Ghost-Behandlung an `.ui-btn`; keiner ist ein
    // Button-Baustein, sonst sähe ein Sprung aus wie eine Aktion.
    assert.equal(countOf(BOARD, 'className="ui-btn"'), 3);
    assert.equal(countOf(BOARD, "style={jumpStyle}"), 2, "Der tel:-Link erbt jumpStyle mit eigener Schriftfarbe.");
  });

  test("die vier Ursprünge sind wortgleich zu /ablage benannt", () => {
    // Zwei Boards, die dieselben vier Zeilenarten zeigen, dürfen sie nicht
    // verschieden benennen. Termine haben eine Detailseite, LinkedIn-Kontakte
    // und Telefon-Leads nicht — deren Verweis führt auf ihre LISTE.
    const meta = slice(BOARD, "const ORIGIN_META: Record<", "\n};");
    const ABLAGE = read("src/components/ablage/AblageBoard.tsx");
    for (const label of ["LinkedIn-Kontakt", "Telefon-Lead", "Zur Liste"]) {
      assert.ok(meta.includes(label), `Der Ursprungs-Katalog kennt „${label}" nicht.`);
      assert.ok(ABLAGE.includes(label), `Gegenprobe: /ablage nennt „${label}" nicht mehr — die beiden laufen auseinander.`);
    }
    // Kein Ziel auflösbar (Lead ohne Liste) heißt: kein Verweis, keine
    // Sackgasse.
    assert.match(meta, /t\.list_id \? `\/lists\/\$\{t\.list_id\}` : null/);
    assert.match(meta, /t\.list_id \? `\/telefon\/\$\{t\.list_id\}` : null/);
    // Und die Herkunft geht mit, damit der Zurück-Pfeil der Detailseite nicht
    // in den Kalender führt.
    assert.match(BOARD, /const FROM_NACHFASSEN = "\?from=nachfassen";/);
    assert.equal(countOf(BOARD, "${FROM_NACHFASSEN}`"), 2, "Setting und Closing — je einmal, an genau einer Stelle.");
  });

  test("erkannt wird eine feste Liste, nicht ein beliebiger Pfad aus der URL", () => {
    // `?from=` landet in einem `href`. Ein übernommener Fremdwert wäre ein
    // offener Weiterleitungspunkt — und ein Zurück-Pfeil ist genau der Knopf,
    // den niemand vorher liest.
    const fn = slice(BACKLINK, "export function backTargetFrom", "\n}\n");
    assert.match(fn, /BACK_TARGETS\[key\][\s\S]*\?\? fallback/);
    assert.doesNotMatch(fn, /href: key|href: from/, "Der Rohwert darf nie selbst zum Ziel werden.");
  });
});

/* ------------------------------------------------------------------ *
 * 5 — Design-Riegel
 * ------------------------------------------------------------------ */

describe("5 · Keine neue Farbe, kein neues Maß", () => {
  test("Ursprung und Grund laufen über den neutralen Badge-Ton", () => {
    // Violett (Setting), Grün (Closing), Blau (Telefon), Teal (LinkedIn) —
    // weder als Token noch als roher Kanalwert. Auf einer einzelnen Karte
    // liest sich das als Zuordnung; auf dreißig Karten untereinander ist es
    // Lärm, und der Ursprung steht ohnehin als Wort und Symbol daneben.
    assert.equal(countOf(BOARD, '<Badge tone="neutral">'), 2, "Ursprung + Grund.");
    assert.doesNotMatch(BOARD_CODE, /--stage-/, "Keine Kanalfarbe im Recycling-Board.");
    for (const kanalwert of ["139 92 246", "63 163 111", "78 128 214", "13 148 136"]) {
      assert.ok(!BOARD.includes(kanalwert), `Kanalfarbe ${kanalwert} steht noch im Board.`);
    }
    const meta = slice(BOARD, "const ORIGIN_META: Record<", "\n};");
    assert.doesNotMatch(meta, /color:|bg:|stage:/, "Der Ursprungs-Katalog trägt Wort und Symbol, keine Farbe.");
  });

  test("Dringlichkeit bleibt farbig — sonst wäre die Umstellung ein Verlust", () => {
    // Die Gegenprobe zum Rest dieses Blocks: „neutral" gilt für KATEGORIEN.
    // Überfällig ist keine Kategorie, sondern eine Dringlichkeit.
    assert.match(BOARD, /borderLeft: overdue \? "3px solid var\(--color-error-text\)"/);
    assert.match(BOARD, /color: overdue \? "var\(--color-error-text\)" : "var\(--text-secondary\)"/);
  });

  test("keine unbekannten Farbwerte", () => {
    // Ein eingeschleuster Hex- oder rgb()-Wert wäre die leiseste Art, ein
    // Farbsystem aufzuweichen — er sieht im Betrieb aus wie eine Farbe, die es
    // immer gab. Erlaubt bleibt genau der 0.28er Rand des Danger-Tons, für den
    // es keinen Alpha-Token gibt. Der Warning-Ton ist mit dem
    // Überfällig-Schalter entfallen.
    assert.deepEqual([...new Set(BOARD.match(/rgba?\([^)]*\)/g) ?? [])], ["rgb(214 90 82 / 0.28)"]);
    assert.deepEqual(BOARD.match(/#[0-9a-fA-F]{3,8}/g) ?? [], [], "Kein roher Hexwert — Farben kommen aus Tokens.");
  });

  test("die Abstände der Stil-Objekte sind Tokens der Spacing-Skala", () => {
    for (const objekt of ["actionStackStyle", "jumpStyle", "jumpRowStyle", "dangerRowStyle"]) {
      const rumpf = slice(BOARD, `const ${objekt}: React.CSSProperties = {`, "};");
      assert.doesNotMatch(rumpf, /\d+(\.\d+)?rem/, `${objekt} führt ein eigenes Abstandsmaß ein.`);
    }
  });
});
