// Die Detailseiten von Erstgespräch und Closing nach dem Aufräumen.
//
// ── GEÄNDERTER GEGENSTAND, und zwar aus dem Rückbau heraus ─────────────────
// HIER STANDEN zwei weitere Blöcke, und beide hingen an derselben Sache:
//
//  1. Die WhatsApp-Einwilligung als Ableitung aus der Nummer. Das war der
//     gefährlichste der drei Punkte — fiel die Ableitung weg, lieferte
//     `resolveFollowUpChannel` nie wieder „whatsapp", und die ganze Spur
//     schaltete sich lautlos ab. Es gibt keine Spur mehr: Der Kanal existierte
//     ausschließlich, um zu entscheiden, WORÜBER eine Erinnerung rausgeht.
//     Mit ihm ist die WhatsApp-Karte gefallen und die Pflichtabfrage im
//     Closing-Dialog — eine Pflicht, deren einziger Verbraucher weg ist, hält
//     nur noch auf. (`withWaConsentDerived` in actions/settingCalls.ts bleibt
//     als Server-Riegel stehen; die beiden CHECKs aus 0032 gelten weiter.)
//  2. Die Erinnerungs-Karte am Termin („heißt auf dem Bildschirm
//     Erinnerungen", „startet zugeklappt", „der zugeklappte Kopf trägt Anzahl,
//     Fälligkeit und Überfälligkeit"). Sie war die Oberfläche des
//     Kaskaden-Panels; das Panel ist gelöscht.
//
// Was bleibt, ist die dritte Regel — und die hatte mit Erinnerungen nie etwas
// zu tun: Die Kopfkarte beider Editoren trägt ZWEI Reihen, und die
// eingreifenden Aktionen stehen unterhalb der Trennlinie, nicht zwischen den
// alltäglichen. Ein Knopf, der im aktuellen Zustand nichts bewirken kann, wird
// WEGGELASSEN statt ausgegraut (Muster AblageBoard.tsx). Genau diese Regel
// verschwindet beim nächsten Umbau lautlos, weil ihr Bruch kein Fehler ist,
// sondern nur eine unruhige Karte — deshalb steht sie hier.
//
// Geprüft wird am QUELLTEXT: beide Editoren sind React-Client-Komponenten, die
// der Node-Test-Runner ohne JSX-Transform nicht laden kann.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SETTING_EDITOR = read("src/components/scripts/SettingCallEditor.tsx");
const CLOSING_EDITOR = read("src/components/closing/ClosingCallEditor.tsx");

/* ------------------------------------------------------------------ *
 * Die Kopfkarte: Gewichtung statt Kette
 * ------------------------------------------------------------------ */

describe("Kopfkarte von Erstgespräch und Closing", () => {
  test("zwei Reihen: das Gespräch oben, die Ausnahmen darunter", () => {
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      assert.match(source, /Reihe 1: das Gespräch/, name);
      assert.match(source, /Reihe 2: Termin & Korrektur/, name);
      // Die Trennlinie ist das, was die beiden Ränge überhaupt sichtbar macht.
      assert.match(source, /borderTop: "1px solid var\(--border-subtle\)"/, name);
    }
  });

  test("die eingreifenden Aktionen stehen NACH den alltäglichen", () => {
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      const reihe1 = source.indexOf("Reihe 1: das Gespräch");
      const reihe2 = source.indexOf("Reihe 2: Termin & Korrektur");
      const lifecycle = source.indexOf("<AppointmentLifecycleBar");
      const reset = source.indexOf("/> Zurücksetzen");
      assert.ok(reihe1 < reihe2, name);
      // Verschieben/Absagen (Lebenszyklus-Leiste) und Zurücksetzen liegen
      // beide unterhalb der Trennlinie.
      assert.ok(lifecycle > reihe2, `${name}: Lebenszyklus-Leiste steht nicht in Reihe 2`);
      assert.ok(reset > reihe2, `${name}: „Zurücksetzen" steht nicht in Reihe 2`);
    }
  });

  test("„Zurücksetzen“ fehlt, solange es nichts zurückzusetzen gibt", () => {
    // Muster AblageBoard.tsx: weglassen statt ausgrauen. Ein toter Knopf auf
    // JEDEM frisch angelegten Termin ist schlechter als keiner.
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      assert.match(source, /const hasResult =/, name);
      assert.match(source, /\{hasResult && \(/, name);
    }
    // Im Erstgespräch bleibt genau EIN gesperrter Fall stehen: Bei angelegtem
    // Closing GÄBE es etwas zurückzusetzen, es ist nur nicht erlaubt — diese
    // Absage muss lesbar sein, ein verschwundener Knopf ließe danach suchen.
    assert.match(SETTING_EDITOR, /disabled=\{isPending \|\| status === "closing_gelegt"\}/);
  });
});

/* ------------------------------------------------------------------ *
 * Was der Rückbau aus den beiden Editoren genommen hat — und was nicht
 * ------------------------------------------------------------------ */

describe("Die beiden Editoren tragen keine Nachrichten-Logik mehr", () => {
  test("kein Kaskaden-Panel, kein Kanal, keine WhatsApp-Karte", () => {
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      assert.doesNotMatch(source, /CascadePanel/, `${name} rendert wieder ein Kaskaden-Panel`);
      assert.doesNotMatch(source, /reminderCascade|cascadeEngine|messageTemplates/, name);
      assert.doesNotMatch(source, /wa_phone|wa_consent_at|wa_refused_at/, `${name} sammelt wieder WhatsApp-Felder`);
    }
  });

  test("die Arbeit am Gespräch ist vollständig geblieben", () => {
    // Der Gegentest zum Block darüber, und der wichtigere von beiden: Beim
    // letzten Kürzen des Setting-Skripts sind versehentlich sämtliche
    // Notizfelder mitgegangen — „weniger Text" heißt nie „Feld weg". Geprüft
    // wird deshalb nicht eine Abwesenheit, sondern eine Anwesenheit: Skript,
    // Notizen, Aufzeichnung und die Ergebnis-Wege.
    assert.match(SETTING_EDITOR, /<ScriptRunner/);
    assert.match(SETTING_EDITOR, /blocks=\{SETTING_BLOCKS\}/);
    assert.match(SETTING_EDITOR, /script_answers: answers/);
    assert.match(SETTING_EDITOR, /save\(\{ notes: notes \|\| null \}\)/);
    assert.match(SETTING_EDITOR, /save\(\{ recording_link: recordingLink \|\| null \}\)/);
    assert.match(SETTING_EDITOR, /setSettingOutcome\(/);
    assert.match(SETTING_EDITOR, /<DisqualifyReasonFields/);

    assert.match(CLOSING_EDITOR, /<ScriptRunner/);
    assert.match(CLOSING_EDITOR, /blocks=\{CLOSING_BLOCKS\}/);
    assert.match(CLOSING_EDITOR, /script_answers: answers/);
    assert.match(CLOSING_EDITOR, /save\(\{ notes: notes \|\| null \}\)/);
    assert.match(CLOSING_EDITOR, /save\(\{ recording_link: recordingLink \|\| null \}\)/);
    assert.match(CLOSING_EDITOR, /setClosingOutcome\(/);
    // Die beiden Einwand-Felder des Closings hängen an keinem Ergebnis und
    // wären beim Kürzen am leichtesten mitgegangen.
    assert.match(CLOSING_EDITOR, /objections_handled/);
    assert.match(CLOSING_EDITOR, /objections_open/);
  });

  test("das Closing lässt sich ohne persönliche Nummer anlegen", () => {
    // Die Pflichtangabe war der Kanal der Closing-Erinnerungen und sonst
    // nichts. Bliebe das Gate stehen, sperrte es ohne Gegenstand — und die
    // Ausnahme („Will keine Nummer rausgeben"), die den Ausweg bot, ist mit
    // der Karte gefallen.
    assert.doesNotMatch(SETTING_EDITOR, /waReady|waBlockedHint|Will keine Nummer rausgeben/);
    assert.match(SETTING_EDITOR, /disabled=\{isPending \|\| !closingAt\}/);
  });
});
