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
 * B — Was hier stand, hing am Erinnerungs-Board
 * ------------------------------------------------------------------ */

// ── GEÄNDERTER GEGENSTAND, und zwar aus dem Rückbau heraus ─────────────────
// HIER STAND ein Block über die MELDUNG der „Niemand"-Sperre: Sie beginnt mit
// einem Zitat, und die Klartext-Heuristik des Erinnerungs-Boards (`ZITAT_PREFIX`,
// `technical`, `friendlyError`) verschluckte sie deshalb — der Nutzer las
// „bitte noch einmal versuchen", den einen Rat, der hier garantiert nicht hilft.
//
// Die Heuristik ist mit dem Board gelöscht; es gibt keine Anzeige mehr, die
// diesen Satz nach ihren Regeln beurteilt. (Das Nachfassen-Board hat eine
// eigene Fehleranzeige, aber nach einer Positivliste statt nach Merkmalen —
// dieselbe Falle kann dort nicht entstehen.) Der Befund bleibt trotzdem
// lehrreich: Eine Meldung wurde nicht falsch, weil sie falsch war, sondern weil
// eine zweite Stelle sie nach Merkmalen beurteilte.
//
/* ------------------------------------------------------------------ *
 * C — Die Sperre ist gefallen, die Org-Grenze steht
 * ------------------------------------------------------------------ */

// ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ──────────────────
// HIER STAND: „„Niemand" wird abgelehnt, statt die Erinnerungen still zu
// entwerten" — geprüft am Zweig `} else if (row.created_by_user_id) {` in
// `setAssignee`.
//
// Der Zweig lehnte „Niemand" ab, sobald der Ersteller die Organisation
// verlassen hatte, weil der Termin danach über `personOf()` auf ihn
// zurückfiel und `reminder_touches_ws_guard` (0032) die offenen Erinnerungen
// des Termins dabei lautlos entwertet hätte. Die Begründung ist mit dem
// Rückbau verschwunden: Es gibt keine Erinnerungen mehr, `setAssignee` fasst
// `reminder_touches` nicht mehr an, und /erinnerungen leitet nur noch weiter.
//
// Stehen geblieben wäre eine Sperre ohne Grund — und zwar eine teure: Ein
// Owner konnte ausgerechnet den Termin eines Ausgezogenen nicht mehr
// freigeben, mit einer Meldung, die auf Erinnerungen verwies, die es nicht
// gibt. Die Zusicherung wird deshalb umgedreht: Sie hält jetzt fest, dass
// „Niemand" durchgeht UND dass die eine Prüfung, die einen Grund hat, bleibt.

describe("C · „Niemand\" geht durch, eine fremde Person nicht", () => {
  test("nur eine GESETZTE Zuweisung wird auf Mitgliedschaft geprüft", () => {
    // Die Org-Grenze ist der Grund, warum `isMember` überhaupt hier steht: Der
    // DB-Guard aus 0028 greift nur beim Org-Umzug, eine Zuweisung über die
    // Grenze wäre danach für niemanden auffindbar (docs §8).
    const body = slice(ASSIGNEES, "export async function setAssignee(", "const table =");
    assert.match(body, /if \(userId && !\(await isMember\(supabase, access\.workspace_id, userId\)\)\)/);
  });

  test("der Ersteller wird nicht mehr geprüft — es gibt nichts mehr zu schützen", () => {
    // `assigned_user_id = null` verletzt keine Invariante: §8 prüft nur, dass
    // eine gesetzte Zuweisung auf ein Mitglied zeigt.
    assert.doesNotMatch(ASSIGNEES, /row\.created_by_user_id/);
    assert.doesNotMatch(ASSIGNEES, /Die offenen Erinnerungen würden/);
  });

  test("und die Zuweisung fasst `reminder_touches` gar nicht mehr an", () => {
    // Der zweite Roundtrip je Zuweisung, samt Revalidierung einer Route, die
    // nur noch weiterleitet. Die Tabelle bleibt stehen (Muster
    // `call_assignees`, docs §3) — sie hat nur keinen Leser mehr.
    //
    // Gesucht wird der ZUGRIFF, nicht das Wort: Die Datei nennt die Tabelle im
    // Kommentar weiter beim Namen, weil sie dort erklärt, was fortgefallen ist.
    assert.doesNotMatch(ASSIGNEES, /\.from\("reminder_touches"\)/);
    assert.doesNotMatch(ASSIGNEES, /^\s*revalidatePath\("\/erinnerungen"/m);
  });
});
