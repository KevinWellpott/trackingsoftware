// Die letzte Stelle, an der eine VOR-Termin-Kaskade für ein bereits gelaufenes
// Gespräch entstand.
//
// Der Befund: `generateScheduled` (src/app/actions/reminders.ts) prüfte vor dem
// Anlegen auf `cancelled_at` — aber nicht darauf, ob das Gespräch schon
// stattgefunden hat. Ziehbar bleiben nach dem Termin-Riegel (terminRiegel.test.ts)
// bewusst Erstgespräche im Status `qualifiziert`/`closing_gelegt` und Closings im
// Status `nachfassen`: Fachlich ist ihr Vorgang nicht beendet, ihr TERMIN aber
// gelaufen. Ein Zug im Kalender legte dort drei frische „steht der Termin noch
// wie geplant?"-Touches an — eine Nachricht, die real rausgeht und nicht mehr
// stimmt.
//
// Gelöst wird das am ERZEUGER, nicht über die Terminal-Liste: Ein vierter Eintrag
// in `TERMINAL_SETTING_STATUS` änderte über `data-terminal` auch die Abblendung
// grüner und goldener Chips im Wochenraster und sperrte das Verschieben dort, wo
// es legitim ist (ein falsch erfasstes Datum korrigieren). Die tragende
// Unterscheidung ist nicht der Status, sondern `show_status`: bei `offen` bewusst
// NULL, gesetzt sobald ein Ergebnis erfasst wird (docs §4).
//
// Bauart wie terminRiegel.test.ts und lifecycleWiring.test.ts: Was eine reine
// Funktion entscheidet, wird als VERHALTEN geprüft; was eine Server Action
// entscheidet, am QUELLTEXT. Eine echte Probe bräuchte eine Datenbank mit
// Kaskadenstufen, eine Attrappe bewiese nur, dass die Attrappe stimmt. Was ein
// Quelltext-Test hier leistet: Er hält fest, dass die Prüfung NICHT WIEDER
// VERSCHWINDET — und ebenso, dass sie nicht lautlos VERSCHÄRFT wird (der
// Ersatztermin nach No-Show muss weiter eine Kaskade bekommen).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { moveLockReason, TERMINAL_CLOSING_STATUS, TERMINAL_SETTING_STATUS } from "@/lib/terminMeta";

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

const REMINDERS = read("src/app/actions/reminders.ts");
const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const CLOSING_CALLS = read("src/app/actions/closingCalls.ts");
const APPOINTMENTS = read("src/app/actions/appointments.ts");
const REVIVE = read("src/app/actions/revive.ts");
const SETTING_EDITOR = read("src/components/scripts/SettingCallEditor.tsx");
const CLOSING_EDITOR = read("src/components/closing/ClosingCallEditor.tsx");

/**
 * Nur der Code, ohne Zeilen- und Blockkommentare.
 *
 * Gebraucht für die Gegenprobe „hängt NICHT an der Terminal-Liste": Der
 * Kommentar im Erzeuger nennt sie namentlich, gerade um zu begründen, warum er
 * sie nicht benutzt. Am Rohtext geprüft wäre die Begründung ihr eigener
 * Widerspruch.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const SCHEDULED = slice(REMINDERS, "async function generateScheduled(", "\n/** Setting-Kaskade");
const SCHEDULED_CODE = withoutComments(SCHEDULED);

/* ------------------------------------------------------------------ *
 * Der Riegel
 * ------------------------------------------------------------------ */

describe("Vor-Termin-Kaskade nur für ein Gespräch ohne erfassten Ausgang", () => {
  test("beide Loader holen `show_status` mit", () => {
    // Ohne die Spalte in der Auswahl wäre der Riegel unten dauerhaft und
    // unbemerkt falsch: PostgREST liefert kein Feld, das niemand angefragt hat,
    // `row.show_status` wäre immer `undefined` — also immer „kein Ergebnis".
    assert.match(REMINDERS, /const SETTING_COLUMNS =[\s\S]{0,240}show_status/);
    assert.match(REMINDERS, /const CLOSING_COLUMNS =[\s\S]{0,240}show_status/);
  });

  test("`EntityRow` trägt den Ausgang neben der Absage", () => {
    // Beide Riegel stehen auf derselben Zeile — die Absage sagt „der Termin
    // findet nicht statt", der Ausgang „er hat schon stattgefunden".
    const entityRow = slice(REMINDERS, "type EntityRow = {", "\n};");
    assert.match(entityRow, /cancelled_at: string \| null;/);
    assert.match(entityRow, /show_status: "show" \| "no_show" \| null;/);
  });

  test("ein erfasster Ausgang entwertet die geplante Kaskade und legt keine neue an", () => {
    // Dasselbe Muster wie der Absage-Riegel eine Zeile darüber: entwerten UND
    // aussteigen. Nur zu unterlassen genügte nicht — die alten Touches zeigten
    // sonst weiter auf einen Zeitpunkt, den es so nicht mehr gibt.
    assert.match(
      SCHEDULED,
      /if \(entityType !== "closing_followup" && row\.show_status\) \{\s*await supersedeTouches\(entityType, entityId, \[kind\]\);\s*return NOTHING;\s*\}/,
      "der Riegel gegen ein bereits gelaufenes Gespräch fehlt in generateScheduled",
    );
  });

  test("der Riegel greift NICHT beim Nachfass-Kontakt — sonst gäbe es ihn nie", () => {
    // `closing_followup` ist die einzige der drei geplanten Kaskaden, deren
    // Anker NICHT der Termin ist, sondern `follow_up_due_at`: ein künftiger
    // Kontakt, der gerade DESHALB vereinbart wurde, weil das Closing
    // stattgefunden hat. `setClosingOutcome` leitet dort `show_status='show'`
    // ab, bevor `generateFollowUpCascade` läuft — ohne die Ausnahme entstünde
    // die Nachfass-Kaskade in keinem einzigen Fall mehr.
    const outcome = slice(CLOSING_CALLS, "export async function setClosingOutcome(", "\n/**");
    const ableitung = outcome.indexOf('patch.show_status = "show"');
    const kaskade = outcome.indexOf("generateFollowUpCascade(input.closingId)");
    assert.notEqual(ableitung, -1, "die Show-Ableitung ist weg — dann trägt die Begründung der Ausnahme nicht mehr");
    assert.notEqual(kaskade, -1);
    assert.ok(ableitung < kaskade, "die Nachfass-Kaskade entsteht vor der Show-Ableitung");
    assert.match(SCHEDULED, /entityType !== "closing_followup"/);
  });

  test("die Ereignis-Ketten bleiben unberührt — sie SETZEN ein Ergebnis voraus", () => {
    // No-Show-, Kickoff- und „kein Abschluss"-Kette entstehen erst nach dem
    // Ereignis. Ein Riegel gegen „Ausgang erfasst" würde dort genau die Kette
    // erschlagen, die den Ausgang beantwortet.
    const chain = slice(REMINDERS, "async function generateChain(", "\n/**");
    assert.doesNotMatch(chain, /show_status/);
  });

  test("gelöst am Erzeuger, nicht über die Terminal-Liste", () => {
    // Die beiden Listen sind gerade bewusst gesetzt worden; sie steuern über
    // `data-terminal` zusätzlich die Optik erfolgreicher Chips und sperren das
    // Verschieben. Der Riegel darf sie deshalb weder erweitern noch überhaupt
    // von ihnen abhängen — geprüft an der Abhängigkeit, nicht am Wort: Der
    // Kommentar im Erzeuger nennt die Liste, gerade um zu begründen, warum er
    // sie NICHT benutzt.
    assert.deepEqual([...TERMINAL_SETTING_STATUS], ["unqualifiziert", "dead"]);
    assert.deepEqual([...TERMINAL_CLOSING_STATUS], ["gewonnen", "verloren"]);
    assert.doesNotMatch(REMINDERS, /from "@\/lib\/terminMeta"/);
    assert.doesNotMatch(SCHEDULED_CODE, /TERMINAL_(SETTING|CLOSING)_STATUS/);
    // Und er hängt auch nicht am `status` selbst — das war der Weg, der die
    // Optik mitgenommen hätte.
    assert.doesNotMatch(SCHEDULED_CODE, /row\.status/);
  });

  test("genau die drei gemeldeten Status bleiben ziehbar — und bekommen trotzdem keine Kaskade", () => {
    // Das ist der Befund in einem Satz: Ihr Vorgang läuft weiter (deshalb kein
    // Riegel im Kalender), ihr Termin ist gelaufen (deshalb der Riegel am
    // Erzeuger). Beide Aussagen müssen gleichzeitig wahr bleiben.
    for (const status of ["qualifiziert", "closing_gelegt"] as const) {
      assert.equal(moveLockReason("setting", status, false), null, status);
    }
    assert.equal(moveLockReason("closing", "nachfassen", false), null);
  });
});

/* ------------------------------------------------------------------ *
 * Gegenrichtung — die Pfade, die weiterhin eine Kaskade bekommen MÜSSEN
 * ------------------------------------------------------------------ */

describe("Gegenrichtung: wo eine Kaskade entstehen muss, entsteht sie weiter", () => {
  test("Ersatztermin nach No-Show — `rescheduleSetting` räumt beide Felder VOR der Kaskade", () => {
    // Der eine Fall, in dem ein Ergebnis erfasst war und trotzdem eine neue
    // Kaskade entstehen MUSS. Er braucht keinen Sonderfall im Riegel, weil die
    // Action Status UND Show-Status im selben UPDATE zurücksetzt — der Riegel
    // liest den Stand DANACH. Verschwände eines der beiden Felder aus dem
    // Patch, wäre der Riegel lautlos verschärft: der Ersatztermin stünde ohne
    // jede Erinnerung da, und niemand bekäme eine Meldung.
    const reschedule = slice(SETTING_CALLS, "export async function rescheduleSetting(", "\n/**");
    assert.match(reschedule, /status: "offen",/);
    assert.match(reschedule, /show_status: null,/);
    const geleert = reschedule.indexOf("show_status: null");
    const erzeugt = reschedule.indexOf("generateSettingCascade(settingId)");
    assert.notEqual(erzeugt, -1);
    assert.ok(geleert < erzeugt, "die Kaskade entsteht, bevor der Show-Status geleert ist");
  });

  test("„Ergebnis zurücksetzen“ leert `show_status` im selben Patch — beide Editoren", () => {
    // Der Regenerator hängt in beiden Actions an `resultCleared` und läuft NACH
    // dem UPDATE. Schickte ein Editor nur `status: "offen"`, bliebe der alte
    // Show-Status stehen und der Riegel griffe gegen den zurückgesetzten Termin.
    const settingReset = slice(SETTING_EDITOR, "async function handleReset(", "\n  function handleMarkNoShow(");
    assert.match(settingReset, /status: "offen"/);
    assert.match(settingReset, /show_status: null/);

    const closingReset = slice(CLOSING_EDITOR, "async function handleReset(", "\n  //");
    assert.match(closingReset, /status: "offen"/);
    assert.match(closingReset, /show_status: null/);
  });

  test("der Riegel liest den Stand NACH dem UPDATE, nicht davor", () => {
    // Trägt der ganze Entwurf: `generateScheduled` bekommt keine Zeile
    // mitgeschleppt, sondern lädt sie selbst. Deshalb sieht es beim
    // Zurücksetzen und beim Ersatztermin den bereits geleerten Show-Status —
    // und beim Kalender-Zug den unangetasteten.
    assert.match(SCHEDULED, /const row = await load\(access\);/);
    const update = slice(SETTING_CALLS, "export async function updateSettingCall(", "\n/**");
    const geschrieben = update.indexOf('.from("setting_calls").update(');
    const erzeugt = update.indexOf("generateSettingCascade(id)");
    assert.ok(geschrieben !== -1 && erzeugt > geschrieben, "die Kaskade entsteht vor dem UPDATE");
  });

  test("Anlegen: kein Anlagepfad schreibt einen Show-Status", () => {
    // Ein frisch angelegter Termin steht auf `status: "offen"` und
    // `show_status` NULL — genau darauf setzt der Riegel. Die vier Anlagepfade
    // (LinkedIn, Telefon, manuell, Wiederbelebung aus der Ablage) dürfen das
    // Feld deshalb gar nicht erst anfassen.
    assert.doesNotMatch(APPOINTMENTS, /show_status/, "ein Anlagepfad schreibt jetzt einen Show-Status");
    assert.doesNotMatch(REVIVE, /show_status/, "die Wiederbelebung schreibt jetzt einen Show-Status");
    assert.equal(APPOINTMENTS.split('status: "offen"').length - 1, 3, "die drei Anlagepfade");
    assert.match(REVIVE, /status: "offen",/);
  });

  test("Closing anlegen: die Kaskade des NEUEN Closings entsteht vor jedem Ergebnis", () => {
    // `createClosingFromSetting` legt mit `status: "offen"` an und rührt
    // `show_status` am Closing nicht an — der Riegel greift dort also nicht.
    // Das `show_status: "show"` in derselben Funktion gehört dem SETTING (der
    // Lead war da) und ist genau der Grund, warum dessen eigene Kaskade
    // gleichzeitig entwertet wird.
    const create = slice(SETTING_CALLS, "export async function createClosingFromSetting(", "\n/**");
    assert.match(create, /supersedeTouches\("setting", settingId, \["setting_msg", "no_show_setting"\]\)/);
    assert.match(create, /\.from\("closing_calls"\)\s*\.insert\(\{[\s\S]{0,600}status: "offen",/);
  });
});
