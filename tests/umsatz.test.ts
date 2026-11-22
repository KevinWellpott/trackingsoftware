// Umsatz-Rechnung der internen Kundenübersicht (src/lib/umsatz.ts, Migration
// 0047). Geprüft werden die Sonderfälle, die der Auftrag ausdrücklich nennt:
// Teilzahlung, Kündigung, Abbruch — dazu Rücklastschrift, Überzahlung und die
// Cent-Rundung des Ratenplans.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  addMonthsISO,
  erzeugeRatenplan,
  kundenKennzahlen,
  parseEuro,
  ratenFuerKuendigung,
  schritteFuerAbbruch,
  verteileZahlungen,
  type UmsatzRate,
  type UmsatzZahlung,
} from "@/lib/umsatz";

const rate = (id: string, faellig_am: string, betrag: number, erlass: UmsatzRate["erlass"] = null): UmsatzRate => ({
  id,
  faellig_am,
  betrag,
  erlass,
});
const zahlung = (id: string, eingang_am: string, betrag: number, art: UmsatzZahlung["art"] = "zahlung"): UmsatzZahlung => ({
  id,
  eingang_am,
  betrag,
  art,
});

const vertrag = (vertragswert: number, extra: Partial<Parameters<typeof kundenKennzahlen>[0] & object> = {}) => ({
  vertragswert,
  gekuendigt_am: null,
  kuendigung_wirksam_zum: null,
  abgebrochen_am: null,
  ...extra,
});

const DREI = [rate("r1", "2026-09-01", 1000), rate("r2", "2026-10-01", 1000), rate("r3", "2026-11-01", 1000)];

describe("Zahlungen werden nach Fälligkeit verteilt", () => {
  test("Teilzahlung macht die älteste Rate teilbezahlt — vor Fälligkeit", () => {
    const v = verteileZahlungen(DREI, [zahlung("z", "2026-08-20", 400)], "2026-08-25");
    assert.equal(v.raten[0].zustand, "teilbezahlt");
    assert.equal(v.raten[0].bezahlt, 400);
    assert.equal(v.raten[0].rest, 600);
    assert.equal(v.raten[1].zustand, "offen");
  });

  test("eine teilbezahlte Rate nach Fälligkeit ist überfällig, nicht teilbezahlt", () => {
    const v = verteileZahlungen(DREI, [zahlung("z", "2026-08-20", 400)], "2026-09-02");
    assert.equal(v.raten[0].zustand, "ueberfaellig");
    assert.equal(v.raten[0].rest, 600);
  });

  test("am Fälligkeitstag selbst ist eine Rate noch nicht überfällig", () => {
    const v = verteileZahlungen(DREI, [], "2026-09-01");
    assert.equal(v.raten[0].zustand, "offen");
  });

  test("Überzahlung wird Guthaben, nicht verschluckt", () => {
    const v = verteileZahlungen(DREI, [zahlung("z", "2026-09-01", 3500)], "2026-09-02");
    assert.ok(v.raten.every((r) => r.zustand === "bezahlt"));
    assert.equal(v.guthaben, 500);
    assert.equal(v.kassiert, 3500);
  });

  test("Rücklastschrift öffnet die zuletzt gefüllte Rate wieder", () => {
    const z = [zahlung("a", "2026-09-01", 1000), zahlung("b", "2026-10-01", 1000), zahlung("c", "2026-10-10", -1000, "ruecklastschrift")];
    const v = verteileZahlungen(DREI, z, "2026-10-15");
    assert.equal(v.kassiert, 1000);
    assert.equal(v.raten[0].zustand, "bezahlt");
    assert.equal(v.raten[1].zustand, "ueberfaellig");
  });

  test("Erstattung ohne vorherige Zahlung erscheint als negatives Guthaben", () => {
    const v = verteileZahlungen(DREI, [zahlung("x", "2026-09-01", -100, "erstattung")], "2026-08-01");
    assert.equal(v.guthaben, -100);
    assert.ok(v.raten.every((r) => r.bezahlt === 0));
  });

  test("stornierte und abgeschriebene Raten nehmen kein Geld auf", () => {
    const raten = [rate("r1", "2026-09-01", 1000, "abgeschrieben"), rate("r2", "2026-10-01", 1000)];
    const v = verteileZahlungen(raten, [zahlung("z", "2026-09-05", 1000)], "2026-10-02");
    assert.equal(v.raten[0].zustand, "abgeschrieben");
    assert.equal(v.raten[1].zustand, "bezahlt");
  });

  test("Cent-genau: drei Drittel ergeben exakt den Vertragswert", () => {
    const plan = erzeugeRatenplan({ gesamt: 4900, anzahl: 3, erstesDatum: "2026-01-31", rhythmusMonate: 1 });
    const raten = plan.map((p, i) => rate(`r${i}`, p.faellig_am, p.betrag));
    const v = verteileZahlungen(raten, [zahlung("z", "2026-04-01", 4900)], "2026-05-01");
    assert.ok(v.raten.every((r) => r.zustand === "bezahlt"));
    assert.equal(v.guthaben, 0);
  });
});

describe("Ratenplan", () => {
  test("Rundungsrest auf der letzten Rate, Monatsende geklemmt", () => {
    const plan = erzeugeRatenplan({ gesamt: 4900, anzahl: 3, erstesDatum: "2026-01-31", rhythmusMonate: 1 });
    assert.deepEqual(plan.map((p) => p.betrag), [1633.33, 1633.33, 1633.34]);
    assert.deepEqual(plan.map((p) => p.faellig_am), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  test("Anzahlung steht als eigene erste Rate", () => {
    const plan = erzeugeRatenplan({
      gesamt: 3900,
      anzahl: 3,
      erstesDatum: "2026-12-01",
      rhythmusMonate: 1,
      anzahlung: 1000,
      anzahlungDatum: "2026-11-10",
    });
    assert.equal(plan.length, 4);
    assert.deepEqual(plan[0], { faellig_am: "2026-11-10", betrag: 1000 });
    assert.equal(plan.reduce((s, p) => s + p.betrag, 0), 4900);
  });

  test("Quartalsweise und über den Jahreswechsel", () => {
    assert.equal(addMonthsISO("2026-11-15", 3), "2027-02-15");
    assert.equal(addMonthsISO("2028-01-31", 1), "2028-02-29");
  });
});

describe("Kündigung und Abbruch", () => {
  test("Kündigung storniert nur Raten NACH dem Wirksamkeitstag", () => {
    assert.deepEqual(ratenFuerKuendigung(DREI, "2026-10-01"), ["r3"]);
  });

  test("gekündigt, aber noch eine fällige Rate offen → überfällig hat Vorrang", () => {
    const raten = [rate("r1", "2026-09-01", 1000), rate("r2", "2026-10-01", 1000), rate("r3", "2026-11-01", 1000, "storniert")];
    const k = kundenKennzahlen(
      vertrag(3000, { gekuendigt_am: "2026-09-15", kuendigung_wirksam_zum: "2026-10-01" }),
      raten,
      [zahlung("z", "2026-09-01", 1000)],
      "2026-10-05",
    );
    assert.equal(k.status, "ueberfaellig");
    assert.equal(k.ueberfaellig, 1000);
    assert.equal(k.storniert, 1000);
    assert.equal(k.nichtVerplant, 0);
  });

  test("gekündigt und alles bis zur Kündigung bezahlt → gekündigt", () => {
    const raten = [rate("r1", "2026-09-01", 1000), rate("r2", "2026-10-01", 1000, "storniert")];
    const k = kundenKennzahlen(
      vertrag(2000, { gekuendigt_am: "2026-09-15", kuendigung_wirksam_zum: "2026-09-30" }),
      raten,
      [zahlung("z", "2026-09-01", 1000)],
      "2026-10-05",
    );
    assert.equal(k.status, "gekuendigt");
    assert.equal(k.offen, 0);
  });

  test("Abbruch: bezahlte Raten bleiben, teilbezahlte werden geteilt, offene abgeschrieben", () => {
    const s = schritteFuerAbbruch(DREI, [zahlung("z", "2026-09-01", 1400)], "2026-10-05");
    assert.deepEqual(s, [
      { art: "teilen", id: "r2", bezahlt: 400, rest: 600, faellig_am: "2026-10-01" },
      { art: "abschreiben", id: "r3" },
    ]);
  });
});

describe("Kennzahlen je Kunde", () => {
  test("ohne Raten mit Vertragswert: Zahlungsplan fehlt", () => {
    const k = kundenKennzahlen(vertrag(4900), [], [], "2026-11-08");
    assert.equal(k.status, "plan_fehlt");
    assert.equal(k.nichtVerplant, 4900);
  });

  test("überfällig, künftig und kassiert summieren sich zum Plan", () => {
    const k = kundenKennzahlen(vertrag(3000), DREI, [zahlung("z", "2026-09-01", 1500)], "2026-10-15");
    assert.equal(k.kassiert, 1500);
    assert.equal(k.ueberfaellig, 500);
    assert.equal(k.kuenftig, 1000);
    assert.equal(k.kassiert + k.offen, 3000);
    assert.equal(k.naechsteRate?.id, "r2");
  });

  test("alles bezahlt → vollständig bezahlt", () => {
    const k = kundenKennzahlen(vertrag(3000), DREI, [zahlung("z", "2026-09-01", 3000)], "2026-12-01");
    assert.equal(k.status, "bezahlt");
    assert.equal(k.naechsteRate, null);
  });
});

describe("Beträge lesen", () => {
  test("deutsche und englische Schreibweisen", () => {
    assert.equal(parseEuro("1.633,33"), 1633.33);
    assert.equal(parseEuro("1633,3"), 1633.3);
    assert.equal(parseEuro("4.900"), 4900);
    assert.equal(parseEuro("4.900 €"), 4900);
    assert.equal(parseEuro("1633.5"), 1633.5);
    assert.equal(parseEuro("abc"), null);
    assert.equal(parseEuro(""), null);
  });
});

describe("Migration 0047", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../supabase/migrations/20260404000047_umsatz_fulfillment.sql", import.meta.url)),
    "utf8",
  );

  test("keine Kaskade auf workspaces (sonst fehlt die Tabelle in der Löschvorschau, §8)", () => {
    assert.doesNotMatch(sql, /references public\.workspaces\(id\) on delete cascade/);
  });

  test("Finanztabellen hängen an is_intern_finanz, nicht an der Mitgliedschaft", () => {
    for (const t of ["kunden_vertraege", "kunden_raten", "kunden_zahlungen"]) {
      assert.match(sql, new RegExp(`on public\\.${t} for all to authenticated\\s+using \\(\\(select public\\.is_intern_finanz\\(\\)\\)\\)`));
    }
  });

  test("kein Plattform-Admin-Zugang an der Titan-Mitgliedschaft vorbei", () => {
    assert.doesNotMatch(sql, /_platform_admin on public\.kunden/);
  });
});
