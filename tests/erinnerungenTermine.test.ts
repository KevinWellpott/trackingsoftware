// Zwei Lücken, die keine Prüfung als Fehler meldet.
//
// Beide sind der typische Rückstand eines Abbruchs: gebaut, aber nicht
// angeschlossen. `tsc` schweigt (noUnusedLocals ist aus), die Tests waren grün,
// und im Diff sieht beides fertig aus.
//
//  · Die Chip-Legende auf /termine war vollständig geschrieben und wurde nie
//    gerendert — für den Nutzer hatte sich damit nichts geändert.
//  · Die Klartext-Heuristik der Fehleranzeige und die Sperre gegen die
//    Zuweisung „Niemand" sind je für sich richtig; zusammen verschluckte die
//    eine die Meldung der anderen, weil sie mit einem Anführungszeichen
//    beginnt.
//
// Geprüft wird am QUELLTEXT — beides hängt an React-Client-Komponenten bzw. an
// einer Server-Action mit Supabase-Client, die der Node-Test-Runner nicht laden
// kann (kein JSX-Transform). Dieselbe Bauart wie nachfassenBoard.test.ts. Die
// Fehleranzeige wird dabei nicht NACHGEBAUT, sondern mit ihren echten, aus dem
// Quelltext gezogenen Regeln auf die echte Meldung angewandt: eine Kopie der
// Regel bewiese nur, dass die Kopie stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const TERMINE = read("src/app/(dashboard)/termine/page.tsx");
const BOARD = read("src/components/erinnerungen/ErinnerungenBoard.tsx");
const ASSIGNEES = read("src/app/actions/assignees.ts");

/* ------------------------------------------------------------------ *
 * A — Eine Legende, die niemand sieht, ist keine
 * ------------------------------------------------------------------ */

describe("A · Die Chip-Legende steht auf der Seite, nicht nur in der Datei", () => {
  test("ChipLegende wird gerendert und nicht nur definiert", () => {
    // Die Gegenprobe zum Abbruch-Stand: Dort kam `ChipLegende` genau einmal
    // vor — in ihrer eigenen `function`-Zeile. Ein Bauteil ohne Aufrufer ist
    // für den Nutzer identisch mit einem, das es nicht gibt.
    const seite = slice(TERMINE, "export default async function TerminePage", "</div>\n  );");
    assert.match(seite, /<ChipLegende \/>/, "Die Legende muss im JSX-Baum der Seite auftauchen.");
    assert.match(seite, /<InfoPopover/, "Sie hängt hinter dem Info-Icon, nicht dauerhaft unter dem Kopf.");
  });

  test("die Muster-Chips tragen die echten Attribute des Kalenders", () => {
    // Ein nachgebautes Kästchen liefe beim nächsten Farbwechsel auseinander.
    // Die vier Aussagen der Legende hängen an genau diesen `data-*`-Namen, aus
    // denen globals.css §7 auch die echten Chips baut.
    const chip = slice(TERMINE, "function LegendChip(", "function LegendRow(");
    assert.match(chip, /className="cal-event"/);
    for (const attribut of ["data-kind", "data-tone", "data-dashed", "data-dimmed"]) {
      assert.match(chip, new RegExp(attribut), `${attribut} fehlt — die Legende erklärt sonst ein anderes System.`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * B — Die Begründung der „Niemand"-Sperre kommt beim Nutzer an
 * ------------------------------------------------------------------ */

/** Ein Regex-Literal aus dem Quelltext ziehen und wirklich benutzen. */
function regexAus(source: string, name: string): RegExp {
  const treffer = source.match(new RegExp(`const ${name} =\\s*(/.*/[a-z]*);`));
  assert.ok(treffer, `Regex-Literal ${name} nicht gefunden`);
  const literal = treffer[1];
  const ende = literal.lastIndexOf("/");
  return new RegExp(literal.slice(1, ende), literal.slice(ende + 1));
}

/** Die Meldung der Sperre — aus den drei aneinandergehängten Literalen. */
function niemandMeldung(): string {
  const block = slice(ASSIGNEES, '"\u201eNiemand', "};");
  const teile = [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(teile.length >= 1, "Die Meldung der „Niemand\"-Sperre steht nicht mehr in assignees.ts.");
  return teile.join("");
}

describe("B · Die Sperre gegen „Niemand\" erklärt sich, statt zum Wiederholen zu raten", () => {
  const meldung = niemandMeldung();
  const zitatPrefix = regexAus(BOARD, "ZITAT_PREFIX");
  const technical = regexAus(BOARD, "technical");

  test("die Meldung beginnt mit einem Zitat — genau daran scheiterte sie", () => {
    // Die Gegenprobe in einer Zeile: Ohne das Abstreifen führender
    // Anführungszeichen fällt dieser Satz durch die Klartext-Prüfung, und der
    // Nutzer liest „bitte noch einmal versuchen" — den einen Rat, der hier
    // garantiert nicht hilft, weil die Zuweisung gar nicht gelingen kann.
    assert.doesNotMatch(meldung, /^[A-ZÄÖÜ]/);
    assert.match(meldung, zitatPrefix);
  });

  test("mit den echten Regeln der Fehleranzeige gilt sie als Klartext", () => {
    const ohneZitat = meldung.replace(zitatPrefix, "");
    assert.match(ohneZitat, /^[A-ZÄÖÜ]/, "Großbuchstabe vorn");
    assert.match(meldung, /[.!?]$/, "Satzzeichen hinten");
    assert.doesNotMatch(meldung, technical, "kein Datenbank-Vokabular");
  });

  test("und die Anzeige wendet das Abstreifen auch wirklich an", () => {
    // Sonst stimmt oben die Rechnung und unten die Karte trotzdem nicht.
    const mapper = slice(BOARD, "function friendlyError(", "const ghostBtn");
    assert.match(mapper, /\/\^\[A-ZÄÖÜ\]\/\.test\(text\.replace\(ZITAT_PREFIX, ""\)\)/);
  });

  test("der Ausweg steht im Satz, nicht nur im Tooltip", () => {
    // Eine Fehlermeldung ohne nächsten Schritt ist eine Sackgasse: Es gibt
    // keinen zweiten Versuch, der hier zum Ziel führt.
    assert.match(meldung, /Person auswählen/);
  });

  test("Gegenprobe: eine rohe PostgREST-Meldung fällt weiterhin durch", () => {
    // Die Lockerung darf das eigentliche Ziel nicht aufweichen — englischer
    // Datenbank-Text gehört in den `title`, nicht auf die Karte.
    const roh = 'new row violates row-level security policy for table "reminder_touches"';
    const klartext =
      /^[A-ZÄÖÜ]/.test(roh.replace(zitatPrefix, "")) && /[.!?]$/.test(roh) && !technical.test(roh);
    assert.equal(klartext, false);
  });
});

/* ------------------------------------------------------------------ *
 * C — Die Sperre selbst bleibt bestehen
 * ------------------------------------------------------------------ */

describe("C · „Niemand\" wird abgelehnt, statt die Erinnerungen still zu entwerten", () => {
  test("der Ersteller wird auf Mitgliedschaft geprüft, bevor zurückgefallen wird", () => {
    // Ohne diese Prüfung setzt `reminder_touches_ws_guard` (Migration 0032)
    // `superseded_at` — lautlos, mit Erfolgsmeldung, und erst an der leeren
    // /erinnerungen-Seite zu bemerken.
    const zweig = slice(ASSIGNEES, "} else if (row.created_by_user_id) {", "const table =");
    assert.match(zweig, /isMember\(supabase, access\.workspace_id, row\.created_by_user_id\)/);
    assert.match(zweig, /return \{\s*error:/, "Der Fall wird abgelehnt, nicht halb ausgeführt.");
  });
});
