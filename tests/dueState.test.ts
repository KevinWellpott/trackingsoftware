// Fälligkeit: „fällig" oder schon „überfällig" — und die Falle, wegen der
// `lib/dueState.ts` überhaupt existiert.
//
// `nachfassen_tasks` presst fünf Quellen in EINE Spalte `due_at timestamptz`,
// und vier davon sind in Wahrheit Tages-Werte (`date`), die die RPC nur castet.
// Ein `date` wird dabei zu Mitternacht UTC — in Berlin 02:00 (Sommerzeit) bzw.
// 01:00 (Winterzeit). Wer die Spalte nach ihrem DATENTYP liest, hält ab dieser
// Uhrzeit jede Aufgabe für überfällig; und weil die RPC ohnehin nur Fälliges
// liefert, wäre schlicht ALLES überfällig. Eine Dringlichkeit, die immer gilt,
// ist keine.
//
// Die Tests unten fixieren deshalb genau diese Stelle: dieselbe Zeichenkette,
// derselbe Bezugspunkt, zwei Körnungen — zwei verschiedene Antworten.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dueDayOf, dueRefNow, isOverdue, type DueGranularity, type DueRef } from "@/lib/dueState";

/**
 * Genau das, was PostgREST aus einer `date`-Spalte macht: Mitternacht UTC.
 * In Berlin ist das am 8.9.2026 (Sommerzeit) der Morgen um 02:00.
 */
const TAGES_WERT = "2026-09-08T00:00:00+00:00";

/** 8.9.2026, 10:00 Berliner Wandzeit (Sommerzeit, UTC+2). */
const REF_10_UHR: DueRef = { nowMs: Date.parse("2026-09-08T08:00:00Z"), todayIso: "2026-09-08" };

/**
 * Ein Zeitpunkt in Berliner Wandzeit am 8.9.2026. Der Offset ist dort fest
 * +2 h (die Umstellung liegt am 29.3. und am 25.10.), Stunde 0 und 1 fallen
 * deshalb noch in den UTC-Vortag.
 */
function berlinAm8September(hour: number, minute = 0): number {
  const utcHour = hour - 2;
  const day = utcHour < 0 ? "07" : "08";
  const hh = String((utcHour + 24) % 24).padStart(2, "0");
  return Date.parse(`2026-09-${day}T${hh}:${String(minute).padStart(2, "0")}:00Z`);
}

describe("dueDayOf", () => {
  test("ein gecasteter Tages-Wert behält seinen Tag, obwohl er nachts ankommt", () => {
    // Sommer: Mitternacht UTC = 02:00 Berlin. Winter: 01:00 Berlin. Beide Male
    // derselbe Kalendertag — sonst verschöbe die Zeitzone jede Wiedervorlage.
    assert.equal(dueDayOf("2026-09-08T00:00:00+00:00"), "2026-09-08");
    assert.equal(dueDayOf("2026-01-15T00:00:00+00:00"), "2026-01-15");
  });

  test("eine reine Datums-Schreibweise wird nicht durch die Zeitzone gedreht", () => {
    assert.equal(dueDayOf("2026-09-08"), "2026-09-08");
    assert.equal(dueDayOf("2026-01-15"), "2026-01-15");
  });

  test("spätabends UTC ist in Berlin bereits der nächste Tag", () => {
    // 22:30 UTC im Sommer = 00:30 Berlin am Folgetag. Ein `slice(0, 10)` auf
    // der Rohzeichenkette läse hier den falschen Tag.
    assert.equal(dueDayOf("2026-09-08T21:30:00Z"), "2026-09-08");
    assert.equal(dueDayOf("2026-09-08T22:30:00Z"), "2026-09-09");
    // Winter: die Grenze liegt eine Stunde später.
    assert.equal(dueDayOf("2026-01-15T22:30:00Z"), "2026-01-15");
    assert.equal(dueDayOf("2026-01-15T23:30:00Z"), "2026-01-16");
  });
});

describe("isOverdue — die 02:00-Falle", () => {
  test("derselbe Wert ist als Tag fällig und als Uhrzeit überfällig", () => {
    // DIE Zusicherung dieser Datei. Fällt sie, behauptet die Seitenleiste eine
    // Dringlichkeit, die die Seite darunter nicht kennt.
    assert.equal(isOverdue(TAGES_WERT, "day", REF_10_UHR), false);
    assert.equal(isOverdue(TAGES_WERT, "moment", REF_10_UHR), true);
  });

  test("die Tages-Körnung bleibt den ganzen Tag ruhig, die Uhrzeit-Körnung kippt um 02:00", () => {
    // Kontrolle des Helfers: 02:00 Berlin ist im Sommer Mitternacht UTC —
    // genau der Zeitpunkt, an dem der gecastete Tages-Wert „vorbei" ist.
    assert.equal(new Date(berlinAm8September(2)).toISOString(), "2026-09-08T00:00:00.000Z");

    for (let stunde = 0; stunde < 24; stunde++) {
      const ref: DueRef = { nowMs: berlinAm8September(stunde, 30), todayIso: "2026-09-08" };
      assert.equal(isOverdue(TAGES_WERT, "day", ref), false, `Tag, ${stunde}:30 Berlin`);
      assert.equal(isOverdue(TAGES_WERT, "moment", ref), stunde >= 2, `Uhrzeit, ${stunde}:30 Berlin`);
    }
  });

  test("auch in der Winterzeit trennt nur die Körnung, nicht die Uhrzeit", () => {
    // 09:00 Berlin am 15.1.2026 = 08:00 UTC; der Tages-Wert liegt bei 01:00
    // Berlin bereits hinter uns.
    const ref: DueRef = { nowMs: Date.parse("2026-01-15T08:00:00Z"), todayIso: "2026-01-15" };
    assert.equal(isOverdue("2026-01-15T00:00:00+00:00", "day", ref), false);
    assert.equal(isOverdue("2026-01-15T00:00:00+00:00", "moment", ref), true);
  });
});

describe("isOverdue — Tages-Körnung", () => {
  test("überfällig wird ein Tages-Eintrag erst am FOLGETAG", () => {
    assert.equal(isOverdue("2026-09-07", "day", REF_10_UHR), true);
    assert.equal(isOverdue("2026-09-08", "day", REF_10_UHR), false);
    assert.equal(isOverdue("2026-09-09", "day", REF_10_UHR), false);
  });

  test("maßgeblich ist der Berliner Kalendertag, nicht der UTC-Datumsteil", () => {
    // 7.9. 22:30 UTC ist in Berlin schon der 8. — also heute, nicht gestern.
    assert.equal(isOverdue("2026-09-07T22:30:00Z", "day", REF_10_UHR), false);
    // Gegenprobe eine Stunde früher: derselbe UTC-Tag, aber Berlin noch am 7.
    assert.equal(isOverdue("2026-09-07T21:30:00Z", "day", REF_10_UHR), true);
  });

  test("über die Monats- und Jahresgrenze hinweg wird lexikografisch richtig verglichen", () => {
    const silvester: DueRef = { nowMs: Date.parse("2026-01-01T09:00:00Z"), todayIso: "2026-01-01" };
    assert.equal(isOverdue("2025-12-31", "day", silvester), true);
    assert.equal(isOverdue("2026-01-01", "day", silvester), false);
  });
});

describe("isOverdue — Uhrzeit-Körnung", () => {
  test("überfällig ist ein Termin in der Minute DANACH, nicht in seiner eigenen", () => {
    const termin = "2026-09-08T09:00:00Z";
    const um = (iso: string): DueRef => ({ nowMs: Date.parse(iso), todayIso: "2026-09-08" });
    assert.equal(isOverdue(termin, "moment", um("2026-09-08T08:59:59Z")), false);
    assert.equal(isOverdue(termin, "moment", um("2026-09-08T09:00:00Z")), false);
    assert.equal(isOverdue(termin, "moment", um("2026-09-08T09:00:01Z")), true);
  });

  test("eine unlesbare Zeitangabe gilt nicht als überfällig", () => {
    // NaN < now wäre false — die Zusicherung ist, dass daraus keine stille
    // Dringlichkeit wird.
    assert.equal(isOverdue("demnächst", "moment", REF_10_UHR), false);
  });
});

describe("isOverdue — leere Werte und fehlender Bezugspunkt", () => {
  test("ohne Fälligkeit ist in beiden Körnungen nichts überfällig", () => {
    for (const koernung of ["day", "moment"] as DueGranularity[]) {
      assert.equal(isOverdue(null, koernung), false, koernung);
      assert.equal(isOverdue(undefined, koernung), false, koernung);
      assert.equal(isOverdue("", koernung), false, koernung);
    }
  });

  test("ohne übergebenen Bezugspunkt ermittelt isOverdue 'jetzt' selbst", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-08T08:00:00Z") });
    assert.equal(isOverdue("2026-09-07", "day"), true);
    assert.equal(isOverdue("2026-09-08", "day"), false);
    assert.equal(isOverdue("2026-09-08T07:00:00Z", "moment"), true);
    assert.equal(isOverdue("2026-09-08T09:00:00Z", "moment"), false);
  });
});

describe("dueRefNow", () => {
  test("der Tag im Bezugspunkt ist der BERLINER, nicht der UTC-Tag", (t) => {
    // 22:30 UTC am 8.9. ist in Berlin bereits der 9. Käme der Tag aus dem
    // ISO-Präfix, stünde in der Seitenleiste abends ein Tag zu wenig.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-08T22:30:00Z") });
    const ref = dueRefNow();
    assert.equal(ref.nowMs, Date.parse("2026-09-08T22:30:00Z"));
    assert.equal(ref.todayIso, "2026-09-09");
  });

  test("mit dem eigenen Bezugspunkt ist der heutige Tag nie überfällig", (t) => {
    // Beide Felder stammen aus EINEM Messwert; wären es zwei Date.now()-Aufrufe,
    // könnte ein Stapel um Mitternacht auseinanderfallen.
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-08T21:00:00Z") });
    const ref = dueRefNow();
    assert.equal(ref.todayIso, "2026-09-08");
    assert.equal(isOverdue(ref.todayIso, "day", ref), false);
  });
});
