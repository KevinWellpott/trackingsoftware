// Zwei Rückmeldungen aus dem Betrieb, eine Datei:
//
//   1. „Alle Closing-Termine sollen automatisch mir zugeordnet werden."
//      Ein Closing erbte bis hierher die Zuweisung seines Settings und stand
//      damit in der Liste des Setters, der es gar nicht führt.
//   2. „Bei Nicht qualifiziert fehlen Genervt · Termin · Tot."
//      Die drei Knöpfe hingen an Arbeitsmenge + stehendem Termin; ein nicht
//      qualifiziertes Erstgespräch bekam einen Strich.
//
// Bauart wie arbeitslisteNeuerTermin.test.ts: Was eine reine Funktion
// entscheidet, wird als VERHALTEN geprüft; was eine Server Action entscheidet,
// am QUELLTEXT — eine echte Probe bräuchte eine Datenbank.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { istBearbeitbar, istInArbeitsmenge, istTerminDran, istZuTun } from "@/lib/dranRegel";
import { CLOSING_ZUSTAENDIG_USERNAME, closingZustaendigIn } from "@/lib/personResolution";

function read(relative: string): string {
  // CRLF → LF, sonst finden Anker mit `\n` unter Windows nichts.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const STEMPEL = read("src/app/actions/followUpStamp.ts");

const CREATE_CLOSING = slice(SETTING_CALLS, "export async function createClosingFromSetting(", "\n/**");
const REOPEN = slice(SETTING_CALLS, "export async function reopenUnqualifiedSetting(", "\n/**");
const NEUER_TERMIN = slice(STEMPEL, "export async function setNeuerTermin(", "\n/**");

const HEUTE = "2026-09-15";

describe("1 · Jedes neue Closing gehört der Closing-Person", () => {
  test("sie wird unter den Mitgliedern gefunden — Groß-/Kleinschreibung egal", () => {
    assert.equal(CLOSING_ZUSTAENDIG_USERNAME, "Simon");
    const team = [
      { user_id: "k", username: "kevin" },
      { user_id: "s", username: "simon" },
    ];
    assert.equal(closingZustaendigIn(team), "s");
    assert.equal(closingZustaendigIn([{ user_id: "s", username: " Simon " }]), "s");
  });

  test("ist sie kein Mitglied, gibt es keinen Treffer — geraten wird nicht", () => {
    // Der Normalfall in einer Kunden-Organisation: Der Plattform-Admin ist dort
    // bewusst kein Mitglied (docs §2). Dann gilt die alte Regel weiter.
    assert.equal(closingZustaendigIn([{ user_id: "k", username: "Kevin" }]), null);
    assert.equal(closingZustaendigIn([]), null);
    // Kein Teiltreffer: „Simone" ist nicht „Simon".
    assert.equal(closingZustaendigIn([{ user_id: "x", username: "Simone" }]), null);
  });

  test("createClosingFromSetting weist ihr zu — vor Setting und Anlegendem", () => {
    assert.match(CREATE_CLOSING, /closingZustaendigIn\(await listDataViewUsers\(access\.workspace_id\)\)/);
    assert.match(CREATE_CLOSING, /assigned_user_id: closer \?\? setting\?\.assigned_user_id \?\? fallbackAssignee,/);
  });

  test("ein BESTEHENDES Closing wird nicht umgehängt", () => {
    // Der Wiederverwendungs-Zweig füllt höchstens eine Terminlücke. Eine
    // Zuweisung, die jemand von Hand geändert hat, darf ein erneuter Klick auf
    // „Qualifiziert" nicht zurückdrehen.
    const reuse = CREATE_CLOSING.slice(CREATE_CLOSING.indexOf("if (existing)"), CREATE_CLOSING.indexOf("// Neu anlegen"));
    assert.ok(reuse.length > 0, "Wiederverwendungs-Zweig nicht gefunden");
    assert.doesNotMatch(reuse, /assigned_user_id/);
  });
});

describe("2 · „Nicht qualifiziert\" trägt die drei Knöpfe", () => {
  test("die Zeile ist bearbeitbar — die anderen Ergebnisse bleiben es nicht", () => {
    assert.equal(istBearbeitbar("nicht_qualifiziert"), true);
    for (const z of ["tot", "close", "kein_close", "closing_gelegt", "qualifiziert"] as const) {
      assert.equal(istBearbeitbar(z), false, z);
    }
  });

  test("… aber sie leuchtet nicht und steht nicht in „Zu tun\"", () => {
    // Die Knöpfe sind eine Möglichkeit, keine tägliche Pflicht — die
    // Arbeitsmenge bleibt „es steht kein Termin" (docs §1).
    assert.equal(istInArbeitsmenge("nicht_qualifiziert"), false);
    assert.equal(istTerminDran("nicht_qualifiziert", null, HEUTE), false);
    assert.equal(istZuTun("nicht_qualifiziert", null), false);
  });

  test("„Termin\" macht das Erstgespräch wieder auf — und das VOR der Show-Weiche", () => {
    // Ein disqualifiziertes Erstgespräch trägt immer `show_status='show'`. Käme
    // die Show-Weiche zuerst, bekäme es nur ein neues Datum und bliebe „Nicht
    // qualifiziert" — der Knopf täte scheinbar nichts.
    assert.match(NEUER_TERMIN, /vorher\?\.status === "unqualifiziert"/);
    const reopenPos = NEUER_TERMIN.indexOf("reopenUnqualifiedSetting(id, iso)");
    const showPos = NEUER_TERMIN.indexOf('show_status === "show"');
    assert.notEqual(reopenPos, -1, "der Rückweg wird nicht aufgerufen");
    assert.notEqual(showPos, -1, "die Show-Weiche ist verschwunden");
    assert.ok(reopenPos < showPos, "die Show-Weiche steht vor dem Rückweg");
    // Der Status muss dafür mitgelesen werden.
    assert.match(NEUER_TERMIN, /\.select\("cancelled_at, revived_at, show_status, status"\)/);
  });

  test("der Rückweg setzt den Status zurück und lässt die Show stehen", () => {
    assert.match(REOPEN, /status: "offen"/);
    assert.match(REOPEN, /follow_up_due: null/);
    // Bedingtes UPDATE: Hat inzwischen jemand anderes ein Ergebnis gesetzt,
    // wird nichts überschrieben — und das sagt die Action auch.
    assert.match(REOPEN, /\.eq\("status", "unqualifiziert"\)/);
    assert.match(REOPEN, /\.select\("id"\)/);
    // Der Lead WAR da; das steht in keiner zweiten Spalte (Muster
    // `moveSettingAppointment` für erschienene Leads).
    assert.doesNotMatch(REOPEN, /show_status/);
    // Zurück im Funnel heißt: keine Wiedervorlage mehr aus der Disqualifizierung.
    assert.match(REOPEN, /clearRecycle\("setting", settingId\)/);
    assert.match(REOPEN, /mirrorAppointmentToSource\(settingId, appointmentIso\)/);
  });
});
