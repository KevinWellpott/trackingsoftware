// Die vereinfachte Telefon-Ansicht — und was der Import ihr liefern muss.
//
// Der Call-Mode trägt seit der Vereinfachung nur noch ZWEI Selektoren
// (Gatekeeper, Entscheider) und die Ergebnis-Knöpfe (vier, seit 0043 fünf). Alles, was vorher
// als Eingabefeld dastand — Pitch, die drei „Warum …?"-Gründe, Reaktion,
// Mailbox, Kontaktdaten, Skript, Einwände, Notizen —, ist aus der Oberfläche
// verschwunden. Die SPALTEN sind geblieben (docs §3): Was fällt, ist die
// Bedienung, nicht die Zeile.
//
// Daraus folgen drei prüfbare Aussagen, und sie sind der Aufbau dieser Datei:
//
//   1. Der CSV-Import füllt die vier Dinge, die ein Anrufer vor dem Wählen
//      braucht, aus einer handrecherchierten Liste mit den Köpfen
//      `Name` / `GF Name` / `Telefon` / `Website`. Das ist der Fall, für den
//      die EXAKTE Kopfzeilen-Gleichheit gebaut wurde (docs §3): Bei
//      Teilstring-Suche träfe „Name" auch „GF Name", und der Firmenname
//      landete als Ansprechpartner.
//   2. Dieselben vier stehen weiterhin auf dem Bildschirm — und zwar
//      vollständig. Die Ansicht ist jetzt die EINZIGE Quelle für den
//      Ansprechpartner: Das Feld, in dem man ihn nachtragen konnte, gibt es
//      nicht mehr.
//   3. Was gefallen ist, bleibt gefallen — mit einer Ausnahme: die Notiz ist
//      auf Wunsch zurück, als einziges Textfeld und einklappbar.
//
// Bauart wie in rueckbauArbeitsflaeche.test.ts: Der Parser ist eine reine
// Funktion und wird als VERHALTEN geprüft; was eine Verdrahtung in JSX
// entscheidet, wird am QUELLTEXT geprüft — eine echte Probe bräuchte einen
// Browser, und eine Attrappe bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { parsePhoneCsv } from "@/lib/phone-csv";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const RUNNER = read("src/components/telefon/CallModeRunner.tsx");

/**
 * Zwei echte Zeilen aus „Webdesign NRW Liste 1.csv" (Lead-Scraper-Export).
 *
 * Drei Eigenschaften der Datei stecken absichtlich drin, jede hätte den
 * Import einzeln kosten können:
 *   · ein **BOM** vor der Kopfzeile, deren erste Spalte gar keinen Namen hat
 *     (Laufindex) — der BOM klebt damit an einer Spalte, die niemand sucht,
 *   · **Leerzeilen** zwischen Kopf und Daten,
 *   · ein Firmenname mit **Komma im Anführungszeichen-Feld**, der bei einem
 *     naiven Split an der falschen Stelle auseinanderfiele.
 */
const CSV =
  "﻿,Name,Art,Anschrift,GF Name,Telefon,Website,Angerufen?,Termin?,Ging nicht ran,\n" +
  "\n" +
  "\n" +
  '1,My Webdesigner,Webdesigner,"Augustastraße 37, 47198 Homberg-Ruhrort-Baerl",Nermin Nurovic,0160 7538915,http://www.my-webdesigner.de/,,,,\n' +
  '3,"Marc Heine - Webdesign, Webflow & SEO",Webdesigner,"Rosellstraße, 50354 Hürth",Marc Heine,015678 398458,https://www.marcheine.de/,,,,\n';

describe("1 · Der Import füllt die vier Felder, die der Anrufer braucht", () => {
  const { rows, totalDataRows } = parsePhoneCsv(CSV);

  test("die beiden Leerzeilen zählen nicht als Datenzeilen", () => {
    assert.equal(totalDataRows, 2);
    assert.equal(rows.length, 2);
  });

  test("`Name` ist die Firma, `GF Name` der Ansprechpartner — nicht umgekehrt", () => {
    // Die Probe, für die es die exakte Kopf-Gleichheit gibt: Beide Köpfe
    // enthalten „Name". Ein Teilstring-Abgleich träfe zweimal dieselbe Spalte.
    assert.equal(rows[0].company, "My Webdesigner");
    assert.equal(rows[0].deciderName, "Nermin Nurovic");
  });

  test("der volle Firmenname überlebt das Komma im Feld", () => {
    assert.equal(rows[1].company, "Marc Heine - Webdesign, Webflow & SEO");
    assert.equal(rows[1].deciderName, "Marc Heine");
  });

  test("Telefonnummer und Website landen vollständig", () => {
    assert.equal(rows[0].phone, "01607538915");
    assert.equal(rows[0].website, "http://www.my-webdesigner.de/");
    assert.equal(rows[1].phone, "015678398458");
    assert.equal(rows[1].website, "https://www.marcheine.de/");
  });

  test("`Art` wird NICHT zur Zielgruppe — die setzt der Dialog einmal für die Datei", () => {
    // Google Maps füllt die Spalte je Eintrag verschieden; als Zielgruppe
    // gelesen entstünden zwei Testgruppen für dieselbe Branche (docs §3).
    assert.equal(rows[0].targetGroup, null);
    assert.equal(rows[1].targetGroup, null);
  });
});

describe("2 · Die vereinfachte Ansicht zeigt die vier weiterhin an", () => {
  test("Firmenname, Ansprechpartner, Website und Rufnummer stehen im Kopf", () => {
    assert.match(RUNNER, /\{current\.company \|\| "Unbekannte Firma"\}/);
    assert.match(RUNNER, /\{current\.decider_name\}/);
    assert.match(RUNNER, /\{current\.website\}/);
    assert.match(RUNNER, /href=\{`tel:\$\{current\.phone\.replace/);
  });

  test("der Firmenname wird im Kopf nicht gekürzt, sondern umbrochen", () => {
    // `overflowWrap: anywhere` statt Ellipse: „Marc Heine - Webdesign,
    // Webflow & SEO" ist der Name, unter dem der Anrufer sich meldet — eine
    // gekürzte Firma ist beim Telefonieren eine falsche Firma.
    assert.match(RUNNER, /overflowWrap: "anywhere"/);
  });

  test("in der Seitenliste trägt die gekürzte Zeile den vollen Namen im Titel", () => {
    // Die Zeile hat eine feste Höhe (Virtualisierung), dort MUSS gekürzt
    // werden. Der volle Name darf deshalb nicht verloren gehen.
    assert.match(RUNNER, /title=\{l\.company \|\| l\.phone \|\| undefined\}/);
  });
});

describe("3 · Was aus der Ansicht verschwunden ist", () => {
  // Gezählt wird der BAUSTEIN, nicht die Beschriftung: Ein Prosa-Kommentar,
  // der ein entferntes Feld beim Namen nennt, darf den Test weder bestehen
  // noch scheitern lassen. `dialer-label` trägt jeder Selektor der Karte —
  // die Liste unten ist damit die vollständige Bedienung der Ansicht.
  const selektoren = [...RUNNER.matchAll(/<label className="dialer-label">([^<]+)<\/label>/g)].map(
    (m) => m[1],
  );

  test("die Karte trägt GENAU zwei Selektoren", () => {
    assert.deepEqual(selektoren, ["Gatekeeper erreicht?", "Entscheider erreicht?"]);
  });

  test("und darunter die fünf Ergebnis-Knöpfe", () => {
    // Vier seit der Vereinfachung, „Kein Termin" kam mit Migration 0043 dazu.
    const i = RUNNER.indexOf("Ergebnis des Anrufs");
    assert.ok(i > 0, "Die Ergebnis-Sektion fehlt");
    const sektion = RUNNER.slice(i);
    for (const label of ["Termin", "Rückruf", "Nicht erreicht", "Toter Lead", "Kein Termin"]) {
      assert.ok(sektion.includes("> " + label), `Ergebnis-Knopf fehlt: ${label}`);
    }
    assert.equal((sektion.match(/className="dialer-outcome"/g) ?? []).length, 5);
  });

  test("das alte Feld-Raster bleibt gefallen", () => {
    // Nicht die Beschriftungen einzeln prüfen, sondern den Baustein: Solange
    // es KEIN DraftField mehr gibt, kann auch keines zurückkommen, ohne dass
    // dieser Test es meldet.
    assert.ok(!RUNNER.includes("DraftField"), "DraftField ist zurück");
    assert.ok(!RUNNER.includes("commitText"), "commitText ist zurück");
  });

  test("genau EIN Textfeld ist zurück: die Notiz, einklappbar", () => {
    // Auf Wunsch zurückgeholt — als einziges Freitextfeld, in einem
    // <details>, das über alle Leads offen oder zu bleibt.
    assert.equal((RUNNER.match(/<textarea/g) ?? []).length, 1, "mehr als ein Textfeld im Call-Mode");
    assert.match(RUNNER, /aria-label="Notizen zum Lead"/);
    assert.match(RUNNER, /onCommit=\{\(next\) => setAndSave\(current\.id, \{ notes: next \}, \{ notes: next \}\)\}/);
    assert.match(RUNNER, /<details\s+open=\{notesOpen\}/);
    assert.match(RUNNER, /<NotesField\s+key=\{current\.id\}/);
  });

  test("`pitch_delivered` hat keine Bedienung mehr, fällt aber weiterhin mit", () => {
    // Die Kaskade bleibt: Ohne sie stünde nach einem zurückgenommenen „Ja"
    // die unmögliche Kombination „kein Entscheider, aber gepitcht" in der
    // Zeile — und die sieht jetzt niemand mehr.
    assert.ok(!selektoren.includes("Pitch gekommen?"), "Der Pitch-Schalter ist zurück");
    assert.match(RUNNER, /decider_reached: false, pitch_delivered: false/);
  });
});
