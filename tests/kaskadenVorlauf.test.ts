// Wie viele Stufen ein kurzfristig gebuchter Termin trägt.
//
// Der Befund des Auftraggebers: Ein heute gebuchter Termin für MORGEN 18:00
// bekam die Stufe „1 Tag vorher" auf HEUTE 18:00 gelegt — vier Stunden nach der
// Buchung ging eine Nachricht raus, die einen Termin bestätigt, den der Lead
// gerade selbst vereinbart hat. Die Stufe war nach der alten Regel völlig
// korrekt: Ihre Fälligkeit lag ja noch in der Zukunft. Nur ist „liegt noch in
// der Zukunft" nicht dasselbe wie „der Vorlauf trägt sie".
//
// Die Regel, in seinen Worten:
//   Termin morgen        → nur die Erinnerung 1 Stunde vorher
//   Termin in 2 Tagen    → 1 Tag vorher + 1 Stunde vorher
//   Termin in 3+ Tagen   → die volle Kaskade
// Für Setting und Closing gleichermaßen.
//
// Zwei Eigenschaften der Umsetzung stehen hier mit unter Prüfung, weil sie sich
// einer falschen Zahl nicht ansehen lassen:
//
//  1. Gerechnet wird in BERLINER KALENDERTAGEN, nicht in Stunden. „Morgen" ist
//     für einen Menschen ein Kalenderbegriff — sonst bekäme ein Termin morgen
//     früh eine andere Kaskade als einer morgen abend.
//  2. Die Regel hängt an der ANZAHL der Stufen und ihrer Nähe zum Termin, nicht
//     an den Minutenwerten 4320/1440/60. Die Offsets stehen in `cascade_steps`
//     und sind je Organisation änderbar.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { isoToBerlinInput } from "@/lib/apptTime";
import { berlinLeadDays, carriedStepNos, leadSkipReason, planScheduledCascade } from "@/lib/cascadeEngine";
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

/** Heute, 1.7.2026, 14:00 Berliner Wandzeit (Sommerzeit, UTC+2). */
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

/* ------------------------------------------------------------------ *
 * Die drei Fälle aus der Ansage — für Setting UND Closing
 * ------------------------------------------------------------------ */

describe("Vorlauf entscheidet, wie viele Stufen entstehen", () => {
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
      assert.match(stufe2.reason, /morgen/, kind);
      assert.doesNotMatch(stufe2.reason, /weniger als/, `${kind}: falsche Begründung — sie hätte zeitlich gepasst`);
    }
  });

  test("Termin in 2 TAGEN: der Vortag kommt dazu", () => {
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(3, 18)), [2, 3], kind);
    }
  });

  test("Termin in 3 TAGEN: die volle Kaskade — Gegenrichtung", () => {
    // Ohne diesen Fall wäre die Kaskade beim Aufräumen halbiert worden. Die
    // 3-Tages-Stufe fällt hier auf HEUTE 18:00 und geht bewusst raus: Der Termin
    // hat den vollen Vorlauf, für den die Abfolge gedacht ist.
    for (const kind of BEIDE) {
      assert.deepEqual(geplanteStufen(kind, berlinSommer(4, 18)), [1, 2, 3], kind);
    }
  });

  test("Termin in zwei Wochen: unverändert alle Stufen", () => {
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
      // 2.7. 23:30 Berlin ist morgen: eine Stufe.
      assert.deepEqual(geplanteStufen(kind, berlinSommer(2, 23, 30)), [3], `${kind} · morgen 23:30`);
      // 3.7. 00:30 Berlin ist übermorgen: zwei Stufen. Real liegt zwischen den
      // beiden Terminen genau eine Stunde — der Mensch, der bucht, denkt aber in
      // Tagen, und die Stufe „1 Tag vorher" landet beim zweiten auf morgen statt
      // auf heute.
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

  test("die Zeitumstellung verschiebt die Grenze nicht", () => {
    // Umstellung in der Nacht auf den 25.10.2026 (danach UTC+1). Gebucht am
    // 24.10. um 12:00 Berlin, Termin am 26.10. um 10:00 Berlin: zwei
    // Kalendertage Vorlauf, also zwei Stufen.
    const now = "2026-10-24T10:00:00.000Z"; // 24.10. 12:00 Berlin (CEST)
    const appointment = "2026-10-26T09:00:00.000Z"; // 26.10. 10:00 Berlin (CET)

    // Millisekunden gerechnet lägen dazwischen 47 Stunden — also „ein Tag", und
    // die Stufe vom Vortag fiele weg. Das ist der Fehler, den die Kalenderrechnung
    // vermeidet.
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
});

/* ------------------------------------------------------------------ *
 * Termin HEUTE — und der Übergang zum Sofort-Touch
 * ------------------------------------------------------------------ */

describe("Termin heute", () => {
  test("die letzte Stufe wird geplant, solange ihr Zeitpunkt noch bevorsteht", () => {
    // Termin heute 18:00, gebucht 14:00: Die Erinnerung eine Stunde vorher
    // (17:00) steht noch bevor und wird eingeplant. Ein Sofort-Touch entsteht
    // dafür ausdrücklich NICHT — es gibt ja eine passende Stufe.
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
      // Alle drei Stufen sind mit dem ZEITLICHEN Grund entfallen — der Vorlauf
      // ist bei einem vergangenen Termin keine Aussage mehr.
      assert.equal(plan.skipped.length, 3, kind);
      for (const s of plan.skipped) assert.match(s.reason, /weniger als/, kind);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Die Regel hängt an der Konfiguration, nicht an 4320/1440/60
 * ------------------------------------------------------------------ */

describe("carriedStepNos — abgeleitet, nicht hartkodiert", () => {
  test("je Tag Vorlauf eine Stufe mehr, gezählt vom Termin rückwärts", () => {
    const vier = [
      step({ step_no: 1, offset_minutes: 7 * DAY }),
      step({ step_no: 2, offset_minutes: 3 * DAY }),
      step({ step_no: 3, offset_minutes: 1 * DAY }),
      step({ step_no: 4, offset_minutes: 2 * HOUR }),
    ];
    assert.deepEqual([...carriedStepNos(vier, 0)].sort(), [4]);
    assert.deepEqual([...carriedStepNos(vier, 1)].sort(), [4]);
    assert.deepEqual([...carriedStepNos(vier, 2)].sort(), [3, 4]);
    assert.deepEqual([...carriedStepNos(vier, 3)].sort(), [2, 3, 4]);
    assert.deepEqual([...carriedStepNos(vier, 4)].sort(), [1, 2, 3, 4]);
    // Mehr Vorlauf als Stufen ändert nichts mehr.
    assert.deepEqual([...carriedStepNos(vier, 40)].sort(), [1, 2, 3, 4]);
  });

  test("ganz andere Abstände, dieselbe Staffelung", () => {
    // Ein Kunde mit zwei Stufen (2 Tage / 30 Minuten): Bei einem Termin morgen
    // bleibt die halbstündige, bei zweien kommt die vom Vortag dazu — obwohl in
    // dieser Konfiguration gar keine 1440-Minuten-Stufe vorkommt.
    const zwei = [
      step({ step_no: 1, offset_minutes: 2 * DAY }),
      step({ step_no: 2, offset_minutes: 30 }),
    ];
    assert.deepEqual([...carriedStepNos(zwei, 1)], [2]);
    assert.deepEqual([...carriedStepNos(zwei, 2)].sort(), [1, 2]);
  });

  test("maßgeblich ist die Nähe zum Termin, nicht die Stufennummer", () => {
    // Die Reihenfolge der Stufennummern prüft nur die Oberfläche. Wäre sie
    // verdreht, fiele bei einer positionsbasierten Auswahl ausgerechnet die
    // termin-nächste Stufe heraus — und der kurzfristige Termin bekäme eine
    // Erinnerung, deren Zeitpunkt längst vorbei ist.
    const verdreht = [
      step({ step_no: 1, offset_minutes: 1 * HOUR }),
      step({ step_no: 2, offset_minutes: 3 * DAY }),
    ];
    assert.deepEqual([...carriedStepNos(verdreht, 1)], [1]);
  });

  test("ohne lesbaren Vorlauf und bei vergangenem Termin bleibt alles stehen", () => {
    // Dann entscheidet allein die Fälligkeit — mit der Begründung, die dazu passt.
    const alle = standardSteps("setting_msg");
    assert.equal(carriedStepNos(alle, null).size, 3);
    assert.equal(carriedStepNos(alle, -2).size, 3);
  });

  test("mindestens eine Stufe bleibt immer", () => {
    // Sonst bekäme ein Termin heute Nachmittag gar keine Erinnerung mehr —
    // auch keine, die eine Stunde vorher noch problemlos rausgehen könnte.
    assert.equal(carriedStepNos(standardSteps("setting_msg"), 0).size, 1);
  });

  test("keine Stufen, keine Menge", () => {
    assert.equal(carriedStepNos([], 5).size, 0);
  });
});

describe("berlinLeadDays", () => {
  test("0 = heute, 1 = morgen, negativ = vorbei", () => {
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

describe("leadSkipReason", () => {
  test("nennt den Vorlauf im Klartext und was stattdessen rausgeht", () => {
    assert.match(leadSkipReason(1, 1), /morgen/);
    assert.match(leadSkipReason(1, 1), /kurz vor dem Termin/);
    assert.match(leadSkipReason(2, 2), /in 2 Tagen/);
    assert.match(leadSkipReason(2, 2), /letzten 2 Stufen/);
    assert.match(leadSkipReason(0, 1), /heute/);
  });
});

/* ------------------------------------------------------------------ *
 * Das Kaskaden-Panel begründet denselben Fall gleich
 * ------------------------------------------------------------------ */

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const PANEL = read("src/components/termine/CascadePanel.tsx");

describe("CascadePanel erklärt die weggelassene Stufe richtig", () => {
  test("es rechnet den Vorlauf mit derselben Funktion wie die Engine", () => {
    // Eine zweite Rechnung im Panel liefe beim ersten geänderten Offset
    // auseinander — und das Panel ist genau die Stelle, an der jemand nachsieht,
    // warum eine Stufe fehlt.
    assert.match(PANEL, /berlinLeadDays\(view\.appointmentAt, new Date\(nowMs\)\.toISOString\(\)\)/);
    assert.match(PANEL, /carried: carriedStepNos\(planned, leadDays\)/);
    assert.match(PANEL, /leadSkipReason\(lead\.days, lead\.carried\.size\)/);
  });

  test("der Rat „Termin verschieben“ steht erst NACH der Vorlauf-Prüfung", () => {
    // Sonst behauptete das Panel bei einem Termin morgen, die Stufe „1 Tag
    // vorher" fehle „obwohl ihre Fälligkeit noch bevorsteht", und riete zu
    // etwas, das daran nichts ändert.
    const vorlauf = PANEL.indexOf("leadSkipReason(lead.days");
    const rat = PANEL.indexOf("Termin verschieben erzeugt die Erinnerungen neu");
    assert.ok(vorlauf !== -1 && rat !== -1);
    assert.ok(vorlauf < rat, "der Verschieben-Rat steht vor der Vorlauf-Prüfung");
  });
});
