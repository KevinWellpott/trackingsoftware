// Der Rückbau des Analyse-Bereichs — festgehalten, damit er nicht zurückkriecht.
//
// WARUM DIESE DATEI: Der Geschäftspartner hat das Nachfass-System als
// over-engineered zurückgewiesen; Kaskaden mit Stufenlogik, Vorlagen-Katalog
// und Grund-Codes fallen. Zwei Auswertungen standen ausschließlich auf diesem
// Überbau und haben ohne ihn keinen Gegenstand mehr: die
// „Erinnerungs-Disziplin" (Setting- und Closing-Tab) und die Grund-Hälfte von
// „Lohnt das Recycling?" (Übersichts-Tab).
//
// Der Versuchs-DECKEL stand hier ursprünglich in derselben Aufzählung. Er ist
// nicht gefallen — er lebt in `recycle_attempt()` (Migration 0033,
// eingefroren) weiter und wird in `/settings` wieder gestellt. Was aus der
// Analyse fiel, ist die Kachel „Am Deckel", und zwar aus einem mechanischen
// Grund: Der Loader lädt `recycle_attempt_count` nicht mehr.
//
// Eine Entfernung ist schwerer zu halten als eine Ergänzung: Sie hinterlässt
// keine Stelle, an der ein Test von selbst rot wird. Beim nächsten Ausbau
// steht der Block wieder da — genau dagegen sind die `doesNotMatch`-Zusicherungen
// unten. Die zweite Hälfte der Datei ist die Gegenprobe: was NICHT gefallen ist,
// muss nachweislich stehen geblieben sein, sonst reißt ein Rückbau mehr heraus
// als beschlossen war.
//
// Geprüft wird am QUELLTEXT, nicht am Verhalten — dieselbe Bauart wie
// analyseVerdrahtung.test.ts. Die Tabs sind Server Components mit `.tsx`; der
// Test-Runner (`node --experimental-strip-types`) kann JSX nicht laden.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SETTING_TAB = read("src/components/analyse/tabs/SettingTab.tsx");
const CLOSING_TAB = read("src/components/analyse/tabs/ClosingTab.tsx");
const UEBERSICHT_TAB = read("src/components/analyse/tabs/UebersichtTab.tsx");
const FUNNEL_TAB = read("src/components/analyse/tabs/FunnelTab.tsx");
const RECYCLE_SECTION = read("src/components/analyse/RecycleSection.tsx");
const ANALYSE_DATA = read("src/lib/analyseData.ts");

/** Der Abschnitt zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

// Die vier Recycling-Select-Ausdrücke plus der Zeilen-Vorfilter — nur dort darf
// eine Recycling-Spalte stehen. Der Rest der Datei bedient andere Auswertungen
// und trägt Spaltennamen, die zufällig ähnlich heißen.
const RECYCLE_TOUCHED = slice(ANALYSE_DATA, "const RECYCLE_TOUCHED =", ";");
const RECYCLE_SELECTS = slice(ANALYSE_DATA, "const RECYCLE_COLS =", "type RawRecycle");

describe("Rückbau — die Erinnerungs-Disziplin ist weg", () => {
  test("kein Tab zeigt die beiden Sektionen noch an", () => {
    for (const [name, source] of [
      ["SettingTab", SETTING_TAB],
      ["ClosingTab", CLOSING_TAB],
    ] as const) {
      assert.doesNotMatch(source, /title="Erinnerungs-Disziplin"/, `${name}: Sektion wieder da`);
      assert.doesNotMatch(
        source,
        /title="Welcher Touch wirkt am stärksten\?"/,
        `${name}: Stufen-Sektion wieder da`,
      );
    }
  });

  test("und keiner rechnet sie noch aus", () => {
    // Die Anzeige zu streichen und die Aggregation stehen zu lassen wäre der
    // teuerste Halbzustand: Der Tab lüde `reminder_touches` weiter, ohne dass
    // eine Zahl daraus entsteht — und beim ersten `drop table` wäre es ein
    // Ladefehler ohne sichtbare Ursache.
    for (const [name, source] of [
      ["SettingTab", SETTING_TAB],
      ["ClosingTab", CLOSING_TAB],
    ] as const) {
      assert.doesNotMatch(source, /loadReminderTouches/, `${name}: lädt weiter Touches`);
      assert.doesNotMatch(source, /touchData|byTouchStep|reminderPersonRows/, `${name}: rechnet weiter`);
      assert.doesNotMatch(source, /cascadeStepLabel|cascadeRank/, `${name}: hängt weiter an der Kaskade`);
    }
  });

  test("die Lade-Funktion selbst existiert nicht mehr", () => {
    // Sie hatte nur diese beiden Aufrufer. Ein Loader ohne Aufrufer ist genau
    // der Ballast, gegen den der Rückbau sich richtet.
    assert.doesNotMatch(ANALYSE_DATA, /loadReminderTouches|reminder_touches|REMINDER_TOUCH_COLUMNS/);
    assert.doesNotMatch(ANALYSE_DATA, /from "@\/lib\/cascadeEngine"/);
  });
});

describe("Rückbau — das Recycling zählt flach", () => {
  test("keine Deckel-Kennzahl: weder Kachel noch Spalte noch Einstellungs-Abfrage", () => {
    // NACHGEZOGEN — der Test prüfte vorher `/Am Deckel|atCap|maxAttempts/` über
    // die GANZE Datei und begründete das mit „kein Deckel". Die Begründung war
    // falsch: `recycle_attempt()` (Migration 0033, eingefroren) nullt bei
    // `recycle_attempt_count >= max_attempts` das `next_recycle_at`, und
    // `recycleBlockedReason` sperrt daraufhin „Jetzt wieder anschreiben". Der
    // Deckel wirkt; gefallen war nur seine Bedienung — was ihn unsichtbar
    // machte, statt ihn abzuschaffen. Er ist deshalb wieder in `/settings`.
    //
    // Was hier zu halten bleibt, ist die KACHEL: Ohne `recycle_attempt_count`
    // im Loader und ohne `max_attempts` in der Zeile wäre „Am Deckel" geraten.
    // Geprüft wird deshalb die Kachel-Deklaration und die Rechnung, nicht mehr
    // das Wort — der Dateikopf der Sektion nennt die Lücke absichtlich beim
    // Namen, und eine Erklärung darf ihren Gegenstand benennen.
    assert.doesNotMatch(RECYCLE_SECTION, /label: "Am Deckel"/);
    assert.doesNotMatch(RECYCLE_SECTION, /atCap|maxAttempts|attemptCount/);
    assert.doesNotMatch(ANALYSE_DATA, /maxAttempts|max_attempts|pipeline_settings/);
  });

  test("keine Aufschlüsselung je Grund", () => {
    // Der Grund-Code war die Achse, nach der die Wartezeiten gestaffelt waren.
    // Ohne Staffelung ist die Tabelle eine Sortierung ohne Entscheidung
    // dahinter.
    assert.doesNotMatch(RECYCLE_SECTION, /byReason|reasonRows|dropoutReasonLabel|Je Grund/);
    assert.doesNotMatch(ANALYSE_DATA, /recycle_reason_code/);
    // `lost_reason_code` bleibt bewusst in der Datei — es ist der Verlustgrund
    // der Top-Einwände im Closing-Tab, nicht der Recycling-Grund. Nur der
    // Recycling-Select darf ihn nicht mehr ziehen.
    assert.doesNotMatch(RECYCLE_SELECTS, /lost_reason_code/);
  });

  test("keine Verteilung der Versuche", () => {
    // Sie diente ausschließlich dazu, Deckel und erstes Intervall
    // gegeneinander zu justieren. Justiert wird nicht mehr: Die Frist gilt für
    // alle vier Ursprünge gleich, und der Deckel ist eine Zahl zwischen 1 und
    // 5, die man einstellt statt sie aus einer Verteilung abzulesen.
    assert.doesNotMatch(RECYCLE_SECTION, /attemptDist|attemptSlot|ATTEMPT_LABELS|Verteilung der Versuche/);
    // Der Versuchszähler wird weder geladen noch durchgereicht. Geprüft am
    // Wert von RECYCLE_TOUCHED, nicht an der ganzen Datei — der Kommentar
    // darüber nennt die alte Fassung absichtlich beim Namen.
    assert.doesNotMatch(RECYCLE_TOUCHED, /recycle_attempt_count/);
    assert.doesNotMatch(ANALYSE_DATA, /attempts: Number|recycle_attempt_count: /);
  });
});

describe("Gegenprobe — was NICHT fallen durfte", () => {
  test("die Sektion „Lohnt das Recycling?“ trägt weiter ihre drei Kennzahlen", () => {
    // Das Recycling bleibt, nur flach. Kontaktiert, Reaktionen und die
    // Wiederbelebungsquote hängen an `recycle_last_contacted_at` /
    // `recycle_responded_at` und damit an keiner Stufe, keinem Grund und keinem
    // Deckel — sie messen weiter genau das, was die Sektion verspricht.
    assert.match(UEBERSICHT_TAB, /<RecycleSection/);
    assert.match(RECYCLE_SECTION, /title="Lohnt das Recycling\?"/);
    for (const kachel of ["Kontaktiert", "Reaktionen", "Wiederbelebungsquote", "Gesperrt"]) {
      assert.match(RECYCLE_SECTION, new RegExp(`label: "${kachel}"`), `Kachel fehlt: ${kachel}`);
    }
    // Der Ursprung bleibt die eine Achse, die auch bei EINER Frist noch trennt.
    assert.match(RECYCLE_SECTION, /label="Ursprung"/);
  });

  test("der Status-Riegel von „Warten aktuell“ steht unverändert", () => {
    // Er prüft Status, Blockade und Wiederbelebung — alles Zeilenzustand, kein
    // Überbau. Ohne ihn behauptet die Kachel eine Warteschlange, die es nicht
    // gibt (Befund C, analyseVerdrahtung.test.ts).
    assert.match(RECYCLE_SECTION, /if \(r\.next_recycle_at && isRecycleCandidate\(r\)\) waiting \+= 1;/);
  });

  test("die fünf Quoten des Termin-Funnels sind nicht angefasst", () => {
    // Sie hängen an status/show_status/cancelled_at, nicht am Überbau — ein
    // Rückbau, der sie mitnimmt, hat zu viel herausgerissen.
    assert.match(SETTING_TAB, /const showRate = pct\(sum\.shows, sum\.shows \+ sum\.noShows\);/);
    assert.match(SETTING_TAB, /const qualiRate = pct\(sum\.quali, sum\.shows\);/);
    assert.match(CLOSING_TAB, /closingShowRate\(sum\.shows, sum\.closings, sum\.abgesagt\)/);
  });

  test("Trichter und Absagequote stehen weiter im Funnel-Tab", () => {
    // Der einzige Termin-Trichter des Bereichs und die einzige Stelle mit einer
    // Absagequote (docs §5.1).
    assert.match(FUNNEL_TAB, /if \(r\.cancelled_at\) continue;/);
    assert.match(FUNNEL_TAB, /Absagen/);
  });
});
