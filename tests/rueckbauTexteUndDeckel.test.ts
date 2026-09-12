// Rückbau, letzte Spur: Texte, tote Reste und ein unsichtbarer Deckel.
//
// WARUM DIESE DATEI: Drei der zwölf Befunde der adversarischen Prüfung teilen
// eine Eigenschaft — sie sind alle unsichtbar für `tsc`, `eslint` und jeden
// Verhaltenstest. Ein Dialogsatz, der eine Ablage-Ansicht nennt, die es nicht
// mehr gibt, kompiliert einwandfrei. Ein Versuchs-Deckel, der in der Datenbank
// weiterwirkt und aus der Oberfläche verschwunden ist, wirft nie einen Fehler;
// er lässt nur Leads verschwinden. Und eine Konstante ohne Verwender sieht wie
// geltende Konvention aus.
//
// Diese Fehlerklasse hat kein Symptom, an dem sie von selbst auffliegt. Deshalb
// steht sie hier, geprüft am QUELLTEXT — die Bauart des Hauses (siehe
// rueckbauEinstellungen.test.ts): Die betroffenen Dateien sind `.tsx` mit JSX,
// der Runner (`node --experimental-strip-types`) lädt sie nicht, und eine
// Attrappe bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Abschnitt zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const LIFECYCLE_META = read("src/components/termine/lifecycleMeta.ts");
const LIFECYCLE_BAR = read("src/components/termine/AppointmentLifecycleBar.tsx");
const LIST_BOARD = read("src/components/ListBoardV2.tsx");
const TERMIN_META = read("src/lib/terminMeta.ts");
const CONTACT_GAP = read("src/lib/contactGap.ts");
const RECYCLE_SECTION = read("src/components/analyse/RecycleSection.tsx");
const PIPELINE_CARD = read("src/components/settings/PipelineSettingsCard.tsx");
const DROPOUT_LISTS = read("src/lib/dropoutLists.ts");
const NACHFASSEN_PAGE = read("src/app/(dashboard)/nachfassen/page.tsx");
const MIGRATION_0032 = read("supabase/migrations/20260404000032_reminder_cascade.sql");
const MIGRATION_0033 = read("supabase/migrations/20260404000033_lead_recycling.sql");

/* ------------------------------------------------------------------ *
 * 1 — Die acht Dialogtexte
 * ------------------------------------------------------------------ */

// Die Werte-Blöcke, nicht die ganzen Dateien: Die Kopfkommentare nennen
// absichtlich weiter, was gefallen ist — eine Erklärung darf ihren Gegenstand
// beim Namen nennen, ein Dialog nicht.
const OUTLOOK_HINTS = slice(LIFECYCLE_META, "export const CANCEL_OUTLOOK_HINTS", "};");
const NO_SHOW_HINTS = slice(LIFECYCLE_META, "export const NO_SHOW_RESOLUTION_HINTS", "};");

describe("Kein sichtbarer Text verspricht Erinnerungen", () => {
  test("die Lebenszyklus-Leiste erwähnt sie weder im Tooltip noch im Modal", () => {
    // Zwei Stellen, derselbe Satz: „Die Erinnerungen werden neu berechnet."
    // Beide standen an einer Aktion, die jeder Verkäufer täglich anfasst.
    assert.doesNotMatch(LIFECYCLE_BAR, /Erinnerungen werden neu berechnet/);
    assert.doesNotMatch(LIFECYCLE_BAR, /Erinnerung/);
  });

  test("die drei No-Show-Ausgänge erklären keine Kette mehr", () => {
    // „Beendet die No-Show-Kette", „die Kette läuft weiter", „die Erinnerungen
    // starten komplett neu" — drei Sätze über einen Mechanismus, den es nicht
    // gibt. Sie waren nicht falsch formuliert, sie beschrieben etwas anderes.
    assert.doesNotMatch(NO_SHOW_HINTS, /Kette|Erinnerung|Stufe/);
  });

  test("und die Leiste sagt stattdessen, was wirklich passiert", () => {
    // Gegenprobe: Ein gelöschter Halbsatz ist kein Gewinn, wenn danach nichts
    // mehr dasteht. Beide Stellen benennen jetzt den abgeleiteten Zustand aus
    // src/lib/dranRegel.ts — das ist die Folge, die der Nutzer als Nächstes
    // sieht.
    assert.match(LIFECYCLE_BAR, /gilt der Lead als verlegt/);
    assert.match(LIFECYCLE_BAR, /„Verlegt“/);
  });

  test("der Blockieren-Dialog der LinkedIn-Liste nennt nur noch das Follow-up", () => {
    // Vorsicht-Datei: Die LinkedIn-Liste ist das erklärte Vorbild der neuen
    // Arbeitsfläche und darf sich sonst nicht verändern. Geändert ist genau ein
    // Halbsatz.
    assert.match(LIST_BOARD, /fliegt damit aus dem Follow-up-Tracking\./);
    assert.doesNotMatch(LIST_BOARD, /Follow-up-Tracking und den Erinnerungen/);
  });
});

describe("Kein sichtbarer Text nennt eine Ablage-Ansicht, die es nicht gibt", () => {
  test("die beiden Absage-Ausblicke nennen „Ausgeschieden“, nicht die alten Reiter", () => {
    // Aus sechs Ansichten wurden zwei (src/lib/dropoutLists.ts). „Abgesagt ohne
    // Aussicht" und „No-Show ohne Antwort" heißen beide „Ausgeschieden";
    // „Abgesagt, Ersatztermin steht aus" gibt es gar nicht mehr — dieser Lead
    // steht in der Terminliste, nicht im Archiv.
    assert.doesNotMatch(OUTLOOK_HINTS, /Abgesagt ohne Aussicht/);
    assert.doesNotMatch(OUTLOOK_HINTS, /offener Ersatztermin/);
    assert.doesNotMatch(NO_SHOW_HINTS, /No-Show ohne Antwort/);
    assert.match(OUTLOOK_HINTS, /Ausgeschieden/);
    assert.match(NO_SHOW_HINTS, /Ausgeschieden/);
  });

  test("die beiden Ansichten heißen wirklich so", () => {
    // Gegenprobe gegen einen Text, der eine erfundene Ansicht nennt: Der Name
    // muss in DROPOUT_LISTS vorkommen, sonst ist der Dialog wieder falsch — nur
    // andersherum.
    const listen = slice(DROPOUT_LISTS, "export const DROPOUT_LISTS", "];");
    assert.match(listen, /title: "Ausgeschieden"/);
    assert.doesNotMatch(listen, /Ersatztermin steht aus/);
  });

  test("der Kalender begründet den Absage-Rahmen nicht mehr mit dem Ablage-Zähler", () => {
    // `outlineFor` blendet `cancel_outlook` bewusst aus. Die Begründung dafür
    // verwies auf eine Ablage-Ansicht samt Navigations-Zähler — beides
    // entfernt. Die Entscheidung bleibt richtig, nur ihr Grund liegt jetzt in
    // der Terminliste.
    const cancelled = slice(TERMIN_META, "Rahmen eines ABGESAGTEN Termins", "const CANCELLED");
    // Der Satz darf die alte Ansicht als HISTORIE nennen („zeigte bis zum
    // Rückbau auf …"), aber nicht mehr als geltenden Ort behaupten. Geprüft
    // wird deshalb der Verweis nach vorn: Wo die Aufgabe HEUTE steht.
    assert.doesNotMatch(cancelled, /hat mit `\/ablage`/);
    assert.doesNotMatch(cancelled, /ihren eigenen Ort samt Navigations-Zähler/);
    assert.match(cancelled, /offene Aufgaben stehen in der Terminliste/);
    assert.match(cancelled, /dranRegel/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Der Versuchs-Deckel
 * ------------------------------------------------------------------ */

describe("Der Versuchs-Deckel wirkt — auch ohne Bedienelement", () => {
  test("er wirkt in der Datenbank — das ist die Tatsache, die alles entscheidet", () => {
    // Die Migrationen sind EINGEFROREN. Solange diese Zeile in 0033 steht, ist
    // der Deckel Realität, egal was die Oberfläche zeigt: `recycle_attempt()`
    // nullt beim Erreichen das `next_recycle_at`, und der Lead kommt nie wieder
    // von selbst hoch.
    assert.match(MIGRATION_0033, /v_attempts >= s\.max_attempts/);
    // Und er lässt sich nicht wegkonfigurieren: Der CHECK aus 0032 klemmt den
    // Wert zwischen 1 und 5 — einen „greift nie"-Wert gibt es dort nicht.
    assert.match(MIGRATION_0032, /max_attempts smallint not null default 2 check \(max_attempts between 1 and 5\)/);
  });

  test("die Pipeline-Karte trägt KEIN Feld mehr dafür", () => {
    // NACHGEZOGEN. Hier stand „die Karte trägt ein Feld dafür, mit den Grenzen
    // des CHECKs" — die Antwort auf den Befund „eine Grenze, die wirkt, die
    // niemand sieht und niemand stellen kann".
    //
    // Der Auftraggeber hat sich für die dritte Möglichkeit entschieden, die in
    // dieser Aufzählung fehlte: Die Grenze bleibt, wie sie ist, und wird nicht
    // gestellt. Der Wert (standardmäßig zwei Versuche) wirkt unverändert weiter;
    // was fällt, ist ausschließlich das Bedienelement. Dass der gespeicherte
    // Wert das Speichern der übrigen Zahlen überlebt, prüft
    // tests/rueckbauEinstellungen.test.ts.
    assert.doesNotMatch(PIPELINE_CARD, /ATTEMPTS_FIELD/);
    assert.doesNotMatch(PIPELINE_CARD, /value=\{settings\.max_attempts\}/);
    // Und der Hinweistext dazu ist mit dem Feld gegangen — ein Satz ohne Feld
    // erklärt eine Zahl, die nirgends steht.
    assert.doesNotMatch(PIPELINE_CARD, /endgültig aus der Wiedervorlage/);
    assert.doesNotMatch(PIPELINE_CARD, /Harte Grenze, keine Warnung/);
    // Gegenprobe: Das Verschiebe-Kontingent daneben bleibt — es ist die Zahl,
    // auf der die Arbeitsliste steht, und es ist eine Warnung, keine Sperre.
    assert.match(PIPELINE_CARD, /keine harte Sperre/);
    assert.match(PIPELINE_CARD, /"max_reschedules"/);
  });

  test("die Sperre im Ablage-Board bleibt die Stelle, an der die Grenze auffällt", () => {
    // „1 von 2" an der einzelnen Karte und der Satz, warum „Jetzt wieder
    // anschreiben" fehlt: Nach dem Wegfall des Feldes ist das die LETZTE Stelle,
    // an der ein Mensch die Grenze überhaupt bemerkt — und sie steht dort am Ort
    // der Handlung, nicht in einer Einstellung, die niemand aufmacht.
    const grund = slice(DROPOUT_LISTS, "export function recycleBlockedReason", "\n}");
    assert.match(grund, /Der Deckel von \$\{gate\.maxAttempts\} Versuchen ist erreicht/);
    const board = read("src/components/ablage/AblageBoard.tsx");
    assert.match(board, /\$\{row\.recycle_attempt_count \?\? 0\} von \$\{maxAttempts\}/);
  });

  test("keine Oberfläche behauptet, es gebe keinen Deckel", () => {
    // Der ursprüngliche Befund: Die einzige Auswertung, die den Deckel messen
    // könnte, trug im Kopf die Behauptung „es gibt keinen". Die Kennzahl selbst
    // bleibt fort (der Loader lädt `recycle_attempt_count` nicht) — aber als
    // benannte Lücke, nicht als Tatsachenbehauptung.
    //
    // Das gilt nach dem Wegfall des Bedienelements ERST RECHT: Die Oberfläche
    // zeigt die Grenze fast nirgends mehr, also darf sie sie nirgends
    // bestreiten. Geprüft an beiden Dateien, die überhaupt über sie sprechen.
    for (const [name, quelle] of [
      ["RecycleSection", RECYCLE_SECTION],
      ["PipelineSettingsCard", PIPELINE_CARD],
    ] as const) {
      assert.doesNotMatch(quelle, /kein Deckel/, `${name} bestreitet den Deckel`);
      assert.doesNotMatch(quelle, /es gibt keinen\)/, `${name} bestreitet den Deckel`);
    }
    assert.match(RECYCLE_SECTION, /LÜCKE, keine Aussage/);
    // Und die Analyse zeigt nicht mehr auf ein Feld in den Einstellungen, das
    // es nicht mehr gibt: Wer die Zahl sucht, findet sie an der Ablage-Karte.
    assert.doesNotMatch(RECYCLE_SECTION, /Verstellbar/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Tote Reste und der Seitenname
 * ------------------------------------------------------------------ */

describe("Tote Reste", () => {
  test("contactGap.ts trägt nur noch, was gelesen wird", () => {
    // Zwei Exporte, zwei Verwender (TermineList, leadDossier). Die vier Exporte
    // der Kontaktfrequenz-Warnung hatten keinen mehr — und die Warnung selbst
    // widerspräche der Arbeitsliste, in der jeder offene Lead TÄGLICH drankommt.
    const exporte = [...CONTACT_GAP.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(exporte, ["dayDiff", "lastContactLabel"]);
  });

  test("und sein Dateikopf beschreibt die heutigen Verwender", () => {
    // Der Kopf nannte `ErinnerungenBoard` und `actions/nachfassen.ts` als die
    // drei Stellen, an denen die Zahl steht. Beide lesen die Datei nicht (mehr);
    // ein Kommentar, der auf Gelöschtes zeigt, kostet beim nächsten Lesen genau
    // die Zeit, die er sparen sollte.
    assert.doesNotMatch(CONTACT_GAP, /ErinnerungenBoard/);
    assert.match(CONTACT_GAP, /TermineList/);
    assert.match(CONTACT_GAP, /leadDossier/);
  });
});

describe("Der Seitenname ist entschieden", () => {
  test("die Seite unter /nachfassen heißt „Recycling“", () => {
    // Das Wort des ganzen Systems für diese Sache: `/settings` („Recycling —
    // Wartezeit"), der Analyse-Bereich („Lohnt das Recycling?"), die RPC
    // `recycle_tasks`, docs §1. „Nachfassen" war die Sammelbezeichnung für DREI
    // Mechanismen; die anderen beiden stehen jetzt in der Terminliste.
    assert.match(NACHFASSEN_PAGE, /eyebrow="Wiedervorlage"/);
    assert.match(NACHFASSEN_PAGE, /\n\s*Recycling\n/);
    // Die ROUTE bleibt: Lesezeichen und `?from=nachfassen` hängen daran.
    assert.match(NACHFASSEN_PAGE, /Die ROUTE behält ihren Namen/);
  });

  test("die Entscheidung steht in der Datei, nicht nur im Diff", () => {
    // Ein Name, dessen Begründung nur im Commit steht, wird beim nächsten
    // „klingt komisch" zurückgedreht. Hier steht auch, was noch nachzuziehen ist
    // (Seitenleiste und Quicklink liegen in anderen Dateien).
    assert.match(NACHFASSEN_PAGE, /DER NAME IST ENTSCHIEDEN/);
    assert.match(NACHFASSEN_PAGE, /NOCH NACHZUZIEHEN/);
  });
});
