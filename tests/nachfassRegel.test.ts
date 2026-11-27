// Nachfass-Eingang — die Regeln als Verhalten (Plan M1).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUFGEBEN_AB_VERSUCHEN,
  badgeZahl,
  gruppeVon,
  gruppiere,
  istAltfall,
  parseReiter,
  plusWerktage,
  schlaegtAufgebenVor,
  versucheInFolge,
  vorschlagNaechsterKontakt,
  type NachfassEintrag,
} from "@/lib/nachfassRegel";

const HEUTE = "2026-12-09"; // Mittwoch
const START = "2026-12-01";
const NOW = Date.parse("2026-12-09T10:00:00Z");

function e(over: Partial<NachfassEintrag>): NachfassEintrag {
  return {
    key: "setting:1",
    quelle: "termin",
    art: "setting",
    id: "1",
    name: "Anna",
    firma: null,
    faelligAm: null,
    koernung: "tag",
    ergebnisFehlt: false,
    lebenszeichen: "2026-12-05",
    kontakte: [],
    ...over,
  };
}

describe("Fälligkeit und Gruppen", () => {
  test("ohne Datum ist ein Vorgang sofort fällig", () => {
    assert.equal(gruppeVon(e({}), HEUTE, NOW, START), "heute");
  });

  test("Datum in der Vergangenheit → überfällig, in der Woche → demnächst, später → wartet", () => {
    assert.equal(gruppeVon(e({ faelligAm: "2026-12-07" }), HEUTE, NOW, START), "ueberfaellig");
    assert.equal(gruppeVon(e({ faelligAm: "2026-12-12" }), HEUTE, NOW, START), "demnaechst");
    assert.equal(gruppeVon(e({ faelligAm: "2027-01-20" }), HEUTE, NOW, START), "wartet");
  });

  test("Termin vorbei ohne Ergebnis steht in eigener Gruppe", () => {
    assert.equal(gruppeVon(e({ ergebnisFehlt: true }), HEUTE, NOW, START), "ergebnis_fehlt");
  });

  test("ein Rückruf wird nach seinem Berliner Tag einsortiert", () => {
    const r = e({ quelle: "rueckruf", art: "phone_lead", koernung: "minute", faelligAm: "2026-12-08T23:30:00Z" });
    // 23:30 UTC = 00:30 Berlin am 09.12. → heute, nicht überfällig
    assert.equal(gruppeVon(r, HEUTE, NOW, START), "heute");
  });

  test("das Badge zählt überfällig + heute + Ergebnis fehlt, nie das Aufräumen", () => {
    const g = gruppiere(
      [
        e({ key: "a", faelligAm: "2026-12-07" }),
        e({ key: "b" }),
        e({ key: "c", ergebnisFehlt: true }),
        e({ key: "d", lebenszeichen: "2026-09-01" }),
        e({ key: "f", faelligAm: "2026-12-12" }),
      ],
      HEUTE,
      NOW,
      START,
    );
    assert.deepEqual(badgeZahl(g), { total: 3, overdue: 2 });
  });
});

describe("Altfall (Aufräumen)", () => {
  test("auch ein alter Termin ohne Ergebnis landet im Aufräumen, ein frischer nicht", () => {
    assert.equal(gruppeVon(e({ ergebnisFehlt: true, lebenszeichen: "2026-09-10" }), HEUTE, NOW, START), "aufraeumen");
    assert.equal(gruppeVon(e({ ergebnisFehlt: true, lebenszeichen: "2026-12-05" }), HEUTE, NOW, START), "ergebnis_fehlt");
  });

  test("altes Lebenszeichen, nie angefasst → Aufräumen", () => {
    assert.equal(istAltfall(e({ lebenszeichen: "2026-10-01" }), HEUTE, START), true);
  });

  test("ein Protokolleintrag holt ihn heraus", () => {
    assert.equal(
      istAltfall(e({ lebenszeichen: "2026-10-01", kontakte: [{ ergebnis: "nicht_erreicht", created_at: "2026-12-02T09:00:00Z" }] }), HEUTE, START),
      false,
    );
  });

  test("ein neu gesetztes Datum („Nochmal versuchen“) ist ein Lebenszeichen", () => {
    assert.equal(istAltfall(e({ lebenszeichen: "2026-10-01", faelligAm: "2026-12-09" }), HEUTE, START), false);
  });

  test("ein Vorgang mit Datum in der Zukunft ist nie Altfall", () => {
    assert.equal(istAltfall(e({ lebenszeichen: "2026-01-01", faelligAm: "2027-01-01" }), HEUTE, START), false);
  });
});

describe("Versuche und Vorschlag", () => {
  test("gezählt wird bis zum letzten Erreichen", () => {
    const k = [
      { ergebnis: "nicht_erreicht" as const, created_at: "5" },
      { ergebnis: "nicht_erreicht" as const, created_at: "4" },
      { ergebnis: "erreicht" as const, created_at: "3" },
      { ergebnis: "nicht_erreicht" as const, created_at: "2" },
    ];
    assert.equal(versucheInFolge(k), 2);
  });

  test(`ab ${AUFGEBEN_AB_VERSUCHEN} Versuchen schlägt die Zeile „aufgeben?" vor`, () => {
    const k = Array.from({ length: AUFGEBEN_AB_VERSUCHEN }, (_, i) => ({ ergebnis: "nicht_erreicht" as const, created_at: String(i) }));
    assert.equal(schlaegtAufgebenVor(k), true);
    assert.equal(schlaegtAufgebenVor(k.slice(1)), false);
  });

  test("nicht erreicht → nächster Werktag, erreicht → in 3 Werktagen, Wochenende übersprungen", () => {
    assert.equal(vorschlagNaechsterKontakt("nicht_erreicht", "2026-12-11"), "2026-12-14"); // Fr → Mo
    assert.equal(vorschlagNaechsterKontakt("erreicht", HEUTE), "2026-12-14"); // Mi → Mo
    assert.equal(plusWerktage("2026-12-12", 1), "2026-12-14"); // Sa → Mo
  });

  test("unbekannte Reiter fallen auf „Fällig“ zurück", () => {
    assert.equal(parseReiter("quatsch"), "faellig");
    assert.equal(parseReiter("aufraeumen"), "aufraeumen");
  });
});
