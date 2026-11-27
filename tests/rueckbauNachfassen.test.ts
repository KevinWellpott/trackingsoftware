// /nachfassen nach dem Rückbau UND nach dem Nachfass-Eingang — was vom Rückbau
// gilt, obwohl die Seite wieder mehr als eine Quelle zeigt.
//
// ── GEÄNDERTER GEGENSTAND ──────────────────────────────────────────────────
// Hier stand die Prüfung der auf das Recycling geschrumpften Seite: das Board
// `NachfassenBoard`, die Action `actions/nachfassen.ts` (getNachfassenTasks,
// undoNachfassenTask, die beiden „…Undoable"-Hüllen), Knopf-Stapel, Kartenraster
// und Ursprungs-Katalog. Am 27.11.2026 hat der Auftraggeber entschieden, dass
// /nachfassen wieder der EINE Eingang für die Tagesarbeit wird — Termine ohne
// nächsten Schritt, Telefon-Rückrufe, fällige Recycling-Leads
// (docs/nachfassen-umbau/PLAN-nachfass-eingang.md). Board und Action sind
// gelöscht; was an ihnen hing (Kartenraster, Knopf-Stapel, Undo-Spalten der
// Recycling-Hüllen), hat keinen Gegenstand mehr und ist mit ihnen gegangen.
//
// GEBLIEBEN sind die Zusicherungen, die nicht am Board hingen, sondern an der
// Sache — und die gelten für den neuen Eingang genauso:
//  1. Die Union-RPC `nachfassen_tasks` wird nicht gelesen und nicht gedroppt.
//  2. Kein Kopiertext, keine Vorlagen, keine Kanal-ABLEITUNG.
//  3. Die Route bleibt, samt Rückweg `?from=nachfassen`.
//  4. Ein Ausfall sieht nicht aus wie Feierabend.
//  5. Ein Fehlklick ist kein Endzustand — und Rückgängig schreibt nur, was der
//     Server erlaubt.
//  6. Dringlichkeit ist GOLD (`DRAN_TONE`), keine neue Farbe.
//
// GEPRÜFT WIRD AM QUELLTEXT — der Test-Runner (`node --experimental-strip-types`)
// kann `.tsx` nicht laden und eine Server Action nicht ausführen. Die REGELN des
// Eingangs (Gruppen, Altfall, Versuche) prüft tests/nachfassRegel.test.ts am
// Verhalten.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Wie oft steht `needle` in `source`? */
function countOf(source: string, needle: string): number {
  let n = 0;
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * Derselbe Quelltext ohne Kommentare — für jede „das gibt es nicht mehr"-
 * Zusicherung. Die Kommentarköpfe ERKLÄREN, was entfernt wurde, und nennen das
 * Entfernte dabei beim Namen; das soll stehen bleiben.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Der Rumpf zwischen zwei Ankern — beide müssen vorkommen. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const BOARD = read("src/components/nachfassen/NachfassEingang.tsx");
const DATA = read("src/lib/nachfassenData.ts");
const ACTION = read("src/app/actions/nachfassKontakt.ts");
const SEITE = read("src/app/(dashboard)/nachfassen/page.tsx");
const BACKLINK = read("src/components/ui/BackLink.tsx");

const BOARD_CODE = codeOnly(BOARD);
const DATA_CODE = codeOnly(DATA);
const ACTION_CODE = codeOnly(ACTION);

/* ------------------------------------------------------------------ *
 * 1 — Was gefallen ist, bleibt gefallen
 * ------------------------------------------------------------------ */

describe("1 · Was gefallen ist, bleibt gefallen", () => {
  test("die alte Action und das alte Board sind weg — nicht nur abgeklemmt", () => {
    // Eine Server Action ohne Aufrufer ist per direktem POST erreichbar — kein
    // Rest, sondern eine offene Tür. Gesucht wird am Code aller drei Nachfolger.
    for (const [name, src] of [
      ["NachfassEingang", BOARD_CODE],
      ["nachfassenData", DATA_CODE],
      ["nachfassKontakt", ACTION_CODE],
    ] as const) {
      assert.doesNotMatch(src, /@\/app\/actions\/nachfassen"|NachfassenBoard|getNachfassenTasks|undoNachfassenTask/, name);
    }
  });

  test("die Union-RPC wird nicht gelesen — und bleibt trotzdem stehen", () => {
    // `nachfassen_tasks` liegt eingefroren auf der Datenbank. Der Eingang baut
    // seine Mengen selbst (Termine über `terminZustand`, Rückrufe direkt,
    // Recycling über `recycle_tasks`) — die Union würde dieselbe Frage ein
    // zweites Mal und anders beantworten (Zweige ③④ lesen `follow_up_due` nur
    // für `no_show`/`unqualifiziert`).
    for (const datei of [
      "src/lib/navCounts.ts",
      "src/lib/navCountsData.ts",
      "src/lib/nachfassenData.ts",
      "src/app/actions/nachfassKontakt.ts",
    ]) {
      assert.doesNotMatch(codeOnly(read(datei)), /nachfassen_tasks/, `${datei} liest die Union-RPC wieder`);
    }
    assert.match(DATA, /\.rpc\("recycle_tasks", \{/, "Das Recycling kommt weiter aus seiner eigenen RPC.");
    assert.doesNotMatch(
      read("supabase/migrations/20260404000028_fundament.sql"),
      /drop function[^\n]*nachfassen_tasks/i,
      "Die eingefrorene RPC wurde gedroppt",
    );
  });

  test("kein Kopiertext, keine Vorlagen-Auflösung, keine Kanal-Ableitung", () => {
    // „Es ist vollkommen egal, WIE jemand kontaktiert wird" — die Zeile sagt WER
    // dran ist und WARUM, nicht was zu schreiben ist. Der Kanal im Popover ist
    // eine reine, optionale Angabe (Plan §4.3), keine Ableitung wie die
    // gefallene `resolveFollowUpChannel` mit WhatsApp-Einwilligung.
    for (const rest of [
      "renderResolved",
      "getTemplateBundles",
      "messageTemplates",
      "renderRecycleTemplate",
      "prepared_text",
      "resolveFollowUpChannel",
      "TEMPLATE_SOURCE_LABELS",
      "navigator\\.clipboard",
    ]) {
      for (const [name, src] of [
        ["Board", BOARD_CODE],
        ["Loader", DATA_CODE],
        ["Action", ACTION_CODE],
      ] as const) {
        assert.doesNotMatch(src, new RegExp(rest), `${name} schleppt noch „${rest}" mit.`);
      }
    }
    assert.match(ACTION, /kanal\?: Kanal \| null;/, "Der Kanal ist optional.");
  });

  test("kein Verweis nach /erinnerungen", () => {
    assert.doesNotMatch(BOARD_CODE, /SECTION_CROSSLINK|\/erinnerungen/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Die Route bleibt
 * ------------------------------------------------------------------ */

describe("2 · Die Route bleibt, der Rückweg hängt daran", () => {
  test("/nachfassen ist eine echte Seite, keine Weiterleitung", () => {
    assert.doesNotMatch(codeOnly(SEITE), /redirect\(/, "Die Seite ist keine Weiterleitung geworden.");
    // GEÄNDERT (Redesign Phase 4): Die Seite heißt wie ihr Navigationspunkt
    // „Heute"; die Zeile darüber sagt „Nachfassen".
    assert.match(SEITE, /Heute\n\s*<InfoPopover/, "Der Titel muss sagen, was die Seite zeigt.");
    assert.match(SEITE, /eyebrow="Nachfassen"/);
    assert.match(BACKLINK, /nachfassen: \{ href: "\/nachfassen"/, "Der Rückweg der Detailseiten hängt weiter daran.");
  });

  test("die Detailseiten-Links tragen die Herkunft mit", () => {
    // Sonst führt der Zurück-Pfeil der Detailseite in den Kalender statt in den
    // Eingang zurück.
    assert.match(DATA, /`\/setting\/\$\{r\.id\}\?from=nachfassen`/);
    assert.match(DATA, /`\/closing\/\$\{r\.id\}\?from=nachfassen`/);
  });

  test("erkannt wird eine feste Liste, nicht ein beliebiger Pfad aus der URL", () => {
    // `?from=` landet in einem `href`. Ein übernommener Fremdwert wäre ein
    // offener Weiterleitungspunkt — und ein Zurück-Pfeil ist genau der Knopf,
    // den niemand vorher liest.
    const fn = slice(BACKLINK, "export function backTargetFrom", "\n}\n");
    assert.match(fn, /BACK_TARGETS\[key\][\s\S]*\?\? fallback/);
    assert.doesNotMatch(fn, /href: key|href: from/, "Der Rohwert darf nie selbst zum Ziel werden.");
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Ein Ausfall sieht nicht aus wie Feierabend
 * ------------------------------------------------------------------ */

describe("3 · Ein Ausfall sieht nicht aus wie Feierabend", () => {
  test("der Loader reicht die Verfügbarkeit von Recycling und Protokoll durch", () => {
    // Fehlt Migration 0033 bzw. 0049, wäre eine leere Liste nicht von „nichts
    // fällig" unterscheidbar.
    assert.match(DATA, /\.then\(\(rows\) => \(\{ rows, available: true \}\)\)\s*\.catch\(\(\) => \(\{ rows: \[\], available: false \}\)\)/);
    assert.match(DATA, /protokollVerfuegbar: protokoll\.available/);
    assert.match(DATA, /recyclingVerfuegbar: boolean/);
  });

  test("das Board zeigt dafür einen Kasten, keine leere Liste", () => {
    assert.match(BOARD, /\{!props\.recyclingVerfuegbar && \(/);
    assert.match(BOARD, /\{!props\.protokollVerfuegbar && \(/);
  });

  test("„Heute erledigt“ behauptet ohne Protokoll keine Zahl", () => {
    assert.match(DATA, /heuteErledigt: protokoll\.available \? heuteErledigt : 0/);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Rückgängig und fail-closed
 * ------------------------------------------------------------------ */

describe("4 · Ein Fehlklick ist kein Endzustand", () => {
  test("nach „Kontakt eintragen“ steht ein Rückweg — nur, wenn die Aktion einen mitliefert", () => {
    assert.match(BOARD, /\{toast\.undo && \(/);
    assert.match(BOARD, /await nachfassRueckgaengig\(token\)/);
    assert.match(BOARD, /^\s*Rückgängig$/m);
  });

  test("der Vorher-Stand wird VOR dem Schreiben gelesen", () => {
    const koerper = slice(ACTION, "export async function kontaktEintragen(", "export async function nachfassRueckgaengig(");
    const lesen = koerper.indexOf("const { data: vorherRaw }");
    const protokoll = koerper.indexOf("const kontakt = await protokolliere(");
    const schreiben = koerper.indexOf(".update(");
    assert.ok(lesen !== -1 && protokoll !== -1 && schreiben !== -1, "Anker fehlen");
    assert.ok(lesen < protokoll && protokoll < schreiben, "Sonst steht im Rückweg der Stand von gerade eben.");
  });

  test("fail-closed: Scheitert das Datum, wird der Protokolleintrag zurückgenommen", () => {
    // Jede Fehlerbehandlung endet in „bleibt Arbeit", nie in „ist versorgt".
    const koerper = slice(ACTION, "export async function kontaktEintragen(", "export async function nachfassRueckgaengig(");
    assert.equal(countOf(koerper, "await protokollZuruecknehmen(kontakt.id);"), 2, "Termin-Update, Recycling-Datum");
  });

  test("welche Spalten Rückgängig schreibt, bestimmt der Server — nicht das Token", () => {
    const undo = slice(ACTION, "export async function nachfassRueckgaengig(", "export async function aufgeben(");
    assert.match(undo, /const erlaubt =/);
    assert.match(undo, /for \(const k of erlaubt\)/);
    assert.doesNotMatch(undo, /Object\.keys\(undo\.vorher\)/, "Die Spalten dürfen nicht aus dem Token stammen.");
    assert.match(undo, /\.from\(TABELLE\[undo\.art\]\)/);
    // Nur der eigene, frische Eintrag.
    assert.match(undo, /row\.created_by_user_id !== access\.user\.id/);
    assert.match(undo, /10 \* 60 \* 1000/);
    // Und die aktive Organisation: Für einen Plattform-Admin lässt RLS sonst
    // jede Zeile der Plattform durch.
    assert.match(undo, /\.eq\("workspace_id", access\.workspace_id\)/);
  });

  test("Sperren bekommt bewusst KEINEN Rückweg", () => {
    // Die Sperrliste ist „nie wieder". Ein Rückgängig widerspräche der Zusage
    // im Bestätigungsdialog.
    assert.match(ACTION, /export async function sperren\([^)]*\): Promise<\{ error\?: string \}>/);
  });
});

/* ------------------------------------------------------------------ *
 * 5 — Der Deckel bleibt wirksam
 * ------------------------------------------------------------------ */

describe("5 · Der Recycling-Deckel wirkt auch aus dem Eingang", () => {
  test("ein Versuch ist eine RUNDE: erst „Aufgeben“ zählt ihn über recycle_attempt()", () => {
    // Ein einzelnes „nicht erreicht" verbraucht keinen Versuch — sonst nahmen
    // zwei verpasste Anrufe an zwei Tagen einen Lead endgültig heraus
    // (Ablauf-Prüfung 27.11.). `aufgeben()` zählt die Runde und plant die
    // nächste über `scheduleRecycle`, das am Deckel kein Datum mehr setzt.
    const eintragen = slice(ACTION, "export async function kontaktEintragen(", "export async function nachfassRueckgaengig(");
    assert.doesNotMatch(eintragen, /supabase\.rpc\("recycle_attempt"/);
    const aufgeben = slice(ACTION, "export async function aufgeben(", "export async function sperren(");
    assert.match(aufgeben, /supabase\.rpc\("recycle_attempt", \{/);
    assert.match(aufgeben, /scheduleRecycle\(ORIGIN\[art\], id\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 6 — Design-Riegel
 * ------------------------------------------------------------------ */

describe("6 · Dringlichkeit ist Gold, keine neue Farbe", () => {
  test("das Board liest DRAN_TONE — dieselbe Definition wie Termin- und LinkedIn-Liste", () => {
    assert.match(BOARD, /import \{ DRAN_TONE \} from "@\/lib\/dranRegel";/);
    // GEÄNDERT (Redesign Phase 6): Die Zeile trägt `data-dran`, den Verlaufston
    // setzt globals.css §11 aus `--gold-tint` — demselben Token wie
    // `DRAN_TONE.bg` (`--warning-bg`). Der Punkt ist der gemeinsame
    // `.dran-mark` aus §6.9.
    assert.match(BOARD, /data-dran=\{dran \|\| undefined\}/);
    assert.match(BOARD, /className="dran-mark" data-dran=\{dran \? "true" : undefined\}/);
    const css = read("src/app/globals.css");
    assert.match(css, /\.nachfass-zeile\[data-dran\] \{ background: linear-gradient\(90deg, var\(--gold-tint\)/);
    assert.match(css, /--gold-tint: var\(--warning-bg\)/);
    assert.match(read("src/lib/dranRegel.ts"), /bg: "var\(--warning-bg\)"/);
  });

  test("keine rgb()-Werte im Board", () => {
    assert.deepEqual(BOARD.match(/rgba?\([^)]*\)/g) ?? [], []);
  });

  test("die Knöpfe kommen aus der Button-Familie", () => {
    assert.match(BOARD, /import \{ Button \} from "@\/components\/ui\/Button";/);
  });
});
