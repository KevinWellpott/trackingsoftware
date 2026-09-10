// /nachfassen als Board, das man wirklich abarbeiten kann.
//
// Vier Zusagen werden hier festgehalten — jede davon war vorher gebrochen:
//  1. Jede Aktion, die eine Karte wegnimmt, hat einen Rückweg (außer der einen,
//     die im Bestätigungsdialog ausdrücklich das Gegenteil zusagt).
//  2. Drei der damals fünf Sektionen konnte man auf der Seite gar nicht
//     abhaken — es sind heute drei von vier, LinkedIn ist entfallen.
//  3. Der Zurück-Pfeil der Detailseite führte in den Kalender.
//  4. Die Setting-Karte verschwieg, WARUM sie fällig ist.
//
// Geprüft wird am QUELLTEXT — dieselbe Bauart und dieselbe Begründung wie in
// tests/nachfassenBoard.test.ts: Server Actions mit Supabase-Client und React-
// Client-Components sind im Node-Test-Runner nicht ladbar (kein JSX-Transform,
// keine Umgebung), und eine Attrappe bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen: Das Projekt hat keine `.gitattributes`, und
  // `core.autocrlf=true` legt die Quelldateien unter Windows mit CRLF ab.
  // Mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Wie oft steht `needle` in `source`? `assert.match` beantwortet das nicht. */
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

const ACTION = read("src/app/actions/nachfassen.ts");
const BOARD = read("src/components/nachfassen/NachfassenBoard.tsx");
const BACKLINK = read("src/components/ui/BackLink.tsx");
const SETTING_PAGE = read("src/app/(dashboard)/setting/[callId]/page.tsx");
const CLOSING_PAGE = read("src/app/(dashboard)/closing/[callId]/page.tsx");

/* ------------------------------------------------------------------ *
 * 1 — Rückgängig
 * ------------------------------------------------------------------ */

describe("1 · Ein Fehlklick ist kein Endzustand mehr", () => {
  test("die Karte verschwindet nicht mehr sofort, sondern trägt einen Rückweg", () => {
    // `setHidden(true)` war das ganze Verfahren: Aktion durchgelaufen, Karte
    // weg. „Beantwortet" liegt wenige Pixel neben „Erledigt → nächste Stufe",
    // und ein Fehlgriff setzte `answered = true` samt `next_follow_up_at =
    // null` — der Kontakt war DAUERHAFT aus dem Follow-up-Fluss.
    assert.doesNotMatch(BOARD, /setHidden/, "Kein stilles Wegblenden mehr.");
    assert.match(BOARD, /<Undo2 size=\{12\} \/> Rückgängig/);
  });

  test("der Knopf erscheint nur, wenn die Aktion einen Rückweg mitgeliefert hat", () => {
    // Ohne diese Bedingung stünde er auch dort, wo es nichts zurückzunehmen
    // gibt — und ein Knopf, der einen Zustand rät, ist schlimmer als keiner.
    assert.match(BOARD, /\{doneEntry\.undo && \(/);
  });

  test("„Endgültig raus\" bekommt bewusst KEINEN Rückweg", () => {
    // Der Bestätigungsdialog sagt wörtlich zu, dass sich das nicht rückgängig
    // machen lässt, und `reviveBlockedReason()` verweigert danach jede
    // Rückholung. Ein Rückgängig hier widerspräche der eben gegebenen Zusage.
    const kataloge = slice(ACTION, "const UNDO_COLUMNS", "const TABLE_BY_ORIGIN");
    assert.doesNotMatch(kataloge, /recycle_excluded_at/);
    // …und der Aufruf läuft weiter direkt gegen actions/recycle.ts, ohne Hülle.
    assert.match(BOARD, /runAction\(excludeFromRecycle\(task\.recycle_origin!, task\.entity_id\), "Endgültig gesperrt"\)/);
  });

  test("zurückgeschrieben wird GENAU das, was die Aktion überschrieben hat", () => {
    const spalten = slice(ACTION, "const UNDO_COLUMNS", "/** null = die Tabelle");
    // Die eine Spalte, die `pushPhoneCallback` anfasst — nicht mehr.
    assert.match(spalten, /telefon_rueckruf: \["callback_at"\]/);
    // Das Closing hält zwei Spalten synchron (`follow_up_due` speist die RPC,
    // `follow_up_due_at` die Kaskade) — beide gehören in den Rückweg.
    assert.match(spalten, /closing_wiedervorlage: \["follow_up_due", "follow_up_due_at"\]/);
    // Die vier, die `recycle_attempt()` + `schedule_recycle()` zusammen
    // anfassen: sonst bliebe nach dem Rückgängig ein Versuchszähler stehen.
    assert.match(
      spalten,
      /recycling_versuch: \["recycle_attempt_count", "recycle_last_contacted_at", "next_recycle_at", "recycle_reason_code"\]/,
    );
  });

  test("die Werte werden VOR dem Schreiben gelesen — danach sind sie weg", () => {
    // Der Existenz-/Scope-Select nimmt die zu überschreibende Spalte gleich
    // mit; ein zweiter Roundtrip wäre hier auch zu spät.
    const callback = slice(ACTION, "export async function pushPhoneCallback", "Recycling — dieselben Aktionen");
    const selectPos = callback.indexOf('.select("id, list_id, callback_at")');
    const updatePos = callback.indexOf(".update({ callback_at: iso })");
    assert.ok(selectPos !== -1 && updatePos !== -1 && selectPos < updatePos);

    // Beim Recycling dieselbe Reihenfolge: Die Hülle liest den Stand VOR dem
    // Klick, sonst verbrennt ein Fehlgriff einen von zwei erlaubten Versuchen.
    const versuch = slice(ACTION, "export async function recycleContactedUndoable", '/** „Reagiert"');
    const lesen = versuch.indexOf("const values = await recycleSnapshot(");
    const schreiben = versuch.indexOf("await markRecycleContacted(");
    assert.ok(lesen !== -1 && schreiben !== -1 && lesen < schreiben, "Sonst steht im Rückweg der Stand von gerade eben.");
  });

  test("Tabelle und Spalten bestimmt der Server, nicht das mitgeschickte Token", () => {
    // Server Actions sind per direktem POST erreichbar. Käme die Spaltenliste
    // vom Aufrufer, wäre `undoNachfassenTask` ein beliebiges UPDATE auf vier
    // Tabellen statt der Rücknahme genau einer bekannten Aktion.
    const undo = slice(ACTION, "export async function undoNachfassenTask", "Vom Tisch nehmen");
    assert.match(undo, /const columns = kind \? UNDO_COLUMNS\[kind\] : undefined;/);
    assert.match(undo, /const table = UNDO_TABLE\[kind\] \?\? \(undo\.origin \? TABLE_BY_ORIGIN\[undo\.origin\] : null\);/);
    assert.match(undo, /for \(const col of columns\)/);
    assert.doesNotMatch(undo, /Object\.keys\(undo\.values\)/, "Die Spalten dürfen nicht aus dem Token stammen.");
    // Dieselbe Zugriffsprüfung wie bei den Nachbarn: Lesen über den
    // Nutzer-Client UND Filter auf die aktive Organisation (für einen
    // Plattform-Admin lässt RLS sonst jede Zeile der Plattform durch).
    assert.match(undo, /await getAccessContext\(\)/);
    assert.equal(
      countOf(undo, '.eq("workspace_id", access.workspace_id)'),
      countOf(undo, '.eq("id", undo.entity_id)'),
      "Jeder Zugriff auf die Zeile — Prüfung wie Schreibvorgang — trägt den Org-Filter.",
    );
  });

  test("das Closing nimmt seinen Rückweg über die Action, nicht per rohem UPDATE", () => {
    // `follow_up_due_at` speist die Kaskade `followup_msg` — eine der genau
    // zwei Überschneidungen mit /erinnerungen (docs §1). Ein rohes UPDATE
    // ließe die Erinnerungen auf dem verschobenen Zeitpunkt stehen, und der
    // Text ginge real zum falschen Termin raus.
    const undo = slice(ACTION, "export async function undoNachfassenTask", "Vom Tisch nehmen");
    assert.match(undo, /if \(kind === "closing_wiedervorlage"\) \{[\s\S]*await updateClosingCall\(/);

    // …und das Tagesdatum wird danach wörtlich zurückgeschrieben.
    // `updateClosingCall` LEITET `follow_up_due` aus `follow_up_due_at` ab —
    // eine Bestandszeile ohne den Zeitstempel (die Spalte gibt es erst seit
    // 0032) stünde danach auf NULL, und `nachfassen_tasks` liest genau diese
    // Spalte: Das Closing fiele durch ein Rückgängig ganz aus der
    // Wiedervorlage heraus.
    assert.match(undo, /if \("follow_up_due" in patch\) \{[\s\S]*\.update\(\{ follow_up_due: patch\.follow_up_due \}\)/);
  });

  test("die erledigte Karte überlebt den Refresh — sonst wäre das Fenster eine Behauptung", () => {
    // `router.refresh()` läuft sofort (die Zähler in der Seitenleiste sollen
    // stimmen). Danach liefert der Server die erledigte Aufgabe nicht mehr —
    // ohne diesen Merge wäre die Karte samt Rückweg im selben Augenblick weg.
    assert.match(BOARD, /const withDone = useMemo\(/);
    const merge = slice(BOARD, "const withDone = useMemo(", "const base = useMemo");
    assert.match(merge, /Object\.values\(doneMap\)/);
    assert.match(merge, /!known\.has\(taskKey\(e\.task\)\)/, "Ein weiterhin gelieferter Eintrag darf sich nicht verdoppeln.");

    // Und die Liste darunter rechnet auf dem gemischten Stand, nicht mehr auf
    // dem rohen `tasks` — sonst zählten die Pillen weniger, als auf dem
    // Schirm steht.
    const gefiltert = slice(BOARD, "const base = useMemo(", "// Überfällige zuerst");
    assert.doesNotMatch(gefiltert, /\btasks\b/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Auf der Seite abhakbar
 * ------------------------------------------------------------------ */

describe("2 · Telefon, Setting und Closing lassen sich ohne Seitenwechsel erledigen", () => {
  test("Setting und Closing bekommen ein festes Wochen-Intervall", () => {
    // Beide tragen ein TAGESDATUM (`follow_up_due`, DUE_GRANULARITY: day).
    assert.equal(countOf(BOARD, "<CheckCheck size={12} /> Erledigt → +7 Tage"), 2);
    assert.match(BOARD, /runAction\(pushFollowUpDue\("setting", task\.entity_id\)/);
    assert.match(BOARD, /runAction\(pushFollowUpDue\("closing", task\.entity_id\)/);
    assert.match(ACTION, /const FOLLOW_UP_PUSH_DAYS = 7;/);
  });

  test("gerechnet wird ab HEUTE, nicht ab der alten Fälligkeit", () => {
    // Sonst läge die neue Wiedervorlage bei einer überfälligen Aufgabe sofort
    // wieder in der Vergangenheit und die Karte stünde morgen unverändert da —
    // dieselbe Begründung wie bei `advanceLinkedInFollowUp`.
    assert.match(ACTION, /addDaysISO\(localDateISO\(\), FOLLOW_UP_PUSH_DAYS\)/);
  });

  test("geschrieben wird über die bestehenden Actions der Detailseiten", () => {
    const push = slice(ACTION, "export async function pushFollowUpDue", "Telefon-Rückruf auf einen neuen");
    assert.match(push, /await updateSettingCall\(id, \{ follow_up_due: nextDay \}\)/);
    assert.match(push, /await updateClosingCall\(id, \{ follow_up_due_at:/);
    // Kein rohes UPDATE daneben: `updateClosingCall` hält `follow_up_due`
    // synchron und baut die Kaskade neu auf.
    assert.doesNotMatch(push, /\.update\(/);
  });

  test("der Telefon-Rückruf bekommt KEIN festes Intervall", () => {
    // `callback_at` ist der einzige Fälligkeitswert des Boards mit einer MIT
    // DEM LEAD VERABREDETEN Uhrzeit (DUE_GRANULARITY: moment, docs §1). Ein
    // „+7 Tage" wäre dort fachlich falsch, eine selbst gesetzte Uhrzeit keine
    // Angabe, sondern eine Behauptung.
    const telefon = slice(BOARD, '{!doneEntry && task.source === "telefon" && (', '{!doneEntry && task.source === "setting"');
    assert.doesNotMatch(telefon, /pushFollowUpDue/);
    assert.match(telefon, /<DateTimeField/);
    assert.match(telefon, /runAction\(pushPhoneCallback\(task\.entity_id, callbackDraft\)/);

    // Der Vorschlag behält die Tageszeit und schiebt nur den Tag.
    const vorschlag = slice(BOARD, "function callbackSuggestion", "\n}\n");
    assert.match(vorschlag, /addDaysISO\(day, 1\)/);
    assert.match(vorschlag, /current\.slice\(11, 16\) \|\| "09:00"/);
  });

  test("ein verschobener Rückruf ist KEINE Anwahl", () => {
    // `phone_call_attempts` zählt Wählversuche (docs §3) — hier hat niemand
    // gewählt. Geschrieben wird deshalb genau eine Spalte.
    const callback = slice(ACTION, "export async function pushPhoneCallback", "Recycling — dieselben Aktionen");
    assert.match(callback, /\.update\(\{ callback_at: iso \}\)/);
    assert.equal(countOf(callback, ".update("), 1);
    assert.doesNotMatch(callback, /logCallAttempt|first_call_at|status:/);
  });

  test("die Links bleiben daneben stehen — das Gespräch braucht die Detailseite", () => {
    assert.match(BOARD, /<ClipboardCheck size=\{12\} \/> Zum Setting/);
    assert.match(BOARD, /<Handshake size=\{12\} \/> Zum Closing/);
    assert.match(BOARD, /<Phone size=\{12\} \/> Anrufen/);
  });

  test("jede neue Action fährt dieselbe Zugriffsprüfung wie ihre Nachbarn", () => {
    // Server Actions sind per direktem POST erreichbar; RLS allein genügt
    // nicht, weil sie einem Plattform-Admin jede Zeile durchlässt.
    for (const [name, bis] of [
      ["export async function pushFollowUpDue", "Telefon-Rückruf auf einen neuen"],
      ["export async function pushPhoneCallback", "Recycling — dieselben Aktionen"],
      ["export async function recycleContactedUndoable", '/** „Reagiert"'],
      ["export async function recycleRespondedUndoable", "\n}\n"],
    ] as const) {
      const body = slice(ACTION, name, bis);
      assert.match(body, /const access = await getAccessContext\(\);/, name);
      assert.match(body, /if \(!access\) return \{ error: "Nicht angemeldet\." \};/, name);
    }
    // Die beiden Recycling-Hüllen schreiben weiter ausschließlich über
    // actions/recycle.ts — dort sitzen Besitzprüfung, Deckel und die RPCs.
    const huelle = slice(ACTION, "export async function recycleContactedUndoable", "\n}\n");
    assert.match(huelle, /await markRecycleContacted\(origin, entityId\)/);
    assert.doesNotMatch(huelle, /\.update\(/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Der Rückweg führt dorthin, wo man herkam
 * ------------------------------------------------------------------ */

describe("3 · Aus /nachfassen führt der Zurück-Pfeil nach /nachfassen", () => {
  test("die Karten geben ihre Herkunft mit", () => {
    // Vier Sprungziele: Setting und Closing je einmal aus der eigenen Sektion
    // und einmal aus dem Recycling.
    assert.match(BOARD, /const FROM_NACHFASSEN = "\?from=nachfassen";/);
    assert.equal(countOf(BOARD, "${FROM_NACHFASSEN}`"), 4);
  });

  test("beide Detailseiten lesen den Parameter und fallen sonst auf den Kalender zurück", () => {
    for (const [name, page] of [["setting", SETTING_PAGE], ["closing", CLOSING_PAGE]] as const) {
      // searchParams ist in dieser Next-Fassung ein Promise und muss erwartet
      // werden — synchron gelesen wäre es ein Objekt ohne Werte.
      assert.match(page, /searchParams: Promise<\{ from\?: string \}>;/, name);
      assert.match(
        page,
        /backTargetFrom\(\(await searchParams\)\.from, \{ href: "\/termine", label: "Termine" \}\)/,
        name,
      );
      assert.match(page, /<BackLink href=\{back\.href\} label=\{back\.label\} \/>/, name);
      assert.doesNotMatch(page, /<BackLink href="\/termine"/, name);
    }
  });

  test("erkannt wird eine feste Liste, nicht ein beliebiger Pfad aus der URL", () => {
    // `?from=` landet in einem `href`. Ein übernommener Fremdwert wäre ein
    // offener Weiterleitungspunkt — „//fremde-seite" ist ein absoluter Link,
    // und ein Zurück-Pfeil ist genau der Knopf, den niemand vorher liest.
    const ziel = slice(BACKLINK, "const BACK_TARGETS", "export function backTargetFrom");
    assert.match(ziel, /nachfassen: \{ href: "\/nachfassen", label: "Nachfassen" \}/);
    const fn = slice(BACKLINK, "export function backTargetFrom", "\n}\n");
    assert.match(fn, /BACK_TARGETS\[key\][\s\S]*\?\? fallback/);
    assert.doesNotMatch(fn, /href: key|href: from/, "Der Rohwert darf nie selbst zum Ziel werden.");
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Die Setting-Karte sagt, was passiert ist
 * ------------------------------------------------------------------ */

describe("4 · Der Anlass steht auf der Karte", () => {
  test("die Aufgabe trägt Status und Disqualifikationsgrund", () => {
    assert.match(ACTION, /setting_status\?: SettingStatus \| null;/);
    assert.match(ACTION, /setting_disqualify_reason\?: string \| null;/);
  });

  test("geholt wird in der ZWEITEN Welle, die RPC bleibt unangetastet", () => {
    // `nachfassen_tasks` ist seit 0030 unverändert und speist auch den
    // Navigations-Zähler — sie darf für ein Anzeigefeld nicht angefasst werden.
    const rpc = slice(ACTION, '.rpc("nachfassen_tasks", {', "})");
    assert.match(rpc, /p_workspace_id: access\.workspace_id,\s*p_today: today,\s*p_now: [^\n]*\n\s*p_effective_user_id: scopeUserId,/);

    // `visible` statt `rows`: die Liste NACH dem Verwerfen des LinkedIn-Zweigs
    // (docs — actions/nachfassen.ts). Über `rows` gelesen holte der Nachschlag
    // Gründe für Karten, die es gar nicht gibt.
    assert.match(ACTION, /const settingIds = \[\.\.\.new Set\(visible\.filter\(\(r\) => r\.source === "setting"\)/);
    assert.match(ACTION, /selectByIds<SettingReasonRow>\(settingIds, \(chunk\) =>/);
    assert.match(ACTION, /\.select\("id, status, disqualify_reason_code"\)/);
  });

  test("die Beschriftungen kommen aus den vorhandenen Maps", () => {
    // `SETTING_STATUS_LABEL` (lib/settingLabels.ts) und `dropoutReasonLabel`
    // (lib/dropoutLists.ts) beschriften dieselben Codes bereits an anderer
    // Stelle. Eine zweite Map liefe früher oder später auseinander.
    assert.match(BOARD, /import \{ SETTING_STATUS_LABEL \} from "@\/lib\/settingLabels";/);
    assert.match(BOARD, /\{SETTING_STATUS_LABEL\[task\.setting_status\]\}/);
    assert.match(BOARD, /` · \$\{dropoutReasonLabel\(task\.setting_disqualify_reason\)\}`/);
    assert.doesNotMatch(BOARD, /"Nicht erschienen"|"Unqualifiziert"/, "Keine zweite Beschriftungsliste im Board.");
  });

  test("der Grund erscheint nur, wo er etwas erklärt", () => {
    // Bei `no_show` gibt es keinen Disqualifikationsgrund — ein leeres „ · "
    // wäre eine Lücke, die wie ein fehlender Wert aussieht.
    assert.match(BOARD, /task\.setting_status === "unqualifiziert" && task\.setting_disqualify_reason/);
    // Und der Badge ist derselbe Baustein wie beim Recycling: beide
    // beantworten „warum liegt diese Karte hier?".
    assert.equal(countOf(BOARD, "<span style={reasonBadgeStyle}>"), 2);
  });
});
