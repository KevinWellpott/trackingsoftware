// Die Verdrahtung zwischen App und Datenbank — der Teil des Umbaus, den kein
// Typ und kein Constraint absichert.
//
// Alle vier Regeln hier haben dieselbe Bauart: Die Datenbank ist auf einen Fall
// vollständig vorbereitet (ein Zweig in `schedule_recycle()`, eine Spalte in
// `pipeline_settings`, eine Abfrage in `recycle_tasks`), und die App ruft ihn
// nie auf. Das ist die teuerste Fehlerklasse des Bereichs, weil sie nichts
// kaputtmacht, das jemand sieht: Es passiert schlicht nichts, und die
// Einstellung dazu steht sichtbar in /settings.
//
// Geprüft wird deshalb am QUELLTEXT statt am Verhalten — dieselbe Bauart wie
// die Migrations-Gegenproben in revive.test.ts. Eine echte Probe bräuchte eine
// Datenbank; eine Attrappe bewiese nur, dass die Attrappe stimmt.
//
// Daraus folgt die eine Regel für die Anker unten: Ein Anker hängt an einem
// BEZEICHNER oder einer Bedingung, nie an Formatierung. Ein Endanker aus
// Klammer und Zeilenumbrüchen (`\n}\n`) beschreibt keine Aussage — er ist schon
// einmal gebrochen, als eine der Quelldateien mit CRLF neu geschrieben wurde,
// und meldete danach einen fehlenden Abschnitt, obwohl die Zusicherung selbst
// unverändert galt. Ein Test, der bei einer Umformatierung rot wird, verbraucht
// genau das Vertrauen, das er schützen soll.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

/**
 * Quelltext lesen — mit vereinheitlichten Zeilenumbrüchen.
 *
 * Geprüft werden Aussagen IM Quelltext, nicht die Frage, welchen Umbruch der
 * zuletzt schreibende Editor gewählt hat. Auf Windows entstehen CRLF-Dateien;
 * ein Anker, der ein `\n` enthält, traf darin nie — und zwar unabhängig davon,
 * ob die geprüfte Zusicherung noch gilt. Ein Test, der beim Umschalten der
 * Zeilenenden umkippt, misst das Werkzeug statt den Code.
 */
function read(relative: string): string {
  const text = readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
  return text.replace(/\r\n/g, "\n");
}

/**
 * Der Rumpf einer Funktion — von ihrer Signatur bis zur nächsten.
 *
 * Beide Anker MÜSSEN treffen. Ein fehlender Anker ist ein benannter Fehlschlag,
 * nie eine still geprüfte leere Zeichenkette: sonst bestünde jede Zusicherung
 * darunter genau dann, wenn es nichts mehr zu prüfen gibt. Der Anker wird
 * escaped gemeldet, weil ein Anker aus Zeilenumbrüchen sonst als Leerzeile in
 * der Fehlermeldung steht und nichts verrät.
 */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${JSON.stringify(from)}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${JSON.stringify(to)}`);
  return source.slice(start, end);
}

/**
 * Dasselbe bis zum Dateiende — für Funktionen, die als LETZTE in ihrer Datei
 * stehen. Dort gibt es keinen nachfolgenden Bezeichner, auf den ein Endanker
 * zeigen könnte, und ein erfundener aus Klammer und Zeilenumbruch ist genau die
 * Sorte Anker, die beim nächsten Umformatieren wandert. Die Gegenprobe hält
 * fest, dass die Funktion wirklich die letzte ist: Kommt eine Deklaration
 * dahinter, wüchse der Ausschnitt sonst lautlos über sie hinweg, und eine
 * Zusicherung bestünde wegen fremden Codes.
 */
function sliceToEnd(source: string, from: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${JSON.stringify(from)}`);
  const body = source.slice(start);
  assert.equal(
    body.slice(from.length).search(/\n(export |async function |function )/),
    -1,
    `Nach ${JSON.stringify(from)} steht eine weitere Deklaration — hier muss ein Endanker hin`,
  );
  return body;
}

const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const RECYCLE = read("src/app/actions/recycle.ts");
const REVIVE = read("src/app/actions/revive.ts");
const ASSIGNEES = read("src/app/actions/assignees.ts");
const CLOSING_CALLS = read("src/app/actions/closingCalls.ts");
const MIGRATION_0033 = read("supabase/migrations/20260404000033_lead_recycling.sql");
const MIGRATION_0037 = read("supabase/migrations/20260404000037_rpc_zugriffspruefung.sql");

describe("Recycling: jeder Zweig, den die Datenbank abfragt, wird auch beliefert", () => {
  test("`unqualifiziert` bekommt ein Recycling-Datum — sonst ist die 8-Wochen-Frist unerreichbar", () => {
    // Gegenprobe an der Datenbank: Der Zweig existiert dreifach — eigene
    // Wartezeit, eigene Abfrage, eigene Einstellung. Fehlte er dort, wäre der
    // App-Aufruf unten falsch statt fehlend.
    assert.match(MIGRATION_0037, /when sc\.status = 'unqualifiziert'\s*\n\s*then s\.days_default_setting_disqualified/);
    assert.match(MIGRATION_0033, /sc\.status in \('dead', 'unqualifiziert'\)/);

    const outcome = slice(
      SETTING_CALLS,
      "export async function setSettingOutcome(",
      "export async function rescheduleSetting(",
    );
    assert.match(outcome, /scheduleRecycle\("setting"/);
    // Beide Status im selben Aufruf: bis hierher stand dort nur 'dead', und die
    // Spalte days_default_setting_disqualified war damit toter Code.
    const call = slice(outcome, 'if (input.outcome === "dead"', "scheduleRecycle");
    assert.match(call, /input\.outcome === "unqualifiziert"/);
  });

  test("„Nochmal versucht\" plant den nächsten Versuch neu ein", () => {
    // `recycle_attempt()` lässt `next_recycle_at` bewusst stehen (außer am
    // Deckel) — der Wert ist per Definition bereits fällig. Ohne ein Neu-
    // Einplanen stünde dieselbe Karte am nächsten Tag wieder da, und die zweite
    // Ghosting-Stufe (`days_ghosting` statt `days_ghosting_breakup`) wäre nie
    // erreichbar, weil sie `recycle_attempt_count > 0` verlangt.
    assert.match(MIGRATION_0037, /when v_attempts = 0 then s\.days_ghosting_breakup else s\.days_ghosting end/);

    const marked = slice(
      RECYCLE,
      "export async function markRecycleContacted(",
      "export async function markRecycleResponded(",
    );
    const attemptAt = marked.indexOf('rpc("recycle_attempt"');
    const scheduleAt = marked.indexOf("scheduleRecycle(origin, entityId)");
    assert.notEqual(attemptAt, -1);
    assert.notEqual(scheduleAt, -1, "markRecycleContacted plant keinen nächsten Versuch ein");
    // Reihenfolge zählt: `schedule_recycle()` liest den frisch erhöhten Zähler
    // und gibt am Deckel bewusst kein Datum mehr aus.
    assert.ok(scheduleAt > attemptAt, "Neu-Einplanen muss NACH dem Hochzählen laufen");
  });

  test("eine reine Grund-Korrektur der Absage rührt Zeitpunkt und Wiedervorlage nicht an", () => {
    // Derselbe Knopf heißt an einer abgesagten Zeile „Absage ändern" und ruft
    // dieselbe Action. `cancelled_at` trägt in der Ablage die Spalte „Eingang",
    // und `schedule_recycle()` rechnet `heute + Wartezeit` — beides neu zu
    // setzen schöbe den Lead um Monate nach hinten, ohne es zu sagen.
    const cancel = slice(
      SETTING_CALLS,
      "export async function cancelAppointment(",
      "async function applyDisqualifyConsequences(",
    );
    assert.match(cancel, /wasCancelled \? \{\} : \{ cancelled_at:/);
    assert.match(cancel, /becomesHopeless/);
    assert.match(cancel, /previous\?\.cancel_outlook !== "ohne_aussicht"/);
  });
});

describe("Rückholen: der Rollback nimmt genau das zurück, was der Claim gesetzt hat", () => {
  test("alle drei Claim-Felder stehen auch im Rollback", () => {
    const body = sliceToEnd(REVIVE, "export async function reviveDropout(");
    // Ohne `next_recycle_at` im Rollback stünde der Vorgang nach einem
    // gescheiterten Insert wieder als nicht-zurückgeholt in der Ablage, wäre
    // aber lautlos aus `recycle_tasks` verschwunden: dessen Zweig verlangt
    // `next_recycle_at <= p_today`, und NULL erfüllt das nie.
    const claim = slice(body, "const { data: claimed", "const { data: created");
    const rollback = slice(body, "if (insertError || !created)", "return { error: insertError");
    for (const field of ["revived_at", "next_recycle_at", "recycle_reason_code"]) {
      assert.match(claim, new RegExp(field), `Claim ohne ${field}`);
      assert.match(rollback, new RegExp(field), `Rollback ohne ${field}`);
    }
    // Die Spaltenlisten müssen die Vorgängerwerte überhaupt mitlesen.
    assert.match(REVIVE, /SETTING_COLUMNS[\s\S]*?next_recycle_at, recycle_reason_code/);
    assert.match(REVIVE, /CLOSING_COLUMNS[\s\S]*?next_recycle_at, recycle_reason_code/);
  });
});

describe("Erinnerungen folgen der zuständigen Person, nicht dem Anmeldekonto", () => {
  // ── GEÄNDERTER UMFANG, und zwar aus dem Rückbau heraus ────────────────────
  // HIER STAND daneben: „in fremder Organisation gibt es keinen
  // Ersteller-Fallback" — der Helfer `assigneeFor` in actions/reminders.ts, der
  // beim Erzeugen einer Kaskade verhinderte, dass ein Plattform-Admin in einer
  // Kundenorganisation Erinnerungen auf sein eigenes Konto legt. Die Datei ist
  // gelöscht; es entsteht keine Kaskade mehr, deren Zuweisung falsch ausfallen
  // könnte.
  //
  // AUCH DER ZWEITE TEST IST GEFALLEN, und zwar eine Rückbauwelle später.
  // HIER STAND: „„Niemand" zieht die offenen Erinnerungen zum Ersteller, statt
  // sie zurückzulassen" — er pinnte `const touchAssignee = userId ??
  // row.created_by_user_id` und das UPDATE auf `reminder_touches` in
  // `setAssignee`. Das war der letzte Schreibpfad auf die Tabelle.
  //
  // Er hatte einen echten Gegenstand, solange /erinnerungen existierte: Blieben
  // die Touches beim bisherigen Zuständigen, sah der bei `data_scope='own'` eine
  // Karte ohne Lead-Namen, und der Ersteller bekam sie nie zu Gesicht. Es gibt
  // keine Karten mehr. Was blieb, war ein Roundtrip und eine Revalidierung je
  // Zuweisung auf eine Spalte ohne Leser.
  //
  // Was an die Stelle tritt, steht in erinnerungenTermine.test.ts (Block C):
  // „Niemand" geht durch, eine Zuweisung über die Org-Grenze nicht, und
  // `reminder_touches` wird gar nicht mehr angefasst. Hier bleibt die
  // Gegenprobe, dass die Zuweisung selbst noch geschrieben wird — sonst ginge
  // dieser Rückbau als „hier passiert nichts mehr" durch.

  test("die Zuweisung selbst wird weiter geschrieben", () => {
    // Endanker am Bezeichner (Regel oben): Seit Migration 0042 folgt
    // `setConductedBy` — `setAssignee` ist nicht mehr die letzte Funktion.
    const body = slice(ASSIGNEES, "export async function setAssignee(", "export async function setConductedBy(");
    assert.match(body, /\.update\(\{ assigned_user_id: userId \}\)/);
    assert.match(body, /\.eq\("workspace_id", access\.workspace_id\)/);
  });
});

describe("Korrigierte Ergebnisse können keine Kette mehr stehen lassen", () => {
  // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ──────────────────
  // HIER STAND: „zurück auf ‚erschienen' räumt die No-Show-Kette ab" und das
  // Pendant fürs Closing. Beide pinnten je einen `supersedeTouches(…, [kaskade])`
  // mit Kaskaden-Filter — die Regel „ein korrigiertes Ergebnis entwertet genau
  // seine eigene Kette, aber auch keine fremde".
  //
  // Der BEFUND dahinter war echt und teuer: Ein geplatztes Closing, bei dem der
  // Lead am nächsten Tag doch unterschreibt, behielt seine No-Show-Kette. Deren
  // zweite Stufe wurde fällig und sagte „ich habe es gestern und heute nicht
  // erreicht" zu jemandem, der gerade unterschrieben hat — die Karte war eine
  // Kopier-Werkbank, der Satz wäre real rausgegangen. Genauso das Erstgespräch:
  // Der Anwesenheits-Schalter ist ein Toggle ohne Dialog, und der Weg zurück
  // ließ die Kette des Wegs hin einfach stehen.
  //
  // Mit dem Rückbau ist die Kette selbst gefallen — und damit die ganze
  // Fehlerklasse. Die Zusicherung wird dadurch nicht schwächer, sondern
  // stärker: Es gibt keinen Aufruf mehr, den ein künftiger Weg zurück vergessen
  // könnte. Genau das prüfen die beiden Tests jetzt, statt eine Verdrahtung
  // festzuhalten, die es nicht mehr gibt.
  const TOUCH_AUFRUFE =
    /supersedeTouches|deleteTouchesForEntity|createNoShowTouch|generateSettingCascade|generateClosingCascade|generateFollowUpCascade|generateClosingKickoff|generateKeinCloseChain/;

  test("das Erstgespräch erzeugt und entwertet keine Touches mehr", () => {
    assert.doesNotMatch(SETTING_CALLS, TOUCH_AUFRUFE);
    // Gegenprobe, damit das nicht als „hier passiert nichts mehr" durchgeht:
    // Was am LEAD hängt, ist geblieben — die Wiedervorlage des Recyclings.
    assert.match(SETTING_CALLS, /scheduleRecycle\("setting"/);
  });

  test("dasselbe beim Closing", () => {
    assert.doesNotMatch(CLOSING_CALLS, TOUCH_AUFRUFE);
    assert.match(CLOSING_CALLS, /scheduleRecycle\("closing"/);
  });
});
