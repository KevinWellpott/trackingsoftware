// Die Zusicherungen am DATENSATZ, auf denen die Vor-Termin-Kaskade einmal
// stand — und die den Rückbau überlebt haben.
//
// ── GEÄNDERTER GEGENSTAND, und zwar aus dem Rückbau heraus ─────────────────
// HIER STAND ein ganzer Block über `generateScheduled` (src/app/actions/
// reminders.ts): Der Erzeuger prüfte vor dem Anlegen auf `cancelled_at`, aber
// nicht darauf, ob das Gespräch schon stattgefunden hat. Ein Zug im Kalender
// legte an einem qualifizierten Erstgespräch drei frische „steht der Termin
// noch wie geplant?"-Touches an — eine Nachricht, die real rausging und nicht
// mehr stimmte. Gelöst wurde das am Erzeuger statt über `TERMINAL_*_STATUS`,
// weil die Terminal-Listen zusätzlich die Optik der Chips und die Sperre gegen
// das Verschieben steuern.
//
// Der Erzeuger ist gelöscht, die ganze Fehlerklasse mit ihm. Was BLEIBT, ist
// die Beobachtung, auf der er stand und auf der heute die Terminliste steht:
// `show_status` ist die tragende Unterscheidung zwischen „der Vorgang läuft
// weiter" und „der Termin ist gelaufen" — bei `offen` bewusst NULL, gesetzt
// sobald ein Ergebnis erfasst wird (docs §4). Jeder Pfad, der ein Ergebnis
// zurücknimmt oder einen Termin neu anlegt, muss das Feld mitführen; täte er es
// nicht, stünde eine Zeile zugleich als offen und als gelaufen da.
//
// Bauart wie terminRiegel.test.ts und lifecycleWiring.test.ts: Was eine reine
// Funktion entscheidet, wird als VERHALTEN geprüft; was eine Server Action
// entscheidet, am QUELLTEXT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";


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

const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const CLOSING_CALLS = read("src/app/actions/closingCalls.ts");
const APPOINTMENTS = read("src/app/actions/appointments.ts");
const REVIVE = read("src/app/actions/revive.ts");
const SETTING_EDITOR = read("src/components/scripts/SettingCallEditor.tsx");
const CLOSING_EDITOR = read("src/components/closing/ClosingCallEditor.tsx");

/* ------------------------------------------------------------------ *
 * Die Anlagepfade — was sie am Datensatz tun
 * ------------------------------------------------------------------ */

describe("Die Anlagepfade bleiben, auch ohne Kaskade", () => {
  // ── GEÄNDERTE ERWARTUNG, aus dem Rückbau heraus ───────────────────────────
  // Die vier Tests hier hielten fest, dass bestimmte Pfade WEITERHIN eine
  // Kaskade bekommen — der Riegel sollte nicht lautlos verschärft werden. Die
  // Kaskade ist inzwischen ganz gefallen, die Aufrufe in den vier Termin-Actions
  // mit ihr. Geprüft wird deshalb nur noch, was diese Pfade am DATENSATZ tun;
  // genau daran hing die Aussage schon vorher, die Kaskade war die Folge.

  test("Ersatztermin nach No-Show — `rescheduleSetting` räumt Status und Show-Status", () => {
    // Ein frischer Anlauf, kein Verschieben: Verschwände eines der beiden Felder
    // aus dem Patch, trüge die Zeile ein neues Datum und weiter ihr altes
    // Ergebnis — in der Arbeitsliste sähe der Lead damit versorgt aus, obwohl
    // sein letzter Termin geplatzt ist.
    const reschedule = slice(SETTING_CALLS, "export async function rescheduleSetting(", "\n/**");
    assert.match(reschedule, /status: "offen",/);
    assert.match(reschedule, /show_status: null,/);
  });

  test("„Ergebnis zurücksetzen“ leert `show_status` im selben Patch — beide Editoren", () => {
    // Schickte ein Editor nur `status: "offen"`, bliebe der alte Show-Status
    // stehen: Die Zeile stünde als offen UND als bereits gelaufen da. Das war
    // die Voraussetzung des Riegels und ist heute die der Arbeitsliste — die
    // Zusicherung gilt unverändert, nur ihr Nutznießer ist ein anderer.
    const settingReset = slice(SETTING_EDITOR, "async function handleReset(", "\n  function handleMarkNoShow(");
    assert.match(settingReset, /status: "offen"/);
    assert.match(settingReset, /show_status: null/);

    const closingReset = slice(CLOSING_EDITOR, "async function handleReset(", "\n  //");
    assert.match(closingReset, /status: "offen"/);
    assert.match(closingReset, /show_status: null/);
  });

  test("kein Erzeuger mehr — auch kein übersehener", () => {
    // HIER STAND: „der Erzeuger liest die Zeile selbst" (er bekam sie nicht
    // mitgeschleppt, sondern lud sie — nur deshalb sah er beim Zurücksetzen den
    // bereits geleerten Show-Status) und daneben die Reihenfolge in
    // `updateSettingCall`: erst UPDATE, dann Kaskade.
    //
    // Beides hat mit dem Erzeuger seinen Gegenstand verloren. Die Gegenprobe
    // hält jetzt fest, dass wirklich KEIN Aufruf mehr dasteht — ein einzelner
    // übersehener wäre schlimmer als alle, weil ihn niemand suchte.
    for (const [name, quelle] of [
      ["settingCalls.ts", SETTING_CALLS],
      ["closingCalls.ts", CLOSING_CALLS],
      ["appointments.ts", APPOINTMENTS],
      ["revive.ts", REVIVE],
    ] as const) {
      assert.doesNotMatch(quelle, /generate(Setting|Closing|FollowUp)Cascade|generateClosingKickoff|generateKeinCloseChain/, name);
      assert.doesNotMatch(quelle, /supersedeTouches|deleteTouchesForEntity|createNoShowTouch/, name);
    }
  });

  test("Anlegen: kein Anlagepfad schreibt einen Show-Status", () => {
    // Ein frisch angelegter Termin steht auf `status: "offen"` und
    // `show_status` NULL — darauf setzte der Riegel, und darauf setzt heute die
    // Arbeitsliste. Die vier Anlagepfade (LinkedIn, Telefon, manuell,
    // Wiederbelebung aus der Ablage) dürfen das Feld deshalb gar nicht erst
    // anfassen. Die Zusicherung ist vom Rückbau unberührt.
    assert.doesNotMatch(APPOINTMENTS, /show_status/, "ein Anlagepfad schreibt jetzt einen Show-Status");
    assert.doesNotMatch(REVIVE, /show_status/, "die Wiederbelebung schreibt jetzt einen Show-Status");
    assert.equal(APPOINTMENTS.split('status: "offen"').length - 1, 3, "die drei Anlagepfade");
    assert.match(REVIVE, /status: "offen",/);
  });

  test("Closing anlegen: der neue Termin startet auf „offen“", () => {
    // `createClosingFromSetting` legt mit `status: "offen"` an und rührt
    // `show_status` am Closing nicht an. Das `show_status: "show"` in derselben
    // Funktion gehört dem SETTING (der Lead war da).
    //
    // HIER STAND daneben, dass dieselbe Funktion die Kaskade des Erstgesprächs
    // entwertet — der Grund, warum es die Zeile überhaupt gab. Beides ist mit
    // dem Rückbau gefallen; die Aussage über den angelegten Termin bleibt.
    const create = slice(SETTING_CALLS, "export async function createClosingFromSetting(", "\n/**");
    assert.match(create, /\.from\("closing_calls"\)\s*\.insert\(\{[\s\S]{0,600}status: "offen",/);
    assert.doesNotMatch(create, /supersedeTouches|generateClosing/);
  });
});
