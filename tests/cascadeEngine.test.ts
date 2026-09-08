// Kaskaden-Engine: Wandzeit-Arithmetik und Stufenplanung.
//
// Die Zeitumstellungs-Fälle stehen bewusst zuerst: Genau dieser Fehler steckte
// in der Vorgänger-Implementierung (Millisekunden statt Wandzeit), und er ist
// unsichtbar — der Touch liegt einfach eine Stunde falsch, zweimal im Jahr.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isoToBerlinInput } from "@/lib/apptTime";
import { planEventChain, planScheduledCascade, shiftBerlinMinutes } from "@/lib/cascadeEngine";
import type { CascadeKind, CascadeStep } from "@/lib/cascadeEngine";
import type { TemplateKey } from "@/lib/messageTemplates";

const DAY = 1440;
const HOUR = 60;

/** Eine Zeile aus cascade_steps, mit den Feldern, die der Test setzt. */
function step(partial: Partial<CascadeStep> & { step_no: number; offset_minutes: number }): CascadeStep {
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

/** Die Standard-Vor-Termin-Kaskade: 3 Tage / 1 Tag / 1 Stunde vorher. */
const SETTING_STEPS: CascadeStep[] = [
  step({ step_no: 1, offset_minutes: 3 * DAY, template_key: "setting_msg_1" }),
  step({ step_no: 2, offset_minutes: 1 * DAY, template_key: "setting_msg_2" }),
  step({ step_no: 3, offset_minutes: 1 * HOUR, template_key: "setting_msg_3" }),
];

/* ------------------------------------------------------------------ *
 * shiftBerlinMinutes — Wandzeit, nicht Millisekunden
 * ------------------------------------------------------------------ */

describe("shiftBerlinMinutes", () => {
  test("Herbst-Umstellung: 3 Tage vor dem 27.10.2026 10:00 ist der 24.10. um 10:00", () => {
    // Die Umstellung liegt am 25.10.2026 (danach UTC+1, davor UTC+2). Auf dem
    // UTC-Zeitstempel gerechnet käme hier 11:00 heraus.
    const appointment = "2026-10-27T09:00:00.000Z"; // 27.10.2026 10:00 Berlin (CET)
    const due = shiftBerlinMinutes(appointment, -3 * DAY);
    assert.equal(due, "2026-10-24T08:00:00.000Z"); // 24.10.2026 10:00 Berlin (CEST)
    assert.equal(isoToBerlinInput(due), "2026-10-24T10:00");
  });

  test("Herbst-Umstellung: 1 Tag über die Grenze sind 25 echte Stunden", () => {
    // Der Umstellungstag selbst: 25.10. 10:00 liegt schon in CET (die Uhr geht
    // um 03:00 zurück), 24.10. 10:00 noch in CEST.
    const appointment = "2026-10-25T09:00:00.000Z"; // So 25.10. 10:00 Berlin
    const due = shiftBerlinMinutes(appointment, -1 * DAY);
    assert.equal(isoToBerlinInput(due), "2026-10-24T10:00");
    // Der Abstand in echten Stunden ist 25, nicht 24 — genau das ist gewollt.
    assert.equal((Date.parse(appointment) - Date.parse(due as string)) / 3_600_000, 25);
  });

  test("Frühjahrs-Umstellung: 3 Tage vor dem 30.03.2026 09:00 ist der 27.03. um 09:00", () => {
    // Umstellung am 29.03.2026 (davor UTC+1, danach UTC+2).
    const due = shiftBerlinMinutes("2026-03-30T07:00:00.000Z", -3 * DAY);
    assert.equal(due, "2026-03-27T08:00:00.000Z");
    assert.equal(isoToBerlinInput(due), "2026-03-27T09:00");
  });

  test("Frühjahrs-Umstellung: 1 Tag über die Grenze sind nur 23 echte Stunden", () => {
    // 29.03. 09:00 liegt schon in CEST (die Uhr springt um 02:00 vor),
    // 28.03. 09:00 noch in CET.
    const appointment = "2026-03-29T07:00:00.000Z"; // So 29.03. 09:00 Berlin
    const due = shiftBerlinMinutes(appointment, -1 * DAY);
    assert.equal(isoToBerlinInput(due), "2026-03-28T09:00");
    assert.equal((Date.parse(appointment) - Date.parse(due as string)) / 3_600_000, 23);
  });

  test("innerhalb einer Zone ist es schlichte Arithmetik", () => {
    assert.equal(shiftBerlinMinutes("2026-07-20T08:00:00.000Z", -HOUR), "2026-07-20T07:00:00.000Z");
    assert.equal(shiftBerlinMinutes("2026-07-20T08:00:00.000Z", 90), "2026-07-20T09:30:00.000Z");
    assert.equal(shiftBerlinMinutes("2026-07-20T08:00:00.000Z", 0), "2026-07-20T08:00:00.000Z");
  });

  test("über Monats- und Jahresgrenzen hinweg", () => {
    assert.equal(isoToBerlinInput(shiftBerlinMinutes("2027-01-02T09:00:00.000Z", -3 * DAY)), "2026-12-30T10:00");
  });

  test("ein unlesbarer Zeitstempel liefert null statt 'Invalid Date'", () => {
    assert.equal(shiftBerlinMinutes("keine Zeit", -DAY), null);
    assert.equal(shiftBerlinMinutes("", -DAY), null);
  });
});

/* ------------------------------------------------------------------ *
 * planScheduledCascade — Vor-Termin-Kaskade
 * ------------------------------------------------------------------ */

describe("planScheduledCascade", () => {
  const NOW = "2026-07-01T08:00:00.000Z";

  test("Termin weit in der Zukunft: alle Stufen, aufsteigend fällig", () => {
    const plan = planScheduledCascade(SETTING_STEPS, "setting_msg", "2026-07-20T08:00:00.000Z", NOW);
    assert.equal(plan.skipped.length, 0);
    assert.deepEqual(
      plan.touches.map((t) => t.step_no),
      [1, 2, 3],
    );
    assert.deepEqual(
      plan.touches.map((t) => t.due_at),
      ["2026-07-17T08:00:00.000Z", "2026-07-19T08:00:00.000Z", "2026-07-20T07:00:00.000Z"],
    );
    for (const t of plan.touches) {
      assert.equal(t.touch_kind, "cascade");
      assert.equal(t.cascade_kind, "setting_msg");
      assert.equal(t.appointment_at, "2026-07-20T08:00:00.000Z");
    }
    assert.deepEqual(
      plan.touches.map((t) => t.template_key),
      ["setting_msg_1", "setting_msg_2", "setting_msg_3"],
    );
  });

  test("kurzfristiger Termin: vergangene Stufen entfallen mit Begründung", () => {
    // Termin in 2 Tagen — die 3-Tages-Stufe passt nicht mehr, die anderen schon.
    const plan = planScheduledCascade(SETTING_STEPS, "setting_msg", "2026-07-03T08:00:00.000Z", NOW);
    assert.deepEqual(
      plan.touches.map((t) => t.step_no),
      [2, 3],
    );
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0].step_no, 1);
    assert.equal(plan.skipped[0].cascade_kind, "setting_msg");
    // Die Begründung nennt den Abstand im Klartext, nicht in Minuten.
    assert.match(plan.skipped[0].reason, /3 Tage/);
    // Nicht gestaucht: keine Stufe rutscht auf eine frühere Fälligkeit.
    for (const t of plan.touches) assert.ok(Date.parse(t.due_at) > Date.parse(NOW));
  });

  test("Termin in 30 Minuten: genau ein Sofort-Touch mit step_no 0", () => {
    const appointment = "2026-07-01T08:30:00.000Z";
    const plan = planScheduledCascade(SETTING_STEPS, "setting_msg", appointment, NOW);
    assert.equal(plan.skipped.length, 3);
    assert.equal(plan.touches.length, 1);

    const [touch] = plan.touches;
    assert.equal(touch.touch_kind, "sofort");
    assert.equal(touch.step_no, 0);
    assert.equal(touch.due_at, NOW);
    assert.equal(touch.appointment_at, appointment);
    assert.equal(touch.requires_no_response, false);
    // Der Text der letzten Stufe: kurz vor dem Termin gehört der Link hin,
    // nicht die Frage „steht der Termin noch?".
    assert.equal(touch.template_key, "setting_msg_3");
  });

  test("Termin in der Vergangenheit: gar nichts, auch kein Sofort-Touch", () => {
    const plan = planScheduledCascade(SETTING_STEPS, "setting_msg", "2026-06-30T08:00:00.000Z", NOW);
    assert.equal(plan.touches.length, 0);
    assert.equal(plan.skipped.length, 3);
  });

  test("abgeschaltete Stufen zählen nicht — auch nicht für den Sofort-Touch", () => {
    const steps = [
      step({ step_no: 1, offset_minutes: 3 * DAY, template_key: "setting_msg_1" }),
      step({ step_no: 2, offset_minutes: 1 * DAY, enabled: false, template_key: "setting_msg_2" }),
      step({ step_no: 3, offset_minutes: 1 * HOUR, template_key: "setting_msg_3" }),
    ];
    const plan = planScheduledCascade(steps, "setting_msg", "2026-07-20T08:00:00.000Z", NOW);
    assert.deepEqual(
      plan.touches.map((t) => t.step_no),
      [1, 3],
    );
  });

  test("ohne aktive Stufe entsteht kein Plan — und kein Sofort-Touch", () => {
    const allOff = SETTING_STEPS.map((s) => ({ ...s, enabled: false }));
    const plan = planScheduledCascade(allOff, "setting_msg", "2026-07-20T08:00:00.000Z", NOW);
    assert.deepEqual(plan, { touches: [], skipped: [] });

    // Dasselbe, wenn für diese Kaskade schlicht nichts konfiguriert ist.
    assert.deepEqual(planScheduledCascade([], "setting_msg", "2026-07-20T08:00:00.000Z", NOW), {
      touches: [],
      skipped: [],
    });
  });

  test("nur die Stufen der angefragten Kaskade zählen", () => {
    const mixed: CascadeStep[] = [
      ...SETTING_STEPS,
      step({ step_no: 1, offset_minutes: 2 * DAY, cascade_kind: "closing_msg", template_key: "closing_msg_1" }),
    ];
    const plan = planScheduledCascade(mixed, "closing_msg", "2026-07-20T08:00:00.000Z", NOW);
    assert.equal(plan.touches.length, 1);
    assert.equal(plan.touches[0].cascade_kind, "closing_msg");
    assert.equal(plan.touches[0].template_key, "closing_msg_1");
  });

  test("Ereignis-Stufen (after_appointment) gehören nicht in die Vor-Termin-Kaskade", () => {
    const chainOnly = [
      step({ step_no: 1, offset_minutes: 0, anchor: "after_appointment", cascade_kind: "no_show_setting" }),
    ];
    assert.deepEqual(planScheduledCascade(chainOnly, "no_show_setting", "2026-07-20T08:00:00.000Z", NOW), {
      touches: [],
      skipped: [],
    });
  });

  test("die Fälligkeiten laufen in Wandzeit — auch über die Umstellung", () => {
    // Termin 27.10.2026 10:00 Berlin, geplant Anfang Oktober: alle drei Stufen
    // liegen auf derselben Uhrzeit, obwohl die Zone dazwischen wechselt.
    const plan = planScheduledCascade(
      SETTING_STEPS,
      "setting_msg",
      "2026-10-27T09:00:00.000Z",
      "2026-10-01T08:00:00.000Z",
    );
    assert.deepEqual(plan.touches.map((t) => isoToBerlinInput(t.due_at)), [
      "2026-10-24T10:00",
      "2026-10-26T10:00",
      "2026-10-27T09:00",
    ]);
  });

  test("ein unlesbarer Termin erzeugt keinen Plan", () => {
    assert.deepEqual(planScheduledCascade(SETTING_STEPS, "setting_msg", "irgendwann", NOW), {
      touches: [],
      skipped: [],
    });
  });
});

/* ------------------------------------------------------------------ *
 * planEventChain — Ketten nach einem Ereignis
 * ------------------------------------------------------------------ */

describe("planEventChain", () => {
  const KIND: CascadeKind = "no_show_setting";
  const EVENT = "2026-07-01T08:00:00.000Z";
  const APPOINTMENT = "2026-07-01T07:30:00.000Z";

  const CHAIN: CascadeStep[] = [
    step({
      step_no: 1,
      offset_minutes: 0,
      anchor: "after_appointment",
      cascade_kind: KIND,
      template_key: "no_show_setting_1",
    }),
    step({
      step_no: 2,
      offset_minutes: 1 * DAY,
      anchor: "after_appointment",
      cascade_kind: KIND,
      requires_no_response: true,
      template_key: "no_show_setting_2",
    }),
  ];

  test("Offset 0 liegt exakt auf dem Ereignis", () => {
    const plan = planEventChain(CHAIN, KIND, EVENT, APPOINTMENT);
    assert.equal(plan.touches[0].due_at, EVENT);
    assert.equal(plan.touches[0].step_no, 1);
    assert.equal(plan.touches[0].touch_kind, "chain");
    assert.equal(plan.touches[0].template_key, "no_show_setting_1");
  });

  test("requires_no_response wird durchgereicht", () => {
    // Die zweite Stufe wird mit angelegt, ist aber nur zu verschicken, wenn auf
    // die erste keine Antwort kam — der Pfeil „keine Antwort" aus dem Konzept.
    const plan = planEventChain(CHAIN, KIND, EVENT, APPOINTMENT);
    assert.deepEqual(
      plan.touches.map((t) => t.requires_no_response),
      [false, true],
    );
  });

  test("der Anker ist das Ereignis, der Termin bleibt als Bezug erhalten", () => {
    const plan = planEventChain(CHAIN, KIND, EVENT, APPOINTMENT);
    assert.equal(plan.touches.length, 2);
    assert.equal(plan.touches[1].due_at, "2026-07-02T08:00:00.000Z");
    for (const t of plan.touches) assert.equal(t.appointment_at, APPOINTMENT);
  });

  test("Ketten entfallen nie — auch nicht bei einem Ereignis in der Vergangenheit", () => {
    const plan = planEventChain(CHAIN, KIND, "2026-01-01T08:00:00.000Z", APPOINTMENT, "2026-07-01T08:00:00.000Z");
    assert.equal(plan.touches.length, 2);
    assert.equal(plan.skipped.length, 0);
  });

  test("auch die Kette rechnet in Wandzeit über die Umstellung", () => {
    // Ereignis am 24.10.2026 10:00 Berlin (CEST), +1 Tag über die Umstellung.
    const plan = planEventChain(CHAIN, KIND, "2026-10-24T08:00:00.000Z", APPOINTMENT);
    assert.equal(isoToBerlinInput(plan.touches[1].due_at), "2026-10-25T10:00");
  });

  test("Vor-Termin-Stufen gehören nicht in die Kette", () => {
    const mixed = [...CHAIN, step({ step_no: 3, offset_minutes: DAY, cascade_kind: KIND })];
    const plan = planEventChain(mixed, KIND, EVENT, APPOINTMENT);
    assert.deepEqual(
      plan.touches.map((t) => t.step_no),
      [1, 2],
    );
  });

  test("ohne aktive Stufe und bei unlesbarem Ereignis entsteht nichts", () => {
    assert.deepEqual(planEventChain([], KIND, EVENT, APPOINTMENT), { touches: [], skipped: [] });
    assert.deepEqual(planEventChain(CHAIN, KIND, "irgendwann", APPOINTMENT), { touches: [], skipped: [] });
  });
});
