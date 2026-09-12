// Der Altlasten-Schnitt ist GEFALLEN — und diese Datei hält fest, dass er nicht
// zurückkommt.
//
// ── WARUM DIE ERWARTUNG GEDREHT WURDE ──────────────────────────────────────
// Hier stand `tests/nachfassenAltlasten.test.ts` und prüfte das Gegenteil: dass
// lange überfällige Zeilen ausgeblendet werden (30 Tage bei Setting- und
// Closing-Wiedervorlagen, 14 beim Telefon-Rückruf, 90 beim Recycling). Die
// Begründung war nicht erfunden — eine Liste mit zweihundert gleichzeitig
// goldenen Zeilen ist keine Arbeitsliste, und `/nachfassen` stand am ersten
// produktiven Tag bei 425 Aufgaben.
//
// Der Auftraggeber hat trotzdem anders entschieden, und zwar wörtlich nach
// seinem Satz: „Eine Liste pro Person. Wer offen ist, wird JEDEN TAG
// kontaktiert. Ohne Ausnahme, ohne Intervall-Logik. Er verschwindet von der
// Liste, wenn er entweder neu terminiert ist oder als tot markiert wird. Nichts
// anderes nimmt ihn da runter."
//
// „Nichts anderes" schließt einen Altersschnitt ein. Die Gegenrede („er ist kein
// Intervall, er löst sich mit jedem Genervt-Klick selbst auf") war ein Argument
// für eine dritte Bedingung — und genau die dritte Bedingung ist das, was der
// Satz ausschließt. Eine Zeile verschwand damit aus einem Grund, den die Ansage
// nicht kennt, und der Nutzer musste einen Schalter finden, um seine eigene
// Arbeit wiederzusehen.
//
// ── WAS DAMIT AUSDRÜCKLICH NICHT GEFALLEN IST ──────────────────────────────
// Die Personen- und Organisationsfilterung, der Ausschnitt „Zu tun · Verlegt ·
// Alle" und die Gold-Regel selbst. Es ging ausschließlich um die Altersgrenze —
// deshalb steht in Abschnitt D die Gegenprobe, dass die drei anderen Schnitte
// noch da sind.
//
// Zwei Prüfarten, wie überall im Haus: Was eine Funktion entscheidet, wird am
// VERHALTEN geprüft (der Navigations-Zähler, mit einer Supabase-Attrappe). Was
// eine React-Komponente verdrahtet, wird am QUELLTEXT geprüft — der Runner
// (`node --experimental-strip-types`) lädt kein `.tsx`, und eine Attrappe bewiese
// nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import type { AccessContext } from "@/lib/access";
import { loadNavCounts } from "@/lib/navCounts";

function pfad(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(pfad(relative), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Die Datei OHNE Kommentare — für jede „das steht hier nicht mehr"-Prüfung an
 * einem BEZEICHNER.
 *
 * Die Trennung ist Absicht und dieselbe wie überall im Haus: Ein gestrichener
 * Mechanismus, dessen Begründung nur im Commit steht, wird beim nächsten
 * „aber zweihundert goldene Zeilen …" wieder eingebaut — die Kommentare MÜSSEN
 * den Parameter und die Funktion beim Namen nennen dürfen. Für sichtbaren
 * OBERFLÄCHENTEXT gilt das nicht: Den prüfen die Tests unten an der rohen
 * Datei, weil ein Kommentar ihn nicht zu zitieren braucht.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const BOARD = read("src/components/nachfassen/NachfassenBoard.tsx");
const SEITE = read("src/app/(dashboard)/nachfassen/page.tsx");
const ACTION = read("src/app/actions/nachfassen.ts");
const TERMINE = read("src/components/termine/TermineBoard.tsx");
const NAV = read("src/lib/navCounts.ts");

/* ------------------------------------------------------------------ *
 * Attrappe für den Navigations-Zähler (Bauart aus tests/navCounts.test.ts)
 * ------------------------------------------------------------------ */

type Antwort = { data?: unknown[] | null; error?: unknown; count?: number | null };

function abfrage(antwort: Antwort) {
  const api: Record<string, unknown> = {};
  for (const m of ["select", "order", "range", "limit", "eq", "is", "in", "not"]) api[m] = () => api;
  api.then = (erfuellen: (v: unknown) => void) => {
    erfuellen({ data: null, error: null, count: null, ...antwort });
  };
  return api;
}

function supabase(antwort: Antwort) {
  return {
    rpc: () => abfrage(antwort),
    from: () => abfrage(antwort),
  } as unknown as Parameters<typeof loadNavCounts>[0];
}

function zugriff(): AccessContext {
  return {
    workspace_id: "ws-1",
    user: { id: "u-ich" },
    effective_user_id: null,
  } as unknown as AccessContext;
}

/** 8.9.2026, 10:00 Berliner Wandzeit (Sommerzeit, UTC+2). */
const JETZT = Date.parse("2026-09-08T08:00:00Z");

/* ------------------------------------------------------------------ *
 * A — Die Grenze selbst ist weg
 * ------------------------------------------------------------------ */

describe("A · Es gibt keine Altersgrenze mehr", () => {
  test("die Bibliothek ist gelöscht — samt der Zahlen, die dort standen", () => {
    // `staleTasks.ts` trug NUR den Schnitt: die vier Grenzen, die Prüfung und
    // den Anker `letztesLebenszeichen()`, der sein Intervall-Argument entschärfen
    // sollte. Ohne Schnitt hat keiner der drei einen Leser. Eine Bibliothek ohne
    // Verwender sieht beim nächsten Lesen wie geltende Konvention aus — und ist
    // die Vorlage, aus der jemand den Schnitt wieder einbaut.
    assert.equal(existsSync(pfad("src/lib/staleTasks.ts")), false, "staleTasks.ts ist wieder da");
  });

  test("keine Datei zeigt mehr darauf", () => {
    // Die Gegenprobe zur gelöschten Datei: Ein zurückgebliebener Import wäre
    // ein Compile-Fehler, eine zurückgebliebene abgeschriebene 30 dagegen
    // nicht. Gesucht wird deshalb nach dem Namen, nicht nach dem Import.
    const treffer: string[] = [];
    const wurzeln = ["src", "tests"];
    const gehe = (verzeichnis: string) => {
      for (const eintrag of readdirSync(pfad(verzeichnis))) {
        const rel = `${verzeichnis}/${eintrag}`;
        if (statSync(pfad(rel)).isDirectory()) {
          gehe(rel);
          continue;
        }
        if (!/\.tsx?$/.test(eintrag)) continue;
        // Diese Datei selbst spricht naturgemäß über die entfernten Namen.
        if (rel.endsWith("altlastenSchnittGefallen.test.ts")) continue;
        // Ohne Kommentare: Erklärungen dürfen die gestrichenen Namen nennen,
        // Code nicht.
        if (/staleTasks|isStaleDue|STALE_AFTER_DAYS|letztesLebenszeichen/.test(code(read(rel)))) treffer.push(rel);
      }
    };
    for (const w of wurzeln) gehe(w);
    assert.deepEqual(treffer, [], `Reste des Altlasten-Schnitts: ${treffer.join(", ")}`);
  });
});

/* ------------------------------------------------------------------ *
 * B — Der Zähler zählt wieder alles, was die Seite zeigt
 * ------------------------------------------------------------------ */

describe("B · Das Badge zählt, was die Liste zeigt", () => {
  test("ein uralter Recycling-Versuch zählt wieder mit", async (t) => {
    // DER KERN. Diese Fälligkeit vom November 2025 lag über 90 Tage zurück und
    // fiel damit aus Badge UND Board. Sie ist jetzt eine Aufgabe wie jede
    // andere — überfällig, aber auf der Liste.
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase({
        data: [{ due_at: "2025-11-01T00:00:00+00:00" }, { due_at: "2026-08-20T00:00:00+00:00" }],
        count: 2,
      }),
      zugriff(),
    );

    assert.deepEqual(counts.nachfassen, { total: 2, overdue: 2 });
  });

  test("auch oberhalb des 500er-Fensters gibt es wieder eine Zahl", async (t) => {
    // Der `null`-Fall „das Fenster wurde abgeschnitten" hing AM SCHNITT: `count`
    // zählt vor dem Fenster, der Schnitt wirkte erst danach — die gefilterte
    // Gesamtzahl war oberhalb des Deckels nicht mehr zu ermitteln. Ohne Schnitt
    // ist `count` die Wahrheit, und das Badge kann sie wieder nennen. Gedeckelt
    // bleibt allein der Überfällig-Anteil (§5.4).
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase({ data: [{ due_at: "2026-09-08T00:00:00+00:00" }], count: 812 }),
      zugriff(),
    );

    assert.deepEqual(counts.nachfassen, { total: 812, overdue: 0 });
  });

  test("GEGENRICHTUNG: eine fehlende Gesamtzahl bleibt „kein Badge“, keine 0", async (t) => {
    // Diese Ehrlichkeitsregel hat mit dem Schnitt nichts zu tun und darf mit ihm
    // nicht mitfallen: `(count ?? 0)` verbuchte fällige Aufgaben stillschweigend
    // als „nichts zu tun" (docs §5.4).
    t.mock.timers.enable({ apis: ["Date"], now: JETZT });
    const counts = await loadNavCounts(
      supabase({ data: [{ due_at: "2026-09-08" }, { due_at: "2026-09-08" }], count: null }),
      zugriff(),
    );

    assert.equal(counts.nachfassen, null);
  });

  test("der Zähler filtert überhaupt nichts mehr heraus", () => {
    // Am Quelltext, weil eine Attrappe nur die geprüfte Antwort abdeckt: Im
    // Zähler steht kein `continue` mehr, das eine Zeile verwirft, und die
    // Gesamtzahl kommt aus `count` statt aus einer selbst gefilterten Liste.
    assert.doesNotMatch(NAV, /continue;/);
    assert.match(NAV, /return tally\(rows\.map\(\(r\) => r\.due_at\), recycle\.count\);/);
  });
});

/* ------------------------------------------------------------------ *
 * C — Die Oberfläche versteckt nichts und braucht keinen Schalter
 * ------------------------------------------------------------------ */

describe("C · Kein Hinweis, kein Schalter, kein Parameter", () => {
  test("/nachfassen blendet nichts mehr aus", () => {
    // Die Hinweiszeile war die BEDINGUNG, unter der ein Schnitt vertretbar war
    // (Zahl, Grenze, Ausweg in einer Zeile). Ohne Schnitt gibt es nichts zu
    // rechtfertigen — und eine Zeile, die „0 ausgeblendet" verschweigt, aber im
    // Code steht, wäre der Rest, aus dem der Schnitt zurückkehrt.
    // Oberflächentext an der ROHEN Datei: Er muss restlos weg sein, ein
    // Kommentar braucht ihn nicht zu zitieren.
    assert.doesNotMatch(BOARD, /ausgeblendet/);
    assert.doesNotMatch(BOARD, /Trotzdem anzeigen/);
    // Bezeichner am CODE: Die Erklärung darüber darf sagen, was gefallen ist.
    assert.doesNotMatch(code(BOARD), /hiddenStale|showingAll/);
    assert.doesNotMatch(code(BOARD), /alle=1/);
  });

  test("… und die Seite kennt den Parameter nicht mehr", () => {
    assert.doesNotMatch(code(SEITE), /alle=1|includeOlder|showingAll|searchParams/);
    // Die Aufgaben kommen ohne Schalter — die Signatur trägt keine Optionen mehr.
    assert.match(SEITE, /await getNachfassenTasks\(\)/);
    assert.match(ACTION, /export async function getNachfassenTasks\(\): Promise<NachfassenResult>/);
  });

  test("/termine blendet weder in der Liste noch bei den Rückrufen etwas aus", () => {
    // Auch hier zweigeteilt: Der sichtbare Text ist restlos weg, die Bezeichner
    // dürfen im Kommentar weiterleben, der den Rückbau begründet.
    assert.doesNotMatch(TERMINE, /Trotzdem anzeigen/);
    assert.doesNotMatch(TERMINE, /Nur aktuelle Arbeit/);
    assert.doesNotMatch(code(TERMINE), /altlasten/i);
    assert.doesNotMatch(code(TERMINE), /versteckt/);
    // Die Liste ist wörtlich die gefilterte Menge — kein zweiter Durchlauf, der
    // noch etwas herausnimmt.
    assert.match(TERMINE, /events=\{filtered\}/);
    assert.match(TERMINE, /ohneTermin=\{ohneTermin\}/);
    assert.match(TERMINE, /aufgaben=\{rueckrufeGefiltert\}/);
  });
});

/* ------------------------------------------------------------------ *
 * D — Gegenprobe: was NICHT gefallen ist
 * ------------------------------------------------------------------ */

describe("D · Die drei anderen Schnitte stehen weiter", () => {
  test("die Personenachse bleibt — „eine Liste pro Person“", () => {
    // Der Auftraggeber hat den ALTERS-Schnitt gestrichen, nicht die Liste je
    // Person. Fiele sie mit, stünde dort der Bestand des ganzen Teams.
    assert.match(TERMINE, /const matchesWer = useCallback\(/);
    assert.match(TERMINE, /e\.assignee\?\.user_id === scopeUserId/);
    assert.match(TERMINE, /r\.ownerUserId !== scopeUserId/);
  });

  test("der Ausschnitt „Zu tun · Termin steht · Alle“ bleibt", () => {
    // Er schneidet nach ZUSTAND, nicht nach Zeit — das ist genau die
    // Unterscheidung aus dem Satz des Auftraggebers („neu terminiert oder tot").
    //
    // Der mittlere heißt seit der Erinnerungs-Runde „Termin steht" (der
    // URL-Wert bleibt `verlegt`), und der erste hat eine zweite Tür bekommen:
    // `istZuTun` = Arbeitsmenge ODER offene Erinnerung. Das ist kein Zeitschnitt
    // in der Gegenrichtung — er nimmt nichts heraus, er holt einen anstehenden
    // Termin für die Stunden herein, in denen anzukündigen ist.
    assert.match(TERMINE, /onZeit=\{\(z\) => setParam\("zeit", z === "zu_tun" \? null : z\)\}/);
    const liste = read("src/components/termine/TermineList.tsx");
    assert.match(liste, /istZuTun\(e\.zustand, e\.erinnerung\)/);
  });

  test("und der Kalender blendet weiterhin nichts aus", () => {
    // „Ausgeblendet wird nichts — auch ein toter Lead bleibt sichtbar" (docs §1).
    // Das galt schon vor dem Rückbau und gilt unverändert.
    assert.match(TERMINE, /const inRange = useMemo\(\s*\n?\s*\(\) => \(range \? filtered\.filter/);
  });
});
