// Erklärtexte gehören hinter das Info-Icon — Handlungsanweisungen nicht.
//
// Auslöser war ein Satz des Auftraggebers über das Nachfassen-Board: „Kannst du
// die Info Texte […] hinter einem Info Icon verstecken — ich will die nicht
// direkt da sehen!" Er arbeitet die drei Arbeitsflächen jeden Morgen ab; jeder
// Satz, den er dabei zum wiederholten Mal überliest, kostet ihn Zeit. Im
// Analyse-Bereich ist die Regel längst durchgezogen (docs/data-model.md §5.1:
// „Sektionen sind einklappbar, Erklärungen stehen hinter dem Info-Icon"), auf
// den Arbeitsflächen war sie es nicht.
//
// Die Regel, nach der hier geschnitten wird:
//   Was der Nutzer lesen MUSS, um zu handeln, bleibt sichtbar.
//   Was erklärt, WARUM die Software sich so verhält, geht hinter das Icon.
//
// Deshalb hat diese Datei ZWEI Richtungen, und die zweite ist die wichtigere:
// Ohne sie wäre bei der nächsten Aufräumrunde eine Fehlermeldung mitversteckt.
// Ein Erklärtext kostet Lesezeit; eine versteckte Handlungsanweisung kostet
// eine Handlung.
//
// Geprüft wird am QUELLTEXT — alle Beteiligten sind React-Komponenten, die der
// Node-Test-Runner ohne JSX-Transform nicht laden kann (Bauart wie
// nachfassenBoard.test.ts und bestandstermine.test.ts). Zeilenenden werden
// vereinheitlicht: `core.autocrlf=true` legt die Quellen unter Windows mit
// CRLF ab, mehrere Anker unten tragen ein `\n`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
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

/**
 * Alles, was in dieser Datei hinter einem Info-Icon steht.
 *
 * Das ist der Hebel für BEIDE Richtungen: Ein Text, der hier auftaucht, ist
 * versteckt; einer, der in der Datei steht und hier fehlt, ist ohne Klick zu
 * sehen. Damit lässt sich „ist gewandert" und „ist geblieben" mit derselben
 * Messung prüfen, statt mit zwei, die auseinanderlaufen können.
 */
function versteckt(source: string): string {
  const out: string[] = [];
  for (let i = source.indexOf("<InfoPopover"); i !== -1; i = source.indexOf("<InfoPopover", i + 1)) {
    const end = source.indexOf("</InfoPopover>", i);
    assert.notEqual(end, -1, "Ein <InfoPopover> ohne schließendes Tag.");
    out.push(source.slice(i, end));
  }
  return out.join("\n\n");
}

const NACHFASSEN = read("src/components/nachfassen/NachfassenBoard.tsx");
const ERINNERUNGEN = read("src/components/erinnerungen/ErinnerungenBoard.tsx");
const ABLAGE = read("src/components/ablage/AblageBoard.tsx");
const PANEL = read("src/components/termine/CascadePanel.tsx");
const SEITE_NACHFASSEN = read("src/app/(dashboard)/nachfassen/page.tsx");
const SEITE_ERINNERUNGEN = read("src/app/(dashboard)/erinnerungen/page.tsx");

/* ------------------------------------------------------------------ *
 * 1 — Hinwärts: die Erklärungen stehen hinter dem Icon
 * ------------------------------------------------------------------ */

describe("1 · Erklärtexte stehen hinter dem Info-Icon", () => {
  test("die Seitenköpfe beschreiben sich nicht mehr selbst", () => {
    // Beide Seiten trugen einen Absatz unter dem Titel, der sagte, was die
    // Seite ist. Die Filterreihe bzw. die Kopfzeile des Boards sagt dasselbe
    // in Zahlen, und zwar über den tatsächlichen Stand.
    for (const [name, seite, satz] of [
      ["/nachfassen", SEITE_NACHFASSEN, /Was ist heute fällig\?/],
      ["/erinnerungen", SEITE_ERINNERUNGEN, /eine Karte je Termin/],
    ] as const) {
      assert.match(seite, /<InfoPopover/, `${name} hat kein Info-Icon am Titel.`);
      assert.match(versteckt(seite), satz, `${name} zeigt seine Selbstbeschreibung weiterhin als Absatz.`);
      assert.doesNotMatch(seite, /\bmeta=/, `${name} trägt weiterhin eine Meta-Zeile mit Fließtext.`);
    }
  });

  test("Server Component: das Icon bringt seinen Handler selbst mit", () => {
    // docs §5.1: In einer Server Component darf das übergebene Element keinen
    // Handler tragen — `preventDefault`/`stopPropagation` sitzen im
    // Client-Teil `InfoPopover`. Ein `onClick` in einer dieser Seiten bräche
    // das Prerendering, und zwar unbemerkt: Beide Seiten sind dynamisch.
    for (const [name, seite] of [
      ["/nachfassen", SEITE_NACHFASSEN],
      ["/erinnerungen", SEITE_ERINNERUNGEN],
    ] as const) {
      assert.doesNotMatch(seite, /"use client"/, `${name} ist keine Server Component mehr.`);
      assert.doesNotMatch(seite, /onClick/, `${name} reicht einen Handler in eine Server Component.`);
    }
  });

  test("/nachfassen: der Verweis ist kurz, seine Bedingung steht hinter dem Icon", () => {
    // Der Satz aus dem Feedback, wörtlich: „No-Show-Kette zu den nicht
    // erschienenen Terminen, sofern eine Kette läuft". Der LINK bleibt — er
    // ist eine Handlung —, der erklärende Halbsatz wandert.
    const tabelle = slice(NACHFASSEN, "const SECTION_CROSSLINK", "/* ── Einklappbare Sektion");
    const labels = [...tabelle.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labels.length, 2, "Es sind genau die zwei Sektionen mit echter Überschneidung (docs §1).");
    for (const label of labels) {
      assert.ok(label.length <= 28, `Der Verweis „${label}" ist wieder ein Satz statt eines Ziels.`);
      assert.doesNotMatch(label, /sofern|falls|bestehen/i, `Der Verweis „${label}" trägt seine Bedingung wieder mit.`);
    }
    // Der Text steht in der Tabelle und wird als `{crosslink.info}` ins
    // Popover gereicht — geprüft wird deshalb dort, wo er lebt.
    assert.match(versteckt(NACHFASSEN), /\{crosslink\.info\}/, "Der Text erreicht das Icon gar nicht.");
    assert.match(tabelle, /erst, wenn der Termin angelegt oder verschoben wird/);
    assert.match(tabelle, /nicht erschienen“ als Ergebnis eingetragen wird/);
  });

  test("/ablage: die Begründungen der Sperrliste und der Rückholung sind weg vom Schirm", () => {
    const hinter = versteckt(ABLAGE);
    assert.match(hinter, /Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines/);
    assert.match(hinter, /veränderte rückwirkend die Quoten eines abgeschlossenen Zeitraums/);
  });

  test("Kaskaden-Panel: die Kopier-Anleitung steht im Kopf, nicht als Fußtext", () => {
    assert.match(versteckt(PANEL), /Nichts geht automatisch raus/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Gegenrichtung: was ohne einen Klick sichtbar bleiben MUSS
 * ------------------------------------------------------------------ */

describe("2 · Handlungsrelevantes bleibt ohne Klick sichtbar", () => {
  /** Steht in der Datei — und ausdrücklich NICHT hinter einem Icon. */
  function sichtbar(name: string, source: string, phrasen: readonly (string | RegExp)[]) {
    const hinter = versteckt(source);
    for (const p of phrasen) {
      const re = typeof p === "string" ? new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : p;
      assert.match(source, re, `${name}: „${p}" ist ganz verschwunden.`);
      assert.doesNotMatch(hinter, re, `${name}: „${p}" wurde hinter dem Info-Icon versteckt.`);
    }
  }

  test("Fehlermeldungen und „nicht verfügbar\"-Kästen — eine versteckte Fehlermeldung ist keine", () => {
    sichtbar("/nachfassen", NACHFASSEN, [
      "Die Aufgabenliste konnte nicht geladen werden",
      "Recycling ist nicht verfügbar",
      "Konnte nicht gespeichert werden — bitte erneut versuchen.",
    ]);
    sichtbar("/erinnerungen", ERINNERUNGEN, [
      "Erinnerungen sind nicht verfügbar",
      "Das ließ sich nicht speichern.",
    ]);
    sichtbar("/ablage", ABLAGE, ["Die Ablage ist nicht verfügbar"]);
    sichtbar("Kaskaden-Panel", PANEL, ["Die Erinnerungen konnten nicht geladen werden"]);
  });

  test("die Ausblendungs-Zeile samt Schalter — Tatsache plus Handlung", () => {
    // Sie nennt die EINE Menge, die diese Seite versteckt, und holt sie
    // zurück. Hinter einem Icon wäre sie ein Geheimnis mit Ausweg.
    sichtbar("/nachfassen", NACHFASSEN, [
      "ausgeblendet",
      "Trotzdem anzeigen",
      "Nur aktuelle Aufgaben",
      "Auch Altlasten werden angezeigt",
    ]);
  });

  test("Leerzustände sagen weiterhin ohne Klick, was als Nächstes passiert", () => {
    sichtbar("/nachfassen", NACHFASSEN, ["Alles nachgefasst", "Keine Aufgaben in dieser Auswahl"]);
    sichtbar("/erinnerungen", ERINNERUNGEN, ["Nichts offen", /Erinnerungen entstehen, wenn ein Termin angelegt/]);
    sichtbar("/ablage", ABLAGE, ["Nichts abgelegt"]);
    sichtbar("Kaskaden-Panel", PANEL, [/nie eine Erinnerung geplant/, "Für diesen Termin steht keine Erinnerung an."]);
  });

  test("Warnungen an einer konkreten Karte bleiben an ihrer Karte", () => {
    sichtbar("/nachfassen", NACHFASSEN, ["Zuletzt kontaktiert"]);
    sichtbar("/erinnerungen", ERINNERUNGEN, ["Zuletzt kontaktiert", "ist hier nicht ermittelbar"]);
    // Die Sätze zu weggelassenen Knöpfen (`hints`) und der Vorgänger-Hinweis
    // hängen an EINER Zeile und entscheiden dort etwas.
    sichtbar("/ablage", ABLAGE, ["Zweiter Anlauf.", "{hint}", "Wiedervorlage ist fällig — steht in Nachfassen"]);
    sichtbar("Kaskaden-Panel", PANEL, ["Der Termin ist abgesagt — es gibt nichts mehr zu bestätigen."]);
  });

  test("DASS die Sperrliste org-weit ist, steht weiter auf dem Schirm — nur das WARUM nicht", () => {
    sichtbar("/ablage", ABLAGE, ["Org-weit — unabhängig von der eingestellten Datensicht"]);
    // Und der Satz zum fehlenden Knopf bleibt ebenfalls: Wer ihn nicht liest,
    // sucht auf jeder Karte nach einer Aktion, die es hier bewusst nicht gibt.
    sichtbar("/ablage", ABLAGE, [/Gesperrte Vorgänge bekommen weder eine Wiedervorlage/]);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — /erinnerungen: der Rückweg muss zu finden sein
 * ------------------------------------------------------------------ */

describe("3 · Rückgängig auf einer erledigten Stufe", () => {
  const doneStep = slice(ERINNERUNGEN, "function DoneStep({", "/** Künftige Stufe");

  test("Wort statt bloßem Symbol, und ein Knopf der Familie statt Handarbeit", () => {
    // Vorher: 22×22 px, nur ein Undo2-Pfeil, Farbe `--text-subtle`. Am Telefon
    // kaum zu treffen, auf dem Schirm kaum zu sehen.
    assert.match(doneStep, /<Button/, "Der Rückweg ist wieder ein handgebauter Knopf.");
    assert.match(doneStep, /Rückgängig/, "Das WORT ist der halbe Gewinn — ein Undo-Pfeil erschließt sich nur, wer ihn kennt.");
    assert.doesNotMatch(doneStep, /width: 22|height: 22/, "Die alte 22-px-Trefferfläche ist zurück.");
    assert.doesNotMatch(doneStep, /<button\b/, "Ein roher <button> bringt weder Touch-Bump noch Hover mit (.ui-btn).");
  });

  test("Gegenprobe: er wird nicht lauter als die Arbeit, die noch aussteht", () => {
    // Zwei Grenzen, beide fachlich: Rückgängig gibt es je STUFE — auf einem
    // Termin mit Vorgeschichte stehen mehrere untereinander, vollbreite Knöpfe
    // ergäben eine Wand. Und die offene Stufe darüber bleibt der Hauptknopf.
    assert.match(doneStep, /variant="ghost"/, "Ghost ist die leiseste Stufe der Familie — hier gehört sie hin.");
    assert.match(doneStep, /size="sm"/);
    assert.doesNotMatch(doneStep, /fullWidth/, "Vollbreit je Stufe wäre eine Wand aus Rückgängig.");
    assert.doesNotMatch(doneStep, /variant="primary"/, "Der Primär-Knopf gehört der nächsten offenen Stufe.");
  });

  test("wer abgehakt hat und wann, steht weiterhin daneben", () => {
    // Im Team die einzige Stelle, an der das überhaupt steht.
    assert.match(doneStep, /whenLabel\(touch\.done_at\)/);
    assert.match(doneStep, /doneByName \?/);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — /erinnerungen: „Vollständig erledigt" ist ein Archiv, keine Arbeitsfläche
 * ------------------------------------------------------------------ */

describe("4 · Die Aufklappung „Vollständig erledigt\"", () => {
  const sektion = slice(ERINNERUNGEN, "{doneCards.length > 0 && (", "{/* ── Aktionsleiste");
  const karte = slice(ERINNERUNGEN, "function TerminCard({", "* Board");

  test("sie benutzt das etablierte Aufklapp-Rezept, nicht ein eigenes halbes", () => {
    // Vorher: `collapse-summary` OHNE `collapse-chevron` und ohne die Karte
    // drumherum — also das Karten-Rezept aus globals.css §6.10 zur Hälfte. Es
    // war nicht zu sehen, dass die Zeile überhaupt eine Aufklappung ist.
    // Dasselbe Rezept trägt das Erinnerungs-Panel auf den Detailseiten.
    assert.match(sektion, /<details className="card">/, "Ohne Karte fehlt die Trennung vom Arbeitsteil darüber.");
    assert.match(sektion, /className="collapse-summary"/);
    assert.match(sektion, /className="collapse-chevron"/, "Ohne Pfeil sieht man der Zeile nicht an, dass sie aufklappt.");
  });

  test("der zugeklappte Kopf sagt, wie viel drin ist und dass es dort einen Rückweg gibt", () => {
    // Eine Aufklappung ohne Anzahl zwingt zum Öffnen.
    assert.match(sektion, /\{doneCards\.length\}/, "Die Anzahl fehlt im Kopf.");
    assert.match(sektion, /Rückweg steht in jeder Zeile/, "Wer zu viel abgehakt hat, soll das ohne Öffnen erfahren.");
  });

  test("die Karten darin verlangen nichts mehr — aber sie behalten alles Nachschlagbare", () => {
    assert.match(sektion, /archived\n/, "Die Karten stehen weiter als Arbeitskarten in der Aufklappung.");
    // Genau zwei Angaben fallen weg, und beide dienen ausschließlich dem
    // Senden: das Absender-Konto und die Aufforderung „Kanal frei wählen".
    assert.match(karte, /\{!archived && \(\n\s*<SenderLine/);
    assert.match(karte, /!archived && <Badge tone="warning">Kanal frei wählen<\/Badge>/);
  });

  test("Gegenprobe: Rückgängig, Zeitpunkt und Person bleiben auch im Archiv erreichbar", () => {
    // Ein Termin landet dort, wenn ALLE Stufen erledigt sind — wenn genau das
    // ein Versehen war, ist das der Ort, an dem man es merkt.
    const stufen = slice(karte, "{doneSteps.map((t) => (", "))}");
    assert.match(stufen, /<DoneStep/);
    assert.match(stufen, /onUndo=\{\(\) => undo\(t\.id\)\}/, "Ohne Rückweg wäre das Archiv eine Sackgasse.");
    assert.match(stufen, /doneByName=\{doneBy\[t\.id\]\}/, "Wer abgehakt hat, steht sonst nirgends.");
    assert.doesNotMatch(stufen, /archived/, "Die Stufenliste selbst darf im Archiv nicht beschnitten werden.");
  });
});
