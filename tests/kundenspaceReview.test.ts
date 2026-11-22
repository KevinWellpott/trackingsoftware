// Befunde des Reviews vom 22.11.2026, je einer pro Test.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseEuro, type UmsatzRate, type UmsatzZahlung } from "@/lib/umsatz";
import * as P from "@/lib/umsatzPlanung";

const ctx = () => {
  let n = 0;
  return { heute: "2026-11-22", neueId: () => `n${++n}` };
};
const r = (id: string, faellig_am: string, extra: Partial<UmsatzRate> = {}): UmsatzRate => ({
  id,
  faellig_am,
  betrag: 1000,
  erlass: null,
  ...extra,
});
const z = (id: string, betrag: number, art: UmsatzZahlung["art"] = "zahlung"): UmsatzZahlung => ({
  id,
  eingang_am: "2026-11-01",
  betrag,
  art,
});
const s = (raten: UmsatzRate[], zahlungen: UmsatzZahlung[] = []): P.Stand => ({
  vertrag: { vertragswert: 3000, gekuendigt_am: null, kuendigung_wirksam_zum: null, abgebrochen_am: null },
  raten,
  zahlungen,
});

describe("Review", () => {
  test("2 · eine Stundung geht nur nach hinten", () => {
    const e = P.verschieben(s([r("a", "2026-12-10"), r("b", "2026-12-20")], [z("z", 1000)]), { rateId: "b", auf: "2026-11-23", grund: "x" }, ctx());
    assert.ok("error" in e);
  });

  test("2 · Korrektur zieht keine Rate vor eine bezahlte", () => {
    const e = P.rateKorrigieren(s([r("a", "2026-12-10"), r("b", "2026-12-20")], [z("z", 1000)]), { rateId: "b", betrag: 1000, faellig_am: "2026-12-01" });
    assert.ok("error" in e);
  });

  test("3 · Schnellerfassung nicht auf einen bestehenden Plan", () => {
    const e = P.planAnlegen(s([r("alt", "2026-09-01")]), { modus: "ergaenzen", raten: [{ faellig_am: "2026-10-01", betrag: 500 }], bezahltBis: 1 }, ctx());
    assert.ok("error" in e);
  });

  test("4 · Löschen macht Kassiert nie negativ", () => {
    assert.ok("error" in P.buchungLoeschen(s([], [z("a", 1000), z("e", -1000, "erstattung")]), "a"));
  });

  test("10 · Pause behält den Monatsletzten", () => {
    const e = P.pausieren(s([r("a", "2027-01-31"), r("b", "2027-02-28"), r("c", "2027-03-31")]), { monate: 1, grund: "x" }, ctx());
    assert.ok("aenderung" in e);
    assert.deepEqual(e.aenderung.ratenAendern?.map((x) => x.faellig_am), ["2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  test("10 · Planende behält den Monatsletzten", () => {
    assert.equal(P.planEnde([r("a", "2027-01-31"), r("b", "2027-02-28")]), "2027-03-31");
  });

  test("11 · ein Nachlass namens Kündigung wird nicht mit zurückgenommen", () => {
    const e = P.erlassen(s([r("a", "2026-12-01")]), { rateId: "a", erlass: "storniert", grund: "Kündigung" }, ctx());
    assert.ok("aenderung" in e);
    assert.notEqual(e.aenderung.ratenAendern?.[0].erlass_grund, P.ERLASS_KUENDIGUNG);
  });

  test("14 · 0.500 sind 50 Cent, nicht 500 €", () => {
    assert.equal(parseEuro("0.500"), 0.5);
    assert.equal(parseEuro("4.900"), 4900);
  });

  test("Zahlung korrigieren in einem Schritt", () => {
    const e = P.buchungKorrigieren(s([r("a", "2026-12-01")], [z("a", 1000)]), { zahlungId: "a", betrag: 100, eingang_am: "2026-11-03" }, ctx());
    assert.ok("aenderung" in e);
    assert.deepEqual(e.aenderung.zahlungenLoeschen, ["a"]);
    assert.equal(e.aenderung.zahlungenNeu?.[0].betrag, 100);
  });

  test("Stundung zurücknehmen", () => {
    const e = P.stundungZurueck(s([r("a", "2026-12-30", { urspruenglich_faellig_am: "2026-11-01" })]), "a");
    assert.ok("aenderung" in e);
    assert.deepEqual(e.aenderung.ratenAendern?.[0], { id: "a", faellig_am: "2026-11-01", urspruenglich_faellig_am: null });
    assert.deepEqual(e.aenderung.stundungLoeschen, ["a"]);
  });

  test("Stundung zurück nicht, wenn eine spätere Rate schon bezahlt ist", () => {
    const e = P.stundungZurueck(
      s([r("b", "2026-12-01"), r("a", "2026-12-30", { urspruenglich_faellig_am: "2026-11-01" })], [z("z", 1000)]),
      "a",
    );
    assert.ok("error" in e);
  });

  test("Anzahl der Verschiebungen, auch über Teilungen", () => {
    const raten = [r("a", "2026-12-01"), r("b", "2027-01-01", { herkunft_rate_id: "a" })];
    const v = [
      { rate_id: "a", art: "stundung" as const },
      { rate_id: "b", art: "stundung" as const },
      { rate_id: "b", art: "zusage" as const },
    ];
    assert.equal(P.anzahlVerschoben("b", raten, v), 2);
  });
});
