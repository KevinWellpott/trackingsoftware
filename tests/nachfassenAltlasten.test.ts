// Der Altlast-Schnitt von /nachfassen.
//
// Am ersten produktiven Tag standen dort 425 Aufgaben — ein Archiv, kein
// Arbeitsvorrat. Der Schnitt nimmt den Bestand heraus, der nie abgearbeitet
// wird, und lässt genau das stehen, wofür die Seite da ist: das frisch
// Überfällige.
//
// Zwei Prüfarten, wie in nachfassenBoard.test.ts begründet:
//  · Die Regel selbst (A/B) ist reine Bibliothek und wird am VERHALTEN geprüft.
//  · Verdrahtung und Beschriftung (C/D) hängen an einer Server-Action mit
//    Supabase-Client und an einem React-Client-Component — beide sind im
//    Node-Test-Runner nicht ladbar, deshalb am QUELLTEXT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  STALE_AFTER_DAYS,
  emptyStaleCounts,
  isStaleDue,
  staleParts,
  staleSourceOf,
  staleTotal,
  type StaleSource,
} from "@/lib/staleTasks";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — dieselbe Begründung wie in
  // nachfassenBoard.test.ts (CRLF unter Windows, Anker mit `\n`).
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Wie oft steht `needle` in `source`? `assert.match` beantwortet das nicht. */
function countOf(source: string, needle: string): number {
  let n = 0;
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const ACTION = read("src/app/actions/nachfassen.ts");
const BOARD = read("src/components/nachfassen/NachfassenBoard.tsx");

const HEUTE = "2026-09-10";

/* ------------------------------------------------------------------ *
 * A — Frisch Fälliges bleibt stehen (die Gegenrichtung)
 * ------------------------------------------------------------------ */

describe("A · Der Schnitt trifft den Bestand, nicht die Arbeit", () => {
  test("was heute fällig ist, bleibt in jeder Quelle sichtbar", () => {
    // Die wichtigste Zusicherung der Datei: Ein Schnitt, der die eigentliche
    // Aufgabe wegnimmt, hätte das Board nicht aufgeräumt, sondern abgeschaltet.
    for (const source of ["telefon", "setting", "closing", "recycling"] as StaleSource[]) {
      assert.equal(isStaleDue(source, HEUTE, HEUTE), false, `${source}: heute fällig ist nie Altlast`);
    }
  });

  test("frisch überfällig bleibt ebenfalls stehen — genau dafür gibt es die Seite", () => {
    // Gestern, vorgestern, letzte Woche: das ist der Zweck eines
    // Nachfass-Boards. Der Rückruf hat die schärfste Grenze (14 Tage) und
    // steht deshalb hier stellvertretend mit einer Woche Verzug.
    assert.equal(isStaleDue("telefon", "2026-09-09", HEUTE), false);
    assert.equal(isStaleDue("telefon", "2026-09-03", HEUTE), false);
    assert.equal(isStaleDue("setting", "2026-08-20", HEUTE), false);
    assert.equal(isStaleDue("closing", "2026-08-20", HEUTE), false);
    assert.equal(isStaleDue("recycling", "2026-07-01", HEUTE), false);
  });

  test("ohne Fälligkeitswert wird nichts ausgeblendet", () => {
    // Wo die Seite über das Alter nichts weiß, behauptet sie auch nichts —
    // dieselbe Regel wie beim fehlenden Pitch-Datum (docs §5.4).
    assert.equal(isStaleDue("telefon", null, HEUTE), false);
    assert.equal(isStaleDue("telefon", undefined, HEUTE), false);
    assert.equal(isStaleDue("telefon", "", HEUTE), false);
  });
});

/* ------------------------------------------------------------------ *
 * B — Die Grenze liegt je Quelle woanders, und zwar genau dort
 * ------------------------------------------------------------------ */

describe("B · Jede Quelle hat ihre eigene Grenze", () => {
  test("der Tag AUF der Grenze zählt noch nicht, der Tag danach schon", () => {
    // Ein Rückruf, der auf den Tag genau 14 Tage alt ist, ist noch Arbeit —
    // erst der 15. macht ihn zur Altlast. Ohne diese Prüfung verschöbe eine
    // spätere „Vereinfachung" von `<` auf `<=` die Grenze lautlos um einen Tag.
    assert.equal(isStaleDue("telefon", "2026-08-27", HEUTE), false, "14 Tage: noch Arbeit");
    assert.equal(isStaleDue("telefon", "2026-08-26", HEUTE), true, "15 Tage: Altlast");
    assert.equal(isStaleDue("setting", "2026-08-11", HEUTE), false, "30 Tage: noch Arbeit");
    assert.equal(isStaleDue("setting", "2026-08-10", HEUTE), true, "31 Tage: Altlast");
    assert.equal(isStaleDue("recycling", "2026-06-12", HEUTE), false, "90 Tage: noch Arbeit");
    assert.equal(isStaleDue("recycling", "2026-06-11", HEUTE), true, "91 Tage: Altlast");
  });

  test("die Kadenzen bleiben gestaffelt: Rückruf < Wiedervorlage < Recycling", () => {
    // Die Reihenfolge IST die Begründung (docs §1): verabredete Uhrzeit,
    // 7-Tage-Wiedervorlage, Wochen-/Monatskadenz. Zieht jemand später eine
    // Zahl über die Nachbarin, fällt diese Zusicherung.
    assert.ok(STALE_AFTER_DAYS.telefon < STALE_AFTER_DAYS.setting);
    assert.equal(STALE_AFTER_DAYS.setting, STALE_AFTER_DAYS.closing);
    assert.ok(STALE_AFTER_DAYS.closing < STALE_AFTER_DAYS.recycling);
  });

  test("ein halbes Jahr alter Bestand fällt überall heraus", () => {
    for (const source of ["telefon", "setting", "closing", "recycling"] as StaleSource[]) {
      assert.equal(isStaleDue(source, "2026-01-05", HEUTE), true, source);
    }
  });

  test("LinkedIn bekommt KEINE Grenze — die Quelle steht nicht mehr auf der Seite", () => {
    // Der Wert kommt aus der RPC weiterhin an; verworfen wird er eine Ebene
    // höher. Eine Grenze für ihn wäre eine Aussage über etwas, das die Seite
    // gar nicht zeigt — und ein zweiter Ort, an dem LinkedIn wieder auftauchen
    // könnte.
    assert.equal(staleSourceOf("linkedin"), null);
    assert.equal(staleSourceOf("unbekannt"), null);
    assert.equal(staleSourceOf("telefon"), "telefon");
  });

  test("die Uhrzeit-Quelle wird auf ihrem Berliner Kalendertag beurteilt", () => {
    // `callback_at` ist ein echter Zeitstempel. Roh verglichen läge ein
    // Rückruf vom 26.08. um 23:30 Berliner Zeit auf dem 26.08. UTC-Datum —
    // dieselbe Falle, gegen die lib/dueState.ts steht.
    assert.equal(isStaleDue("telefon", "2026-08-26T21:30:00.000Z", HEUTE), true);
    assert.equal(isStaleDue("telefon", "2026-08-26T22:30:00.000Z", HEUTE), false, "22:30 UTC = 27.08. in Berlin");
  });
});

/* ------------------------------------------------------------------ *
 * C — Die Zahl wird gezählt und hinausgereicht
 * ------------------------------------------------------------------ */

describe("C · Ausgeblendetes wird gezählt, nicht verschluckt", () => {
  test("die Zähler summieren und beschriften sich selbst", () => {
    const counts = emptyStaleCounts();
    assert.equal(staleTotal(counts), 0);
    assert.deepEqual(staleParts(counts), [], "Ohne Treffer keine Aufzählung.");

    counts.telefon = 1;
    counts.setting = 12;
    counts.recycling = 40;
    assert.equal(staleTotal(counts), 53);

    const parts = staleParts(counts);
    assert.deepEqual(parts, [
      "1 Rückruf (über 14 Tage überfällig)",
      "12 Setting-Wiedervorlagen (über 30 Tage überfällig)",
      "40 Recycling-Versuche (über 90 Tage überfällig)",
    ]);
    // Jeder Teil nennt SEINE Grenze: Sie ist je Quelle verschieden, eine
    // gemeinsame Nennung am Ende läse sich wie eine gemeinsame Zahl.
    for (const part of parts) assert.match(part, /über \d+ Tage überfällig/);
  });

  test("die Server-Action wendet den Schnitt an und zählt ihn getrennt", () => {
    assert.match(ACTION, /hiddenStale: StaleCounts/, "Das Ergebnis muss die Zahl tragen.");
    assert.match(slice(ACTION, "  return {\n    tasks,", "\n}"), /hiddenStale,/);

    // Der Schnitt hängt am Schalter — sonst wäre `?alle=1` wirkungslos.
    assert.match(ACTION, /options\?\.includeOlder \? null : staleSourceOf\(r\.source\)/);
    assert.match(ACTION, /hiddenStale\[staleSource\]\+\+;/);
    assert.match(ACTION, /hiddenStale\.recycling\+\+;/, "Auch das Recycling wird geschnitten.");

    // Gerechnet wird auf dem BERLINER Kalendertag, nicht auf dem des Servers:
    // Auf Vercel läuft der in UTC, und zwischen Mitternacht und 02:00 Berliner
    // Zeit läge `localDateISO()` einen Tag zurück — Badge und Seite fielen
    // dann jede Nacht um die Aufgaben auf der Grenze auseinander.
    assert.match(ACTION, /const staleToday = berlinDateISO\(new Date\(\)\.toISOString\(\)\) \|\| today;/);
    assert.match(ACTION, /isStaleDue\(staleSource, r\.due_at, staleToday\)/);

    // Der frühere Pitch-Schnitt ist mit dem LinkedIn-Zweig verschwunden —
    // samt seiner Zähler. Ein Mechanismus ohne Quelle sieht später aus wie ein
    // Fehler. (Geprüft am CODE, nicht am Fließtext: Der Kommentar am Ergebnis-
    // Typ darf und soll weiter erklären, warum es die beiden nicht mehr gibt.)
    assert.doesNotMatch(ACTION, /let hiddenOlder|hiddenOlder\+\+|let unreadableContacts|unreadableContacts\+\+/);
    assert.doesNotMatch(slice(ACTION, "  return {\n    tasks,", "\n}"), /hiddenOlder|unreadableContacts/);
  });

  test("der Navigations-Zähler fährt DENSELBEN Schnitt", () => {
    // Das Badge zeigte die Zahl, über die sich der Auftraggeber beschwert hat.
    // Es zählt jetzt genau das, was die Seite auch zeigt — über dieselben
    // Funktionen, nicht über eine zweite Kopie der Grenzen.
    const NAV = read("src/lib/navCounts.ts");
    assert.match(NAV, /import \{ isStaleDue, staleSourceOf \} from "@\/lib\/staleTasks";/);
    assert.match(NAV, /if \(r\.source === "linkedin"\) continue;/);
    assert.match(NAV, /if \(stale && isStaleDue\(stale, r\.due_at, today\)\) continue;/);
    assert.match(NAV, /if \(isStaleDue\("recycling", r\.due_at, today\)\) continue;/);

    // Und die exakte Gesamtzahl kommt danach aus der GEFILTERTEN Liste. Der
    // `count` von PostgREST zählt vor dem Fenster und wüsste von den Schnitten
    // nichts; wurde das Fenster abgeschnitten, gibt es lieber kein Badge als
    // eine zu kleine Zahl (docs §5.4: `null` heißt „nicht ermittelbar").
    assert.match(NAV, /if \(tasks\.count > taskRows\.length \|\| recycle\.count > recycleRows\.length\) return null;/);
    assert.match(NAV, /return tally\(rows, rows\.length\);/);
  });

  test("der Schnitt greift VOR dem Rendern des Textes", () => {
    // Eine Aufgabe, die niemand sieht, braucht keine aufgelöste Vorlage. Die
    // Reihenfolge ist zusätzlich die Absicherung dagegen, dass ein späterer
    // Umbau den `continue` hinter den teuren Teil schiebt.
    const schleife = slice(ACTION, "for (const r of visible) {", "let list_id: string | null = null;");
    assert.match(schleife, /continue;/, "Der Altlast-Zweig muss die Zeile überspringen.");
    assert.doesNotMatch(schleife, /renderResolved/, "Vor dem Schnitt darf keine Vorlage aufgelöst werden.");
  });
});

/* ------------------------------------------------------------------ *
 * D — Ausgeblendetes wird GENANNT, samt Ausweg
 * ------------------------------------------------------------------ */

describe("D · Nichts verschwindet lautlos", () => {
  test("das Board nennt die Zahl und bietet denselben Schalter an", () => {
    assert.match(BOARD, /hiddenStale: StaleCounts/);
    // Die Zahl steht sichtbar da (mit korrektem Numerus) …
    assert.match(BOARD, /\{staleHidden\}/);
    assert.match(BOARD, /"lange überfällige Aufgabe" : "lange überfällige Aufgaben"/);
    assert.match(BOARD, /ausgeblendet/);
    // … die Aufschlüsselung erklärt, WELCHE Grenze gegriffen hat …
    assert.match(BOARD, /staleParts\(hiddenStale\)/);
    // … und der Ausweg steht in derselben Zeile.
    const zeile = slice(BOARD, "{staleHidden}", "</div>");
    assert.match(zeile, /href="\?alle=1"/);
  });

  test("mit ?alle=1 sagt die Seite, dass sie jetzt alles zeigt", () => {
    const alles = slice(BOARD, "{showingAll ? (", ") : (");
    assert.match(alles, /Altlasten/, "Der Zustand „alles sichtbar\" muss den Bestand benennen.");
    assert.match(alles, /href="\?"/, "…und den Weg zurück.");
  });

  test("es gibt GENAU EINE Ausblendung auf dieser Seite", () => {
    // Der frühere Pitch-Schnitt und die Zeile „Zugriff auf den Kontakt fehlt"
    // beurteilten einen LinkedIn-Kontakt — die Quelle ist weg, die Zeilen
    // auch. Zwei Erklärungen für eine Ausblendung, von denen eine nichts mehr
    // beschreibt, sind schlimmer als keine.
    assert.doesNotMatch(BOARD, /Pitch &gt; 7 Tage/);
    assert.doesNotMatch(BOARD, /hiddenOlder|unreadableContacts/);
    assert.equal(countOf(BOARD, "ausgeblendet"), 1, "Nur EINE Ausblendungs-Zeile.");
  });
});
