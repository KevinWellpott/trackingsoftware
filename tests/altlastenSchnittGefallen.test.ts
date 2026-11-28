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
// ── UND WAS DER NACHFASS-EINGANG DARAN ÄNDERT (27.11.2026) ─────────────────
// Die Tagesarbeit steht seither auf /nachfassen (docs/nachfassen-umbau/
// PLAN-nachfass-eingang.md). Der Eingang hat einen Reiter „Aufräumen" für den
// Altbestand vor dem Start (Plan §4.5, Entscheidung N4) — und der ist
// ausdrücklich KEIN versteckter Altersschnitt: Altfälle sind sichtbar und
// gezählt, der Reiter verlangt eine Entscheidung, und sobald jemand einen
// Vorgang anfasst, ist er kein Altfall mehr. Genau diese drei Eigenschaften
// prüft Abschnitt B; fiele eine davon, wäre der alte Schnitt unter neuem Namen
// zurück.
//
// Zwei Prüfarten, wie überall im Haus: Was eine Funktion entscheidet, wird am
// VERHALTEN geprüft (die Regel-Bibliothek des Eingangs). Was eine
// React-Komponente verdrahtet, wird am QUELLTEXT geprüft — der Runner
// (`node --experimental-strip-types`) lädt kein `.tsx`, und eine Attrappe bewiese
// nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  REITER_GRUPPEN,
  badgeZahl,
  gruppeVon,
  gruppiere,
  type NachfassEintrag,
} from "@/lib/nachfassRegel";

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

const EINGANG = read("src/components/nachfassen/NachfassEingang.tsx");
const SEITE = read("src/app/(dashboard)/nachfassen/page.tsx");
const TERMINE = read("src/components/termine/TermineBoard.tsx");
const BADGE = read("src/lib/navCountsData.ts");

/** Ein fester Tag nach dem Start des Eingangs. */
const HEUTE = "2026-12-10";
const JETZT = Date.parse(`${HEUTE}T09:00:00.000Z`);
const START = "2026-12-01";

function eintrag(patch: Partial<NachfassEintrag> & { key: string }): NachfassEintrag {
  return {
    quelle: "termin",
    art: "setting",
    id: patch.key,
    name: patch.key,
    firma: null,
    faelligAm: null,
    koernung: "tag",
    ergebnisFehlt: false,
    lebenszeichen: HEUTE,
    kontakte: [],
    ...patch,
  };
}

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
 * B — „Aufräumen“ ist kein Altersschnitt unter neuem Namen
 * ------------------------------------------------------------------ */

describe("B · Der Eingang verliert nichts und versteckt nichts", () => {
  const eintraege = [
    eintrag({ key: "ueber", faelligAm: "2026-12-05" }),
    eintrag({ key: "heute", faelligAm: HEUTE }),
    eintrag({ key: "ohne-datum" }),
    eintrag({ key: "fehlt", ergebnisFehlt: true }),
    eintrag({ key: "bald", faelligAm: "2026-12-12" }),
    eintrag({ key: "spaeter", faelligAm: "2027-02-01" }),
    // Altbestand: letztes Lebenszeichen lange vor dem Start, nie angefasst.
    eintrag({ key: "alt", faelligAm: "2025-11-01", lebenszeichen: "2025-11-01" }),
  ];

  test("gruppiere() verliert keinen einzigen Vorgang", () => {
    // Der alte Schnitt NAHM Zeilen weg. Jede Gruppe des Eingangs ist ein Reiter
    // mit Inhalt — die Summe aller Gruppen ist die Eingabe, ohne Rest.
    const gruppen = gruppiere(eintraege, HEUTE, JETZT, START);
    const summe = [...gruppen.values()].reduce((n, l) => n + l.length, 0);
    assert.equal(summe, eintraege.length);
  });

  test("das Badge zählt genau, was der Reiter „Fällig“ zeigt", () => {
    // Die Bindungspflicht aus docs §5.4: Ein Badge, das anders zählt als die
    // Seite darunter, ist ein Fehler — in BEIDE Richtungen.
    const gruppen = gruppiere(eintraege, HEUTE, JETZT, START);
    const faellig = REITER_GRUPPEN.faellig.reduce((n, g) => n + (gruppen.get(g)?.length ?? 0), 0);
    assert.equal(badgeZahl(gruppen).total, faellig);
    assert.equal(faellig, 4, "überfällig, heute, ohne Datum, Ergebnis fehlt");
  });

  test("… und liest dafür DENSELBEN Loader wie die Seite", () => {
    // In der schlanken Form (Punkt 5, 28.11.): dieselbe Funktion `ladeIntern`,
    // nur ohne Wiedervorlage und Kontaktwege — die zählt das Badge ohnehin nicht.
    assert.match(BADGE, /ladeNachfassenSchlank\(\)/);
    assert.match(BADGE, /badgeZahl\(gruppiere\(daten\.eintraege, daten\.today, daten\.nowMs\)\)/);
    assert.match(SEITE, /await ladeNachfassen\(/);
  });

  test("ein angefasster Vorgang fällt NIE wegen seines Alters aus „Fällig“", () => {
    // DER KERN. Das Alter allein nimmt nichts herunter: Wer seit einem Jahr
    // überfällig ist, aber im Eingang schon einmal bearbeitet wurde, steht
    // unter „Überfällig" und im Badge — genau wie der Satz des Auftraggebers es
    // verlangt.
    const uralt = eintrag({
      key: "uralt",
      faelligAm: "2025-11-01",
      lebenszeichen: "2025-11-01",
      kontakte: [{ ergebnis: "nicht_erreicht", created_at: "2026-12-02T09:00:00.000Z" }],
    });
    assert.equal(gruppeVon(uralt, HEUTE, JETZT, START), "ueberfaellig");
    assert.equal(badgeZahl(gruppiere([uralt], HEUTE, JETZT, START)).total, 1);
  });

  test("der Altbestand ist sichtbar, gezählt und verlangt eine Entscheidung", () => {
    // Die drei Bedingungen aus Plan §4.5. Fehlte eine, wäre „Aufräumen" der
    // alte Schnitt unter neuem Namen.
    const alt = eintraege.find((e) => e.key === "alt")!;
    assert.equal(gruppeVon(alt, HEUTE, JETZT, START), "aufraeumen");
    // Sichtbar und gezählt: Der Reiter trägt seine Zahl …
    assert.match(EINGANG, /label: `Aufräumen \$\{aufraeumenAnzahl\}`/);
    // … und verschwindet erst, wenn er leer ist.
    assert.match(EINGANG, /aufraeumenAnzahl > 0 \|\| props\.reiter === "aufraeumen"/);
    // Entscheidung: die drei Sammelaktionen.
    for (const aktion of ['sammel("nochmal")', 'sammel("aufgeben")', 'sammel("sperren")']) {
      assert.ok(EINGANG.includes(aktion), `${aktion} fehlt im Aufräumen`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * C — Kein Hinweis, kein Schalter, kein Parameter
 * ------------------------------------------------------------------ */

describe("C · Kein Ausblende-Hinweis, kein Schalter, kein Parameter", () => {
  test("/nachfassen kennt keine „ausgeblendet … Trotzdem anzeigen“-Zeile", () => {
    // Die Hinweiszeile war die BEDINGUNG, unter der ein Schnitt vertretbar war.
    // Ohne Schnitt gibt es nichts zu rechtfertigen.
    assert.doesNotMatch(EINGANG, /ausgeblendet/);
    assert.doesNotMatch(EINGANG, /Trotzdem anzeigen/);
    assert.doesNotMatch(code(EINGANG), /hiddenStale|showingAll/);
    assert.doesNotMatch(code(EINGANG), /alle=1/);
  });

  test("… und die Seite reicht keinen Alters-Schalter an den Loader", () => {
    assert.doesNotMatch(code(SEITE), /alle=1|includeOlder|showingAll/);
    // Der Loader bekommt genau eine Angabe: die Personenachse.
    assert.match(SEITE, /await ladeNachfassen\(sp\.wer === "alle" \? "alle" : "mein"\)/);
  });

  test("/termine blendet in der Liste nichts aus", () => {
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
  });
});

/* ------------------------------------------------------------------ *
 * D — Gegenprobe: was NICHT gefallen ist
 * ------------------------------------------------------------------ */

describe("D · Die anderen Schnitte stehen weiter", () => {
  test("die Personenachse bleibt — „eine Liste pro Person“", () => {
    // Der Auftraggeber hat den ALTERS-Schnitt gestrichen, nicht die Liste je
    // Person. Fiele sie mit, stünde dort der Bestand des ganzen Teams.
    assert.match(TERMINE, /const matchesWer = useCallback\(/);
    assert.match(TERMINE, /e\.assignee\?\.user_id === scopeUserId/);
    assert.match(read("src/lib/nachfassenData.ts"), /if \(!alle && person !== scopeUser\) continue;/);
  });

  test("der Ausschnitt der Terminliste schneidet nach Zustand, nicht nach Zeit", () => {
    // Seit dem Nachfass-Eingang: „Erinnerung Setting · Erinnerung Closing ·
    // Alle" — „Alle" ist die Vorgabe und fliegt aus der URL.
    assert.match(TERMINE, /onZeit=\{\(z\) => setParam\("zeit", z === "alle" \? null : z\)\}/);
    const liste = read("src/components/termine/TermineList.tsx");
    assert.match(liste, /all\.filter\(\(e\) => e\.zustand === "verlegt" && e\.kind === art\)/);
  });

  test("und der Kalender blendet weiterhin nichts aus", () => {
    // „Ausgeblendet wird nichts — auch ein toter Lead bleibt sichtbar" (docs §1).
    assert.match(TERMINE, /const inRange = useMemo\(\s*\n?\s*\(\) => \(range \? filtered\.filter/);
  });
});
