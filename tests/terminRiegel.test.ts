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

import { CASCADE_KIND_LABELS, type CascadeKind } from "@/lib/cascadeEngine";
import { CANCELLED_MOVE_HINT, moveLockReason, TERMINAL_CLOSING_STATUS, TERMINAL_SETTING_STATUS } from "@/lib/terminMeta";
import { buildEvents, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
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
  const { events } = buildEvents([setting(patch)], [], NAMES);
  assert.equal(events.length, 1, "Termin ist aus dem Kalender verschwunden");
  return events[0];
}

function closingEvent(patch: Partial<WithCancellation<ClosingCall>> = {}) {
  const { events } = buildEvents([], [closing(patch)], NAMES);
  assert.equal(events.length, 1, "Termin ist aus dem Kalender verschwunden");
  return events[0];
}

/* ------------------------------------------------------------------ *
 * Befund 1
 * ------------------------------------------------------------------ */

describe("Befund 1 — ein Ergebnis entwertet ALLE Kaskaden des Closings", () => {
  const outcome = slice(CLOSING_CALLS, "export async function setClosingOutcome(", "\n/**");

  test("entwertet wird ohne Kaskadenliste — wie in setSettingOutcome", () => {
    // Der Kern des Befunds: Am entity_type 'closing' hängen fünf Kaskaden, die
    // frühere Aufzählung nannte zwei. Eine Liste, die jemand bei der nächsten
    // Kaskaden-Art nachziehen muss, ist genau die Bauart, die hier still
    // versagt hat — deshalb ist die Abwesenheit jeder Liste die Prüfung.
    assert.match(outcome, /supersedeTouches\("closing", input\.closingId\);/);
    assert.doesNotMatch(
      outcome,
      /supersedeTouches\("closing", input\.closingId, \[/,
      "setClosingOutcome grenzt wieder nach Kaskaden-Art ein",
    );
  });

  test("das Kriterium ist „neues Ereignis“, nicht der Outcome", () => {
    // Alle drei Ergebnisse beenden den Termin — auch „Nachfassen": Das
    // Gespräch hat stattgefunden, der vereinbarte Rückkontakt hängt am eigenen
    // entity_type. Ausgenommen ist deshalb nicht ein Outcome, sondern die reine
    // Grund-Korrektur an einer bereits verlorenen Zeile (Muster `wasCancelled`)
    // — sonst nähme das Entwerten die laufende „kein Abschluss"-Kette mit,
    // ohne sie neu aufzubauen.
    assert.match(outcome, /if \(!correctingLoss\) \{\s*await supersedeTouches\("closing", input\.closingId\);/);
    assert.match(outcome, /const correctingLoss =[\s\S]{0,200}before\?\.status === "verloren"/);
  });

  test("der Nachfass-Kontakt hängt am eigenen entity_type und wird eigens abgeräumt", () => {
    // 'closing_followup' ist eine andere entity_type-Zeile; das listenlose
    // Entwerten oben erreicht sie nicht. Ohne diesen zweiten Aufruf liefen
    // Kette und Nachfass-Kaskade nebeneinander.
    const supersede = outcome.indexOf('supersedeTouches("closing_followup", input.closingId)');
    const regenerate = outcome.indexOf("generateFollowUpCascade(input.closingId)");
    assert.notEqual(supersede, -1);
    assert.notEqual(regenerate, -1);
    assert.ok(regenerate > supersede, "die Nachfass-Kaskade wird vor dem Entwerten aufgebaut");
  });

  test("Gegenprobe: alle fünf Kaskaden am entity_type 'closing' sind abgedeckt", () => {
    // Die Liste, die es nicht mehr gibt, hätte diese fünf nennen müssen. Der
    // Test hängt an der Registry und wird deshalb von selbst wieder rot, sobald
    // jemand eine sechste Kaskade am Closing einführt und hier doch wieder
    // aufzählt.
    const amClosing: CascadeKind[] = [
      "closing_msg",
      "closing_mail",
      "closing_kickoff",
      "no_show_closing",
      "kein_close",
    ];
    for (const kind of amClosing) assert.ok(CASCADE_KIND_LABELS[kind], `unbekannte Kaskade: ${kind}`);
    // Keine einzige davon steht noch als Literal in setClosingOutcome — genau
    // das ist der Unterschied zu vorher.
    for (const kind of amClosing) assert.doesNotMatch(outcome, new RegExp(`"${kind}"`), kind);
  });

  test("'closing_kickoff' wird überhaupt irgendwo entwertet", () => {
    // Die stillere Hälfte des Befunds: Diese Kaskade wurde im ganzen Code nie
    // abgeräumt — nur `cancelAppointment` und `deleteClosingCall` nahmen sie
    // über die listenlose Variante mit. Nach jedem Ergebnis stand sie dauerhaft
    // überfällig und kündigte einen längst gelaufenen Termin an.
    const listlos = [
      ...CLOSING_CALLS.matchAll(/supersedeTouches\("closing", [\w.]+\);/g),
      ...CLOSING_CALLS.matchAll(/deleteTouchesForEntity\("closing", [\w.]+\)/g),
    ];
    assert.ok(listlos.length >= 2, "kein listenloses Entwerten am entity_type 'closing'");
  });
});

/* ------------------------------------------------------------------ *
 * Befund 2
 * ------------------------------------------------------------------ */

describe("Befund 2a — der Kalender kennt die Absage", () => {
  test("ein abgesagter Termin bleibt SICHTBAR", () => {
    // Ausgeblendet wird im Kalender nichts (docs §1) — das war die Falle des
    // alten „Versteckt"-Schalters. Es geht ums Verschieben, nicht ums Anzeigen.
    const { events, ohneTermin } = buildEvents([setting({ cancelled_at: "2026-09-10T09:00:00.000Z" })], [], NAMES);
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

  test("Pill und Chip-Titel behaupten nicht mehr „Offen“", () => {
    // Die Absage lässt `status` und `show_status` bewusst unangetastet
    // (docs §3) — ohne eigenen Pill stand über einem abgeräumten Termin
    // „Offen", in Liste, Popover und Chip-Titel gleichermaßen.
    assert.equal(settingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }).statusPill.label, "Abgesagt");
    assert.equal(closingEvent({ cancelled_at: "2026-09-10T09:00:00.000Z" }).statusPill.label, "Abgesagt");
    assert.equal(settingEvent().statusPill.label, "Offen");
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
    // Datum, und die Kaskaden-Erzeugung steigt wegen `cancelled_at` aus — ein
    // Termin garantiert ohne Erinnerung.
    const move = slice(SETTING_CALLS, "export async function moveSettingAppointment(", "\n/**");
    assert.match(move, /\.select\("cancelled_at"\)/);
    assert.match(move, /return \{ error: CANCELLED_MOVE_HINT \}/);

    // Beim Closing gibt es kein `moveClosingAppointment`; der Kalender-Drag
    // landet in `updateClosingCall`.
    const update = slice(CLOSING_CALLS, "export async function updateClosingCall(", "\n/**");
    assert.match(update, /appointmentChanged && before\?\.cancelled_at/);
    assert.match(update, /return \{ error: CANCELLED_MOVE_HINT \}/);

    // Und `postponeAppointment` benutzt denselben Satz statt einer zweiten
    // Formulierung derselben Regel.
    assert.match(SETTING_CALLS, /if \(current\.cancelled_at\) return \{ error: CANCELLED_MOVE_HINT \}/);
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
      assert.match(e.lockedReason!, /Das Erstgespräch ist mit /);
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
    assert.equal(
      moveLockReason("setting", "unqualifiziert", false),
      "Das Erstgespräch ist mit „Unqualifiziert“ abgeschlossen — ein neuer Zeitpunkt ändert daran nichts.",
    );
    assert.equal(
      moveLockReason("closing", "gewonnen", false),
      "Das Closing ist mit „Gewonnen“ abgeschlossen — ein neuer Zeitpunkt ändert daran nichts.",
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

describe("Befund 3 — „Ergebnis zurücksetzen“ lässt den Termin nicht ohne Kaskade", () => {
  const update = slice(CLOSING_CALLS, "export async function updateClosingCall(", "\n/**");

  test("der Regenerator hängt nicht mehr allein an `call_at`", () => {
    // `handleReset` schickt bewusst kein `call_at` mit (der Termin ist Arbeit,
    // kein Ergebnis). Der alte Zweig hing ausschließlich daran — das Closing
    // stand danach wieder auf „Offen", der Termin in der Zukunft, und es gab
    // keine Erinnerung mehr.
    assert.match(update, /const resultCleared = "status" in patch && patch\.status === "offen";/);
    assert.match(update, /if \(appointmentChanged \|\| resultCleared\) \{/);
    assert.match(update, /generateClosingCascade\(id\)/);
  });

  test("… aber nur für einen Termin, der noch bevorsteht", () => {
    // Für einen vergangenen Termin findet `planScheduledCascade` keine Stufe
    // mehr und legt EINEN sofort fälligen Touch an — beim Verschieben ist genau
    // der gewollt, hier wäre er eine Terminbestätigung für ein Gespräch, das
    // längst gelaufen ist. Wortgleich zu `settingAppointmentAhead`.
    assert.match(update, /if \(appointmentChanged \|\| \(await closingAppointmentAhead\(id\)\)\)/);
    const helper = slice(CLOSING_CALLS, "async function closingAppointmentAhead(", "\n/**");
    assert.match(helper, /\.select\("call_at, cancelled_at"\)/);
    assert.match(helper, /if \(!row\?\.call_at \|\| row\.cancelled_at\) return false;/);
    assert.match(helper, /Date\.parse\(row\.call_at\) > Date\.now\(\)/);
  });

  test("Gegenprobe: `handleReset` schickt weiterhin kein `call_at`", () => {
    // Wenn dieser Test rot wird, ist der Befund auf dem anderen Weg gelöst
    // worden — dann darf der Zweig oben verschwinden, aber nicht vorher.
    const reset = slice(CLOSING_EDITOR, "async function handleReset(", "\n  //");
    assert.match(reset, /status: "offen"/);
    assert.doesNotMatch(reset, /call_at/);
  });

  test("das Setting löst denselben Fall genauso — beide Editoren bleiben gleich", () => {
    const settingUpdate = slice(SETTING_CALLS, "export async function updateSettingCall(", "\n/**");
    assert.match(settingUpdate, /const resultCleared = "status" in patch && patch\.status === "offen";/);
    assert.match(settingUpdate, /await settingAppointmentAhead\(id\)/);
  });
});
