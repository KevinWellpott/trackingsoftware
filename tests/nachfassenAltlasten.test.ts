// Der Altlast-Schnitt von /nachfassen.
//
// Am ersten produktiven Tag standen dort 425 Aufgaben — ein Archiv, kein
// Arbeitsvorrat. Der Schnitt nimmt den Bestand heraus, der nie abgearbeitet
// wird, und lässt genau das stehen, wofür die Seite da ist: das frisch
// Überfällige.
//
// WAS SICH MIT DEM RÜCKBAU GEÄNDERT HAT: Die Seite trägt nur noch EINE Quelle,
// das Recycling. Aus der Aufschlüsselung je Quelle (`StaleCounts`,
// `staleParts`, `staleTotal`) ist damit eine Zahl geworden — sie hatte genau
// einen Aufrufer, und der zeigt drei der vier Quellen nicht mehr. Geprüft wird
// hier deshalb die Regel selbst und ihre Verdrahtung, nicht mehr die
// Beschriftung einer Aufzählung, die es nicht gibt.
//
// Die Grenzen der drei anderen Quellen stehen weiterhin in der Bibliothek und
// werden hier weiterhin geprüft: Der Navigations-Zähler (lib/navCounts.ts)
// liest sie noch, solange er beide Nachfassen-RPCs zählt.
//
// Zwei Prüfarten, wie in tests/rueckbauNachfassen.test.ts begründet:
//  · Die Regel selbst (A/B) ist reine Bibliothek und wird am VERHALTEN geprüft.
//  · Verdrahtung und Beschriftung (C/D) hängen an einer Server-Action mit
//    Supabase-Client und an einem React-Client-Component — beide sind im
//    Node-Test-Runner nicht ladbar, deshalb am QUELLTEXT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { STALE_AFTER_DAYS, isStaleDue, staleSourceOf, type StaleSource } from "@/lib/staleTasks";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
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
    // Gestern, vorgestern, letzten Monat: das ist der Zweck einer
    // Wiedervorlage. Beim Recycling liegt die Grenze bei einem Vierteljahr,
    // ein Verzug von zehn Wochen ist dort noch Arbeit.
    assert.equal(isStaleDue("recycling", "2026-07-01", HEUTE), false);
    assert.equal(isStaleDue("telefon", "2026-09-09", HEUTE), false);
    assert.equal(isStaleDue("setting", "2026-08-20", HEUTE), false);
    assert.equal(isStaleDue("closing", "2026-08-20", HEUTE), false);
  });

  test("ohne Fälligkeitswert wird nichts ausgeblendet", () => {
    // Wo die Seite über das Alter nichts weiß, behauptet sie auch nichts
    // (docs §5.4).
    assert.equal(isStaleDue("recycling", null, HEUTE), false);
    assert.equal(isStaleDue("recycling", undefined, HEUTE), false);
    assert.equal(isStaleDue("recycling", "", HEUTE), false);
  });
});

/* ------------------------------------------------------------------ *
 * B — Die Grenze liegt je Quelle woanders, und zwar genau dort
 * ------------------------------------------------------------------ */

describe("B · Jede Quelle hat ihre eigene Grenze", () => {
  test("der Tag AUF der Grenze zählt noch nicht, der Tag danach schon", () => {
    // Ein Versuch, der auf den Tag genau 90 Tage alt ist, ist noch Arbeit —
    // erst der 91. macht ihn zur Altlast. Ohne diese Prüfung verschöbe eine
    // spätere „Vereinfachung" von `<` auf `<=` die Grenze lautlos um einen Tag.
    assert.equal(isStaleDue("recycling", "2026-06-12", HEUTE), false, "90 Tage: noch Arbeit");
    assert.equal(isStaleDue("recycling", "2026-06-11", HEUTE), true, "91 Tage: Altlast");
    assert.equal(isStaleDue("telefon", "2026-08-27", HEUTE), false, "14 Tage: noch Arbeit");
    assert.equal(isStaleDue("telefon", "2026-08-26", HEUTE), true, "15 Tage: Altlast");
    assert.equal(isStaleDue("setting", "2026-08-11", HEUTE), false, "30 Tage: noch Arbeit");
    assert.equal(isStaleDue("setting", "2026-08-10", HEUTE), true, "31 Tage: Altlast");
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

  test("LinkedIn bekommt KEINE Grenze — die Quelle steht auf keiner Seite", () => {
    // Der Wert kommt aus `nachfassen_tasks` weiterhin an; angezeigt wird er
    // nirgends. Eine Grenze für ihn wäre eine Aussage über etwas, das niemand
    // sieht — und ein zweiter Ort, an dem er wieder auftauchen könnte.
    assert.equal(staleSourceOf("linkedin"), null);
    assert.equal(staleSourceOf("unbekannt"), null);
    assert.equal(staleSourceOf("recycling"), "recycling");
  });

  test("ein Zeitstempel wird auf seinem Berliner Kalendertag beurteilt", () => {
    // `next_recycle_at` ist zwar ein Tagesdatum, `callback_at` aber ein echter
    // Zeitstempel. Roh verglichen läge ein Wert vom 26.08. um 23:30 Berliner
    // Zeit auf dem 26.08. UTC-Datum — dieselbe Falle, gegen die
    // lib/dueState.ts steht.
    assert.equal(isStaleDue("telefon", "2026-08-26T21:30:00.000Z", HEUTE), true);
    assert.equal(isStaleDue("telefon", "2026-08-26T22:30:00.000Z", HEUTE), false, "22:30 UTC = 27.08. in Berlin");
  });
});

/* ------------------------------------------------------------------ *
 * C — Die Zahl wird gezählt und hinausgereicht
 * ------------------------------------------------------------------ */

describe("C · Ausgeblendetes wird gezählt, nicht verschluckt", () => {
  test("die Server-Action wendet den Schnitt an und zählt ihn getrennt", () => {
    // Aus dem Record je Quelle ist eine Zahl geworden — es gibt nur noch eine
    // Quelle, und eine Aufzählung mit einem Posten ist keine.
    assert.match(ACTION, /hiddenStale: number/, "Das Ergebnis muss die Zahl tragen.");
    assert.match(ACTION, /return \{ tasks, hiddenStale, recyclingAvailable: recycle\.available \};/);

    // Der Schnitt hängt am Schalter — sonst wäre `?alle=1` wirkungslos.
    assert.match(ACTION, /if \(options\?\.includeOlder\) return true;/);
    assert.match(ACTION, /if \(!isStaleDue\("recycling", r\.due_at, staleToday\)\) return true;/);
    assert.match(ACTION, /hiddenStale\+\+;/);

    // Gerechnet wird auf dem BERLINER Kalendertag, nicht auf dem des Servers:
    // Auf Vercel läuft der in UTC, und zwischen Mitternacht und 02:00 Berliner
    // Zeit läge `localDateISO()` einen Tag zurück — Badge und Seite fielen
    // dann jede Nacht um die Aufgaben auf der Grenze auseinander.
    assert.match(ACTION, /const staleToday = berlinDateISO\(new Date\(\)\.toISOString\(\)\) \|\| localDateISO\(\);/);

    // Der frühere Pitch-Schnitt und die Zähler je Quelle sind mit ihren
    // Quellen verschwunden. Ein Mechanismus ohne Quelle sieht später aus wie
    // ein Fehler. (Geprüft am CODE, nicht am Fließtext: Die Kommentare dürfen
    // weiter erklären, warum es die beiden nicht mehr gibt.)
    assert.doesNotMatch(ACTION, /hiddenOlder\+\+|unreadableContacts\+\+|emptyStaleCounts\(\)/);
  });

  test("der Schnitt greift VOR dem Nachschlag auf die Liste", () => {
    // Eine Aufgabe, die niemand sieht, braucht auch keinen Listenbezug für
    // ihren Sprung-Link. Die Reihenfolge ist zusätzlich die Absicherung
    // dagegen, dass ein späterer Umbau den Filter hinter den teuren Teil
    // schiebt.
    const schnitt = ACTION.indexOf("const due = recycle.tasks.filter(");
    const nachschlag = ACTION.indexOf("const contactIds = [");
    assert.notEqual(schnitt, -1);
    assert.notEqual(nachschlag, -1);
    assert.ok(schnitt < nachschlag, "Erst schneiden, dann nachschlagen.");
  });

  test("der Navigations-Zähler fährt DENSELBEN Schnitt", () => {
    // Das Badge zeigte einmal die Zahl, über die sich der Auftraggeber
    // beschwert hat. Es schneidet über dieselben Funktionen wie die Seite,
    // nicht über eine zweite Kopie der Grenzen.
    //
    // ACHTUNG, offene Baustelle: Der Zähler liest weiterhin BEIDE
    // Nachfassen-RPCs, die Seite nur noch `recycle_tasks`. Er zählt damit
    // gerade mehr, als die Seite zeigt — das wird zentral nachgezogen. Diese
    // Zusicherung hält nur fest, dass er die Grenzen nicht selbst nachbaut.
    const NAV = read("src/lib/navCounts.ts");
    assert.match(NAV, /import \{ isStaleDue, staleSourceOf \} from "@\/lib\/staleTasks";/);
    assert.match(NAV, /if \(isStaleDue\("recycling", r\.due_at, today\)\) continue;/);

    // Und die exakte Gesamtzahl kommt aus der GEFILTERTEN Liste. Der `count`
    // von PostgREST zählt vor dem Fenster und wüsste von den Schnitten nichts;
    // wurde das Fenster abgeschnitten, gibt es lieber kein Badge als eine zu
    // kleine Zahl (docs §5.4: `null` heißt „nicht ermittelbar").
    assert.match(NAV, /return tally\(rows, rows\.length\);/);
  });
});

/* ------------------------------------------------------------------ *
 * D — Ausgeblendetes wird GENANNT, samt Ausweg
 * ------------------------------------------------------------------ */

describe("D · Nichts verschwindet lautlos", () => {
  test("das Board nennt die Zahl, die Grenze und bietet den Schalter an", () => {
    assert.match(BOARD, /hiddenStale: number/);
    // Die Zahl steht sichtbar da (mit korrektem Numerus) …
    assert.match(BOARD, /\{hiddenStale\}/);
    assert.match(BOARD, /"lange überfälliger Versuch" : "lange überfällige Versuche"/);
    assert.match(BOARD, /ausgeblendet/);
    // … die Grenze steht daneben und kommt aus der Bibliothek, nicht als
    // abgetippte 90 …
    assert.match(BOARD, /über \{STALE_AFTER_DAYS\.recycling\} Tage überfällig/);
    // … und der Ausweg steht in derselben Zeile.
    const zeile = slice(BOARD, "{hiddenStale}", "</div>");
    assert.match(zeile, /href="\?alle=1"/);
  });

  test("mit ?alle=1 sagt die Seite, dass sie jetzt alles zeigt", () => {
    const alles = slice(BOARD, "{showingAll ? (", ") : hiddenStale > 0 ? (");
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
