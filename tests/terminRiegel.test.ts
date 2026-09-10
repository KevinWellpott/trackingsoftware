// Drei Riegel am Termin-Lebenszyklus — der Deploy-Blocker und die zwei Lücken
// daneben.
//
// Zwei Bauarten in einer Datei, und das ist Absicht:
//
//  · Was eine reine Funktion entscheidet, wird als VERHALTEN geprüft
//    (`buildEvents`, `outlineFor`, `moveLockReason`). Das ist der ehrlichere
//    Test, und er ist hier möglich, weil src/lib/termine.ts und
//    src/lib/terminMeta.ts keine Datenbank kennen.
//  · Was eine Server Action entscheidet, wird am QUELLTEXT geprüft — dieselbe
//    Bauart wie lifecycleWiring.test.ts und schreibpfadGrenzen.test.ts. Eine
//    echte Probe bräuchte eine Datenbank mit Kaskadenstufen; eine Attrappe
//    bewiese nur, dass die Attrappe stimmt. Was ein Quelltext-Test dagegen
//    leistet: Er hält fest, dass eine Prüfung NICHT WIEDER VERSCHWINDET — und
//    genau das ist die Fehlerklasse hier. Keiner der drei Befunde hat je einen
//    Fehler geworfen; sie waren still.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { CANCELLED_MOVE_HINT, moveLockReason, TERMINAL_CLOSING_STATUS, TERMINAL_SETTING_STATUS } from "@/lib/terminMeta";
import { buildEvents, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf einer Funktion — von ihrer Signatur bis zum nächsten Anker. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const CLOSING_CALLS = read("src/app/actions/closingCalls.ts");
const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const DRAG = read("src/components/termine/useDragReschedule.ts");
const BOARD = read("src/components/termine/TermineBoard.tsx");
const CLOSING_EDITOR = read("src/components/closing/ClosingCallEditor.tsx");

/* ------------------------------------------------------------------ *
 * Testdaten
 * ------------------------------------------------------------------ */

const NAMES = new Map([["u1", "kevin"]]);

/**
 * Ein FESTES „heute". `buildEvents` verlangt es seit dem Rückbau als Argument,
 * weil der abgeleitete Zustand daran hängt (Termin in der Zukunft = „Verlegt").
 * Vorher holte sich niemand ein Datum, und diese Testdatei war stillschweigend
 * zeitabhängig: Ihre Termin-Fixture liegt auf dem 20.09.2026 und wäre ab dem
 * 21.09.2026 in eine andere Erwartung gekippt.
 */
const HEUTE = "2026-09-15";

/** Nur die Felder, die `fromSetting`/`fromClosing` wirklich anfassen. */
function setting(patch: Partial<WithCancellation<SettingCall>> = {}): WithCancellation<SettingCall> {
  return {
    id: "s1",
    status: "offen",
    show_status: null,
    appointment_at: "2026-09-20T08:00:00.000Z",
    lead_name: "Meier",
    company: "Meier GmbH",
    meet_link: null,
    meeting_kind: null,
    phone: null,
    source_type: null,
    source_detail: null,
    assigned_user_id: "u1",
    created_by_user_id: "u1",
    ...patch,
  } as WithCancellation<SettingCall>;
}

function closing(patch: Partial<WithCancellation<ClosingCall>> = {}): WithCancellation<ClosingCall> {
  return {
    id: "c1",
    status: "offen",
    show_status: null,
    call_at: "2026-09-20T08:00:00.000Z",
    lead_name: "Meier",
    company: "Meier GmbH",
    meet_link: null,
    deal_volume: null,
    assigned_user_id: "u1",
    created_by_user_id: "u1",
    ...patch,
  } as WithCancellation<ClosingCall>;
}

function settingEvent(patch: Partial<WithCancellation<SettingCall>> = {}) {
  const { events } = buildEvents([setting(patch)], [], NAMES, HEUTE);
  assert.equal(events.length, 1, "Termin ist aus dem Kalender verschwunden");
  return events[0];
}

function closingEvent(patch: Partial<WithCancellation<ClosingCall>> = {}) {
  const { events } = buildEvents([], [closing(patch)], NAMES, HEUTE);
  assert.equal(events.length, 1, "Termin ist aus dem Kalender verschwunden");
  return events[0];
}

/* ------------------------------------------------------------------ *
 * Befund 1
 * ------------------------------------------------------------------ */

describe("Befund 1 — ein Ergebnis kann keine Kaskade des Closings mehr überleben", () => {
  // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ──────────────────
  // HIER STANDEN fünf Tests um EINEN Befund: Am entity_type 'closing' hingen
  // fünf Kaskaden, und die Aufzählung in `setClosingOutcome` nannte zwei davon.
  // 'no_show_closing' blieb stehen (der Lead, der nach einem geplatzten Closing
  // doch unterschreibt, las am nächsten Tag „ich habe es gestern und heute nicht
  // erreicht"), 'closing_kickoff' wurde im ganzen Code nie entwertet und stand
  // nach jedem Ergebnis dauerhaft überfällig. Die Lösung war, die Liste
  // abzuschaffen — eine Aufzählung, die jemand bei jeder neuen Kaskaden-Art
  // nachziehen muss, versagt still.
  //
  // Der Rückbau geht denselben Schritt zu Ende: Es gibt keine Kaskade mehr, also
  // auch keine Liste und kein Entwerten. Die Prüfung ist deshalb dieselbe
  // geblieben, nur radikaler — statt „keine Liste" jetzt „kein Aufruf".
  const outcome = slice(CLOSING_CALLS, "export async function setClosingOutcome(", "\n/**");

  test("kein Erzeugen, kein Entwerten, keine Kaskaden-Namen mehr", () => {
    assert.doesNotMatch(outcome, /supersedeTouches|generateFollowUpCascade|generateKeinCloseChain/);
    // ── GEÄNDERTER ANKER, und zwar aus dem Rückbau heraus ───────────────────
    // Die fünf Namen standen bis hierher NICHT als Literal da, sondern kamen
    // aus `CASCADE_KIND_LABELS` — damit der Test von selbst rot wurde, sobald
    // jemand eine zehnte Kaskade erfindet. Die Registry ist mit dem
    // Kaskaden-Rechner gefallen; es gibt nichts mehr, woran er hängen könnte.
    // Ausgeschrieben beschreibt die Liste jetzt einen abgeschlossenen Zustand
    // („das waren die fünf") statt eines wachsenden — und die Zusicherung wird
    // dadurch stärker, nicht schwächer: Wer eine dieser Kaskaden wiederbelebt,
    // müsste sie zuerst neu erfinden.
    const amClosing = ["closing_msg", "closing_mail", "closing_kickoff", "no_show_closing", "kein_close"];
    for (const kind of amClosing) assert.doesNotMatch(CLOSING_CALLS, new RegExp(`"${kind}"`), kind);
  });

  test("das Kriterium „neues Ereignis, keine Korrektur\" bleibt — es trägt jetzt die Wiedervorlage", () => {
    // Die Unterscheidung war nie nur für die Kette da: Eine reine Grund-
    // Korrektur an einer bereits verlorenen Zeile darf auch das Recycling-Datum
    // nicht neu rechnen (`schedule_recycle()` rechnet `heute + Wartezeit`).
    // Sie ist deshalb nicht als toter Zwischenwert mitgefallen.
    assert.match(outcome, /const correctingLoss =[\s\S]{0,200}before\?\.status === "verloren"/);
    assert.match(outcome, /const needsRecycleDate = !correctingLoss/);
  });
});

/* ------------------------------------------------------------------ *
 * Befund 2
 * ------------------------------------------------------------------ */

describe("Befund 2a — der Kalender kennt die Absage", () => {
  test("ein abgesagter Termin bleibt SICHTBAR", () => {
    // Ausgeblendet wird im Kalender nichts (docs §1) — das war die Falle des
    // alten „Versteckt"-Schalters. Es geht ums Verschieben, nicht ums Anzeigen.
    const { events, ohneTermin } = buildEvents([setting({ cancelled_at: "2026-09-10T09:00:00.000Z" })], [], NAMES, HEUTE);
    assert.equal(events.length, 1);
    assert.equal(ohneTermin.length, 0);
  });

  test("der Chip sagt die Absage — mit den vorhandenen drei Schaltern", () => {
    // Rot = geplatzt, gestrichelt = daran ändert sich nichts mehr, abgeblendet
    // = aus der Planung raus. Kein neues Muster, exakt das Tripel eines
    // `dead`-Settings.
    const e = settingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" });
    assert.deepEqual(e.outline, { tone: "danger", dashed: true, dimmed: true });
    assert.equal(e.cancelled, true);
  });

  test("Pill und Chip-Titel behaupten nicht, der Termin stünde noch", () => {
    // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ───────────────
    // Die Zusicherung ist dieselbe geblieben: Über einem abgeräumten Termin
    // darf nicht stehen, dass er stattfindet. Nur ihre BESCHRIFTUNG hat sich
    // umgedreht, weil das Wort „Offen" jetzt das Gegenteil bedeutet.
    //
    // Vorher hieß „Offen" der gespeicherte `status='offen'` — „Termin steht,
    // Ergebnis fehlt"; über einer Absage war das falsch, und ein eigener Pill
    // „Abgesagt" hielt die Trennung. Seit dem Rückbau ist der Zustand
    // ABGELEITET, und „Offen" heißt „es steht KEIN Termin, der Mensch liegt in
    // der Luft" (src/lib/dranRegel.ts). Für eine Absage ist das exakt die
    // richtige Aussage — und die nützliche dazu: Die Zeile bleibt damit in der
    // Arbeitsmenge, statt als eigener Endzustand aus der Liste zu fallen. Ein
    // elfter Pill „Abgesagt" wäre jetzt der Fehler; der Auftraggeber will genau
    // einen Status je Zeile, und „Abgesagt" ist keiner seiner acht.
    assert.equal(settingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }).statusPill.label, "Offen");
    assert.equal(closingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }).statusPill.label, "Offen");

    // Die Gegenprobe, die es vorher gar nicht geben konnte: Derselbe Termin
    // OHNE Absage steht in der Zukunft und ist damit versorgt.
    assert.equal(settingEvent().statusPill.label, "Verlegt");
    assert.equal(settingEvent().dran, false);
    // … und die Absage kippt ihn in die Arbeitsmenge zurück.
    assert.equal(settingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }).dran, true);
  });

  test("„die Absage ist überholt“ steht in `revived_at`, nicht im Datum", () => {
    // Der teure Denkfehler, den diese Prüfung festnagelt: Man sagt ab, BEVOR
    // der Termin ist — `appointment_at` ist also immer jünger als
    // `cancelled_at`, und ein Vergleich der beiden Zeitstempel wäre stets
    // „Termin gewinnt". Aus den zwei Spalten allein ist „abgesagt, altes Datum
    // steht noch drin" von „abgesagt, danach neu terminiert" NICHT zu
    // unterscheiden; deshalb entscheidet das dritte Feld.
    const abgesagt = settingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" });
    const zurueckgeholt = settingEvent({
      cancelled_at: "2026-09-10T09:00:00.000Z",
      revived_at: "2026-09-11T09:00:00.000Z",
    });
    assert.equal(abgesagt.zustand, "offen");
    assert.equal(zurueckgeholt.zustand, "verlegt");
    assert.equal(zurueckgeholt.dran, false);
  });

  test("… und er ist nicht mehr ziehbar, mit Begründung", () => {
    for (const e of [
      settingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }),
      closingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }),
    ]) {
      assert.equal(e.lockedReason, CANCELLED_MOVE_HINT);
    }
    assert.equal(settingEvent().lockedReason, null);
  });

  test("der Riegel steht auch auf dem Server — beide Wege zum selben Zustand", () => {
    // Die Oberfläche allein genügt nicht: Server Actions sind per direktem POST
    // erreichbar. Ohne den Riegel trüge die Zeile `cancelled_at` UND ein neues
    // Datum und stünde zugleich als abgesagt und als terminiert da — die
    // Begründung hat der Rückbau ausgetauscht (vorher: der Termin stünde ohne
    // Erinnerung da), die Regel nicht.
    //
    // ── GEÄNDERTE ANKER, weil der Riegel nur die HALBE Bedingung las ────────
    // HIER STAND `.select("cancelled_at")` bzw. `if (current.cancelled_at)`.
    // Die Regel ist dieselbe geblieben, ihre Bedingung war unvollständig: Der
    // Riegel nennt in seinem eigenen Kommentar „Neuen Termin ansetzen" als den
    // Weg zurück — und wies genau diesen Weg mit ab, weil er ihn an nichts
    // erkennen konnte. Für ein abgesagtes CLOSING war der Knopf damit einer,
    // der ausnahmslos scheitert; für ein Erstgespräch war die Zeile ab dem
    // Ersatztermin für immer eingefroren.
    //
    // Maßgeblich ist deshalb das PAAR aus Absage und Rückholung
    // (`absageWirktNoch`) — dieselben zwei Spalten, die `terminZustand()`
    // längst zusammen liest. Die Zusicherung wird dadurch nicht schwächer:
    // Eine Zeile OHNE `revived_at` bleibt gesperrt, und zwar an allen drei
    // Stellen.
    const move = slice(SETTING_CALLS, "export async function moveSettingAppointment(", "\n/**");
    assert.match(move, /\.select\("cancelled_at, revived_at"\)/);
    assert.match(move, /if \(absageWirktNoch\([\s\S]{0,120}return \{ error: CANCELLED_MOVE_HINT \}/);

    // Beim Closing gibt es kein `moveClosingAppointment`; der Kalender-Drag
    // landet in `updateClosingCall`. Der Vorher-Lesen-Block dort hat seit dem
    // Rückbau nur noch diesen einen Zweck — deshalb hängt er am Termin-Feld,
    // statt daneben auch den alten Show-Status zu holen.
    const update = slice(CLOSING_CALLS, "export async function updateClosingCall(", "\n/**");
    assert.match(update, /const appointmentChanged = "call_at" in patch;/);
    assert.match(update, /if \(appointmentChanged\) \{[\s\S]*?absageWirktNoch\(before\)/);
    assert.match(update, /return \{ error: CANCELLED_MOVE_HINT \}/);

    // Und `postponeAppointment` benutzt denselben Satz statt einer zweiten
    // Formulierung derselben Regel.
    assert.match(SETTING_CALLS, /if \(absageWirktNoch\(current\)\) return \{ error: CANCELLED_MOVE_HINT \}/);

    // Die Bedingung selbst steht je Datei an EINER Stelle — drei Abschriften
    // wären drei Regeln, die auseinanderlaufen.
    for (const [name, quelle] of [
      ["settingCalls.ts", SETTING_CALLS],
      ["closingCalls.ts", CLOSING_CALLS],
    ] as const) {
      assert.match(quelle, /function absageWirktNoch\(row:[\s\S]{0,200}Boolean\(row\?\.cancelled_at\) && !row\?\.revived_at/, name);
    }
  });
});

describe("Befund 2b — terminale Status sind vollständig", () => {
  test("ein unqualifiziertes Erstgespräch ist nicht mehr ziehbar", () => {
    // Der teure Fall: Ein Zug legte über `moveSettingAppointment` →
    // `generateSettingCascade` drei frische „steht der Termin noch?"-Touches an
    // einen disqualifizierten Lead.
    assert.ok(TERMINAL_SETTING_STATUS.includes("unqualifiziert"));
    assert.ok(TERMINAL_SETTING_STATUS.includes("dead"));
    for (const status of ["unqualifiziert", "dead"] as const) {
      const e = settingEvent({ status });
      assert.ok(e.lockedReason, `${status} ist weiter ziehbar`);
      assert.match(e.lockedReason!, /Das Erstgespräch steht auf /);
    }
  });

  test("das Pendant für Closings ist vollständig", () => {
    assert.deepEqual([...TERMINAL_CLOSING_STATUS], ["gewonnen", "verloren"]);
    for (const status of ["gewonnen", "verloren"] as const) {
      assert.ok(closingEvent({ status }).lockedReason, `${status} ist weiter ziehbar`);
    }
  });

  test("offene Vorgänge bleiben ziehbar — der Riegel ist kein Rundumschlag", () => {
    // 'no_show' und 'closing_gelegt' beim Erstgespräch, 'nachfassen' beim
    // Closing: Dort geht der Vorgang weiter, ein Ersatztermin ist der Normalfall.
    for (const status of ["offen", "no_show", "closing_gelegt"] as const) {
      assert.equal(settingEvent({ status }).lockedReason, null, status);
    }
    for (const status of ["offen", "nachfassen"] as const) {
      assert.equal(closingEvent({ status }).lockedReason, null, status);
    }
  });

  test("die Begründung nennt das Ergebnis beim Namen", () => {
    // GEÄNDERTE BESCHRIFTUNG, gleiche Zusicherung: Der Riegel muss das
    // Ergebnis benennen, statt wortlos abzuprallen. Die Namen kommen seit dem
    // Rückbau aus derselben Quelle wie der Pill in der Arbeitsliste — sonst
    // nennt der Riegel ein Ergebnis „Unqualifiziert", während die Zeile daneben
    // „Nicht qualifiziert" trägt. Der Satz ist dafür umformuliert („steht auf"
    // statt „ist mit … abgeschlossen"): „Das Closing ist mit ‚Close‘
    // abgeschlossen" wäre in der neuen Sprache ein Stolperer.
    assert.equal(
      moveLockReason("setting", "unqualifiziert", false),
      "Das Erstgespräch steht auf „Nicht qualifiziert“ — ein neuer Zeitpunkt ändert daran nichts.",
    );
    assert.equal(
      moveLockReason("closing", "gewonnen", false),
      "Das Closing steht auf „Close“ — ein neuer Zeitpunkt ändert daran nichts.",
    );
    // Die Absage schlägt den Status: Sie fasst ihn gar nicht an, ein abgesagtes
    // offenes Erstgespräch stünde sonst als ziehbar da.
    assert.equal(moveLockReason("setting", "offen", true), CANCELLED_MOVE_HINT);
  });

  test("der Zug prallt nicht mehr wortlos ab", () => {
    // Vorher hing das Ziehen an `event.terminal` und tat bei einem terminalen
    // Chip schlicht nichts — das sieht aus wie ein Fehler der App, nicht wie
    // eine Regel, und der Nutzer probiert es dreimal.
    assert.match(DRAG, /onBlocked\?\.\(drag\.event\)/);
    assert.match(DRAG, /if \(drag\.event\.lockedReason\) \{/);
    assert.doesNotMatch(DRAG, /drag\.event\.terminal/);
    assert.doesNotMatch(DRAG, /!event\.terminal/);
    // Und die Meldung landet in der Fehlerzeile des Boards.
    assert.match(BOARD, /onBlocked: handleBlocked/);
    assert.match(BOARD, /setError\(event\.lockedReason\)/);
  });
});

describe("Befund 2c — das Termin-Feld im Closing-Editor", () => {
  test("gesperrt, sobald das Ergebnis feststeht — und begründet", () => {
    // Eine Änderung dort lief über `updateClosingCall` → `generateClosingCascade`
    // und legte eine frische Bestätigungs-Kaskade für ein entschiedenes
    // Gespräch an.
    assert.match(CLOSING_EDITOR, /const terminLocked = moveLockReason\("closing", status, Boolean\(call\.cancelled_at\)\)/);
    const feld = slice(CLOSING_EDITOR, "<span style={fieldLabel}>Termin</span>", "Google-Meet-Link");
    assert.match(feld, /disabled=\{Boolean\(terminLocked\)\}/);
    assert.match(feld, /\{terminLocked && /, "gesperrt, aber ohne Begründung");
  });
});

/* ------------------------------------------------------------------ *
 * Befund 3
 * ------------------------------------------------------------------ */

describe("Befund 3 — „Ergebnis zurücksetzen“ braucht keinen Regenerator mehr", () => {
  // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ──────────────────
  // HIER STAND der Befund: „Ergebnis zurücksetzen" dreht den Status auf „Offen",
  // die Bestätigungs-Kaskade war beim Ergebnis aber entwertet worden — und weil
  // `handleReset` bewusst kein `call_at` mitschickt, hing der Regenerator am
  // falschen Feld. Das Closing stand danach dauerhaft ohne Erinnerung da, und
  // das Kaskaden-Panel begründete das mit einem Ereignis, das es nie gab.
  //
  // Ohne Kaskade gibt es nichts wiederherzustellen: Das Zurücksetzen ist ein
  // gewöhnliches UPDATE. Was bleibt, ist die Gegenprobe am Editor — sie hielt
  // schon damals fest, WORAN der Regenerator nicht hängen durfte, und sie
  // beschreibt weiterhin, was der Knopf tut.
  const update = slice(CLOSING_CALLS, "export async function updateClosingCall(", "\n/**");

  test("das Zurücksetzen erzeugt nichts mehr — und der Helfer dazu ist weg", () => {
    assert.doesNotMatch(update, /generateClosingCascade|generateFollowUpCascade|createNoShowTouch/);
    assert.doesNotMatch(CLOSING_CALLS, /closingAppointmentAhead/);
    assert.doesNotMatch(SETTING_CALLS, /settingAppointmentAhead/);
  });

  test("Gegenprobe: `handleReset` schickt weiterhin kein `call_at`", () => {
    // Der Termin ist Arbeit, kein Ergebnis: Ein zurückgesetztes Ergebnis darf
    // den Zeitpunkt nicht mitnehmen. Das gilt unverändert.
    const reset = slice(CLOSING_EDITOR, "async function handleReset(", "\n  //");
    assert.match(reset, /status: "offen"/);
    assert.doesNotMatch(reset, /call_at/);
  });
});
