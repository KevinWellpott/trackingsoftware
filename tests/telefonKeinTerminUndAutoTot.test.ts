// Zwei Telefon-Regeln aus Migration 0043 und ihrem Code:
//
//   1. „Kein Termin" ist ein eigenes Ergebnis mit eigener Routing-Liste —
//      wie Rückruf und Nicht erreicht, nicht wie Tot (kein Recycling).
//   2. Das dritte „Nicht erreicht" stellt einen Lead automatisch auf Tot.
//
// Bauart wie telefonAnsichtUndImport.test.ts: Die Server-Action braucht eine
// Datenbank, deshalb wird die Verdrahtung am QUELLTEXT geprüft.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const ACTION = read("src/app/actions/phone.ts");
const RUNNER = read("src/components/telefon/CallModeRunner.tsx");
const MIGRATION = read("supabase/migrations/20260404000043_telefon_kein_termin.sql");
const TYPES = read("src/lib/types.ts");

describe("Migration 0043 erweitert genau die drei CHECKs", () => {
  test("Listenart, Lead-Status und Anruf-Ergebnis kennen 'kein_termin'", () => {
    assert.match(MIGRATION, /list_kind in \('akquise', 'rueckruf', 'nicht_erreicht', 'kein_termin'\)/);
    assert.match(MIGRATION, /status in \('aktiv', 'rueckruf', 'nicht_erreicht', 'kein_termin', 'termin', 'dead'\)/);
    assert.match(
      MIGRATION,
      /outcome in \('termin', 'rueckruf', 'nicht_erreicht', 'kein_termin', 'dead', 'kein_ergebnis'\)/,
    );
  });

  test("alte CHECKs werden über die Spalte gefunden, nicht über den Namen", () => {
    // Die CHECKs aus 0008/0028 sind inline angelegt — ihr Name ist generiert.
    assert.match(MIGRATION, /c\.conkey = array\[a\.attnum\]/);
  });

  test("die TypeScript-Typen ziehen mit", () => {
    assert.match(TYPES, /PhoneListKind = [^;]*"kein_termin"/);
    assert.match(TYPES, /PhoneLeadStatus = [^;]*"kein_termin"/);
    assert.match(TYPES, /PhoneCallOutcome =[^;]*"kein_termin"/);
  });
});

describe("„Kein Termin“ sortiert in eine eigene Liste", () => {
  test("die Action verschiebt in die Routing-Liste 'kein_termin'", () => {
    assert.match(ACTION, /kein_termin: "Kein Termin"/);
    assert.match(ACTION, /newStatus === "nicht_erreicht" \|\| newStatus === "kein_termin"/);
    assert.match(ACTION, /ensurePhoneRoutingList\(srcList, newStatus\)/);
  });

  test("…und plant KEIN Recycling ein (nur 'dead' tut das)", () => {
    assert.match(ACTION, /if \(newStatus === "dead"\) await scheduleRecycle\("telefon", input\.leadId\)/);
  });

  test("der Knopf ruft die Action mit 'kein_termin', per Klick und Taste 5", () => {
    assert.match(RUNNER, /onClick=\{\(\) => applyOutcome\("kein_termin"\)\}/);
    assert.match(RUNNER, /kein_termin: "5"/);
    // Die bestehenden Kürzel bleiben, wo sie waren.
    assert.match(RUNNER, /termin: "1", rueckruf: "2", nicht_erreicht: "3", dead: "4"/);
  });
});

describe("Drittes „Nicht erreicht“ IN FOLGE ⇒ automatisch tot", () => {
  test("die Grenze steht bei 3", () => {
    assert.match(ACTION, /const NICHT_ERREICHT_LIMIT = 3;/);
  });

  test("gelesen werden die letzten zwei Anwahlen, neueste zuerst", () => {
    // Eine Serie, keine Summe: Nur die jüngsten LIMIT−1 Anwahlen zählen.
    assert.match(ACTION, /\.order\("attempt_no", \{ ascending: false \}\)\s*\.limit\(NICHT_ERREICHT_LIMIT - 1\)/);
    assert.ok(!/count \+ 1 >= NICHT_ERREICHT_LIMIT/.test(ACTION), "Die Summen-Zählung ist zurück");
  });

  test("alle müssen 'nicht_erreicht' sein — jedes andere Ergebnis bricht die Serie", () => {
    assert.match(ACTION, /\.length === NICHT_ERREICHT_LIMIT - 1/);
    assert.match(ACTION, /\.every\(\(r\) => \(r as \{ outcome: string \}\)\.outcome === "nicht_erreicht"\)/);
  });

  test("scheitert das Lesen, wird NICHT beendet", () => {
    assert.match(ACTION, /!recentErr &&/);
  });

  test("der Status wird 'dead', das Log behält 'nicht_erreicht'", () => {
    assert.match(ACTION, /const newStatus = autoDead \? "dead" : input\.outcome;/);
    assert.match(ACTION, /outcome: input\.outcome === "aktiv" \? "kein_ergebnis" : input\.outcome/);
  });

  test("die Oberfläche übernimmt 'dead' und sagt, warum", () => {
    assert.match(RUNNER, /status: res\.autoDead \? "dead" : outcome/);
    assert.match(RUNNER, /3-mal hintereinander nicht erreichbar/);
  });
});
