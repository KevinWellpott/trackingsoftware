// Fulfillment-Regeln des Kundenspace (src/lib/kunden.ts).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { aufmerksamkeit, verschobeneReihenfolge, zeilenZuPunkten } from "@/lib/kunden";
import { planRaten } from "@/lib/geldAktion";

const JETZT = Date.parse("2026-11-22T12:00:00Z");
const basis = { status: "aktiv" as const, agenda: 1 };

describe("Aufmerksamkeit", () => {
  test("kein Termin", () => {
    assert.deepEqual(aufmerksamkeit({ ...basis, termin: null }, JETZT), ["Kein Meeting geplant"]);
  });

  test("Termin vorbei ohne Abschluss, aber nicht während des Meetings", () => {
    assert.deepEqual(aufmerksamkeit({ ...basis, termin: "2026-11-22T09:00:00Z" }, JETZT), ["Meeting noch nicht abgeschlossen"]);
    assert.deepEqual(aufmerksamkeit({ ...basis, termin: "2026-11-22T11:30:00Z" }, JETZT), []);
  });

  test("unter 48 h ohne Agenda", () => {
    assert.deepEqual(aufmerksamkeit({ ...basis, agenda: 0, termin: "2026-11-23T12:00:00Z" }, JETZT), ["Meeting ohne Agenda"]);
    assert.deepEqual(aufmerksamkeit({ ...basis, agenda: 0, termin: "2026-11-25T12:00:00Z" }, JETZT), []);
  });

  test("pausiert und beendet brauchen nichts", () => {
    for (const status of ["pausiert", "abgeschlossen", "abgesprungen"] as const) {
      assert.deepEqual(aufmerksamkeit({ status, agenda: 0, termin: null }, JETZT), []);
    }
  });
});

describe("Liste einfügen", () => {
  test("eine Zeile ist eine Checkbox, # beginnt eine Phase", () => {
    assert.deepEqual(zeilenZuPunkten("Kickoff\n\n# Woche 1\n- Profil\n2. Skript\n[ ] Liste\n- [x] Pitch\n☐ Call\n#\nAbschluss"), [
      { titel: "Kickoff", phase: null },
      { titel: "Profil", phase: "Woche 1" },
      { titel: "Skript", phase: "Woche 1" },
      { titel: "Liste", phase: "Woche 1" },
      { titel: "Pitch", phase: "Woche 1" },
      { titel: "Call", phase: "Woche 1" },
      { titel: "Abschluss", phase: null },
    ]);
  });

  test("ein Titel, der mit einer Zahl beginnt, bleibt heil", () => {
    assert.deepEqual(zeilenZuPunkten("30.11. Review\n90-Tage-Plan\n#1 Priorität").map((x) => x.titel), [
      "30.11. Review",
      "90-Tage-Plan",
      "#1 Priorität",
    ]);
  });
});

describe("Sortieren", () => {
  test("innerhalb der Phase, auch wenn die Phasen gemischt liegen (B11)", () => {
    const rows = [
      { id: "a", phase: "1" },
      { id: "x", phase: "2" },
      { id: "b", phase: "1" },
    ];
    assert.deepEqual(verschobeneReihenfolge(rows, "b", -1), ["b", "a", "x"]);
    assert.equal(verschobeneReihenfolge(rows, "x", -1), null);
  });
});

describe("Ratenplan aus der Eingabe", () => {
  test("Anzahlung allein ist ein vollständiger Plan", () => {
    const r = planRaten({ gesamt: "4.900", anzahlung: "4900", anzahl: 0, erstesDatum: "2026-12-01", rhythmusMonate: 1 });
    assert.deepEqual(r, [{ faellig_am: "2026-12-01", betrag: 4900 }]);
  });

  test("Unlesbares wird nie zu 0", () => {
    assert.ok("error" in planRaten({ gesamt: "4900", anzahlung: "tausend", anzahl: 3, erstesDatum: "2026-12-01", rhythmusMonate: 1 }));
  });
});

describe("Serverseiten rufen keine Funktion aus Client-Modulen (B19)", () => {
  // Der Build merkt das nicht, erst das Rendern mit Daten wirft.
  const wurzel = fileURLToPath(new URL("../src/", import.meta.url));
  const dateien = readdirSync(wurzel, { recursive: true, encoding: "utf8" }).filter(
    (f) => /\.tsx?$/.test(f) && /(kunden|umsatz)/i.test(f),
  );
  for (const f of dateien) {
    const text = readFileSync(join(wurzel, f), "utf8");
    if (text.startsWith('"use client"')) continue;
    test(f, () => {
      assert.doesNotMatch(text, /import \{[^}]*\bformatDateDe\b[^}]*\} from "@\/components\/ui/);
    });
  }
});
