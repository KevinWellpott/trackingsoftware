// Rückbau, Spur Kern: Der Kaskaden-Rechner, das Erinnerungs-Modul, das
// Kaskaden-Panel und die Vorlagen-Bibliothek sind gelöscht.
//
// WARUM ES DIESE DATEI GIBT: Eine Entfernung hinterlässt keinen Anker. Die
// beiden Wellen davor haben die OBERFLÄCHE des Überbaus abgeschaltet — Routen
// wurden zu Weiterleitungen, Sektionen verschwanden, Einstellungen fielen weg.
// Der Code darunter lief weiter, sichtbar für niemanden. Genau so kommt er
// zurück: Wer eine Bibliothek findet, die vollständig aussieht und die niemand
// aufruft, hält den fehlenden Aufruf für das Versehen.
//
// Er war es nicht. Das Zielbild des Auftraggebers ist wörtlich: „Keine
// Kaskaden. Keine Stufen. Keine Templates. Keine Kanal-Logik. Keine
// automatischen Nachrichten." Diese Datei ist der Widerspruch, den die
// gelöschten Dateien nicht mehr selbst einlegen können.
//
// GEPRÜFT WIRD AN DER DATEIABWESENHEIT und am Quelltext der Nachbarn —
// dieselbe Bauart wie rueckbauEinstellungen.test.ts. Ein Import auf eine
// gelöschte Datei fiele schon `tsc` auf; was hier zusätzlich festgehalten
// wird, ist die Absicht.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function pfad(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(pfad(relative), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Derselbe Quelltext ohne Kommentare.
 *
 * Nötig für jede „das gibt es nicht mehr"-Zusicherung: Die Kommentarköpfe der
 * zurückgebauten Dateien ERKLÄREN, was entfernt wurde, und nennen das
 * Entfernte dabei beim Namen — das ist erwünscht und soll stehen bleiben. Ohne
 * diesen Schnitt schlüge die Gegenprobe an ihrer eigenen Begründung an.
 */
function ohneKommentare(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/* ------------------------------------------------------------------ *
 * Die entfernten Dateien
 * ------------------------------------------------------------------ */

describe("Rückbau: der Kern ist weg, nicht nur abgeklemmt", () => {
  test("Rechner, Modul, Panel, Board und Vorlagen sind gelöscht", () => {
    for (const datei of [
      // Der Rechner: Stufenwahl, Buchungstag-Regel, Sofort-Touch.
      "src/lib/cascadeEngine.ts",
      // Die Kanal-Auflösung (WhatsApp gegen Akquise-Kanal).
      "src/lib/reminderCascade.ts",
      // Der Vorlagen-Katalog: 31 Schlüssel, Vorrangkette, Platzhalter, tidy().
      "src/lib/messageTemplates.ts",
      // Erzeugen, Entwerten, Erledigen, Ergebnis, Rückgängig.
      "src/app/actions/reminders.ts",
      // Die Leseseite dazu — sie hatte genau einen Verbraucher, das Panel.
      "src/app/actions/appointmentCascade.ts",
      // Die beiden Oberflächen.
      "src/components/termine/CascadePanel.tsx",
      "src/components/erinnerungen/ErinnerungenBoard.tsx",
    ]) {
      assert.equal(existsSync(pfad(datei)), false, `${datei} ist wieder da`);
    }
  });

  test("keine Datei im Projekt importiert noch aus ihnen", () => {
    // `tsc` fängt das ebenfalls — aber erst, wenn jemand die Datei WIEDER
    // ANLEGT und importiert. Diese Zusicherung greift schon davor: Sie
    // beschreibt, dass hier nichts mehr hingehört.
    const modul = /@\/lib\/(cascadeEngine|reminderCascade|messageTemplates)|@\/app\/actions\/(reminders|appointmentCascade)/;
    for (const datei of [
      "src/app/actions/settingCalls.ts",
      "src/app/actions/closingCalls.ts",
      "src/app/actions/appointments.ts",
      "src/app/actions/revive.ts",
      "src/app/actions/nachfassen.ts",
      "src/app/actions/recycle.ts",
      "src/app/actions/dropout.ts",
      "src/components/scripts/SettingCallEditor.tsx",
      "src/components/closing/ClosingCallEditor.tsx",
      "src/components/nachfassen/NachfassenBoard.tsx",
      "src/components/settings/PipelineSettingsCard.tsx",
      "src/app/(dashboard)/settings/page.tsx",
    ]) {
      assert.doesNotMatch(read(datei), modul, datei);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Das Verschiebe-Kontingent — die eine Zahl, die bleiben MUSSTE
 * ------------------------------------------------------------------ */

describe("Rückbau: das Verschiebe-Kontingent hat den Umzug überlebt", () => {
  // Es hing im Erinnerungs-Modul, gehört aber nicht zur Kaskade: `max_reschedules`
  // trennt „liegt in der Luft" von „ist versorgt" und ist damit die
  // Unterscheidung, auf der die neue Arbeitsfläche steht. Wäre es mit der Datei
  // gefallen, verschwände die Warnung an ZWEI Stellen — und zwar lautlos, denn
  // ein fehlender Hinweis wirft keinen Fehler.
  const ACTION = read("src/app/actions/pipelineSettings.ts");

  test("die Konfiguration wohnt jetzt in ihrer eigenen Datei", () => {
    assert.match(ACTION, /export async function getPipelineSettings\(/);
    assert.match(ACTION, /export async function updatePipelineSettings\(/);
    assert.match(ACTION, /max_reschedules: \{ min: 1, max: 5 \}/);
  });

  test("beide Warner lesen sie weiterhin — Server-Riegel und Leiste", () => {
    // Der eine meldet `warn:'limit'` beim Verschieben, der andere zeigt das
    // Kontingent an der Termin-Karte. Fehlte einer, wäre die Grenze eine
    // Behauptung ohne Anzeige oder eine Anzeige ohne Grenze.
    const postpone = read("src/app/actions/settingCalls.ts");
    assert.match(postpone, /import \{ getPipelineSettings \} from "@\/app\/actions\/pipelineSettings"/);
    assert.match(postpone, /settings\.max_reschedules/);

    const leiste = read("src/components/termine/AppointmentLifecycleBar.tsx");
    assert.match(leiste, /import \{ getPipelineSettings \} from "@\/app\/actions\/pipelineSettings"/);
    assert.match(leiste, /res\.settings\.max_reschedules/);
  });
});

/* ------------------------------------------------------------------ *
 * Das Recycling bleibt — flach
 * ------------------------------------------------------------------ */

describe("Rückbau: der Recycling-Pfad steht, ohne seine Staffelung", () => {
  const KADENZ = read("src/lib/recycleCadence.ts");

  test("Ursprungs-Typ und Grund-Beschriftung bleiben, der Anlass-Satz fällt", () => {
    // Beide Verbliebenen haben echte Verbraucher: den Typ lesen drei
    // Server-Actions und das Nachfassen-Board, die Labels liefern der Ablage
    // die zwei Codes `dead` und `fu_exhausted`, die keine andere Grund-Familie
    // kennt (DROPOUT_REASON_LABELS in lib/dropoutLists.ts).
    assert.match(KADENZ, /export type RecycleOrigin/);
    assert.match(KADENZ, /export const RECYCLE_REASON_LABELS/);
    assert.match(read("src/lib/dropoutLists.ts"), /RECYCLE_REASON_LABELS/);
    // Der Aufhänger füllte {anlass} in einer Vorlage. Es gibt keine Vorlagen —
    // und mit der einen Frist auch keinen grund-spezifischen Anlass mehr. Der
    // Kommentarkopf der Datei nennt ihn weiterhin, gerade um das zu begründen;
    // geprüft wird deshalb der Code.
    assert.doesNotMatch(ohneKommentare(KADENZ), /renderRecycleTemplate|RECYCLE_REASON_HINTS/);
  });

  test("die Wiedervorlage selbst wird weiterhin eingeplant", () => {
    // Die Gegenprobe zum ganzen Block: „flach" heißt nicht „weg". Verschwände
    // der Aufruf, endete jeder terminal negative Lead wieder still — genau der
    // Zustand, gegen den das Recycling einmal gebaut wurde.
    assert.match(read("src/app/actions/settingCalls.ts"), /scheduleRecycle\("setting"/);
    assert.match(read("src/app/actions/closingCalls.ts"), /scheduleRecycle\("closing"/);
  });
});
