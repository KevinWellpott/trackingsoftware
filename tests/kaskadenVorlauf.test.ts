// Am Buchungstag geht keine Erinnerung raus.
//
// Der Befund des Auftraggebers: Ein heute gebuchter Termin für MORGEN 18:00
// bekam die Stufe „1 Tag vorher" auf HEUTE 18:00 gelegt — vier Stunden nach der
// Buchung ging eine Nachricht raus, die einen Termin bestätigt, den der Lead
// gerade selbst vereinbart hat. Die Stufe war nach der ursprünglichen Regel
// völlig korrekt: Ihre Fälligkeit lag ja noch in der Zukunft. Nur ist „liegt
// noch in der Zukunft" nicht dasselbe wie „darf schon raus".
//
// Die erste Fassung zählte dafür Vorlauf-Tage (je Tag eine Stufe mehr). Sie ließ
// EINEN Fall übrig, und zwar strukturell denselben: Bei genau 3 Tagen Vorlauf
// fiel die 3-Tages-Stufe auf den Buchungstag. Die jetzige Regel sagt deshalb
// direkt, worum es geht:
//
//   Eine Stufe wird geplant, wenn (1) ihre Fälligkeit noch bevorsteht UND
//   (2) sie nicht auf den Buchungstag fällt (Berliner Kalendertag).
//   AUSNAHME: Die termin-nächste Stufe wird immer geplant, solange sie
//   bevorsteht — sonst bekäme ein Termin HEUTE gar keine Erinnerung mehr.
//
// Für die Auslieferungswerte (3 Tage / 1 Tag / 1 Stunde) ergibt das:
//   heute        → „1 Stunde", solange sie bevorsteht
//   morgen       → „1 Stunde"
//   in 2 Tagen   → „1 Tag" + „1 Stunde"
//   in 3 Tagen   → „1 Tag" + „1 Stunde"   (die 3-Tages-Stufe läge auf heute)
//   in 4+ Tagen  → alle drei
// Für Setting und Closing wörtlich gleich.
//
// Zwei Eigenschaften der Umsetzung stehen hier mit unter Prüfung, weil sie sich
// einer falschen Zahl nicht ansehen lassen:
//
//  1. Gerechnet wird in BERLINER KALENDERTAGEN, nicht in Stunden. „Derselbe Tag"
//     ist ein Kalenderbegriff — am Umstellungswochenende ist ein Tag 23 oder 25
//     Stunden lang, und eine Millisekunden-Rechnung läge dann daneben.
//  2. Die Regel hängt am Kalendertag der Fälligkeit, nicht an den Minutenwerten
//     4320/1440/60. Die Offsets stehen in `cascade_steps` und sind je
//     Organisation per SQL änderbar.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { isoToBerlinInput } from "@/lib/apptTime";
import {
  berlinLeadDays,
  BOOKING_DAY_SKIP_REASON,
  fallsOnBookingDay,
  nearestStep,
  planScheduledCascade,
} from "@/lib/cascadeEngine";
import type { CascadeKind, CascadeStep } from "@/lib/cascadeEngine";
import type { TemplateKey } from "@/lib/messageTemplates";

const DAY = 1440;
const HOUR = 60;

function step(
  partial: Partial<CascadeStep> & { step_no: number; offset_minutes: number },
): CascadeStep {
  const anchor = partial.anchor ?? "before_appointment";
  return {
    cascade_kind: "setting_msg",
    trigger_event: anchor === "before_appointment" ? "scheduled" : "no_show",
    requires_no_response: false,
    enabled: true,
    template_key: `setting_msg_${Math.min(partial.step_no, 3)}` as TemplateKey,
    ...partial,
    anchor,
  };
}

/** Die ausgelieferte Vor-Termin-Kaskade einer Kaskadenart: 3 Tage / 1 Tag / 1 Stunde. */
function standardSteps(kind: CascadeKind): CascadeStep[] {
  const prefix = kind === "closing_msg" ? "closing_msg" : "setting_msg";
  return [1, 2, 3].map((no) =>
    step({
      cascade_kind: kind,
      step_no: no,
      offset_minutes: no === 1 ? 3 * DAY : no === 2 ? 1 * DAY : 1 * HOUR,
      template_key: `${prefix}_${no}` as TemplateKey,
    }),
  );
}

/** Beide Termin-Arten — die Regel gilt für Setting und Closing wörtlich gleich. */
const BEIDE: CascadeKind[] = ["setting_msg", "closing_msg"];

/** Gebucht am 1.7.2026 um 14:00 Berliner Wandzeit (Sommerzeit, UTC+2). */
const JETZT = "2026-07-01T12:00:00.000Z";

/**
 * Ein Berliner Wandzeit-Punkt im Juli 2026 als echtes UTC — nur für die
 * Lesbarkeit der Fälle. Der Offset ist dort fest +2 h; die Stunden 0 und 1
 * fallen deshalb noch in den UTC-Vortag.
 */
function berlinSommer(tag: number, stunde: number, minute = 0): string {
  const utcStunde = stunde - 2;
  const utcTag = utcStunde < 0 ? tag - 1 : tag;
  const hh = String((utcStunde + 24) % 24).padStart(2, "0");
  return `2026-07-${String(utcTag).padStart(2, "0")}T${hh}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function geplanteStufen(kind: CascadeKind, appointment: string, now = JETZT): number[] {
  return planScheduledCascade(standardSteps(kind), kind, appointment, now).touches.map((t) => t.step_no);
}

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const PANEL = read("src/components/termine/CascadePanel.tsx");
const REMINDERS = read("src/app/actions/reminders.ts");

/* ------------------------------------------------------------------ *
 * Die Staffelung — jede Zeile der Tabelle, für Setting UND Closing
 * ------------------------------------------------------------------ */

describe("Der Buchungstag entscheidet, welche Stufen entstehen", () => {
  test("Termin MORGEN: nur die Erinnerung kurz vor dem Termin", () => {
    for (const kind of BEIDE) {
      // Termin morgen 18:00, gebucht heute 14:00. „1 Tag vorher" läge auf HEUTE
      // 18:00 — vier Stunden nach der Buchung. Genau das ist die Beschwerde.
      const plan = planScheduledCascade(standardSteps(kind), kind, berlinSommer(2, 18), JETZT);
      assert.deepEqual(
        plan.touches.map((t) => t.step_no),
        [3],
        kind,
      );
      // Und sie ist nicht etwa aus Zeitgründen entfallen: ihre Fälligkeit hätte
      // noch bevorgestanden. Der Grund muss das sagen.
      const stufe2 = plan.skipped.find((s) => s.step_no === 2);
      assert.ok(stufe2, `${kind}: Stufe 2 fehlt in der Begründung`);
      assert.equal(stufe2.reason, BOOKING_DAY_SKIP_REASON, kind);
      assert.doesNotMatch(stufe2.reason, /weniger als/, `${kind}: falsche Begründung — sie hätte zeitlich gepasst`);
    }
  });

  test("Termin in 2 TAGEN: der Vortag kommt dazu", () => {
    // Die 1-Tages-Stufe fällt auf MORGEN und geht raus; die 3-Tages-Stufe liegt
    // zwei Tage in der Vergangenheit.
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(3, 18)), [2, 3], kind);
    }
  });

  test("Termin in 3 TAGEN: die 3-Tages-Stufe fiele auf den Buchungstag und entfällt", () => {
    // GEÄNDERTE ERWARTUNG (vorher [1, 2, 3]): Nach der Vorlauf-Zählung trug ein
    // Vorlauf von drei Tagen alle drei Stufen. Die 3-Tages-Stufe fällt dabei
    // aber auf HEUTE 18:00 — vier Stunden nach der Buchung, also strukturell
    // exakt der Fall, gegen den die Regel überhaupt gebaut wurde. Sie entfällt
    // jetzt; die beiden termin-näheren Stufen bleiben.
    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, berlinSommer(4, 18), JETZT);
      assert.deepEqual(
        plan.touches.map((t) => t.step_no),
        [2, 3],
        kind,
      );
      const stufe1 = plan.skipped.find((s) => s.step_no === 1);
      assert.ok(stufe1, `${kind}: Stufe 1 fehlt in der Begründung`);
      assert.equal(stufe1.reason, BOOKING_DAY_SKIP_REASON, kind);
    }
  });

  test("Termin in 4 TAGEN: die volle Kaskade — Gegenrichtung", () => {
    // Ohne diesen Fall wäre die Kaskade beim Schärfen der Regel um eine Stufe
    // kürzer geworden. Die 3-Tages-Stufe fällt hier auf MORGEN 18:00 und geht
    // bewusst raus: Der Termin hat den vollen Vorlauf, für den die Abfolge
    // gedacht ist.
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(5, 18)), [1, 2, 3], kind);
    }
  });

  test("Termin in zwei Wochen: unverändert alle Stufen, keine Begründung nötig", () => {
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(15, 18)), [1, 2, 3], kind);
      assert.equal(planScheduledCascade(standardSteps(kind), kind, berlinSommer(15, 18), JETZT).skipped.length, 0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Die Tagesgrenze — der Grund für die Kalenderrechnung
 * ------------------------------------------------------------------ */

describe("Die Grenze läuft am Berliner Kalendertag, nicht an Stunden", () => {
  test("gerade noch morgen gegen gerade schon übermorgen — eine Stunde Unterschied, eine Stufe mehr", () => {
    for (const kind of BEIDE) {
      // Termin morgen 23:30: „1 Tag vorher" fiele auf HEUTE 23:30 — Buchungstag.
      assert.deepEqual(geplanteStufen(kind, berlinSommer(2, 23, 30)), [3], `${kind} · morgen 23:30`);
      // Termin übermorgen 00:30: dieselbe Stufe fällt auf MORGEN 00:30 und geht
      // raus. Real liegt zwischen den beiden Terminen genau eine Stunde — der
      // Mensch, der bucht, denkt aber in Tagen.
      assert.deepEqual(geplanteStufen(kind, berlinSommer(3, 0, 30)), [2, 3], `${kind} · übermorgen 00:30`);
    }
  });

  test("ein Termin morgen früh und einer morgen abend bekommen dieselbe Kaskade", () => {
    // Stundengerechnet wären das 19 und 32 Stunden Vorlauf — der eine läge unter
    // 24, der andere darüber, und niemand könnte erklären, warum der eine zwei
    // Erinnerungen bekommt und der andere eine.
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(2, 9)), [3], `${kind} · morgen 09:00`);
      assert.deepEqual(geplanteStufen(kind, berlinSommer(2, 22)), [3], `${kind} · morgen 22:00`);
    }
  });

  test("die Zeitumstellung verschiebt die Tagesgrenze nicht", () => {
    // Umstellung in der Nacht auf den 25.10.2026 (danach UTC+1). Gebucht am
    // 24.10. um 12:00 Berlin, Termin am 26.10. um 10:00 Berlin.
    const now = "2026-10-24T10:00:00.000Z"; // 24.10. 12:00 Berlin (CEST)
    const appointment = "2026-10-26T09:00:00.000Z"; // 26.10. 10:00 Berlin (CET)

    // Millisekunden gerechnet lägen dazwischen 47 Stunden — also „ein Tag", und
    // die Vortags-Stufe fiele fälschlich auf den Buchungstag. Das ist der
    // Fehler, den die Kalenderrechnung vermeidet.
    assert.equal((Date.parse(appointment) - Date.parse(now)) / 3_600_000, 47);
    assert.equal(berlinLeadDays(appointment, now), 2);

    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, appointment, now);
      assert.deepEqual(
        plan.touches.map((t) => t.step_no),
        [2, 3],
        kind,
      );
      // Und die Fälligkeit der Vortags-Stufe liegt auf derselben WANDZEIT,
      // obwohl die Uhr dazwischen zurückgestellt wird.
      const vortag = plan.touches.find((t) => t.step_no === 2);
      assert.equal(isoToBerlinInput(vortag!.due_at), "2026-10-25T10:00", kind);
    }
  });

  test("der Umstellungstag ist 25 Stunden lang — und trotzdem EIN Buchungstag", () => {
    // Gebucht am 25.10.2026 um 00:30 Berlin, also VOR der Umstellung; die
    // Vortags-Stufe eines Termins am 26.10. 23:30 fällt auf den 25.10. 23:30,
    // also NACH der Umstellung. Zwischen beiden liegen exakt 24 Stunden — eine
    // Stundenrechnung hielte das für „einen Tag später" und ließe die Nachricht
    // am Buchungstag rausgehen. Der Kalender sagt: derselbe Tag.
    const now = "2026-10-24T22:30:00.000Z"; // 25.10. 00:30 Berlin (noch CEST)
    const appointment = "2026-10-26T22:30:00.000Z"; // 26.10. 23:30 Berlin (CET)

    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, appointment, now);
      assert.deepEqual(
        plan.touches.map((t) => t.step_no),
        [3],
        kind,
      );
      const stufe2 = plan.skipped.find((s) => s.step_no === 2);
      assert.ok(stufe2, `${kind}: Stufe 2 fehlt in der Begründung`);
      assert.equal(stufe2.reason, BOOKING_DAY_SKIP_REASON, kind);
    }

    // Die Gegenprobe zur Behauptung oben: exakt 24 Stunden, exakt ein Kalendertag.
    const due = "2026-10-25T22:30:00.000Z"; // 25.10. 23:30 Berlin (CET)
    assert.equal((Date.parse(due) - Date.parse(now)) / 3_600_000, 24);
    assert.equal(berlinLeadDays(due, now), 0);
  });
});

/* ------------------------------------------------------------------ *
 * Termin HEUTE — die Ausnahme, ohne die die Regel zu viel wegnimmt
 * ------------------------------------------------------------------ */

describe("Termin heute", () => {
  test("die termin-nächste Stufe wird geplant, obwohl sie am Buchungstag liegt", () => {
    // Termin heute 18:00, gebucht 14:00: Die Erinnerung eine Stunde vorher
    // (17:00) liegt zwangsläufig am Buchungstag — und ist trotzdem richtig. Ohne
    // die Ausnahme bekäme ein Termin, der heute stattfindet, gar nichts mehr.
    // Ein Sofort-Touch entsteht dafür ausdrücklich NICHT: Es gibt ja eine
    // passende Stufe.
    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, berlinSommer(1, 18), JETZT);
      assert.deepEqual(
        plan.touches.map((t) => t.step_no),
        [3],
        kind,
      );
      assert.equal(plan.touches[0].touch_kind, "cascade", kind);
    }
  });

  test("erst wenn auch die letzte Stufe vorbei ist, greift der Sofort-Touch", () => {
    // Termin heute 14:20, gebucht 14:00: Auch „1 Stunde vorher" liegt hinter uns.
    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, berlinSommer(1, 14, 20), JETZT);
      assert.equal(plan.touches.length, 1, kind);
      assert.equal(plan.touches[0].touch_kind, "sofort", kind);
      assert.equal(plan.touches[0].step_no, 0, kind);
    }
  });

  test("ein Termin, der schon gelaufen ist, bekommt gar nichts", () => {
    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, berlinSommer(1, 9), JETZT);
      assert.equal(plan.touches.length, 0, kind);
      // Alle drei Stufen sind mit dem ZEITLICHEN Grund entfallen — auch die
      // termin-nächste, für die die Buchungstag-Ausnahme gälte. Die Ausnahme
      // schafft keine Erinnerung, deren Zeitpunkt vorbei ist.
      assert.equal(plan.skipped.length, 3, kind);
      for (const s of plan.skipped) assert.match(s.reason, /weniger als/, kind);
    }
  });

  test("eine verstrichene Stufe behält den zeitlichen Grund, auch am Buchungstag", () => {
    // Termin morgen 09:00: „1 Tag vorher" läge auf HEUTE 09:00 — Buchungstag UND
    // vorbei. Beide Riegel treffen zu, und die Reihenfolge entscheidet: Der
    // zeitliche Grund ist der genauere, denn hier ändert auch ein späterer
    // Buchungszeitpunkt nichts mehr.
    for (const kind of BEIDE) {
      const plan = planScheduledCascade(standardSteps(kind), kind, berlinSommer(2, 9), JETZT);
      const stufe2 = plan.skipped.find((s) => s.step_no === 2);
      assert.ok(stufe2, `${kind}: Stufe 2 fehlt in der Begründung`);
      assert.match(stufe2.reason, /weniger als 1 Tag/, kind);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Verschieben — der Buchungstag wandert mit
 * ------------------------------------------------------------------ */

describe("Beim Verschieben gilt der Tag der Verschiebung", () => {
  test("derselbe Termin, einen Tag später neu geplant: eine Stufe weniger", () => {
    // Termin am 5.7. 18:00. Am 1.7. gebucht, trägt er alle drei Stufen. Wird er
    // am 2.7. angefasst (Verschieben plant die Kaskade komplett neu), fällt die
    // 3-Tages-Stufe auf den 2.7. 18:00 — den neuen Buchungstag — und entfällt.
    // Das ist gewollt: Wer gerade eben mit dem Lead gesprochen hat, braucht am
    // selben Tag keine Erinnerung an das eben Verabredete.
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(5, 18), berlinSommer(1, 14)), [1, 2, 3], kind);
      assert.deepEqual(geplanteStufen(kind, berlinSommer(5, 18), berlinSommer(2, 14)), [2, 3], kind);
    }
  });

  test("die Planung misst gegen JETZT, nicht gegen einen eingefrorenen Zeitpunkt", () => {
    // Der vierte Parameter bleibt weg — `nowIso` ist damit der Moment der
    // Planung. Weil `generateScheduled` nach JEDER Terminänderung neu plant,
    // wandert der Buchungstag von selbst mit. Ein mitgegebener Zeitstempel
    // (etwa `created_at` des Termins) hielte ihn dagegen auf dem Tag der
    // Ersterfassung fest.
    assert.match(REMINDERS, /planScheduledCascade\(steps, kind, row\.appointment_at\)/);
  });
});

/* ------------------------------------------------------------------ *
 * Die Regel hängt an der Konfiguration, nicht an 4320/1440/60
 * ------------------------------------------------------------------ */

describe("Andere Konfigurationen, dieselbe Regel", () => {
  test("vier Stufen mit ganz anderen Abständen", () => {
    const vier = [
      step({ step_no: 1, offset_minutes: 7 * DAY }),
      step({ step_no: 2, offset_minutes: 3 * DAY }),
      step({ step_no: 3, offset_minutes: 1 * DAY }),
      step({ step_no: 4, offset_minutes: 2 * HOUR }),
    ];
    const stufen = (appointment: string) =>
      planScheduledCascade(vier, "setting_msg", appointment, JETZT).touches.map((t) => t.step_no);

    // Termin in 3 Tagen: die 7-Tages-Stufe ist vorbei, die 3-Tages-Stufe fiele
    // auf heute — es bleiben die beiden termin-nahen.
    assert.deepEqual(stufen(berlinSommer(4, 18)), [3, 4]);
    // Termin in 4 Tagen: die 3-Tages-Stufe fällt auf morgen und geht raus.
    assert.deepEqual(stufen(berlinSommer(5, 18)), [2, 3, 4]);
    // Termin in 8 Tagen: alles.
    assert.deepEqual(stufen(berlinSommer(9, 18)), [1, 2, 3, 4]);
  });

  test("zwei Stufen (2 Tage / 30 Minuten) — ohne jede 1440er-Stufe", () => {
    const zwei = [
      step({ step_no: 1, offset_minutes: 2 * DAY }),
      step({ step_no: 2, offset_minutes: 30 }),
    ];
    const stufen = (appointment: string) =>
      planScheduledCascade(zwei, "setting_msg", appointment, JETZT).touches.map((t) => t.step_no);

    // Termin in 2 Tagen: die 2-Tages-Stufe fiele auf heute.
    assert.deepEqual(stufen(berlinSommer(3, 18)), [2]);
    // Termin in 3 Tagen: sie fällt auf morgen und geht raus.
    assert.deepEqual(stufen(berlinSommer(4, 18)), [1, 2]);
  });

  test("maßgeblich ist die Nähe zum Termin, nicht die Stufennummer", () => {
    // Die Reihenfolge der Stufennummern prüft nur die Oberfläche. Wäre sie
    // verdreht, träfe eine positionsbasierte Ausnahme ausgerechnet die falsche
    // Stufe — und der Termin von heute Nachmittag bekäme statt der Erinnerung
    // eine Stunde vorher gar keine.
    const verdreht = [
      step({ step_no: 1, offset_minutes: 1 * HOUR }),
      step({ step_no: 2, offset_minutes: 3 * DAY }),
    ];
    const plan = planScheduledCascade(verdreht, "setting_msg", berlinSommer(1, 18), JETZT);
    assert.deepEqual(
      plan.touches.map((t) => t.step_no),
      [1],
    );
    assert.equal(plan.touches[0].touch_kind, "cascade");
  });

  test("ohne lesbares „jetzt“ entscheidet allein die Fälligkeit", () => {
    // Kein Kalendertag, keine Behauptung: Die Buchungstag-Regel schweigt, und
    // die Stufen fallen nur noch über ihre Fälligkeit heraus.
    const plan = planScheduledCascade(standardSteps("setting_msg"), "setting_msg", berlinSommer(2, 18), "");
    assert.deepEqual(
      plan.touches.map((t) => t.step_no),
      [1, 2, 3],
    );
  });
});

describe("nearestStep", () => {
  test("die Stufe mit dem kleinsten Abstand, nicht die höchste Nummer", () => {
    assert.equal(nearestStep(standardSteps("setting_msg"))?.step_no, 3);
    assert.equal(
      nearestStep([step({ step_no: 1, offset_minutes: 1 * HOUR }), step({ step_no: 2, offset_minutes: 3 * DAY })])
        ?.step_no,
      1,
    );
  });

  test("keine Stufen, keine nächste", () => {
    assert.equal(nearestStep([]), null);
  });
});

describe("fallsOnBookingDay", () => {
  const due = berlinSommer(1, 18); // heute 18:00 — derselbe Kalendertag wie JETZT

  test("derselbe Kalendertag trifft zu, der nächste nicht mehr", () => {
    assert.equal(fallsOnBookingDay(1, due, JETZT, 3), true);
    assert.equal(fallsOnBookingDay(1, berlinSommer(2, 18), JETZT, 3), false);
  });

  test("die termin-nächste Stufe ist ausgenommen", () => {
    assert.equal(fallsOnBookingDay(3, due, JETZT, 3), false);
  });

  test("ohne bekannte termin-nächste Stufe greift keine Ausnahme", () => {
    assert.equal(fallsOnBookingDay(3, due, JETZT, null), true);
  });

  test("unlesbare Werte behaupten nichts", () => {
    assert.equal(fallsOnBookingDay(1, "demnächst", JETZT, 3), false);
    assert.equal(fallsOnBookingDay(1, due, "", 3), false);
  });
});

describe("berlinLeadDays", () => {
  test("0 = derselbe Tag, 1 = morgen, negativ = vorbei", () => {
    assert.equal(berlinLeadDays(berlinSommer(1, 23), JETZT), 0);
    assert.equal(berlinLeadDays(berlinSommer(2, 1), JETZT), 1);
    assert.equal(berlinLeadDays(berlinSommer(4, 9), JETZT), 3);
    assert.equal(berlinLeadDays(berlinSommer(1, 9), JETZT), 0);
    assert.equal(berlinLeadDays("2026-06-29T09:00:00.000Z", JETZT), -2);
  });

  test("gezählt wird der BERLINER Kalendertag", () => {
    // 1.7. 22:30 UTC ist in Berlin schon der 2. — also morgen, nicht heute.
    assert.equal(berlinLeadDays("2026-07-01T22:30:00.000Z", JETZT), 1);
    assert.equal(berlinLeadDays("2026-07-01T21:30:00.000Z", JETZT), 0);
  });

  test("unlesbare Werte liefern null statt einer geratenen Zahl", () => {
    assert.equal(berlinLeadDays("demnächst", JETZT), null);
    assert.equal(berlinLeadDays(berlinSommer(2, 9), ""), null);
  });
});

describe("BOOKING_DAY_SKIP_REASON", () => {
  test("nennt den Buchungstag und sagt, warum das ein Grund ist", () => {
    assert.match(BOOKING_DAY_SKIP_REASON, /^Entfällt — /);
    assert.match(BOOKING_DAY_SKIP_REASON, /Buchungstag/);
    assert.match(BOOKING_DAY_SKIP_REASON, /vereinbart/);
    // Kein Vorlauf-Wortlaut mehr: „der Termin ist morgen" beschriebe eine Regel,
    // die es nicht mehr gibt — und wäre bei einem Termin in drei Tagen falsch.
    assert.doesNotMatch(BOOKING_DAY_SKIP_REASON, /Vorlauf/);
  });
});

/* ------------------------------------------------------------------ *
 * Das Kaskaden-Panel begründet denselben Fall gleich
 * ------------------------------------------------------------------ */

describe("CascadePanel erklärt die weggelassene Stufe richtig", () => {
  test("es benutzt dieselbe Regel wie die Engine, statt sie nachzubauen", () => {
    // Eine zweite Rechnung im Panel liefe beim ersten geänderten Offset
    // auseinander — und das Panel ist genau die Stelle, an der jemand nachsieht,
    // warum eine Stufe fehlt.
    assert.match(PANEL, /const nearestNo = nearestStep\(planned\)\?\.step_no \?\? null;/);
    assert.match(
      PANEL,
      /fallsOnBookingDay\(step\.step_no, due, new Date\(nowMs\)\.toISOString\(\), nearestStepNo\)/,
    );
    assert.match(PANEL, /reason: BOOKING_DAY_SKIP_REASON/);
  });

  test("der Rat „Termin verschieben“ steht erst NACH der Buchungstag-Prüfung", () => {
    // Sonst behauptete das Panel bei einem Termin morgen, die Stufe „1 Tag
    // vorher" fehle „obwohl ihre Fälligkeit noch bevorsteht", und riete zu
    // etwas, das daran nichts ändert.
    const buchungstag = PANEL.indexOf("reason: BOOKING_DAY_SKIP_REASON");
    const rat = PANEL.indexOf("Termin verschieben erzeugt die Erinnerungen neu");
    assert.ok(buchungstag !== -1 && rat !== -1);
    assert.ok(buchungstag < rat, "der Verschieben-Rat steht vor der Buchungstag-Prüfung");
  });

  test("der zeitliche Grund steht weiterhin VOR dem Buchungstag-Grund", () => {
    // Dieselbe Reihenfolge wie in `planScheduledCascade`: Eine Stufe, deren
    // Fälligkeit ohnehin verstrichen ist, bekommt den genaueren Grund.
    const zeitlich = PANEL.indexOf("beim Planen lagen weniger als");
    const buchungstag = PANEL.indexOf("reason: BOOKING_DAY_SKIP_REASON");
    assert.ok(zeitlich !== -1 && buchungstag !== -1);
    assert.ok(zeitlich < buchungstag, "der Buchungstag-Grund steht vor dem zeitlichen");
  });
});
