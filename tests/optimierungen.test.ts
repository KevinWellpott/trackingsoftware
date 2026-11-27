// Optimierungen aus der Prüfliste vom 27.11.2026 (O1–O9) und die Auslöser des
// Nachfass-Eingangs. Reine Regeln als Verhalten, Schreibpfade am Quelltext.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { FU_AUSGELAUFEN_TAGE, istFuAusgelaufen, istKontaktDran, istTerminDran } from "@/lib/dranRegel";
import { brauchtErgebnis, faelligNachShowStatus } from "@/lib/nachfassRegel";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const NOW = Date.parse("2026-12-09T15:00:00Z");

describe("O1/O2 — Ergebnis-Schnellknöpfe", () => {
  const basis = { kind: "setting" as const, status: "offen", showStatus: null, at: "2026-12-09T09:00:00Z", abgesagt: false, nowMs: NOW };

  test("erscheinen, sobald der Termin begonnen hat und kein Ergebnis trägt", () => {
    assert.equal(brauchtErgebnis(basis), true);
  });
  test("nicht vor dem Termin, nicht bei Absage, nicht mit Ergebnis, nicht ohne Uhr", () => {
    assert.equal(brauchtErgebnis({ ...basis, at: "2026-12-10T09:00:00Z" }), false);
    assert.equal(brauchtErgebnis({ ...basis, abgesagt: true }), false);
    assert.equal(brauchtErgebnis({ ...basis, showStatus: "show" }), false);
    assert.equal(brauchtErgebnis({ ...basis, nowMs: null }), false);
  });
  test("Closing: auch nach „erschienen“, solange der Status offen ist", () => {
    assert.equal(brauchtErgebnis({ ...basis, kind: "closing", showStatus: "show" }), true);
    assert.equal(brauchtErgebnis({ ...basis, kind: "closing", status: "gewonnen" }), false);
  });
});

describe("O3 — „Durchgeführt von“ wird vorbelegt", () => {
  test("in beiden Ergebnis-Actions, nur wenn leer", () => {
    for (const f of ["src/app/actions/closingCalls.ts", "src/app/actions/settingCalls.ts"]) {
      const src = read(f);
      assert.match(src, /async function durchfuehrungVorbelegen\(/, f);
      assert.match(src, /\.is\("conducted_by_user_id", null\)/, f);
    }
  });
});

describe("O4 — fällige Rückrufe zuerst im Call-Modus", () => {
  test("sortiert nach verabredeter Uhrzeit vor den übrigen Leads", () => {
    const src = read("src/components/telefon/CallModeRunner.tsx");
    assert.match(src, /return \[\.\.\.vorn, \.\.\.treffer\.filter\(\(l\) => !faellig\(l\)\)\];/);
  });
});

describe("O9 — LinkedIn-Follow-ups laufen nach 14 Tagen aus", () => {
  const k = { answered: null, appointment_set: null, follow_up_number: 1, blocked_at: null };
  test(`über ${FU_AUSGELAUFEN_TAGE} Tage überfällig = nicht mehr dran, aber ausgelaufen`, () => {
    const alt = { ...k, next_follow_up_at: "2026-11-20" };
    assert.equal(istKontaktDran(alt, "2026-12-09"), false);
    assert.equal(istFuAusgelaufen(alt, "2026-12-09"), true);
  });
  test("innerhalb der Frist weiter dran", () => {
    const frisch = { ...k, next_follow_up_at: "2026-11-30" };
    assert.equal(istKontaktDran(frisch, "2026-12-09"), true);
    assert.equal(istFuAusgelaufen(frisch, "2026-12-09"), false);
  });
});

describe("Nachfass-Eingang — Auslöser und Gold", () => {
  test("No-Show heute, erschienen ohne Ergebnis am nächsten Werktag", () => {
    assert.equal(faelligNachShowStatus("no_show", "2026-12-11"), "2026-12-11");
    assert.equal(faelligNachShowStatus("show", "2026-12-11"), "2026-12-14");
    assert.equal(faelligNachShowStatus(null, "2026-12-11"), null);
  });
  test("Gold in der Terminliste heißt nur noch: Erinnerung offen", () => {
    assert.equal(istTerminDran("offen", null, "2026-12-09", null), false);
    assert.equal(istTerminDran("verlegt", null, "2026-12-09", "stunde"), true);
  });
  test("Absage „neuer Termin“ macht den Vorgang heute fällig", () => {
    assert.match(read("src/app/actions/settingCalls.ts"), /input\.outlook === "neuer_termin"\s*\n\s*\? \{ follow_up_due: berlinDateISO/);
  });
  test("ein Recycling-Anruf bei einem Telefon-Lead schreibt eine Anwahl (O2)", () => {
    assert.match(read("src/app/actions/nachfassKontakt.ts"), /input\.art === "phone_lead" && input\.kanal === "anruf"/);
  });
  test("das Badge liest denselben Loader wie die Seite", () => {
    const src = read("src/lib/navCountsData.ts");
    assert.match(src, /ladeNachfassen\("mein"\)/);
    assert.match(src, /badgeZahl\(gruppiere\(/);
  });
});

describe("Betrag aus dem Gewonnen-Popover", () => {
  test("deutsche und englische Schreibweise", async () => {
    const { parseBetrag } = await import("@/lib/betrag");
    assert.equal(parseBetrag("4900"), 4900);
    assert.equal(parseBetrag("4.900"), 4900);
    assert.equal(parseBetrag("4.900,50"), 4900.5);
    assert.equal(parseBetrag("4900.50"), 4900.5);
    assert.equal(parseBetrag("4900,5 €"), 4900.5);
    assert.equal(parseBetrag(""), null);
    assert.equal(parseBetrag("abc"), undefined);
  });
});
