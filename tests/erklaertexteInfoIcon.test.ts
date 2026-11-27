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

const NACHFASSEN = read("src/components/nachfassen/NachfassEingang.tsx");
const ABLAGE = read("src/components/ablage/AblageBoard.tsx");
const SEITE_NACHFASSEN = read("src/app/(dashboard)/nachfassen/page.tsx");
// ── GEÄNDERTER UMFANG, und zwar aus dem Rückbau heraus ─────────────────────
// HIER STANDEN zwei weitere Quellen: das Erinnerungs-Board und das
// Kaskaden-Panel am Termin. Beide Dateien sind gelöscht — es gibt keine
// stundengenaue Kaskade mehr und damit auch keine Fläche, auf der sie sich
// erklären müsste. Die Regel, nach der hier geschnitten wird, ist unverändert
// und gilt weiter für die drei verbliebenen Flächen.

/* ------------------------------------------------------------------ *
 * 1 — Hinwärts: die Erklärungen stehen hinter dem Icon
 * ------------------------------------------------------------------ */

describe("1 · Erklärtexte stehen hinter dem Info-Icon", () => {
  test("der Seitenkopf beschreibt sich nicht mehr selbst", () => {
    // Die Seite trug einen Absatz unter dem Titel, der sagte, was sie ist. Die
    // Liste darunter sagt dasselbe über den tatsächlichen Stand.
    // (/erinnerungen stand hier als zweite Seite, bis der Rückbau sie auf eine
    // Weiterleitung reduziert hat — ohne Kopf gibt es dort nichts mehr zu
    // verstecken.)
    //
    // Die gesuchte Frage hat sich zweimal geändert: Nach dem Rückbau zeigte
    // /nachfassen nur das Recycling („welcher tote Lead ist wieder einen
    // Versuch wert?"). Seit dem Nachfass-Eingang ist die Seite wieder der EINE
    // Ort für die Tagesarbeit — Termine ohne nächsten Schritt, Rückrufe,
    // Recycling — und beantwortet „wen musst du heute kontaktieren?".
    assert.match(SEITE_NACHFASSEN, /<InfoPopover/, "/nachfassen hat kein Info-Icon am Titel.");
    assert.match(
      versteckt(SEITE_NACHFASSEN),
      /Wen musst du heute kontaktieren\?/,
      "/nachfassen zeigt seine Selbstbeschreibung weiterhin als Absatz.",
    );
    assert.doesNotMatch(SEITE_NACHFASSEN, /\bmeta=/, "/nachfassen trägt weiterhin eine Meta-Zeile mit Fließtext.");
  });

  test("Server Component: das Icon bringt seinen Handler selbst mit", () => {
    // docs §5.1: In einer Server Component darf das übergebene Element keinen
    // Handler tragen — `preventDefault`/`stopPropagation` sitzen im
    // Client-Teil `InfoPopover`. Ein `onClick` in der Seite bräche das
    // Prerendering, und zwar unbemerkt: Die Seite ist dynamisch.
    assert.doesNotMatch(SEITE_NACHFASSEN, /"use client"/, "/nachfassen ist keine Server Component mehr.");
    assert.doesNotMatch(SEITE_NACHFASSEN, /onClick/, "/nachfassen reicht einen Handler in eine Server Component.");
  });

  test("/nachfassen: es gibt keinen Verweis mehr, der eine Kaskade verspricht", () => {
    // HIER STAND: „Der Verweis ist kurz, seine Bedingung steht hinter dem
    // Icon" — geprüft an `SECTION_CROSSLINK`, den zwei Links von /nachfassen
    // nach /erinnerungen samt ihrer Bedingung im Popover.
    //
    // Beides ist mit dem Rückbau gefallen: /erinnerungen ist eine
    // Weiterleitung, die Kaskade hat keine Oberfläche mehr, und die beiden
    // Sektionen, die den Verweis trugen (Setting- und Closing-Wiedervorlage),
    // stehen nicht mehr auf der Seite. Ein Verweis mit einer Bedingung, die
    // nie mehr eintritt, wäre schlimmer als gar keiner — die Zusicherung
    // dreht sich deshalb um.
    assert.doesNotMatch(NACHFASSEN, /SECTION_CROSSLINK/);
    assert.doesNotMatch(NACHFASSEN, /href="\/erinnerungen"/);
    // Und das Board hat damit gar kein Info-Icon mehr: Was es zu erklären
    // gäbe, steht am Seitentitel (Block oben) oder auf der Karte selbst.
    assert.equal(versteckt(NACHFASSEN), "", "Das Board erklärt sich wieder hinter einem Icon.");
  });

  test("/ablage: die Begründungen der Sperrliste und der Rückholung sind weg vom Schirm", () => {
    const hinter = versteckt(ABLAGE);
    assert.match(hinter, /Ein Kontaktverbot, das nur sein Besitzer sieht, ist keines/);
    assert.match(hinter, /veränderte rückwirkend die Quoten eines abgeschlossenen Zeitraums/);
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
    // Der Nachfass-Eingang kennt zwei Ausfälle, die man sehen muss: Das
    // Kontakt-Protokoll fehlt (Migration noch nicht eingespielt — „Kontakt
    // eintragen" schreibt dann nicht), oder die Recycling-Wiedervorlagen sind
    // nicht ladbar (dann fehlt eine ganze Quelle in der Liste). Beides sähe
    // ohne den Kasten aus wie „nichts zu tun".
    sichtbar("/nachfassen", NACHFASSEN, [
      "Das Kontakt-Protokoll fehlt noch in der Datenbank",
      "Die Recycling-Wiedervorlagen konnten nicht geladen werden",
    ]);
    sichtbar("/ablage", ABLAGE, ["Die Ablage ist nicht verfügbar"]);
  });

  test("was nicht unter „Fällig“ steht, ist ohne Klick gezählt und erklärt", () => {
    // HIER STAND: „es gibt gar keine Ausblendungs-Zeile mehr" — der
    // Altlasten-Schnitt war gefallen, und eine Zeile, die etwas ankündigt, das
    // nicht passiert, wäre der Rest gewesen, aus dem er zurückkommt.
    //
    // Der Nachfass-Eingang sortiert den Altbestand bewusst in einen eigenen
    // Reiter „Aufräumen" (Plan §4.5, Entscheidung N4). Dass das kein
    // versteckter Altersschnitt ist, hängt an genau dieser Regel: Die Zahl
    // steht im Reiter, die Erklärung steht über der Liste — beides ohne Klick.
    assert.doesNotMatch(NACHFASSEN, /ausgeblendet/);
    assert.doesNotMatch(NACHFASSEN, /Trotzdem anzeigen/);
    assert.match(NACHFASSEN, /label: `Aufräumen \$\{aufraeumenAnzahl\}`/);
    sichtbar("/nachfassen", NACHFASSEN, ["Altbestand vor dem Start des Eingangs", "Noch {aufraeumListe.length} offen."]);
  });

  test("Leerzustände sagen weiterhin ohne Klick, was als Nächstes passiert", () => {
    // Der Leerzustand von „Fällig" sagt, wo die übrigen Vorgänge stehen —
    // sonst läse sich eine leere Liste wie „niemand ist offen".
    sichtbar("/nachfassen", NACHFASSEN, ["Nichts fällig. Wer offen ist, steht mit seinem nächsten Kontakt unter"]);
    sichtbar("/ablage", ABLAGE, ["Nichts abgelegt"]);
  });

  test("Warnungen an einer konkreten Karte bleiben an ihrer Karte", () => {
    // /nachfassen trug hier die Kontaktfrequenz-Warnung, danach die Angabe
    // „Zuletzt versucht". Im Nachfass-Eingang stehen an der Zeile der letzte
    // Kontakt und — ab fünf Versuchen ohne Erreichen — der Vorschlag zum
    // Aufgeben (Plan §4.4). Ein Vorschlag hinter einem Icon wäre keiner.
    sichtbar("/nachfassen", NACHFASSEN, [
      "zuletzt ${lastContactLabel(",
      "nicht erreicht. Aufgeben? Er kommt nach der Wartezeit über das Recycling wieder.",
    ]);
    // Die Sätze zu weggelassenen Knöpfen (`hints`) und der Vorgänger-Hinweis
    // hängen an EINER Zeile und entscheiden dort etwas.
    sichtbar("/ablage", ABLAGE, ["Zweiter Anlauf.", "{hint}", "Wiedervorlage ist fällig — steht in Nachfassen"]);
  });

  test("DASS die Sperrliste org-weit ist, steht weiter auf dem Schirm — nur das WARUM nicht", () => {
    sichtbar("/ablage", ABLAGE, ["Org-weit — unabhängig von der eingestellten Datensicht"]);
    // Und der Satz zum fehlenden Knopf bleibt ebenfalls: Wer ihn nicht liest,
    // sucht auf jeder Karte nach einer Aktion, die es hier bewusst nicht gibt.
    sichtbar("/ablage", ABLAGE, [/Gesperrte Vorgänge bekommen weder eine Wiedervorlage/]);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Was hier stand, hatte /erinnerungen als Gegenstand
 * ------------------------------------------------------------------ */

// HIER STANDEN zwei Blöcke über das Erinnerungs-Board: „Rückgängig auf einer
// erledigten Stufe" (ein Wort statt eines Undo-Pfeils, ghost statt primary,
// wer abgehakt hat und wann) und „Die Aufklappung ‚Vollständig erledigt'"
// (Karten-Rezept, Anzahl im Kopf, Rückweg auch im Archiv).
//
// Beide Befunde waren echt und ihre Regeln gelten weiter — ein Rückweg braucht
// ein Wort, eine Aufklappung braucht ihre Anzahl im Kopf. Nur ihr Gegenstand
// ist gelöscht: Es gibt keine Stufen mehr, die man abhaken oder zurücknehmen
// könnte. Die Regeln selbst leben dort weiter, wo sie noch etwas tragen — in
// /ablage und /nachfassen, geprüft im Block darüber.
