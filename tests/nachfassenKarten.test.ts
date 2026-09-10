// Die Karten auf /nachfassen — Anordnung und Farbe.
//
// WARUM ES DIESE DATEI GIBT: Beides ist eine GESTALTUNG, kein Rechenweg, und
// Gestaltungen gehen bei der nächsten Änderung lautlos verloren. Wer einen
// weiteren Knopf „schnell noch danebensetzt", macht aus dem Stapel wieder eine
// umbrechende Reihe; wer einem Badge „zur Unterscheidung" die Kanalfarbe gibt,
// hat in vier Schritten wieder Violett, Grün, Blau und Teal auf derselben
// Seite. Im Betrieb sähe beides vollkommen normal aus — es fiele erst dem
// Auftraggeber auf, und zwar zum dritten Mal.
//
// Zwei Zusagen stehen dahinter:
//  1. Die Knöpfe stehen UNTEREINANDER, über die volle Kartenbreite, und die
//     Hierarchie der Runde davor bleibt: genau EIN Hauptknopf, Sprung-Links
//     leise, „Endgültig raus" als einziges deutlich abgesetzt.
//  2. Die Badges tragen NEUTRALE Töne der Plattform. Farbe bleibt der
//     Dringlichkeit vorbehalten (überfällig, Kontaktfrequenz).
//
// GEPRÜFT WIRD AM QUELLTEXT — dieselbe Bauart und dieselbe Begründung wie in
// tests/nachfassenBoard.test.ts und tests/sidebarBloecke.test.ts: Der
// Test-Runner (`node --experimental-strip-types`) kann `.tsx` nicht laden, und
// eine Attrappe bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen: Das Projekt hat keine `.gitattributes`, und
  // `core.autocrlf=true` legt die Quelldateien unter Windows mit CRLF ab.
  // Mehrere Anker unten tragen ein `\n` — ohne diese Zeile wäre die Datei auf
  // einem frischen Klon rot, ohne dass am geprüften Code etwas fehlte.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

function countOf(source: string, needle: string): number {
  let n = 0;
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Der Rumpf zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const BOARD = read("src/components/nachfassen/NachfassenBoard.tsx");
const BADGE = read("src/components/ui/Badge.tsx");
const ERINNERUNGEN = read("src/components/erinnerungen/ErinnerungenBoard.tsx");

/* Die Anker der vier Quellen-Zweige. Der Telefon-Zweig ist umbrochen, weil
   seine Bedingung zusätzlich den Zustandswechsel „Vorschlags-Knopf ⇄ Feld +
   Speichern" trägt.
   Bewusst als Funktion und nicht als Konstante auf Modulebene: Ein Anker, der
   nicht mehr passt, soll GENAU DEN Test rot machen, der ihn braucht — auf
   Modulebene nähme die erste fehlgeschlagene Zusicherung die ganze Datei mit,
   und man sähe nicht mehr, was sonst noch bricht. */
const ZWEIG_ANKER: Record<string, [from: string, to: string]> = {
  telefon: ['{!doneEntry &&\n          task.source === "telefon" &&', '{!doneEntry && task.source === "setting"'],
  setting: ['{!doneEntry && task.source === "setting" && (', '{!doneEntry && task.source === "closing"'],
  closing: ['{!doneEntry && task.source === "closing" && (', "{/* Recycling:"],
  recycling: [
    '{!doneEntry && task.source === "recycling" && task.recycle_origin && (',
    "{/* Rohmeldung nur im `title`",
  ],
};

function zweig(quelle: keyof typeof ZWEIG_ANKER): string {
  const [from, to] = ZWEIG_ANKER[quelle];
  return slice(BOARD, from, to);
}

/* ------------------------------------------------------------------ *
 * 1 — Die Knöpfe stehen untereinander
 * ------------------------------------------------------------------ */

describe("1 · Der Knopf-Stapel", () => {
  test("die Knopfzone ist eine Spalte, keine umbrechende Reihe", () => {
    // Vorher: `display: flex` + `flexWrap: "wrap"`. Auf 300 Pixel Kartenbreite
    // brach die Reihe ohnehin um — und WO sie umbrach, entschied die Länge der
    // Beschriftungen. Dieselbe Karte sah auf jedem Bildschirm anders aus.
    const stack = slice(BOARD, "const actionStackStyle: React.CSSProperties = {", "};");
    assert.match(stack, /flexDirection: "column"/);
    assert.match(stack, /alignItems: "stretch"/);
    assert.doesNotMatch(stack, /flexWrap/, "Eine umbrechende Knopfzone ist genau das, was hier abgelöst wurde.");
    // …und die Karte benutzt sie auch.
    assert.match(BOARD, /<div style=\{actionStackStyle\}>/);
  });

  test("jeder Aktions-Knopf nimmt die volle Kartenbreite", () => {
    // Ein gestapelter Knopf über die ganze Breite liest sich als Zeile mit
    // klarer Beschriftung und ist auf dem Touchgerät sicher zu treffen
    // (`.ui-btn` hebt bei `pointer: coarse` auf 44 px). Genau EINER ist davon
    // ausgenommen — siehe Block 2.
    assert.equal(countOf(BOARD, "<Button"), 9, "Acht gestapelte Knöpfe plus „Endgültig raus“.");
    assert.equal(countOf(BOARD, "fullWidth"), 8);
    const danger = slice(BOARD, "<div style={dangerRowStyle}>", "</div>");
    assert.doesNotMatch(danger, /fullWidth/, "„Endgültig raus“ ist der eine Knopf ohne volle Breite.");
  });

  test("die Knöpfe kommen aus der Button-Familie, nicht aus vier Inline-Kopien", () => {
    // Vorher lagen `primaryBtnStyle`, `linkBtnStyle`, `navBtnStyle` und
    // `dangerBtnStyle` als eigene Objekte daneben — vier Kopien der Varianten
    // aus components/ui/Button.tsx, die früher oder später auseinanderlaufen.
    assert.match(BOARD, /import \{ Button \} from "@\/components\/ui\/Button";/);
    for (const alt of ["primaryBtnStyle", "linkBtnStyle", "navBtnStyle", "dangerBtnStyle"]) {
      assert.doesNotMatch(BOARD, new RegExp(alt), `${alt} ist durch die Button-Komponente abgelöst.`);
    }
  });

  test("die Wege stehen zusammen in EINER leisen Zeile, nicht im Stapel", () => {
    // Sie schreiben nichts, sie führen nur woandershin. Als weitere vollbreite
    // Knöpfe stünden sie gleichrangig neben den Aktionen — und der Stapel wäre
    // doppelt so hoch. Gesammelt werden sie an genau einer Stelle, sonst stünde
    // die Zeile viermal im JSX.
    assert.match(BOARD, /const jumps: React\.ReactNode\[\] = \[\];/);
    assert.match(BOARD, /\{!doneEntry && jumps\.length > 0 && <div style=\{jumpRowStyle\}>\{jumps\}<\/div>\}/);
    const row = slice(BOARD, "const jumpRowStyle: React.CSSProperties = {", "};");
    assert.match(row, /flexWrap: "wrap"/, "Die Wege-Zeile darf umbrechen — die Aktionen darüber nicht.");
    assert.match(row, /borderTop: "1px solid var\(--border-subtle\)"/, "Hairline statt eigener Fläche.");
    // Fünf Wege: Telefonliste, Rufnummer, Setting, Closing, Pitch-Liste — plus
    // das Dossier. Alle tragen dieselbe Ghost-Behandlung an `.ui-btn`.
    assert.equal(countOf(BOARD, 'className="ui-btn"'), 6);
    // Kein Weg ist ein Button-Baustein: sonst sähe ein Sprung aus wie eine Aktion.
    for (const quelle of Object.keys(ZWEIG_ANKER)) {
      assert.doesNotMatch(zweig(quelle), /jumpStyle/, "Sprung-Links gehören in die Wege-Zeile, nicht in den Aktions-Zweig.");
    }
  });

  test("der Rückweg nach dem Erledigen trägt weiter", () => {
    // Die Karte bleibt kurz gedimmt stehen und trägt einen Knopf. Beim Umbau
    // auf den Stapel wäre das die leiseste Stelle zum Verlieren gewesen — sie
    // hängt an einem Zustand, den man beim Ansehen der Seite nicht sieht.
    const done = slice(BOARD, "<div style={actionStackStyle}>", "{/* Telefon-Rückruf");
    assert.match(done, /\{doneEntry && \(/, "Der Rückweg steht IM Stapel, nicht daneben.");
    assert.match(done, /\{doneEntry\.undo && \(/);
    assert.match(done, /onClick=\{undoNow\}/);
    assert.match(done, /fullWidth/, "Auf der gedimmten Karte ist er die einzige Handlung.");
    // …aber kein Primär-Knopf: Zurücknehmen ist die Ausnahme, nicht der Schritt.
    assert.doesNotMatch(done, /variant="primary"/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Die Hierarchie der Runde davor bleibt
 * ------------------------------------------------------------------ */

describe("2 · Genau ein Hauptknopf, und „Endgültig raus“ abgesetzt", () => {
  test("jede Quelle hat GENAU EINEN Primär-Knopf", () => {
    // Die Regel aus der letzten Runde. Zwei gefüllte Knöpfe übereinander
    // hätten gar keinen Hauptknopf mehr — dann liest man wieder jeden einzeln,
    // dreißigmal am Vormittag.
    for (const quelle of Object.keys(ZWEIG_ANKER)) {
      const erwartet = quelle === "telefon" ? 2 : 1;
      assert.equal(
        countOf(zweig(quelle), 'variant="primary"'),
        erwartet,
        quelle === "telefon"
          ? "Telefon zeigt denselben einen Knopf in zwei Zuständen (Vorschlag ⇄ Speichern) — nie beide gleichzeitig."
          : `Der Zweig „${quelle}“ muss genau einen Primär-Knopf tragen.`,
      );
    }
    // Und die beiden Telefon-Zustände schließen sich wirklich aus.
    assert.match(zweig("telefon"), /\(callbackDraft === null \? \(/);
  });

  test("die schreibende Zweitaktion ist nicht gefüllt", () => {
    // „Reagiert" ist die Ausnahme im Recycling und darf dem CTA darüber nicht
    // die Lautstärke nehmen: die Success-Variante ist eine reine Hairline,
    // keine grüne Fläche.
    assert.equal(countOf(zweig("recycling"), 'variant="success"'), 1);
    assert.doesNotMatch(zweig("recycling"), /var\(--success-bg\)/, "Keine gefüllte Fläche für die Zweitaktion.");
  });

  test("„Endgültig raus“ steht zuletzt, allein, hinter einer zweiten Hairline", () => {
    // Vier Dinge setzen ihn ab, KEINS davon ist eine neue Farbe: Position
    // (ganz unten), Trennlinie, Breite (Inhalt statt voll) und Ausrichtung
    // (rechts — die gestapelten Aktionen beginnen alle links).
    const row = slice(BOARD, "const dangerRowStyle: React.CSSProperties = {", "};");
    assert.match(row, /justifyContent: "flex-end"/);
    assert.match(row, /borderTop: "1px solid var\(--border-subtle\)"/);

    const jumps = BOARD.indexOf("<div style={jumpRowStyle}>");
    const danger = BOARD.indexOf("<div style={dangerRowStyle}>");
    assert.notEqual(jumps, -1);
    assert.notEqual(danger, -1);
    assert.ok(jumps < danger, "Der unwiderrufliche Knopf gehört ans Ende des Stapels, unter die Wege.");
    assert.ok(danger > BOARD.indexOf("{error && ("), "Der Fehler-Span steht weiterhin davor.");

    // Er ist als einziger kleiner als die Aktionen darüber und trägt die
    // Danger-Hairline, die er schon hatte — nicht mehr, nicht weniger.
    const knopf = slice(BOARD, "<div style={dangerRowStyle}>", "</div>");
    assert.match(knopf, /variant="danger"/);
    assert.match(knopf, /size="sm"/);
    assert.match(knopf, /destructive: true/, "Die Rückfrage bleibt Teil der Absetzung.");
    // Und er bleibt der EINZIGE Danger-Knopf der Seite.
    assert.equal(countOf(BOARD, 'variant="danger"'), 1);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Neutrale Badges
 * ------------------------------------------------------------------ */

describe("3 · Die Kanal-Identitätsfarben stehen nicht mehr auf den Karten", () => {
  test("das Board nennt keine Stage-Farbe mehr", () => {
    // Violett (Setting), Grün (Closing), Blau (Telefon), Teal (LinkedIn) —
    // weder als Token noch als roher Kanalwert. Auf einer einzelnen Karte
    // liest sich das als Zuordnung; auf dreißig Karten untereinander ist es
    // Lärm, und der Kanal steht ohnehin als Wort und Symbol daneben.
    assert.doesNotMatch(BOARD, /--stage-/, "Keine Kanalfarbe im Nachfassen-Board.");
    for (const kanalwert of ["139 92 246", "63 163 111", "78 128 214", "13 148 136"]) {
      assert.ok(!BOARD.includes(kanalwert), `Kanalfarbe ${kanalwert} steht noch im Board.`);
    }
  });

  test("Kanal, Anlass und Grund laufen über den neutralen Badge-Ton", () => {
    assert.equal(countOf(BOARD, '<Badge tone="neutral">'), 3, "Kanal + Recycling-Grund + Setting-Anlass.");
    // Der Kanal-Eintrag trägt nur noch Wort und Symbol — keine Farbfelder mehr.
    const meta = slice(BOARD, "const CHANNEL_META: Record<", "};");
    assert.match(meta, /\{ label: string; icon: React\.ReactNode \}/);
    assert.doesNotMatch(meta, /color:|bg:|border:/);
  });

  test("auch Sektionskopf und Filterreihe sind neutral", () => {
    // Sie standen direkt über den Karten und trugen dieselben vier Farben
    // gleich noch einmal. Die aktive Filter-Pille läuft jetzt über die eine
    // Behandlung, die das System für einen UI-Zustand kennt: den Orange-Tint.
    const sektion = slice(BOARD, "const SECTION_META: Record<", "};");
    assert.match(sektion, /\{ icon: React\.ReactNode \} \| undefined/);
    assert.doesNotMatch(sektion, /tone:|bg:|color:/);
    assert.match(BOARD, /background: active \? "var\(--accent-muted\)" : "var\(--surface-1\)"/);
    assert.match(BOARD, /color: active \? "var\(--orange-300\)" : "var\(--text-muted\)"/);
  });

  test("Dringlichkeit bleibt farbig — sonst wäre die Umstellung ein Verlust", () => {
    // Die Gegenprobe zum Rest dieses Blocks: „neutral" gilt für KATEGORIEN.
    // Überfällig ist keine Kategorie, sondern eine Dringlichkeit, und die
    // Kontaktfrequenz-Warnung ebenso.
    assert.match(BOARD, /borderLeft: overdue \? "3px solid var\(--color-error-text\)"/);
    assert.match(BOARD, /color: overdue \? "var\(--color-error-text\)" : "var\(--text-secondary\)"/);
    assert.match(BOARD, /color: "var\(--warning-fg\)"/, "Der Kontaktfrequenz-Hinweis bleibt Gold.");
    assert.match(BOARD, /background: overdueOnly \? "var\(--warning-bg\)"/, "Die Überfällig-Pille bleibt Gold.");
  });

  test("das geteilte Stage-Badge ist neutral — und damit alle drei Arbeitsboards", () => {
    // `StageBadge` steht auf /erinnerungen, in /ablage und im Lead-Dossier.
    // Nur /nachfassen umzustellen hieße, drei nebeneinander benutzte Seiten
    // verschieden aussehen zu lassen; die Stufe steht dort überall als WORT im
    // Badge, die Farbe wiederholt sie nur.
    const stageBadge = slice(BADGE, "export function StageBadge(", "\n}\n");
    assert.match(stageBadge, /\{ \.\.\.TONE_STYLES\.neutral, \.\.\.style \}/);
    assert.doesNotMatch(stageBadge, /STAGE_TINT|STAGE_COLOR|<StageDot/);
    assert.doesNotMatch(BADGE, /const STAGE_TINT/, "Die Tint-Tabelle hat keinen Aufrufer mehr.");
    // Der Kanal-Badge daneben folgt derselben Regel — „Kanal frei wählen"
    // bleibt dagegen amber: das ist keine Kategorie, sondern eine offene Stelle.
    assert.match(ERINNERUNGEN, /<Badge tone=\{card\.channel \? "neutral" : "warning"\}>/);
  });

  test("die Palette selbst bleibt stehen — sie trägt anderswo Information", () => {
    // In Kalender-Chips (lib/terminMeta.ts) und in den Diagrammen des
    // Analyse-Bereichs ist die Farbe die EINZIGE Unterscheidung. Deshalb wird
    // hier nur die Anwendung auf Arbeitskarten neutralisiert, nicht die
    // Farbtabelle in `src/lib` angefasst.
    assert.match(BADGE, /export const STAGE_COLOR: Record<StageKey, string>/);
    assert.match(BADGE, /export function StageDot\(/);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Design-Riegel
 * ------------------------------------------------------------------ */

describe("4 · Keine neue Farbe, kein neues Maß", () => {
  // Dieselbe Bauart wie der Design-Block in tests/sidebarBloecke.test.ts: Ein
  // eingeschleuster Hex- oder rgb()-Wert wäre die leiseste Art, ein
  // Farbsystem aufzuweichen — er sieht im Betrieb aus wie eine Farbe, die es
  // immer gab. Erlaubt bleibt genau das, was schon vorher dastand: die 0.28er
  // Ränder der SEMANTISCHEN Töne (Success, Warning, Danger, Info), für die es
  // keinen Alpha-Token gibt.
  const ERLAUBT: Record<string, string[]> = {
    "NachfassenBoard.tsx": ["rgb(209 162 79 / 0.28)", "rgb(214 90 82 / 0.28)"],
    "Badge.tsx": [
      "rgb(209 162 79 / 0.28)",
      "rgb(214 90 82 / 0.28)",
      "rgb(63 179 127 / 0.28)",
      "rgb(78 128 214 / 0.28)",
    ],
    "ErinnerungenBoard.tsx": ["rgb(214 90 82 / 0.28)", "rgb(63 179 127 / 0.28)"],
  };

  for (const [name, quelle] of [
    ["NachfassenBoard.tsx", BOARD],
    ["Badge.tsx", BADGE],
    ["ErinnerungenBoard.tsx", ERINNERUNGEN],
  ] as const) {
    test(`${name}: keine unbekannten Farbwerte`, () => {
      assert.deepEqual([...new Set(quelle.match(/rgba?\([^)]*\)/g) ?? [])].sort(), ERLAUBT[name].slice().sort());
      assert.deepEqual(quelle.match(/#[0-9a-fA-F]{3,8}/g) ?? [], [], "Kein roher Hexwert — Farben kommen aus Tokens.");
    });
  }

  test("die neuen Abstände sind Tokens der Spacing-Skala", () => {
    // Kein `0.375rem`/`0.3rem` mehr in der Knopfzone: Die drei neuen
    // Stil-Objekte rechnen ausschließlich mit `--sp-*` und `--fs-*`.
    for (const objekt of ["actionStackStyle", "jumpStyle", "jumpRowStyle", "dangerRowStyle"]) {
      const rumpf = slice(BOARD, `const ${objekt}: React.CSSProperties = {`, "};");
      assert.doesNotMatch(rumpf, /\d+(\.\d+)?rem/, `${objekt} führt ein eigenes Abstandsmaß ein.`);
    }
  });
});
