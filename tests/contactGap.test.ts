// Kontaktfrequenz: „Wann haben wir diesen Lead zuletzt angefasst?"
//
// Zwei Zusicherungen. Die erste ist unverändert: Die Zahl zählt KALENDERTAGE
// und keine 24-Stunden-Blöcke, und sie heißt in Terminliste und Dossier
// wortgleich.
//
// Die zweite ist neu und eine ABWESENHEIT: Die Kontaktfrequenz-Warnung ist
// ersatzlos entfallen. Sie steht damit nicht mehr in dieser Datei — und sie
// soll auch nicht zurückkommen, denn die neue Arbeitsliste sagt das Gegenteil
// („Wer offen ist, wird JEDEN TAG kontaktiert"). Eine Warnung vor dem
// täglichen Kontakt wäre eine Warnung vor dem Verfahren.
//
// GEÄNDERT GEGENÜBER DEM VORSTAND: Dieser Test prüfte bis hierher
// `CONTACT_GAP_WARN_DAYS`, `contactAgeDays`, `isWithinContactGap` und
// `contactGapWindowStart` — vier Exporte ohne Verwender. Die Prüfungen sind
// nicht abgeschwächt, sondern gegenstandslos geworden: Sie beschrieben eine
// Warnung, die es nicht mehr gibt. Was von ihnen inhaltlich zu retten war (die
// Körnung „Kalendertag") prüft jetzt der `dayDiff`-Block direkt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { dayDiff, lastContactLabel } from "@/lib/contactGap";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const QUELLE = read("src/lib/contactGap.ts");

describe("dayDiff", () => {
  test("zählt ganze Kalendertage, vorwärts wie rückwärts", () => {
    assert.equal(dayDiff("2026-09-01", "2026-09-08"), 7);
    assert.equal(dayDiff("2026-09-08", "2026-09-01"), -7);
    assert.equal(dayDiff("2026-09-08", "2026-09-08"), 0);
  });

  test("eine Zeitumstellung verschluckt und erfindet keinen Tag", () => {
    // In Berlin hat der 29.3.2026 nur 23 und der 25.10.2026 25 Stunden. Würde
    // die Differenz in Ortszeit gerechnet, käme hier 1 bzw. 3 statt 2 heraus —
    // ein Lead wäre zweimal im Jahr einen Tag zu alt oder zu jung.
    assert.equal(dayDiff("2026-03-28", "2026-03-30"), 2);
    assert.equal(dayDiff("2026-10-24", "2026-10-26"), 2);
    // Über eine ganze Sommerzeit-Periode hinweg (1.3. → 1.11.2026).
    assert.equal(dayDiff("2026-03-01", "2026-11-01"), 245);
  });

  test("Monats-, Jahres- und Schaltjahresgrenzen stimmen", () => {
    assert.equal(dayDiff("2025-12-31", "2026-01-01"), 1);
    assert.equal(dayDiff("2026-01-31", "2026-02-01"), 1);
    assert.equal(dayDiff("2024-02-28", "2024-03-01"), 2);
    assert.equal(dayDiff("2026-02-28", "2026-03-01"), 1);
  });

  test("eine unlesbare Eingabe ergibt 0 statt NaN", () => {
    // Ein NaN würde sich durch jede Beschriftung fressen („vor NaN Tagen").
    assert.equal(dayDiff("gestern", "2026-09-08"), 0);
    assert.equal(dayDiff("2026-09-08", ""), 0);
  });

  test("die Körnung ist der Kalendertag, nicht der 24-Stunden-Block", () => {
    // Der Fall, den beide Verwender über `berlinDateISO` hereingeben: Kontakt
    // am 7.9. um 23:00 Berlin, jetzt ist der 8.9. um 01:00 Berlin. Zwei Stunden
    // her — aber gestern. Wer in Millisekunden rechnete, schriebe „heute".
    assert.equal(dayDiff("2026-09-07", "2026-09-08"), 1);
    assert.equal(lastContactLabel(dayDiff("2026-09-07", "2026-09-08")), "gestern");
  });
});

describe("lastContactLabel", () => {
  test("beschriftet jede Stufe wörtlich so, wie sie auf beiden Seiten steht", () => {
    assert.equal(lastContactLabel(null), "noch nie kontaktiert");
    assert.equal(lastContactLabel(0), "heute");
    assert.equal(lastContactLabel(1), "gestern");
    assert.equal(lastContactLabel(2), "vor 2 Tagen");
    assert.equal(lastContactLabel(3), "vor 3 Tagen");
    assert.equal(lastContactLabel(42), "vor 42 Tagen");
  });

  test("„noch nie“ ist nicht „heute“", () => {
    // Der einzige Grund, warum die Funktion einen Nullwert annimmt: Eine 0 an
    // dieser Stelle behauptete einen Kontakt, den es nie gab.
    assert.notEqual(lastContactLabel(null), lastContactLabel(0));
  });
});

describe("Rückbau: die Kontaktfrequenz-Warnung ist weg", () => {
  test("die vier Exporte der Warnung gibt es nicht mehr", () => {
    // Geprüft am QUELLTEXT und nicht über einen Import: Ein `import` eines
    // entfernten Exports wäre ein Ladefehler der ganzen Datei, kein Befund.
    for (const name of [
      "CONTACT_GAP_WARN_DAYS",
      "contactAgeDays",
      "isWithinContactGap",
      "contactGapWindowStart",
    ]) {
      assert.doesNotMatch(QUELLE, new RegExp(`export (const|function) ${name}\\b`), `${name} ist wieder da`);
    }
  });

  test("die Datei deklariert keine Warnschwelle mehr", () => {
    // Eine Schwelle ohne Auswertung wäre die halbe Rückkehr: Sie sieht aus wie
    // geltende Konvention, und der nächste Verwender wäre schnell geschrieben.
    //
    // Gesucht wird eine DEKLARATION, nicht das Wort: Der Dateikopf nennt die
    // vier entfernten Namen absichtlich weiter — er begründet, warum es sie
    // nicht mehr gibt, und das ist genau die Erklärung, die einen Rückbau hält.
    assert.doesNotMatch(QUELLE, /^\s*(export\s+)?const\s+\w*WARN_DAYS\b/m);
  });
});
