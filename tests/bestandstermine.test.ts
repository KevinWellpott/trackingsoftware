// Der erste Tag nach dem Deploy — was drei Oberflächen behaupteten, das am
// Montag nicht stimmte.
//
// Ausgangslage (gemessen, nicht vermutet): 9 Organisationen, 173 Erstgespräche,
// 50 Closings, **0 Zeilen in `reminder_touches`**. Für die Kaskade gab es
// bewusst keinen Backfill — erst was nach dem Deploy angelegt oder verschoben
// wurde, erzeugte Erinnerungen. Die Entscheidung war richtig; falsch war nur,
// wie die Oberfläche darüber sprach.
//
// ── GEÄNDERTER GEGENSTAND, und zwar aus dem Rückbau heraus ─────────────────
// HIER STANDEN zwei weitere Blöcke, und beide beschrieben eine Fläche, die es
// nicht mehr gibt:
//
//  · A — das Kaskaden-Panel und seine dreiwertige Historie („nie geplant" ist
//    nicht „erledigt & entfallen"). Das Panel ist gelöscht.
//  · B — der Leerzustand von /erinnerungen und seine Zusage „sobald ein Termin
//    ansteht". Das Board ist gelöscht, die Route eine Weiterleitung.
//
// Beide Befunde waren echt, und ihr gemeinsamer Kern hat den Rückbau überlebt:
// Eine Oberfläche darf nicht behaupten, es sei etwas geplant, was nie geplant
// war. Der radikalste Weg, das einzuhalten, ist der hier gegangene — es gibt
// nichts mehr zu planen. Was bleibt, ist der dritte Block: Keine Seite verweist
// mehr auf eine Kette, die niemand erzeugt.
//
// Geprüft wird am QUELLTEXT: /nachfassen ist eine React-Client-Komponente, die
// der Node-Test-Runner ohne JSX-Transform nicht laden kann.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const NACHFASSEN = read("src/components/nachfassen/NachfassenBoard.tsx");

/* ------------------------------------------------------------------ *
 * /nachfassen verweist nicht mehr auf die Kaskade
 * ------------------------------------------------------------------ */

describe("Kein Verweis mehr nach /erinnerungen", () => {
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
