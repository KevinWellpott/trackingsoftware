// Gesamtübersicht und Monatsansicht (src/lib/finanzen.ts): rein, raus, bleibt.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { kundenKennzahlen, type UmsatzRate, type UmsatzZahlung } from "@/lib/umsatz";
import {
  altersklasse,
  bruttoZuNetto,
  istMonat,
  kostenImMonat,
  monatsAbschluss,
  monatsTage,
  type KostenDaten,
  type KundeFinanz,
} from "@/lib/finanzen";

const HEUTE = "2026-11-22";
const kunde = (raten: UmsatzRate[], zahlungen: UmsatzZahlung[] = [], vereinbarungen: KundeFinanz["vereinbarungen"] = []): KundeFinanz => ({
  id: "k",
  name: "Kunde",
  k: kundenKennzahlen(
    { vertragswert: 3000, gekuendigt_am: null, kuendigung_wirksam_zum: null, abgebrochen_am: null },
    raten,
    zahlungen,
    HEUTE,
  ),
  zahlungen,
  vereinbarungen,
});
const r = (id: string, faellig_am: string, betrag = 1000): UmsatzRate => ({ id, faellig_am, betrag, erlass: null });
const keineKosten: KostenDaten = { positionen: [], betraege: [], monate: [] };
const ads: KostenDaten = {
  positionen: [{ id: "ads", name: "Ads", kategorie: "marketing", rhythmus: "monatlich", start_monat: "2026-09", ende_monat: null }],
  betraege: [
    { position_id: "ads", gueltig_ab: "2026-09", betrag: 800 },
    { position_id: "ads", gueltig_ab: "2026-11", betrag: 1000 },
  ],
  monate: [],
};

describe("Kosten", () => {
  test("Änderung gilt ab Monat X, frühere Monate bleiben", () => {
    assert.equal(kostenImMonat(ads, "2026-10").summe, 800);
    assert.equal(kostenImMonat(ads, "2026-11").summe, 1000);
    assert.equal(kostenImMonat(ads, "2027-05").summe, 1000);
    assert.equal(kostenImMonat(ads, "2026-08").summe, 0);
  });

  test("Ist ersetzt Plan, wird nie addiert", () => {
    const d = { ...ads, monate: [{ position_id: "ads", monat: "2026-11", ist: 940, ausgesetzt: false }] };
    assert.equal(kostenImMonat(d, "2026-11").summe, 940);
    assert.equal(kostenImMonat(d, "2026-11").zeilen[0].plan, 1000);
  });

  test("Ist von 0 ist 0, nicht Plan", () => {
    const d = { ...ads, monate: [{ position_id: "ads", monat: "2026-11", ist: 0, ausgesetzt: false }] };
    assert.equal(kostenImMonat(d, "2026-11").summe, 0);
  });

  test("ausgesetzt und beendet", () => {
    const aus = { ...ads, monate: [{ position_id: "ads", monat: "2026-11", ist: null, ausgesetzt: true }] };
    assert.equal(kostenImMonat(aus, "2026-11").summe, 0);
    assert.equal(kostenImMonat(aus, "2026-12").summe, 1000);
    const ende = { ...ads, positionen: [{ ...ads.positionen[0], ende_monat: "2026-11" }] };
    assert.equal(kostenImMonat(ende, "2026-11").summe, 1000);
    assert.equal(kostenImMonat(ende, "2026-12").summe, 0);
  });

  test("einmalig, quartalsweise, jährlich", () => {
    const mit = (rhythmus: "einmalig" | "quartal" | "jaehrlich") => ({
      ...ads,
      positionen: [{ ...ads.positionen[0], rhythmus }],
    });
    const treffer = (d: KostenDaten) =>
      ["2026-09", "2026-10", "2026-12", "2027-09"].map((m) => kostenImMonat(d, m).summe > 0);
    assert.deepEqual(treffer(mit("einmalig")), [true, false, false, false]);
    assert.deepEqual(treffer(mit("quartal")), [true, false, true, true]);
    assert.deepEqual(treffer(mit("jaehrlich")), [true, false, false, true]);
  });
});

describe("Was bleibt", () => {
  test("das Beispiel: 6.000 rein, 1.000 Ads, 30 % Rücklage", () => {
    const z: UmsatzZahlung = { id: "z", eingang_am: "2026-11-05", betrag: 6000, art: "zahlung" };
    const a = monatsAbschluss([kunde([r("a", "2026-11-05", 6000)], [z])], ads, 30, "2026-11", HEUTE);
    assert.deepEqual([a.rein, a.raus, a.gewinn, a.ruecklage, a.frei], [6000, 1000, 5000, 1500, 3500]);
  });

  test("Überfälliges zählt nicht in die sichere Prognose", () => {
    const a = monatsAbschluss([kunde([r("alt", "2026-11-01"), r("kommt", "2026-11-28")])], keineKosten, 0, "2026-11", HEUTE);
    assert.deepEqual([a.eingegangen, a.nochErwartet, a.ueberfaelligImMonat, a.rein], [0, 1000, 1000, 1000]);
  });

  test("Vorauszahlung zählt einmal: im Monat des Eingangs", () => {
    const z: UmsatzZahlung = { id: "z", eingang_am: "2026-11-10", betrag: 1000, art: "zahlung" };
    const k = [kunde([r("a", "2026-12-01")], [z])];
    assert.equal(monatsAbschluss(k, keineKosten, 0, "2026-11", HEUTE).rein, 1000);
    assert.equal(monatsAbschluss(k, keineKosten, 0, "2026-12", HEUTE).rein, 0);
  });

  test("Verlust: keine Rücklage auf negativen Gewinn", () => {
    const a = monatsAbschluss([], ads, 30, "2026-11", HEUTE);
    assert.deepEqual([a.gewinn, a.ruecklage, a.frei], [-1000, 0, -1000]);
  });

  test("vergangener Monat: nur, was wirklich kam", () => {
    assert.equal(monatsAbschluss([kunde([r("a", "2026-10-10")])], keineKosten, 0, "2026-10", HEUTE).rein, 0);
  });
});

describe("Monat nach Tagen", () => {
  test("fällig, eingegangen und übertragen stehen am jeweiligen Tag", () => {
    const z: UmsatzZahlung = { id: "z", eingang_am: "2026-11-07", betrag: 400, art: "zahlung" };
    const tage = monatsTage(
      [kunde([r("a", "2026-11-03", 500)], [z], [
        { id: "v", rate_id: "b", art: "stundung", betrag: 1000, von_datum: "2026-11-10", auf_datum: "2027-01-10", grund: "x" },
        { id: "w", rate_id: "a", art: "zusage", betrag: 100, von_datum: "2026-11-12", auf_datum: "2026-11-30", grund: "x" },
      ])],
      "2026-11",
    );
    assert.deepEqual(tage.map((t) => [t.tag, t.faellig, t.eingegangen, t.uebertragen]), [
      ["2026-11-03", 500, 0, 0],
      ["2026-11-07", 0, 400, 0],
      ["2026-11-10", 0, 0, 1000],
    ]);
  });
});

describe("Monat nach Tagen: Stornos", () => {
  test("eine stornierte Rate ist nicht fällig", () => {
    const tage = monatsTage([kunde([{ ...r("a", "2026-11-03"), erlass: "storniert" }])], "2026-11");
    assert.deepEqual(tage, []);
  });
});

describe("Hilfen", () => {
  test("Altersklassen 1–7, 8–30, über 30", () => {
    assert.deepEqual([1, 7, 8, 30, 31].map(altersklasse), ["bis7", "bis7", "bis30", "bis30", "ueber30"]);
  });

  test("Brutto-Umrechner", () => {
    assert.equal(bruttoZuNetto(5831, 19), 4900);
  });

  test("Monat aus der URL", () => {
    assert.deepEqual(["2026-11", "2026-13", "2026-1", "x"].map(istMonat), [true, false, false, false]);
  });
});
