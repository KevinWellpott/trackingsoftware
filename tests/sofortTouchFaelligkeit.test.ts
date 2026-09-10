// Wann ein Sofort-Touch überfällig ist — und wann eben nicht.
//
// Der Befund aus dem Betrieb: „Wenn ich jemanden auf ein Closing oder Setting
// terminiere, dies sich aber nicht mit unserem Erinnerungs-Flow deckt, steht das
// als ausstehend im Tab Erinnerungen, obwohl das dann ja nicht fällig ist."
//
// Die Ursache: `planScheduledCascade` legt für einen kurzfristig gebuchten
// Termin EINEN Sofort-Touch an, dessen Fälligkeit der Zeitpunkt seiner
// ENTSTEHUNG ist. Eine Minute später ist die Uhr weiter, und dieselbe Regel, die
// eine echte Versäumnis erkennt, hält ihn für überfällig — obwohl niemand etwas
// versäumt hat: Der Termin steht noch bevor, der Touch ist gerade erst
// entstanden.
//
// Die Regel jetzt: Ein Sofort-Touch ist erst überfällig, wenn sein TERMIN vorbei
// ist. Sie steht in `lib/dueState.ts`, also an der einen Stelle, die alle
// Anzeigen lesen. (Der Navigations-Zähler war bis zum Rückbau die dritte davon;
// er ist mit /erinnerungen gefallen — die Regel selbst nicht, sie trägt
// weiterhin Board und Kaskaden-Panel.)
//
// Bauart wie in den Nachbardateien: Was eine reine Funktion entscheidet, wird am
// VERHALTEN geprüft; was eine React-Komponente entscheidet, die der Test-Runner
// nicht laden kann, am QUELLTEXT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { dueRefAt, isOverdue, reminderDueSpec, type DueRef } from "@/lib/dueState";

/** 8.9.2026, 10:00 Berliner Wandzeit (Sommerzeit, UTC+2). */
const JETZT = Date.parse("2026-09-08T08:00:00Z");
const REF: DueRef = dueRefAt(JETZT);

/** Der Sofort-Touch eines Termins: entstanden vor drei Stunden, Termin um 11:00. */
const ENTSTANDEN = "2026-09-08T05:00:00Z"; // 07:00 Berlin
const TERMIN_GLEICH = "2026-09-08T09:00:00Z"; // 11:00 Berlin — steht noch bevor
const TERMIN_VORBEI = "2026-09-08T07:30:00Z"; // 09:30 Berlin — ist durch

function sofort(appointmentAt: string | null) {
  return { touch_kind: "sofort", appointment_at: appointmentAt };
}

function stufe(appointmentAt: string) {
  return { touch_kind: "cascade", appointment_at: appointmentAt };
}

/* ------------------------------------------------------------------ *
 * Die Regel selbst
 * ------------------------------------------------------------------ */

describe("Ein Sofort-Touch misst gegen den Termin, nicht gegen sich selbst", () => {
  test("solange der Termin bevorsteht, ist er nicht überfällig — auch Stunden nach seiner Entstehung nicht", () => {
    // Genau der gemeldete Fall: entstanden um 07:00, jetzt ist 10:00, der Termin
    // ist um 11:00. Nach der alten Regel stand er seit drei Stunden rot da.
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort(TERMIN_GLEICH)), REF), false);

    // Und zwar über den ganzen Vorlauf hinweg, nicht nur in der ersten Minute.
    for (let minuten = 0; minuten <= 180; minuten += 15) {
      const ref = dueRefAt(Date.parse(ENTSTANDEN) + minuten * 60_000);
      assert.equal(
        isOverdue(ENTSTANDEN, reminderDueSpec(sofort(TERMIN_GLEICH)), ref),
        false,
        `${minuten} Minuten nach der Entstehung`,
      );
    }
  });

  test("nach dem Termin ist er überfällig — dann geht die Bestätigung nicht mehr raus", () => {
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort(TERMIN_VORBEI)), REF), true);
  });

  test("die Grenze ist der Termin, auf die Minute genau", () => {
    const termin = "2026-09-08T09:00:00Z";
    const um = (iso: string) => dueRefAt(Date.parse(iso));
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort(termin)), um("2026-09-08T08:59:59Z")), false);
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort(termin)), um("2026-09-08T09:00:00Z")), false);
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort(termin)), um("2026-09-08T09:00:01Z")), true);
  });

  test("ohne Termin bleibt er ruhig statt dauerhaft rot", () => {
    // Eine Dringlichkeit, für die es keinen Endpunkt gibt, wird hier nicht
    // behauptet — dasselbe Prinzip wie bei einer unlesbaren Fälligkeit.
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort(null)), REF), false);
    assert.equal(isOverdue(ENTSTANDEN, reminderDueSpec(sofort("nächste Woche")), REF), false);
  });
});

/* ------------------------------------------------------------------ *
 * Gegenrichtung — ohne sie wäre die Überfällig-Erkennung entschärft
 * ------------------------------------------------------------------ */

describe("Gegenrichtung: eine normale Stufe wird weiterhin überfällig", () => {
  test("eine geplante Kaskadenstufe kippt in der Minute nach ihrer Fälligkeit", () => {
    // DER Test dieser Datei. Fällt er, ist nicht der Sofort-Touch repariert,
    // sondern die Überfällig-Erkennung insgesamt weich — und das merkt niemand,
    // bis eine echte Erinnerung verpasst wird.
    const faellig = "2026-09-08T07:00:00Z"; // 09:00 Berlin, also vor einer Stunde
    assert.equal(isOverdue(faellig, reminderDueSpec(stufe(TERMIN_GLEICH)), REF), true);
    assert.equal(isOverdue(faellig, "moment", REF), true);
  });

  test("eine Stufe, deren Zeitpunkt noch bevorsteht, ist es nicht", () => {
    assert.equal(isOverdue("2026-09-08T08:30:00Z", reminderDueSpec(stufe(TERMIN_GLEICH)), REF), false);
  });

  test("der Termin macht eine normale Stufe NICHT ruhig", () => {
    // Die Ausnahme gilt genau für `sofort`. Eine Stufe, die vor einem noch
    // bevorstehenden Termin liegt und verstrichen ist, ist versäumt — das ist der
    // Normalfall der Kaskade und der Grund, warum es die Seite gibt.
    const verstrichen = "2026-09-08T06:00:00Z";
    assert.equal(isOverdue(verstrichen, reminderDueSpec(stufe(TERMIN_GLEICH)), REF), true);
    // Auch die Ereignis-Ketten (No-Show, kein Abschluss) bleiben unberührt.
    assert.equal(
      isOverdue(verstrichen, reminderDueSpec({ touch_kind: "chain", appointment_at: TERMIN_GLEICH }), REF),
      true,
    );
  });

  test("die Tages-Körnung von /nachfassen ist unberührt", () => {
    // Die zweite Regel in derselben Datei — sie darf sich durch die neue nicht
    // verschieben (siehe dueState.test.ts).
    assert.equal(isOverdue("2026-09-08T00:00:00+00:00", "day", REF), false);
    assert.equal(isOverdue("2026-09-07T00:00:00+00:00", "day", REF), true);
  });
});

describe("reminderDueSpec", () => {
  test("nur `sofort` bekommt die Termin-Frist, alles andere die Uhrzeit", () => {
    assert.deepEqual(reminderDueSpec(sofort(TERMIN_GLEICH)), {
      granularity: "sofort",
      appointmentAt: TERMIN_GLEICH,
    });
    assert.equal(reminderDueSpec(stufe(TERMIN_GLEICH)), "moment");
    assert.equal(reminderDueSpec({ touch_kind: "chain" }), "moment");
    // Fehlt die Spalte in einer Abfrage, ist die Uhrzeit der sichere Rückfall:
    // Sie behauptet keine Ausnahme, die niemand geprüft hat.
    assert.equal(reminderDueSpec({}), "moment");
  });
});

/* ------------------------------------------------------------------ *
 * Die Regel von Hand — dieselbe Rechnung, die die Anzeige macht
 * ------------------------------------------------------------------ */

describe("Eine gemischte Liste ergibt genau die erwartete Zahl Versäumnisse", () => {
  test("zwei von vier Touches sind überfällig — die beiden Sofort-Touches trennt ihr Termin", () => {
    // Stand bis zum Rückbau als Vergleich zwischen Navigations-Zähler und
    // Board hier: Der Zähler auf `reminder_touches` ist mit /erinnerungen
    // gefallen (lib/navCounts.ts). Die RECHNUNG bleibt trotzdem geprüft — sie
    // ist die eine Stelle, an der Board und Kaskaden-Panel ihre roten Ränder
    // herleiten, und ohne sie fiele mit dem Zähler auch die Zusicherung weg.
    const zeilen = [
      { due_at: ENTSTANDEN, touch_kind: "sofort", appointment_at: TERMIN_GLEICH },
      { due_at: ENTSTANDEN, touch_kind: "sofort", appointment_at: TERMIN_VORBEI },
      { due_at: "2026-09-08T06:00:00Z", touch_kind: "cascade", appointment_at: TERMIN_GLEICH },
      { due_at: "2026-09-08T09:30:00Z", touch_kind: "cascade", appointment_at: TERMIN_GLEICH },
    ];
    const ueberfaellig = zeilen.filter((z) => isOverdue(z.due_at, reminderDueSpec(z), REF));
    assert.equal(ueberfaellig.length, 2);
    assert.deepEqual(
      ueberfaellig.map((z) => z.appointment_at),
      [TERMIN_VORBEI, TERMIN_GLEICH],
    );
  });
});

/* ------------------------------------------------------------------ *
 * Das Board — Quelltext, weil der Runner kein JSX lädt
 * ------------------------------------------------------------------ */

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const BOARD = read("src/components/erinnerungen/ErinnerungenBoard.tsx");
const PANEL = read("src/components/termine/CascadePanel.tsx");

// Bis zum Rückbau waren es DREI Anzeigen: Board, Kaskaden-Panel und der
// Navigations-Zähler. Der dritte hing an /erinnerungen und ist mit der Seite
// gefallen (lib/navCounts.ts) — geprüft wird jetzt, was noch da ist.
describe("Beide Anzeigen lesen die EINE Regel", () => {
  test("das Board rechnet nicht selbst, sondern fragt dueState", () => {
    assert.match(BOARD, /from "@\/lib\/dueState"/);
    assert.match(BOARD, /isOverdue\(dueAtIso, reminderDueSpec\(touch\), dueRefAt\(nowMs\)\)/);
    // Auch der rote Rand der Karte — sonst steht sie rot in einem Korb, der sie
    // nicht für überfällig hält.
    assert.match(BOARD, /isOverdue\(active!\.due_at, reminderDueSpec\(active!\), dueRefAt\(nowMs\)\)/);
    // Und keine handgerechnete Zweitregel daneben.
    assert.doesNotMatch(BOARD, /new Date\(active!\.due_at\)\.getTime\(\) <= nowMs/);
  });

  test("das Kaskaden-Panel am Termin benutzt dieselbe Regel", () => {
    assert.match(PANEL, /isOverdue\(touch\.due_at, reminderDueSpec\(touch\), dueRefAt\(nowMs\)\)/);
    assert.doesNotMatch(PANEL, /new Date\(touch\.due_at\)\.getTime\(\) <= nowMs/);
  });
});

describe("Der Sofort-Touch landet in einem Korb, der ihn nicht anklagt", () => {
  test("es gibt einen eigenen Korb „Jetzt fällig“ zwischen Überfällig und der nächsten Stunde", () => {
    // „Überfällig" wäre ein Vorwurf. „In der nächsten Stunde" wäre eine
    // Behauptung über den Termin, die bei abgeschalteter Stundenstufe falsch
    // sein kann — der Sofort-Touch weiß nur, dass er JETZT dran ist.
    assert.match(BOARD, /jetzt: "Jetzt fällig"/);
    assert.match(BOARD, /BUCKET_ORDER: readonly BucketKey\[\] = \["overdue", "jetzt", "soon", "today", "week", "later"\]/);
  });

  test("der Korb kommt nach der Überfällig-Prüfung, nicht davor", () => {
    // Sonst schluckte er auch die echten Versäumnisse: Deren Fälligkeit liegt
    // ebenfalls in der Vergangenheit.
    const ueberfaellig = BOARD.indexOf('return "overdue"');
    const jetzt = BOARD.indexOf('return "jetzt"');
    assert.ok(ueberfaellig !== -1 && jetzt !== -1);
    assert.ok(ueberfaellig < jetzt, "der Jetzt-Korb steht vor der Überfällig-Prüfung");
  });

  test("die Karte sagt hinter dem Info-Icon, warum sie nur eine Stufe trägt", () => {
    // Ein einzelner Touch statt drei sieht wie ein Fehler in der Kaskade aus.
    // Der Satz erklärt — also hinter das Icon; die Fälligkeit daneben ist
    // handlungsrelevant und bleibt sichtbar.
    assert.match(BOARD, /touch\.touch_kind === "sofort" && \(\s*<InfoPopover/);
    const erklaerung = BOARD.slice(BOARD.indexOf('<InfoPopover label="Warum nur eine Bestätigung"'));
    assert.match(erklaerung.slice(0, 600), /kurzfristig gebucht/);
    assert.match(erklaerung.slice(0, 600), /überfällig, wenn der Termin vorbei ist/);
  });
});
