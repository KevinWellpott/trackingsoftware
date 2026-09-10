// Die Verdrahtung des Analyse-Bereichs: Benutzen die Tabs die Zähl-Regeln, die
// daneben in `src/lib/analyse.ts` stehen?
//
// Warum das eine eigene Datei ist: Eine Bibliothek, die niemand ruft, besteht
// jeden Test in analyseKennzahlen.test.ts. Genau diese Lücke war der teure Teil
// aller sechs Befunde — die Regel war jeweils bekannt und irgendwo im Bereich
// auch richtig formuliert, nur nicht an der Stelle, die die Zahl ausgibt.
//
// Geprüft wird am QUELLTEXT, nicht am Verhalten — dieselbe Bauart wie
// lifecycleWiring.test.ts. Die Tabs sind Server Components mit `.tsx`; der
// Test-Runner (`node --experimental-strip-types`) kann JSX nicht laden, und eine
// Attrappe bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
}

/** Der Abschnitt zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const CLOSING_TAB = read("src/components/analyse/tabs/ClosingTab.tsx");
const SETTING_TAB = read("src/components/analyse/tabs/SettingTab.tsx");
const FUNNEL_TAB = read("src/components/analyse/tabs/FunnelTab.tsx");
const UEBERSICHT_TAB = read("src/components/analyse/tabs/UebersichtTab.tsx");
const RECYCLE_SECTION = read("src/components/analyse/RecycleSection.tsx");
const ANALYSE_DATA = read("src/lib/analyseData.ts");

describe("Befund A — die Absage senkt die Closing-Show-Quote nicht mehr", () => {
  test("abgesagte Termine werden gezählt und aus dem Nenner genommen", () => {
    // Der Nenner bleibt „alle Closing-Termine" (docs §5) — nur die abgesagten
    // kommen raus. Beides muss im selben Durchlauf passieren, sonst zählt die
    // Kachel etwas anderes als die Vergleichstabelle darunter.
    assert.match(CLOSING_TAB, /if \(r\.cancelled_at\) t\.abgesagt \+= 1;/);
    assert.match(CLOSING_TAB, /sum\.abgesagt \+= t\.abgesagt;/);
    assert.match(CLOSING_TAB, /closingShowRate\(sum\.shows, sum\.closings, sum\.abgesagt\)/);
    assert.match(CLOSING_TAB, /closingShowRate\(t\.shows, t\.closings, t\.abgesagt\)/);
  });

  test("keine rohe Rechnung gegen die volle Termin-Menge mehr", () => {
    // Die alte Fassung stand zweimal im Code (Kachel und Personen-Zeile). Bliebe
    // eine davon stehen, widersprächen sich zwei Zahlen auf demselben Bildschirm.
    assert.doesNotMatch(CLOSING_TAB, /pct\(sum\.shows, sum\.closings\)/);
    assert.doesNotMatch(CLOSING_TAB, /pct\(t\.shows, t\.closings\)/);
  });
});

describe("Befund B — Setting- und Funnel-Tab filtern die Quelle gleich", () => {
  test("der Setting-Tab vergleicht den Registry-Schlüssel, nicht den Rohwert", () => {
    // `source_type` ist nullable: Unter `?quelle=sonstige` fiel jede Zeile ohne
    // Quelle aus allen vier Kacheln, während der Donut daneben sie als
    // „Sonstige" auswies.
    assert.match(SETTING_TAB, /const channel = channelKeyOf\(r\.source_type\);/);
    assert.match(SETTING_TAB, /if \(quelle !== "alle" && channel !== quelle\) continue;/);
    assert.doesNotMatch(SETTING_TAB, /r\.source_type !== quelle/);
  });

  test("auch der Gruppierungsschlüssel der Quellen-Sektion nimmt den Registry-Wert", () => {
    // Zweite Hälfte desselben Befunds, in derselben Datei stehen geblieben:
    // `sourceKeyOf` schlüsselte über den Rohwert, beschriftete die Zeile aber
    // über `channelLabel()`. Alles Unbekannte heißt dort „Sonstige" — zwei
    // Rohwerte ergäben also zwei Zeilen mit identischem Label, die niemand
    // auseinanderhalten kann. Der Funnel-Tab (`srcOf`) faltet sie zu einer.
    assert.match(SETTING_TAB, /key: `t:\$\{channelKeyOf\(r\.source_type\)\}`/);
    assert.doesNotMatch(SETTING_TAB, /key: `t:\$\{r\.source_type \?\? "sonstige"\}`/);
  });

  test("die Auflösung steht EINMAL im Fundament, nicht je Tab", () => {
    // Drei Kopien derselben Funktion waren der Nährboden des Befunds: Der
    // Setting-Tab hatte gar keine und behalf sich mit dem Rohvergleich.
    for (const [name, source] of [
      ["SettingTab", SETTING_TAB],
      ["FunnelTab", FUNNEL_TAB],
      ["UebersichtTab", UEBERSICHT_TAB],
    ] as const) {
      assert.doesNotMatch(source, /function channelKeyOf\(/, `${name} hält eine eigene Kopie`);
      assert.match(source, /channelKeyOf/, `${name} nutzt den Helfer gar nicht`);
    }
  });
});

describe("Befund C — „Warten aktuell“ zählt nur noch echte Wiedervorlagen", () => {
  test("die Kachel führt dieselben Status-Riegel wie recycle_tasks", () => {
    // Kein Rückkehrpfad räumt `next_recycle_at` ab. Ohne den Riegel steht in der
    // Kachel ein gewonnenes Closing als offene Wiedervorlage — im Board
    // /nachfassen taucht es längst nicht mehr auf, weil die RPC prüft.
    assert.match(RECYCLE_SECTION, /if \(r\.next_recycle_at && isRecycleCandidate\(r\)\) waiting \+= 1;/);
  });

  test("die Felder dafür werden auch geladen", () => {
    // Der Riegel ist nur so gut wie die Spaltenliste: Fehlt ein Feld im Select,
    // ist es `undefined` und der Zweig fällt still auf „ja" zurück.
    assert.match(ANALYSE_DATA, /RECYCLE_CONTACT_SELECT[\s\S]{0,200}blocked_at/);
    assert.match(ANALYSE_DATA, /RECYCLE_CONTACT_SELECT[\s\S]{0,200}follow_up_number/);
    assert.match(ANALYSE_DATA, /RECYCLE_PHONE_SELECT[\s\S]{0,200}status/);
    assert.match(ANALYSE_DATA, /RECYCLE_SETTING_SELECT[\s\S]{0,200}no_show_resolution/);
    assert.match(ANALYSE_DATA, /RECYCLE_SETTING_SELECT[\s\S]{0,200}revived_at/);
    assert.match(ANALYSE_DATA, /RECYCLE_CLOSING_SELECT[\s\S]{0,200}revived_at/);
  });
});

describe("Befund D — Recycling-Zeilen ohne owner_name zählen wieder mit", () => {
  test("die Sektion nutzt die Kette owner_name → Listen-Ersteller", () => {
    const scope = slice(RECYCLE_SECTION, "const inScope =", "const byOrigin");
    assert.match(scope, /listOwnerMatches\(r, selectedOwners, selectedIds\)/);
    // Der alte Einzeiler prüfte nur den Namen — `ownerKey(null)` ergibt "" und
    // trifft nie.
    assert.doesNotMatch(scope, /selectedOwners\.has\(ownerKey\(r\.owner_name\)\)/);
  });

  test("der Ersteller der Elternliste wird geladen UND durchgereicht", () => {
    // Er stand schon im Select und wurde im Mapper verworfen — geladen und
    // weggeworfen sieht von außen aus wie „gibt es nicht".
    assert.match(ANALYSE_DATA, /lists\?: \{ owner_name: string \| null; created_by_user_id: string \| null \}/);
    assert.match(ANALYSE_DATA, /list_created_by_user_id:/);
  });
});

describe("Befund E — Sperren verschwinden nicht im Datenlage-Fenster", () => {
  test("die Kachel „Gesperrt“ hängt nicht mehr an `covers`", () => {
    // `covers` wird aus dem ersten VERSUCH abgeleitet; eine Sperre entsteht bei
    // `keine_zusammenarbeit` aber sofort, ein erster Versuch frühestens nach
    // Wochen. Bis dahin zeigte die Kachel „—", obwohl korrekt gezählt wurde.
    // Nur der Wert-Ausdruck, nicht der Kommentar darüber — der nennt `covers`
    // gerade deshalb, weil die Kachel nicht mehr daran hängt.
    const wert = slice(RECYCLE_SECTION, 'label: "Gesperrt",', "},");
    assert.doesNotMatch(wert, /covers/);
    assert.match(wert, /value: data\.available \? INT\.format\(excludedInRange\) : "—"/);
  });

  test("„Warten aktuell“ in der Meta-Zeile ebenso wenig", () => {
    // Dieselbe Begründung, zweite Zahl: `waiting` ist der Stand von HEUTE —
    // der Infotext sagt das wörtlich —, während `covers` am ersten
    // protokollierten VERSUCH hängt. Am Tag eins gibt es keinen Versuch, aber
    // sehr wohl eine Warteschlange; an `covers` gehängt war die gerade erst
    // richtiggestellte Zahl ausgerechnet dann unsichtbar.
    const meta = slice(RECYCLE_SECTION, "const meta = [", ".join(");
    assert.match(meta, /data\.available \? `\$\{INT\.format\(waiting\)\} warten aktuell` : null/);
    // Die alte Fassung hatte beide Hälften in EINEM Template-String hinter
    // demselben `covers`.
    assert.doesNotMatch(RECYCLE_SECTION, /Versuchen · \$\{INT\.format\(waiting\)\}/);
  });
});

describe("Befund F — die Meta-Zeile beschriftet ihre Ausschlussmenge richtig", () => {
  test("„mit Dauer-Angabe“ statt „mit Setting-Bezug“", () => {
    // `speedUnknown` steigt auch, wenn nur `closing_calls.call_at` fehlt. Ein
    // Bestands-Closing mit sauberer Verknüpfung wurde damit als herkunftslos
    // gemeldet — eine Aussage über ein ganz anderes Feld.
    assert.doesNotMatch(CLOSING_TAB, /von \$\{INT\.format\(sum\.closings\)\} mit Setting-Bezug/);
    assert.match(CLOSING_TAB, /mit Dauer-Angabe/);
  });
});
