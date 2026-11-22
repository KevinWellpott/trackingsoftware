// Geldaktionen des Kundenspace (src/lib/umsatzPlanung.ts). Jeder Fall aus
// den Befunden B1–B6 und den Sonderfällen des Plans steht hier als Test.
//
// `anwenden()` spielt nach, was `finanz_anwenden()` (Migration 0047) schreibt.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cent, kundenKennzahlen, type UmsatzRate, type UmsatzZahlung } from "@/lib/umsatz";
import {
  abbruch,
  abbruchZurueck,
  aufFolgeraten,
  buchen,
  buchungLoeschen,
  erlassen,
  kuendigung,
  kuendigungZurueck,
  pausieren,
  planAnlegen,
  planEnde,
  planVorschlag,
  rateKorrigieren,
  rateLoeschen,
  verschieben,
  zusagen,
  type Aenderung,
  type Ergebnis,
  type Stand,
} from "@/lib/umsatzPlanung";

const HEUTE = "2026-11-22";
const ctx = () => {
  let n = 0;
  return { heute: HEUTE, neueId: () => `neu-${++n}` };
};
const r = (id: string, faellig_am: string, betrag = 1000, extra: Partial<UmsatzRate> = {}): UmsatzRate => ({
  id,
  faellig_am,
  betrag,
  erlass: null,
  ...extra,
});
const z = (id: string, betrag: number, eingang_am = "2026-10-01"): UmsatzZahlung => ({
  id,
  eingang_am,
  betrag,
  art: "zahlung",
});
const stand = (raten: UmsatzRate[], zahlungen: UmsatzZahlung[] = [], wert = 3000): Stand => ({
  vertrag: { vertragswert: wert, gekuendigt_am: null, kuendigung_wirksam_zum: null, abgebrochen_am: null },
  raten,
  zahlungen,
});
const DREI = () => [r("r1", "2026-10-01"), r("r2", "2026-11-01"), r("r3", "2026-12-01")];

function ok(e: Ergebnis): Aenderung {
  assert.ok("aenderung" in e, JSON.stringify(e));
  return e.aenderung;
}
function fehler(e: Ergebnis) {
  assert.ok("error" in e, JSON.stringify(e));
}
function anwenden(s: Stand, a: Aenderung): Stand {
  let raten = s.raten.map((x) => ({ ...x, ...(a.ratenAendern?.find((u) => u.id === x.id) ?? {}) }));
  raten = raten.filter((x) => !a.ratenLoeschen?.includes(x.id));
  raten.push(...(a.ratenNeu ?? []));
  const zahlungen = [...s.zahlungen, ...(a.zahlungenNeu ?? [])].filter((x) => !a.zahlungenLoeschen?.includes(x.id));
  return { vertrag: { ...s.vertrag, ...(a.vertrag ?? {}) }, raten, zahlungen };
}
const zahlen = (s: Stand) => kundenKennzahlen(s.vertrag, s.raten, s.zahlungen, HEUTE);
const aktiv = (s: Stand) => s.raten.filter((x) => !x.erlass).reduce((n, x) => n + cent(x.betrag), 0);
const neu = (...b: [string, number][]) => b.map(([faellig_am, betrag]) => ({ faellig_am, betrag }));

describe("B1 + B3 · Ratenplan", () => {
  test("voll verplant: Ergänzen schlägt nichts vor, nicht den Vertragswert", () => {
    assert.equal(planVorschlag(stand(DREI()), "ergaenzen", HEUTE), 0);
  });

  test("Ersetzen schlägt nur vor, was nicht bezahlt ist", () => {
    assert.equal(planVorschlag(stand(DREI(), [z("a", 1500)]), "ersetzen", HEUTE), 1500);
  });

  test("Ersetzen lässt Bezahltes stehen, der Rest geht auf", () => {
    const s = stand(DREI(), [z("a", 1500)]);
    const n = anwenden(s, ok(planAnlegen(s, { modus: "ersetzen", raten: neu(["2026-12-15", 750], ["2027-01-15", 750]) }, ctx())));
    const k = zahlen(n);
    assert.equal(aktiv(n), 300000);
    assert.equal(k.kassiert, 1500);
    assert.equal(k.ueberfaellig, 0);
    assert.equal(k.kuenftig, 1500);
    assert.equal(k.guthaben, 0);
    assert.equal(k.raten.find((x) => x.id === "r1")?.zustand, "bezahlt");
  });

  test("Schnellerfassung: Raten 1 bis 2 bezahlt, Eingang nie in der Zukunft", () => {
    const s = stand([]);
    const a = ok(
      planAnlegen(
        s,
        { modus: "ergaenzen", raten: neu(["2026-11-01", 1000], ["2026-12-01", 1000], ["2027-01-01", 1000]), bezahltBis: 2 },
        ctx(),
      ),
    );
    assert.deepEqual(a.zahlungenNeu?.map((x) => x.eingang_am), ["2026-11-01", HEUTE]);
    assert.equal(zahlen(anwenden(s, a)).kuenftig, 1000);
  });

  test("Schnellerfassung mit angezahlter nächster Rate", () => {
    const s = stand([], [], 2000);
    const a = ok(planAnlegen(s, { modus: "ergaenzen", raten: neu(["2026-10-01", 1000], ["2026-11-01", 1000]), bezahltBis: 1, teilbetrag: 300 }, ctx()));
    assert.equal(zahlen(anwenden(s, a)).ueberfaellig, 700);
  });

  test("Schnellerfassung bucht nichts doppelt auf vorhandene Zahlungen", () => {
    fehler(planAnlegen(stand([], [z("a", 1000)]), { modus: "ergaenzen", raten: neu(["2026-11-01", 3000]), bezahltBis: 1 }, ctx()));
  });
});

describe("B2 + B6 · Stundung und Übertrag", () => {
  test("teilbezahlt: nur der Rest wandert, Überfällig sinkt genau um ihn", () => {
    const s = stand(DREI(), [z("a", 500)]);
    assert.equal(zahlen(s).ueberfaellig, 1500);
    const a = ok(verschieben(s, { rateId: "r1", auf: "2027-01-15", grund: "vereinbart" }, ctx()));
    const n = anwenden(s, a);
    const k = zahlen(n);
    assert.equal(k.ueberfaellig, 1000);
    assert.equal(k.kuenftig, 1500);
    assert.equal(k.raten.find((x) => x.id === "r1")?.zustand, "bezahlt");
    assert.equal(aktiv(n), aktiv(s));
  });

  test("ganze Rate: nicht überfällig, Ursprung und Ursprungsmonat bleiben belegt", () => {
    const s = stand([r("r1", "2026-11-01")], [], 1000);
    const a = ok(verschieben(s, { rateId: "r1", auf: "2026-11-30", grund: "Urlaub" }, ctx()));
    const n = anwenden(s, a);
    assert.equal(zahlen(n).ueberfaellig, 0);
    assert.equal(n.raten[0].urspruenglich_faellig_am, "2026-11-01");
    const v = a.vereinbarungen![0];
    assert.deepEqual([v.art, v.von_datum, v.auf_datum, v.betrag], ["stundung", "2026-11-01", "2026-11-30", 1000]);
  });

  test("mehrfach verschoben: das erste Datum bleibt", () => {
    const s = stand([r("r1", "2026-12-01", 1000, { urspruenglich_faellig_am: "2026-10-01" })]);
    const n = anwenden(s, ok(verschieben(s, { rateId: "r1", auf: "2027-02-01", grund: "erneut" }, ctx())));
    assert.equal(n.raten[0].urspruenglich_faellig_am, "2026-10-01");
  });

  test("nur ein Teil wird verschoben", () => {
    const s = stand(DREI());
    const n = anwenden(s, ok(verschieben(s, { rateId: "r1", betrag: 400, auf: "2027-01-01", grund: "knapp" }, ctx())));
    assert.equal(zahlen(n).ueberfaellig, 1600);
    assert.equal(aktiv(n), 300000);
  });

  test("gebrochene Vereinbarung: Tage zählen ab neuem Datum", () => {
    const k = zahlen(stand([r("r1", "2026-11-15", 1000, { urspruenglich_faellig_am: "2026-10-01" })], [], 1000));
    assert.equal(k.raten[0].tage, 7);
    assert.equal(k.raten[0].vereinbarungGebrochen, true);
  });

  test("ohne Grund, ohne Rest, zu hoch oder in die Vergangenheit: abgelehnt", () => {
    const s = stand(DREI(), [z("a", 1000)]);
    fehler(verschieben(s, { rateId: "r2", auf: "2027-01-01", grund: " " }, ctx()));
    fehler(verschieben(s, { rateId: "r1", auf: "2027-01-01", grund: "x" }, ctx()));
    fehler(verschieben(s, { rateId: "r2", auf: "2026-11-21", grund: "x" }, ctx()));
    fehler(verschieben(s, { rateId: "r2", betrag: 1000.01, auf: "2027-01-01", grund: "x" }, ctx()));
  });

  test("auf Folgeraten verteilen: Summe gleich, Rundung auf der letzten", () => {
    const s = stand([r("r1", "2026-11-01", 100), r("a", "2026-12-01"), r("b", "2027-01-01"), r("c", "2027-02-01")]);
    const a = ok(aufFolgeraten(s, { rateId: "r1", grund: "verteilt" }, ctx()));
    const n = anwenden(s, a);
    assert.equal(aktiv(n), aktiv(s));
    assert.deepEqual(n.raten.map((x) => x.betrag), [1033.33, 1033.33, 1033.34]);
    assert.equal(a.vereinbarungen!.reduce((x, v) => x + cent(v.betrag), 0), 10000);
    assert.equal(zahlen(n).ueberfaellig, 0);
  });

  test("teilbezahlt auf Folgeraten: der bezahlte Teil bleibt", () => {
    const s = stand(DREI(), [z("a", 400)]);
    const n = anwenden(s, ok(aufFolgeraten(s, { rateId: "r1", grund: "x" }, ctx())));
    assert.equal(n.raten.find((x) => x.id === "r1")?.betrag, 400);
    assert.equal(n.raten.find((x) => x.id === "r3")?.betrag, 1600);
    assert.equal(zahlen(n).ueberfaellig, 1000);
  });

  test("ans Planende: ein Rhythmus nach der letzten Rate", () => {
    assert.equal(planEnde(DREI()), "2027-01-01");
    assert.equal(planEnde([r("a", "2026-03-01"), r("b", "2026-06-01")]), "2026-09-01");
  });

  test("Pause: Künftiges rückt, Überfälliges bleibt", () => {
    const s = stand([r("alt", "2026-11-01"), r("a", "2026-12-31"), r("b", "2027-01-31")]);
    const n = anwenden(s, ok(pausieren(s, { monate: 2, grund: "Elternzeit" }, ctx())));
    assert.deepEqual(n.raten.map((x) => x.faellig_am), ["2026-11-01", "2027-02-28", "2027-03-31"]);
    assert.equal(zahlen(n).ueberfaellig, 1000);
  });

  test("Zusage: bleibt 21 Tage überfällig, nur der Vermerk kommt dazu", () => {
    const s = stand([r("r1", "2026-11-01")], [], 1000);
    const a = ok(zusagen(s, { rateId: "r1", auf: "2026-11-30", grund: "am Telefon" }, ctx()));
    assert.equal(a.vereinbarungen![0].art, "zusage");
    assert.equal(a.ratenAendern, undefined);
    assert.equal(zahlen(anwenden(s, a)).raten[0].tage, 21);
  });
});

describe("B4 + B5 · Status", () => {
  test("Wert 0 ohne Plan ist nicht vollständig bezahlt", () => {
    assert.equal(zahlen(stand([], [], 0)).status, "vertrag_fehlt");
  });

  test("Plan über Vertragswert ist sichtbar", () => {
    assert.equal(zahlen(stand(DREI(), [], 2000)).zuvielVerplant, 1000);
  });

  test("alle geplanten Raten bezahlt, Vertrag nicht voll verplant: Plan unvollständig", () => {
    assert.equal(zahlen(stand([r("r1", "2026-10-01")], [z("a", 1000)])).status, "plan_unvollstaendig");
  });

  test("Tage überfällig: die älteste offene Rate zählt", () => {
    const k = zahlen(stand(DREI(), [z("a", 1000)]));
    assert.equal(k.tageUeberfaellig, 21);
  });

  test("am Fälligkeitstag 0 Tage", () => {
    assert.equal(zahlen(stand([r("r1", HEUTE)], [], 1000)).tageUeberfaellig, 0);
  });
});

describe("Buchungen", () => {
  test("Erstattung mindert Kassiert und erzeugt keine neue Forderung", () => {
    const s = stand(DREI(), [z("a", 2000)]);
    const vorher = zahlen(s);
    const n = anwenden(s, ok(buchen(s, { art: "erstattung", betrag: 500, eingang_am: HEUTE }, ctx())));
    const k = zahlen(n);
    assert.equal(k.kassiert, 1500);
    assert.equal(k.offen, vorher.offen);
    assert.equal(k.storniert, 500);
  });

  test("Erstattung aus Guthaben storniert nichts", () => {
    const s = stand(DREI(), [z("a", 3500)]);
    const a = ok(buchen(s, { art: "erstattung", betrag: 500, eingang_am: HEUTE }, ctx()));
    const k = zahlen(anwenden(s, a));
    assert.equal(k.guthaben, 0);
    assert.equal(k.storniert, 0);
    assert.equal(k.offen, 0);
  });

  test("gelöschte Erstattung stellt die Rate wieder her", () => {
    const s = stand(DREI(), [z("a", 2000)]);
    const n = anwenden(s, ok(buchen(s, { art: "erstattung", betrag: 500, eingang_am: HEUTE }, ctx())));
    const id = n.zahlungen.find((x) => x.art === "erstattung")!.id;
    const k = zahlen(anwenden(n, ok(buchungLoeschen(n, id))));
    assert.deepEqual([k.kassiert, k.storniert, k.offen], [2000, 0, 1000]);
  });

  test("mehr erstatten als eingegangen: abgelehnt", () => {
    fehler(buchen(stand(DREI(), [z("a", 100)]), { art: "erstattung", betrag: 200, eingang_am: HEUTE }, ctx()));
  });

  test("Rücklastschrift öffnet die Rate wieder", () => {
    const s = stand(DREI(), [z("a", 2000)]);
    const n = anwenden(s, ok(buchen(s, { art: "ruecklastschrift", betrag: 1000, eingang_am: HEUTE }, ctx())));
    assert.equal(zahlen(n).ueberfaellig, 1000);
  });

  test("gleicher Betrag am gleichen Tag warnt, bestätigt geht es durch", () => {
    const s = stand(DREI(), [z("a", 1000, HEUTE)]);
    const b = { art: "zahlung", betrag: 1000, eingang_am: HEUTE } as const;
    assert.ok("doppelt" in buchen(s, b, ctx()));
    ok(buchen(s, { ...b, trotzDoppelt: true }, ctx()));
  });

  test("Zahlung in der Zukunft ist noch kein Eingang", () => {
    fehler(buchen(stand(DREI()), { art: "zahlung", betrag: 1000, eingang_am: "2026-11-23" }, ctx()));
  });
});

describe("Erlass, Korrektur, Ende", () => {
  test("Storno einer teilbezahlten Rate trifft nur den Rest", () => {
    const s = stand(DREI(), [z("a", 400)]);
    const k = zahlen(anwenden(s, ok(erlassen(s, { rateId: "r1", erlass: "storniert", grund: "Nachlass" }, ctx()))));
    assert.equal(k.storniert, 600);
    assert.equal(k.ueberfaellig, 1000);
    assert.equal(k.guthaben, 0);
  });

  test("Korrektur unter den bezahlten Teil: abgelehnt", () => {
    fehler(rateKorrigieren(stand(DREI(), [z("a", 400)]), { rateId: "r1", betrag: 300, faellig_am: "2026-10-01" }));
  });

  test("Datum einer angezahlten Rate nur über Stundung", () => {
    fehler(rateKorrigieren(stand(DREI(), [z("a", 400)]), { rateId: "r1", betrag: 1000, faellig_am: "2026-12-24" }));
  });

  test("bezahlte Rate löschen: abgelehnt", () => {
    fehler(rateLoeschen(stand(DREI(), [z("a", 1000)]), "r1"));
  });

  test("Kündigung und Rücknahme, der Nachlass bleibt", () => {
    const s = stand([...DREI(), r("nl", "2026-12-15", 100, { erlass: "storniert", erlass_grund: "Nachlass" })]);
    const g = anwenden(s, ok(kuendigung(s, { gekuendigt_am: HEUTE, wirksam_zum: "2026-11-30" })));
    assert.equal(zahlen(g).kuenftig, 0);
    assert.equal(zahlen(g).ueberfaellig, 2000);
    const n = anwenden(g, ok(kuendigungZurueck(g)));
    assert.equal(zahlen(n).kuenftig, 1000);
    assert.equal(zahlen(n).storniert, 100);
  });

  test("Abbruch und Rücknahme", () => {
    const s = stand(DREI(), [z("a", 1400)]);
    const g = anwenden(s, ok(abbruch(s, { datum: HEUTE }, ctx())));
    assert.equal(zahlen(g).abgeschrieben, 1600);
    assert.equal(zahlen(g).status, "abgebrochen");
    assert.equal(zahlen(anwenden(g, ok(abbruchZurueck(g)))).offen, 1600);
  });

  test("späte Zahlung nach Abbruch ist Guthaben", () => {
    const s = stand([r("r1", "2026-10-01", 1000, { erlass: "abgeschrieben" })], [z("a", 200)], 1000);
    assert.equal(zahlen(s).guthaben, 200);
  });
});

describe("Invariante über alle Verschiebungen", () => {
  // Deterministisch durchgespielt: jeder Zahlungsstand × jede Rate × jede Aktion.
  test("Summe bleibt, Überfälliges sinkt nie stärker als der verschobene Betrag", () => {
    let geprueft = 0;
    for (let gezahlt = 0; gezahlt <= 4000; gezahlt += 125) {
      const s = stand(
        [r("a", "2026-09-30"), r("b", "2026-10-31"), r("c", "2026-11-30"), r("d", "2026-12-31")],
        gezahlt ? [z("z", gezahlt)] : [],
        4000,
      );
      const vor = zahlen(s);
      for (const rate of vor.raten) {
        if (!rate.rest) continue;
        for (const e of [
          verschieben(s, { rateId: rate.id, auf: "2027-03-15", grund: "x" }, ctx()),
          verschieben(s, { rateId: rate.id, betrag: rate.rest / 2, auf: "2027-03-15", grund: "x" }, ctx()),
          aufFolgeraten(s, { rateId: rate.id, grund: "x" }, ctx()),
        ]) {
          if (!("aenderung" in e)) continue;
          const n = anwenden(s, e.aenderung);
          const nach = zahlen(n);
          const bewegt = e.aenderung.vereinbarungen!.reduce((x, v) => x + cent(v.betrag), 0);
          const erwartet = rate.zustand === "ueberfaellig" ? bewegt : 0;
          assert.equal(aktiv(n), aktiv(s));
          assert.equal(cent(nach.offen), cent(vor.offen));
          assert.equal(cent(vor.ueberfaellig) - cent(nach.ueberfaellig), erwartet, `${gezahlt} ${rate.id}`);
          geprueft++;
        }
      }
    }
    assert.ok(geprueft > 100);
  });
});
