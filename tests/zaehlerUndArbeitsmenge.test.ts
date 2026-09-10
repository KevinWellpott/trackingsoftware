// Zähler und Arbeitsmenge — was auf der täglichen Liste steht und was gezählt
// wird.
//
// Vier Befunde einer adversarischen Prüfung stehen hier unter Beobachtung. Sie
// haben eine gemeinsame Form: Nach dem Rückbau zeigte die Oberfläche eine
// andere Menge an, als eine zweite Stelle behauptete — und beide sahen für sich
// genommen völlig normal aus.
//
//  1. ZWEI ABLAGE-ENDZUSTÄNDE STANDEN IN DER TÄGLICHEN ARBEITSLISTE. Der
//     Termin-Lebenszyklus (Migration 0032) hat bewusst KEINEN neuen
//     `status`-Wert bekommen: „abgesagt ohne Aussicht" und „No-Show ohne
//     Antwort" lassen `status` stehen. `terminZustand()` las nur `status`,
//     `show_status`, Datum und Absage — und machte daraus `offen` bzw.
//     `no_show`, also Arbeitsmenge. Dieselbe Zeile leuchtete täglich gold UND
//     lag in der Ablage. Es gab keinen Handgriff, der das auflöst.
//
//  2. DER NACHFASSEN-ZÄHLER ZÄHLTE DREI QUELLEN, DIE DIE SEITE NICHT ZEIGT.
//     Geprüft in navCounts.test.ts (Verhalten) und rueckbauNavigation.test.ts
//     (Quelltext); hier steht nur die Gegenrichtung: Was der Zähler nicht mehr
//     zählt, muss auf der Arbeitsfläche ankommen.
//
//  3. „HEUTE" WURDE ZWEIMAL GERECHNET, EINMAL FALSCH. Die Arbeitsliste nahm den
//     Browser-Tag (`localDateISO`), die Gold-Regel darin den Berliner
//     (`berlinDateISO`). Auf Vercel (UTC) fallen die abends auseinander.
//
//  4. DIE BEIDEN NEUEN ARBEITSFLÄCHEN HATTEN KEINEN ALTLAST-SCHNITT. „Zu tun"
//     schnitt nur nach Zustand — am ersten Tag stünde dort jede jemals angelegte
//     Zeile ohne Ergebnis, alle gleichzeitig gold.
//
// Zwei Prüfarten, wie in rueckbauArbeitsflaeche.test.ts begründet: Was eine
// reine Funktion entscheidet, wird am VERHALTEN geprüft. Was eine Verdrahtung
// in einer React-Komponente entscheidet, wird am QUELLTEXT geprüft — der
// Test-Runner kann .tsx nicht laden, und eine Attrappe bewiese nur, dass die
// Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  istInArbeitsmenge,
  istTerminDran,
  terminZustand,
  type TerminZustand,
  type TerminZustandInput,
} from "@/lib/dranRegel";
import { isStaleDue, letztesLebenszeichen, STALE_AFTER_DAYS } from "@/lib/staleTasks";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Die Datei OHNE Kommentare — für jede „das steht hier nicht mehr"-Prüfung. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const BOARD = read("src/components/termine/TermineBoard.tsx");
const SEITE = read("src/app/(dashboard)/termine/page.tsx");
const SIDEBAR = read("src/components/Sidebar.tsx");
const STALE = read("src/lib/staleTasks.ts");

const HEUTE = "2026-09-15";
const MORGEN = "2026-09-16T08:00:00.000Z";
const GESTERN = "2026-09-14T08:00:00.000Z";
const ABGESAGT_AM = "2026-09-10T09:00:00.000Z";

function zustand(patch: Partial<TerminZustandInput>): TerminZustand {
  return terminZustand(
    {
      kind: "setting",
      status: "offen",
      showStatus: null,
      at: MORGEN,
      cancelledAt: null,
      cancelOutlook: null,
      noShowResolution: null,
      revivedAt: null,
      ...patch,
    },
    HEUTE,
  );
}

/* ------------------------------------------------------------------ *
 * 1 — Die Ablage-Endzustände fallen aus der Arbeitsmenge
 * ------------------------------------------------------------------ */

describe("1 · Was in der Ablage liegt, steht nicht zugleich in der Tagesarbeit", () => {
  test("„abgesagt ohne Aussicht“ ist aus dem Funnel — obwohl der Status `offen` bleibt", () => {
    // DER KERN DES BEFUNDS. `cancelAppointment` setzt `cancelled_at` +
    // `cancel_outlook` und lässt `status` unangetastet (docs §3). Ohne eigene
    // Prüfung wurde daraus `offen` — also Arbeitsmenge, also täglich gold,
    // während dieselbe Zeile in /ablage unter „Ausgeschieden" stand und ins
    // Recycling ging. Zwei Seiten, zwei Wahrheiten, kein Handgriff dazwischen.
    const z = zustand({ status: "offen", cancelledAt: ABGESAGT_AM, cancelOutlook: "ohne_aussicht" });
    assert.equal(z, "tot");
    assert.equal(istInArbeitsmenge(z), false);
    assert.equal(istTerminDran(z, null, HEUTE), false, "die Zeile leuchtet weiterhin gold");
  });

  test("beim Closing heißt derselbe Zustand „Kein Close“", () => {
    // Kein elfter Zustand: Die zehn sind wörtlich die Liste des Auftraggebers,
    // und beide Fälle haben dort längst einen Namen. „Tot" gibt es in der
    // Closing-Sprache nicht, „Kein Close" ist sein Gegenstück.
    const z = terminZustand(
      {
        kind: "closing",
        status: "offen",
        showStatus: null,
        at: MORGEN,
        cancelledAt: ABGESAGT_AM,
        cancelOutlook: "ohne_aussicht",
        noShowResolution: null,
        revivedAt: null,
      },
      HEUTE,
    );
    assert.equal(z, "kein_close");
    assert.equal(istInArbeitsmenge(z), false);
  });

  test("GEGENPROBE: „abgesagt, neuer Termin in Aussicht“ bleibt Tagesarbeit", () => {
    // Die wichtigste Zusicherung dieses Abschnitts — sie ist der Grund, warum
    // nicht einfach jede Absage aus der Liste fliegt. `cancel_outlook` trennt
    // zwei Fälle, die nicht zusammenfallen dürfen (docs §4): totes Ende gegen
    // offenen Ersatztermin. Der zweite ist GENAU der Lead, der in der Luft
    // liegt — er trug früher sogar einen eigenen Ablage-Reiter („Ersatztermin
    // steht aus"), und der Rückbau hat ihn ausdrücklich in die Hauptliste
    // verlegt. Fiele er hier heraus, hätte die Reparatur ihn heimatlos gemacht.
    const z = zustand({ cancelledAt: ABGESAGT_AM, cancelOutlook: "neuer_termin" });
    assert.equal(z, "offen");
    assert.equal(istInArbeitsmenge(z), true);
    assert.equal(istTerminDran(z, null, HEUTE), true);
  });

  test("… und ein zurückgeholter Vorgang ebenfalls: `revived_at` hebt die Absage auf", () => {
    // Dieselbe Rolle wie in `stehtNochAn`: Erst dieses dritte Feld unterscheidet
    // „abgesagt, altes Datum steht noch drin" von „abgesagt, danach neu
    // terminiert". Ohne es verschwände ein zurückgeholter Lead im Nichts.
    assert.equal(
      zustand({ at: MORGEN, cancelledAt: ABGESAGT_AM, cancelOutlook: "ohne_aussicht", revivedAt: "2026-09-11T09:00:00.000Z" }),
      "verlegt",
    );
  });

  test("„No-Show ohne Antwort“ ist ebenfalls aus dem Funnel", () => {
    // `no_show_resolution='ohne_antwort'` ist die ausdrückliche Feststellung,
    // dass nach dem No-Show nichts mehr kam — der einzige saubere Auslöser der
    // Ablage-Ansicht „No-Show ohne Antwort" und ein Recycling-Zweig (docs §5).
    const z = zustand({ at: GESTERN, showStatus: "no_show", noShowResolution: "ohne_antwort" });
    assert.equal(z, "tot");
    assert.equal(istInArbeitsmenge(z), false);
  });

  test("GEGENPROBE: jeder ANDERE No-Show bleibt Tagesarbeit", () => {
    // „Er kam nicht, und niemand hat neu terminiert" ist der Normalfall, für
    // den es die Liste gibt. Nur die eine dokumentierte Feststellung nimmt ihn
    // heraus — ein leeres Feld tut es nicht.
    for (const resolution of [null, "antwort", "ersatztermin"]) {
      const z = zustand({ at: GESTERN, showStatus: "no_show", noShowResolution: resolution });
      assert.equal(z, "no_show", `noShowResolution=${resolution}`);
      assert.equal(istInArbeitsmenge(z), true);
    }
  });

  test("die Reihenfolge trägt: ein neuer Termin schlägt den alten No-Show-Ausgang", () => {
    // `no_show_resolution` wird NACH der Termin-Frage geprüft. Andersherum
    // verschwände eine Zeile, für die längst ein Ersatztermin steht — und die
    // ist versorgt, nicht ausgeschieden.
    assert.equal(zustand({ at: MORGEN, showStatus: "no_show", noShowResolution: "ohne_antwort" }), "verlegt");
  });

  test("der Statuswert schlägt beides — ein Ergebnis bleibt ein Ergebnis", () => {
    // Ein disqualifiziertes Erstgespräch, das später auch noch abgesagt wurde,
    // ist „Nicht qualifiziert" und nicht „Tot": Der ausdrücklich erfasste
    // Ausgang sagt mehr als die Absage danach.
    assert.equal(
      zustand({ status: "unqualifiziert", cancelledAt: ABGESAGT_AM, cancelOutlook: "ohne_aussicht" }),
      "nicht_qualifiziert",
    );
  });

  test("die beiden Felder gehören in die EINGABE — sonst kann die Regel sie nicht kennen", () => {
    // Der Befund saß nicht in der Reihenfolge, sondern im Typ: `TerminZustandInput`
    // trug die beiden Spalten gar nicht. Pflichtfelder, kein `?` — ein Aufrufer,
    // der sie vergisst, ist damit ein Compile-Fehler und kein stiller Ausfall.
    const REGEL = read("src/lib/dranRegel.ts");
    assert.match(REGEL, /\n {2}cancelOutlook: string \| null;/);
    assert.match(REGEL, /\n {2}noShowResolution: string \| null;/);
    // Und der eine Aufrufer füllt sie aus beiden Tabellen.
    const TERMINE = read("src/lib/termine.ts");
    assert.equal(TERMINE.split("cancelOutlook: c.cancel_outlook ?? null,").length - 1, 2);
    assert.equal(TERMINE.split("noShowResolution: c.no_show_resolution ?? null,").length - 1, 2);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — „Heute" wird einmal gerechnet, und zwar in Berlin
 * ------------------------------------------------------------------ */

describe("2 · Eine Uhr, eine Zeitzone", () => {
  test("der Tag kommt vom Server und ist der Berliner", () => {
    // Das Board rechnete `localDateISO()` im Browser, die Gold-Regel darunter
    // `berlinDateISO`. Auf Vercel läuft der Server in UTC: zwischen etwa 22:00
    // Berliner Zeit und Mitternacht lieferte er den VORTAG, der Client den
    // richtigen Tag. Das ist ein Hydrations-Unterschied UND ein Rechenfehler —
    // in dem Fenster leuchteten heute gestempelte Zeilen wieder gold, und
    // gestrige Termine galten als „Verlegt".
    //
    // Europe/Berlin ist eine Produktgrenze, keine Einstellung (docs §6).
    assert.match(SEITE, /import \{ berlinDateISO \} from "@\/lib\/apptTime";/);
    assert.match(SEITE, /const today = berlinDateISO\(new Date\(\)\.toISOString\(\)\);/);
    assert.match(SEITE, /today=\{today\}/);
  });

  test("… und das Board holt sich keinen zweiten", () => {
    // Die Gegenprobe: Ein durchgereichter Tag hilft nichts, solange daneben
    // noch eine zweite Uhr steht. Geprüft am CODE — die Begründung im Kommentar
    // darf `localDateISO` beim Namen nennen.
    assert.doesNotMatch(code(BOARD), /localDateISO/, "das Board rechnet seinen Tag wieder selbst");
    assert.doesNotMatch(code(BOARD), /new Date\(\)/, "im Board steht wieder eine eigene Uhr");
    assert.match(BOARD, /\n {2}today: string;/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Der Altlast-Schnitt der beiden Arbeitsflächen
 * ------------------------------------------------------------------ */

describe("3 · Zweihundert gleichzeitig goldene Zeilen sind keine Arbeitsliste", () => {
  test("der Anker ist das JÜNGSTE Lebenszeichen, nicht der Termin allein", () => {
    // Das ist der Unterschied zwischen einem Schnitt und einem Intervall: Ein
    // Lead, dessen Termin im März war, den das Team aber seit Wochen täglich
    // nervt, bleibt stehen — der Nachfass-Stempel ist jünger. Ohne diesen
    // Vorrang verschwände er mitten aus der Arbeit heraus.
    assert.equal(letztesLebenszeichen(["2026-03-01T08:00:00.000Z", "2026-09-14T08:00:00.000Z"]), "2026-09-14");
    assert.equal(letztesLebenszeichen(["2026-09-14T08:00:00.000Z", "2026-03-01T08:00:00.000Z"]), "2026-09-14");
    // Reihenfolge egal, `null`/`undefined` werden übergangen.
    assert.equal(letztesLebenszeichen([null, "2026-09-14T08:00:00.000Z", undefined]), "2026-09-14");
  });

  test("ohne jedes Lebenszeichen wird nichts ausgeblendet", () => {
    // Wo die Seite über das Alter nichts weiß, behauptet sie auch nichts
    // (docs §5.4) — ein Termin ohne Datum und ohne Stempel bleibt sichtbar.
    assert.equal(letztesLebenszeichen([null, undefined, ""]), null);
    assert.equal(isStaleDue("setting", null, HEUTE), false);
  });

  test("die Grenze der Arbeitsliste liegt bei 30 Tagen, die der Rückrufe bei 14", () => {
    // Die Staffelung IST die Begründung: Ein verabredeter Rückruf hat eine
    // Uhrzeit und ist nach zwei Wochen keiner mehr; ein Termin-Vorgang darf
    // länger liegen, bevor er als aufgegeben gilt.
    assert.equal(STALE_AFTER_DAYS.setting, 30);
    assert.equal(STALE_AFTER_DAYS.closing, 30);
    assert.equal(STALE_AFTER_DAYS.telefon, 14);
    // Der Tag AUF der Grenze zählt noch als Arbeit, der Tag danach nicht mehr.
    assert.equal(isStaleDue("setting", "2026-08-16", HEUTE), false, "30 Tage: noch Arbeit");
    assert.equal(isStaleDue("setting", "2026-08-15", HEUTE), true, "31 Tage: Altlast");
  });

  test("der Schnitt trifft NUR die Arbeitsmenge, und er hängt am jüngsten Lebenszeichen", () => {
    // Verdrahtung im Board: `istInArbeitsmenge` UND `isStaleDue` — ein
    // „Verlegt" wird nie ausgeblendet, es ist versorgt und steht im Kalender.
    assert.match(
      BOARD,
      /istInArbeitsmenge\(e\.zustand\) &&\s*\n\s*isStaleDue\(e\.kind, letztesLebenszeichen\(\[e\.at, e\.lastContactedAt\]\), today\)/,
    );
  });

  test("der Rückruf-Reiter schneidet mit SEINER Kadenz", () => {
    // Er lud jeden Lead im Status `rueckruf` mit einem Datum, egal wie alt —
    // ein verabredeter Rückruf vom Februar ist kein Rückruf mehr. Anker ist
    // hier die Fälligkeit selbst: Sie ist eingehalten oder vorbei.
    assert.match(BOARD, /isStaleDue\("telefon", r\.callbackAt, today\)/);
  });

  test("der Kalender blendet weiterhin NICHTS aus", () => {
    // „Ausgeblendet wird nichts — auch ein toter Lead bleibt sichtbar" (docs
    // §1). Der Schnitt ist eine Frage der Arbeitsliste; ein Kalender mit
    // Löchern wäre eine andere und schlechtere Software.
    assert.match(BOARD, /const inRange = useMemo\(\s*\n?\s*\(\) => \(range \? filtered\.filter/);
    assert.doesNotMatch(BOARD, /inRange = useMemo\([\s\S]{0,200}liste\.events/);
  });

  test("die versteckte Zahl wird GENANNT, mit Grenze und Ausweg", () => {
    // Die Bedingung, unter der ein Schnitt vertretbar ist. Ohne diese Zeile ist
    // er ein lautloses Verschwinden — und der Nutzer sucht einen Lead, den die
    // Software ihm ohne Ansage weggenommen hat.
    assert.match(BOARD, /function AltlastHinweis\(/);
    assert.match(BOARD, /\{versteckt\} \{versteckt === 1 \? einzahl : mehrzahl\} \(seit über \{grenzeTage\} Tagen\)/);
    assert.match(BOARD, /Trotzdem anzeigen/);
    assert.match(BOARD, /Nur aktuelle Arbeit/);
    // Die Grenze kommt aus der Bibliothek, nicht als abgetippte 30 bzw. 14.
    assert.match(BOARD, /grenzeTage=\{STALE_AFTER_DAYS\.setting\}/);
    assert.match(BOARD, /grenzeTage=\{STALE_AFTER_DAYS\.telefon\}/);
  });

  test("der Ausweg steht in der URL — und heißt NICHT „alle“", () => {
    // Diese Seite trägt bereits einen Schalter „Alle" für den
    // Zustands-Ausschnitt (`zeit=alle`). Zwei Bedienelemente, die beide „alles"
    // heißen und Verschiedenes tun, machen eines von beiden unauffindbar.
    assert.match(BOARD, /const zeigeAltlasten = sp\.get\("altlasten"\) === "1";/);
    assert.match(BOARD, /setParam\("altlasten", an \? "1" : null\)/);
    // Und er wirkt auf BEIDE Flächen, sonst wäre er auf einer wirkungslos.
    assert.match(BOARD, /if \(zeigeAltlasten\) return \{ events: filtered, ohneTermin, versteckt: 0 \};/);
    assert.match(BOARD, /if \(zeigeAltlasten\) return \{ aufgaben: rueckrufeGefiltert, versteckt: 0 \};/);
  });

  test("die Begründung steht da, wo die Zahlen stehen", () => {
    // Der Schnitt widerspricht „wer offen ist, wird JEDEN TAG kontaktiert" nur
    // scheinbar. Wer die Zahl später ändern will, muss das Argument daneben
    // finden — sonst wird aus der Grenze eine Meinung.
    assert.match(STALE, /Intervall/);
    assert.match(STALE, /Genervt/);
    assert.match(STALE, /altlasten=1/);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Die Navigation sagt, was sie meint
 * ------------------------------------------------------------------ */

describe("4 · Der Block „Meine Arbeit“", () => {
  test("/termine trägt einen Tooltip — es war die einzige Zeile ohne", () => {
    // Die Tooltips SIND die Abgrenzung der drei Zeilen; sie sind die einzige
    // Stelle, an der ohne Doku steht, welche Zeile welche Frage beantwortet.
    // Ausgerechnet die zentrale Arbeitsfläche hatte keinen.
    const block = SIDEBAR.slice(SIDEBAR.indexOf('href="/termine"'), SIDEBAR.indexOf('href="/nachfassen"'));
    assert.match(block, /title="[^"]{40,}"/, "die Termine-Zeile hat weiterhin keinen Tooltip");
    assert.match(block, /Arbeitsliste/);
  });

  test("… und bewusst keinen Zähler", () => {
    // Das ist eine Entscheidung, keine Lücke, und sie steht als Begründung
    // daneben: Das Gold der Liste ist ABGELEITET (lib/dranRegel.ts) — ein Badge
    // müsste dieselben Zeilen laden wie die Seite oder die Regel ein zweites
    // Mal als Filter formulieren.
    const block = SIDEBAR.slice(SIDEBAR.indexOf('href="/termine"'), SIDEBAR.indexOf('href="/nachfassen"'));
    assert.doesNotMatch(block, /count=/);
  });
});
