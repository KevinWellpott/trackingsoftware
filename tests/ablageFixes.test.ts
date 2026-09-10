// Die Ablage: vier Stellen, an denen ein Klick etwas anderes tut, als die
// Karte sagt.
//
//  B  „Jetzt wieder anschreiben" liest den Zustand der Zeile und schreibt
//     danach — zwei Anweisungen. Sperrt jemand die Zeile dazwischen, lief das
//     Update in den Exklusiv-CHECK der Datenbank und der Nutzer bekam eine rohe
//     Postgres-Meldung. Der Ausschluss gehört als Bedingung IN das Update.
//  C  Dasselbe Update schrieb keinen Grund mit. Die Wiedervorlage-Abfrage
//     ersetzt den fehlenden Grund beim Erstgespräch durch den festverdrahteten
//     Wert „dead" — ein abgesagter Termin stand danach als toter Lead in Karte
//     und Grund-Tabelle.
//  D  Beim Zurückholen erbte der NEUE Termin die Herkunft ungefiltert. Ein
//     Altwert ('manuell'/'inbound'/'website') entstand damit heute neu, obwohl
//     ihn kein Formular mehr vergibt.
//  F  Die Sperrliste liefert org-weit, der Nachschlag ihres Grundes läuft durch
//     die Zeilensicherheit. Für ein Mitglied mit Datensicht „nur eigene" trug
//     die Karte einer Kollegin deshalb „Ohne Grund" — eine Aussage über die
//     Daten, wo eine über die Sicht gemeint war.
//
// B, C, D und die Verdrahtung von F sind Server-Actions und ohne Datenbank
// nicht auszuführen; geprüft wird deshalb am QUELLTEXT — dieselbe Bauart wie
// lifecycleWiring.test.ts. Die reinen Entscheidungen dahinter (welcher Grund,
// welche Beschriftung) stehen in der Bibliothek und werden echt ausgeführt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { SELECTABLE_CHANNELS } from "@/lib/channels";
import { dropoutReasonBadge, dropoutReasonLabel, recycleReasonCodeFor } from "@/lib/dropoutLists";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; mehrere Anker unten tragen ein `\n`.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf einer Funktion — von ihrer Signatur bis zum nächsten Anker. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const DROPOUT = read("src/app/actions/dropout.ts");
const REVIVE = read("src/app/actions/revive.ts");
const BOARD = read("src/components/ablage/AblageBoard.tsx");
const NAV = read("src/components/ablage/AblageNav.tsx");
const MIGRATION_0029 = read("supabase/migrations/20260404000029_analyse_umbau.sql");
const MIGRATION_0033 = read("supabase/migrations/20260404000033_lead_recycling.sql");

const PULL_FORWARD = slice(DROPOUT, "export async function pullRecycleForward(", "\n}\n");

/* ------------------------------------------------------------------ *
 * B — Gate-Lesen und Schreiben sind zwei Anweisungen
 * ------------------------------------------------------------------ */

describe("Recycling vorziehen gewinnt den Wettlauf gegen eine Sperre nicht, es weicht ihm aus", () => {
  test("der Ausschluss steht als Bedingung IM Update", () => {
    // Ohne diese Zeile trifft das Update eine inzwischen gesperrte Zeile und
    // läuft in den CHECK aus Migration 0033: `recycle_excluded_at` und
    // `next_recycle_at` schließen sich gegenseitig aus.
    const update = slice(PULL_FORWARD, "const today = todayBerlin();", "revalidatePath(");
    assert.match(update, /\.is\("recycle_excluded_at", null\)/);
    // Und das Ergebnis muss zählbar sein — ohne `select` ist „keine Zeile
    // getroffen" von „alles gut" nicht zu unterscheiden.
    assert.match(update, /\.select\("id"\)/);
  });

  test("keine getroffene Zeile heißt „inzwischen gesperrt“, nicht „nicht gefunden“", () => {
    // Die Zeile gab es beim Lesen noch — verschwunden ist sie also nicht.
    const update = slice(PULL_FORWARD, "const today = todayBerlin();", "revalidatePath(");
    assert.match(update, /updated\.length === 0/);
    assert.match(update, /Inzwischen gesperrt/);
  });

  test("Gegenprobe: die Datenbank weist die Kombination wirklich ab", () => {
    // Wäre der CHECK nicht da, wäre die Bedingung oben nur Kosmetik.
    assert.match(MIGRATION_0033, /recycle_excluded_at is null or next_recycle_at is null/);
  });
});

/* ------------------------------------------------------------------ *
 * C — der Grund wandert mit
 * ------------------------------------------------------------------ */

describe("recycleReasonCodeFor", () => {
  test("das Closing reicht seinen Verlustgrund weiter", () => {
    assert.equal(
      recycleReasonCodeFor({ entity: "closing", status: "verloren", lostReasonCode: "preis" }),
      "preis",
    );
  });

  test("ohne Verlustgrund bleibt die Spalte leer — die Abfrage hat dort einen richtigen Ersatz", () => {
    // `recycle_tasks` nimmt beim Closing `lost_reason_code`, sonst „Sonstiges".
    // Einen falschen Ersatzwert wie „dead" gibt es in diesem Zweig gar nicht.
    assert.equal(recycleReasonCodeFor({ entity: "closing", status: "verloren", lostReasonCode: null }), null);
  });

  test("das Erstgespräch reicht seinen Disqualifizierungsgrund weiter", () => {
    assert.equal(
      recycleReasonCodeFor({
        entity: "setting",
        status: "unqualifiziert",
        disqualifyReasonCode: "kein_budget",
      }),
      "kein_budget",
    );
  });

  test("ein toter Lead heißt „Dead“, ein unqualifizierter nicht", () => {
    // Ohne den zweiten Fall stünde in Bestandsdaten (Grund noch nicht
    // nachgepflegt) ein „Dead" an einem Termin, der stattgefunden hat.
    assert.equal(recycleReasonCodeFor({ entity: "setting", status: "dead" }), "dead");
    assert.equal(recycleReasonCodeFor({ entity: "setting", status: "unqualifiziert" }), "unqualifiziert");
  });

  test("die Absage ohne Aussicht ist ein eigener Grund — genau der Fehler aus Befund 6", () => {
    assert.equal(
      recycleReasonCodeFor({ entity: "setting", status: "offen", cancelOutlook: "ohne_aussicht" }),
      "abgesagt",
    );
  });

  test("der No-Show ohne Antwort ebenso", () => {
    assert.equal(
      recycleReasonCodeFor({ entity: "setting", status: "offen", noShowResolution: "ohne_antwort" }),
      "no_show_ohne_antwort",
    );
  });

  test("der Status geht vor — ein geführtes Gespräch sagt mehr als eine Absage", () => {
    // Dieselbe Reihenfolge wie in `schedule_recycle()`: Dort bestimmt der
    // Status die Wartezeit, die Absage ist der Auffangfall.
    assert.equal(
      recycleReasonCodeFor({
        entity: "setting",
        status: "unqualifiziert",
        disqualifyReasonCode: "kein_bedarf",
        cancelOutlook: "ohne_aussicht",
        noShowResolution: "ohne_antwort",
      }),
      "kein_bedarf",
    );
  });

  test("eine Zeile ohne terminalen Zustand bekommt keinen Grund angedichtet", () => {
    assert.equal(recycleReasonCodeFor({ entity: "setting", status: "offen" }), null);
  });

  test("jeder erzeugte Grund ist beschriftet — sonst stünde der rohe Token auf der Karte", () => {
    for (const code of ["abgesagt", "no_show_ohne_antwort", "unqualifiziert", "dead"]) {
      const label = dropoutReasonLabel(code);
      assert.notEqual(label, code, `${code} ohne Beschriftung`);
    }
    assert.equal(dropoutReasonLabel("abgesagt"), "Abgesagt");
    assert.equal(dropoutReasonLabel("no_show_ohne_antwort"), "No-Show ohne Antwort");
    assert.equal(dropoutReasonLabel("unqualifiziert"), "Unqualifiziert");
  });
});

describe("Das Vorziehen stempelt den Grund in dieselbe Anweisung", () => {
  test("`recycle_reason_code` steht im Update", () => {
    const update = slice(PULL_FORWARD, "const today = todayBerlin();", "revalidatePath(");
    assert.match(update, /recycle_reason_code/);
    assert.match(PULL_FORWARD, /recycleReasonCodeFor\(\{/);
  });

  test("der Grund kommt AUS DER ZEILE, nicht aus dem Aufruf", () => {
    // Dieselbe Regel, aus der `schedule_recycle()` seit 0033 seinen Grund
    // selbst liest: Ein mitgeschicktes Argument ließe per direktem POST jeden
    // beliebigen Grund (und damit jede Wartezeit) setzen.
    const args = slice(PULL_FORWARD, "recycleReasonCodeFor({", "});");
    for (const feld of ["row.status", "row.cancel_outlook", "row.no_show_resolution"]) {
      assert.match(args, new RegExp(feld.replace(".", "\\.")), `${feld} wird nicht gelesen`);
    }
    // Und die Spalten müssen überhaupt mitgelesen werden.
    assert.match(DROPOUT, /GATE_COLUMNS[\s\S]{0,400}cancel_outlook, no_show_resolution/);
  });

  test("Gegenprobe: ohne Stempel zeigt die Abfrage „dead“ an", () => {
    // Genau dieser festverdrahtete Ersatzwert machte aus einem abgesagten
    // Erstgespräch einen toten Lead.
    assert.match(MIGRATION_0033, /coalesce\(sc\.recycle_reason_code, 'dead'\)/);
  });
});

/* ------------------------------------------------------------------ *
 * D — kein neuer Altwert beim Zurückholen
 * ------------------------------------------------------------------ */

describe("Der zweite Anlauf erbt keine Herkunft, die es nicht mehr gibt", () => {
  test("die Registry kennt die drei Altwerte nicht als wählbar", () => {
    const waehlbar = new Set(SELECTABLE_CHANNELS.map((c) => c.key));
    for (const alt of ["manuell", "inbound", "website"]) {
      assert.equal(waehlbar.has(alt as never), false, `${alt} gilt als wählbar`);
    }
    // Gegenprobe, damit der Filter nicht ALLES verwirft.
    for (const gueltig of ["linkedin", "telefon", "ads", "social_media", "sonstige"]) {
      assert.equal(waehlbar.has(gueltig as never), true, `${gueltig} fehlt in der Registry`);
    }
  });

  test("die Altwerte stehen weiter in der Datenbank — geerbt werden könnten sie also", () => {
    // Der CHECK gilt auch für Updates auf ganz anderen Spalten; die Altwerte
    // bleiben deshalb erlaubt. Genau darum braucht es den Filter in der App.
    const check = slice(MIGRATION_0029, "setting_calls_source_type_check", ");");
    for (const alt of ["'manuell'", "'inbound'", "'website'"]) {
      assert.ok(check.includes(alt), `${alt} nicht mehr im CHECK — dann ist dieser Test falsch`);
    }
  });

  test("der Insert läuft über den Filter, nicht über den Rohwert", () => {
    const insert = slice(REVIVE, '.from("setting_calls")\n    .insert({', ".select(\"id\")");
    assert.match(insert, /source_type: inheritableSource\(/);
    assert.doesNotMatch(insert, /source_type: row\.source_type/);
    // Der Freitext daneben bleibt — er trägt den echten Ursprung.
    assert.match(insert, /source_detail: row\.source_detail/);
  });

  test("der Filter liest die Registry, statt die Schlüssel abzuschreiben", () => {
    assert.match(REVIVE, /import \{ SELECTABLE_CHANNELS \} from "@\/lib\/channels";/);
    const helper = slice(REVIVE, "function inheritableSource(", "\n}\n");
    assert.match(helper, /SELECTABLE_SOURCE_KEYS\.has\(value\)/);
  });
});

/* ------------------------------------------------------------------ *
 * F — „Ohne Grund" gegen „Grund nicht sichtbar"
 * ------------------------------------------------------------------ */

describe("Die Sperrliste behauptet nicht, es gebe keinen Grund", () => {
  test("dropoutReasonBadge trennt Datenlage und Sichtbarkeit", () => {
    assert.equal(dropoutReasonBadge("preis", false), "Preis");
    // Ein vorhandener Grund schlägt das Flag: Steht er da, ist er sichtbar.
    assert.equal(dropoutReasonBadge("preis", true), "Preis");
    assert.equal(dropoutReasonBadge(null, false), "Ohne Grund");
    assert.equal(dropoutReasonBadge(null, true), "Grund nicht sichtbar");
  });

  test("der Nachschlag merkt sich, welche Zeile er gar nicht lesen durfte", () => {
    // Erst alle angefragten Ids als „nicht sichtbar" vormerken, dann jede
    // zurückgekommene überschreiben: Die Differenz IST die Antwort der
    // Zeilensicherheit.
    const body = slice(DROPOUT, "async function loadBlockReasons(", "\n/**");
    assert.match(body, /for \(const id of ids\) out\.set\(`\$\{entity\}:\$\{id\}`, \{ visible: false \}\);/);
    assert.match(body, /visible: true/);
    // Der Vormerker muss VOR dem Abbruch bei einem Fehler stehen — sonst
    // fiele ein ausgefallener Nachschlag wieder auf „Ohne Grund" zurück.
    assert.ok(
      body.indexOf("for (const id of ids)") < body.indexOf("if (error || !data) continue;"),
      "bei einem Fehler bliebe der Vormerker aus",
    );
  });

  test("eine gelesene Zeile OHNE Grund bleibt „Ohne Grund“", () => {
    // Die Gegenprobe zur Regel darüber: Sichtbar und leer ist eine Aussage
    // über die Daten und darf nicht als Sichtbarkeitsproblem gelten.
    const body = slice(DROPOUT, "async function loadBlockReasons(", "\n/**");
    assert.match(body, /reason_code: code \?\? null/);
  });

  test("die Karte beschriftet über dropoutReasonBadge, nicht mehr über das Label allein", () => {
    assert.match(BOARD, /dropoutReasonBadge\(row\.reason_code, row\.reason_hidden\)/);
    assert.match(DROPOUT, /reason_hidden: lookup \? !lookup\.visible : false/);
  });

  test("nachgeschlagen wird nur in der Sperrliste — sonst gäbe es den Fall gar nicht", () => {
    // Die anderen fünf Listen laufen mit der eingestellten Datensicht; dort
    // kann keine Zeile erscheinen, deren Grund unlesbar wäre.
    assert.match(DROPOUT, /list === "gesperrt" \? await loadBlockReasons\(access, raw\) : null/);
  });
});

/* ------------------------------------------------------------------ *
 * Bedienbarkeit — die Stellen, an denen die Oberfläche etwas verschweigt
 * ------------------------------------------------------------------ */

describe("Die Umschaltleiste sagt, was sie zeigt", () => {
  test("die Ablage trägt keine Zähler mehr", async () => {
    // Die eine Zahl, die etwas verlangte, hing an „Ersatztermin steht aus" —
    // der einzigen Liste mit offener Handlung, und die steht jetzt in der
    // Hauptliste. Was bleibt, ist Archiv; ein Archiv mahnt nicht.
    // Zweiter Grund: „Ausgeschieden" legt vier RPC-Aufrufe entdoppelt zusammen.
    // Die Summe der vier Einzelzähler wäre größer als die Liste darunter — eine
    // Zahl, die der Liste widerspricht, ist schlimmer als keine.
    assert.doesNotMatch(NAV, /count/);
    assert.doesNotMatch(NAV, /count-pill/);
    const { DROPOUT_LISTS } = await import("@/lib/dropoutLists");
    for (const l of DROPOUT_LISTS) {
      assert.equal("openAction" in l, false, `${l.key} trägt noch ein Handlungs-Flag`);
    }
  });

  test("die Zähler-Abfrage ist mit den Zählern gegangen", () => {
    // Sechs `count: 'exact'`-Aufrufe je Seitenaufruf für Zahlen, die niemand
    // mehr sieht — genau der Ballast, gegen den dieser Rückbau sich richtet.
    assert.doesNotMatch(DROPOUT, /loadDropoutCounts/);
  });

  test("Doku-Verweise und Spaltennamen stehen nicht auf dem Bildschirm", async () => {
    const { DROPOUT_LISTS } = await import("@/lib/dropoutLists");
    for (const l of DROPOUT_LISTS) {
      for (const text of [l.tab, l.title, l.meta, l.derivation]) {
        assert.doesNotMatch(text, /ENTSCHEIDUNGEN|cancel_outlook|revived_at|recycle_excluded_at/, text);
      }
    }
  });
});

describe("Karten zeigen nur Knöpfe, die etwas tun", () => {
  test("die drei Aktionen werden weggelassen statt ausgegraut", () => {
    const aktionen = slice(BOARD, "{/* ── Aktionen ── */}", "{/* Warum ein Knopf fehlt");
    assert.match(aktionen, /\{!blocked && \(/);
    // Ohne Listen-Zusatz: `dropout_lists('gesperrt')` liefert ausschließlich
    // Zeilen mit gesetztem Kontaktverbot, `row.excluded` ist dort also immer
    // wahr. Ein zusätzliches `list !== "gesperrt"` wäre unerreichbar und
    // behauptete eine Listen-Sonderregel, die es nicht gibt.
    assert.match(aktionen, /\{!row\.excluded && \(/);
    assert.match(aktionen, /\{!row\.revive_blocked && \(/);
    // Kein einziger `disabled`-Knopf mehr in der Aktionszeile — auch nicht der
    // Listen-Verweis darüber. Er trifft zwar nur den Einzelfall „Lead ohne
    // Liste" und nicht eine ganze Ansicht, aber eine Ausnahme wäre keine
    // mildere Regel, sondern eine zweite neben der ersten.
    assert.equal(aktionen.split("disabled style={disabledBtn}").length - 1, 0);
  });

  test("die beiden Rückhol-Knöpfe heißen nicht mehr beide „zurückholen“", () => {
    // „Recycling vorziehen" und „Zurückholen" klangen gleich und taten
    // Verschiedenes — der eine setzt ein Datum, der andere legt einen Termin
    // an. Ein Fehlgriff kostete einen Termin, den niemand wollte.
    assert.match(BOARD, /Jetzt wieder anschreiben/);
    assert.match(BOARD, /Neuen Termin ansetzen/);
    assert.doesNotMatch(BOARD, /> Recycling vorziehen/);
    assert.doesNotMatch(BOARD, /> Zurückholen/);
  });

  test("Datenbank-Vokabular steht nicht mehr im Fußtext", () => {
    const fuss = slice(BOARD, "{rows.length > 0 && (", "</div>\n  );");
    assert.doesNotMatch(fuss, /Entscheidung K10/);
    assert.doesNotMatch(fuss, /terminal/);
    assert.doesNotMatch(fuss, /Zeile/);
  });

  test("auch die Fehlerkarte nennt keinen SQL-Namen", () => {
    // Sie ist die einzige Karte, die ein Administrator zu sehen bekommt — und
    // genau deshalb war sie beim Aufräumen übersehen worden. Die Migration hat
    // eine Nummer; die ist für den Administrator die bessere Auskunft und für
    // alle anderen wenigstens keine Kryptik.
    const karte = slice(BOARD, "Die Ablage ist nicht verfügbar", "</div>\n      </div>");
    assert.doesNotMatch(karte, /dropout_lists/);
    assert.match(karte, /Migration 0033/);
  });
});

/* ------------------------------------------------------------------ *
 * Ein weggelassener Knopf hinterlässt seinen Grund
 * ------------------------------------------------------------------ */

describe("Wo ein Knopf fehlt, steht warum", () => {
  test("listAllowsRevive benennt die eine Liste, in der es die Aktion nie gibt", async () => {
    const { DROPOUT_LISTS, listAllowsRevive } = await import("@/lib/dropoutLists");
    assert.equal(listAllowsRevive("gesperrt"), false);
    for (const l of DROPOUT_LISTS) {
      if (l.key === "gesperrt") continue;
      assert.equal(listAllowsRevive(l.key), true, `${l.key} bietet die Aktion nicht an`);
    }
  });

  test("Gegenprobe: in der Sperrliste ist wirklich JEDE Zeile gesperrt", async () => {
    // Nur deshalb darf der Grund dort einmal am Fuß stehen statt auf jeder
    // Karte: `dropout_lists('gesperrt')` liefert in allen vier Zweigen
    // ausschließlich Zeilen mit `recycle_excluded_at is not null`.
    const { reviveBlockedReason } = await import("@/lib/dropoutLists");
    for (const entity of ["setting", "closing", "linkedin", "telefon"] as const) {
      assert.notEqual(
        reviveBlockedReason({ entity, revived: false, excluded: true }),
        null,
        `${entity} wäre in der Sperrliste zurückholbar`,
      );
    }
  });

  test("der Grund gegen den neuen Termin kommt auf die Karte, nicht nur in den Datensatz", () => {
    // `revive_blocked` ist ein fertiger SATZ aus der Server-Action. Gelesen
    // wurde er nur als Wahrheitswert — in der Sperrliste fehlte der Knopf
    // damit auf jeder Karte, ohne dass irgendwo stand, warum.
    assert.match(BOARD, /hints\.push\(row\.revive_blocked\)/);
    // Und zwar nur dort, wo er an DIESER Zeile hängt: Gilt er für die ganze
    // Ansicht, trägt ihn der Fuß.
    assert.match(BOARD, /if \(row\.revive_blocked && !listWideBlock\)/);
    assert.match(BOARD, /const listWideBlock = !listAllowsRevive\(list\);/);
  });

  test("in „Ausgeschieden“ steht der Recycling-Grund AUF der Karte", () => {
    // Vor der Zusammenlegung war die Antwort je Reiter einheitlich und stand
    // deshalb am Fuß. Jetzt liegt ein abgesagtes Closing (kein Zweig) neben
    // einem verlorenen (ein Zweig) — ein Fußtext dazu wäre auf der Hälfte der
    // Karten falsch.
    assert.match(BOARD, /if \(blocked && !listWideBlock\)/);
  });

  test("auch der weggelassene Listen-Verweis bekommt seinen Satz", () => {
    // Der Verweis entfällt, wenn die Liste des Leads gelöscht wurde. Ohne
    // Ersatzsatz sieht die Karte aus wie jede andere — nur mit einem Knopf
    // weniger, und niemand weiß, ob das Absicht ist.
    const hinweise = slice(BOARD, "const hints: string[] = [];", "function run(");
    assert.match(hinweise, /if \(!href\)/);
    assert.match(hinweise, /Dossier/);
  });

  test("die Sätze werden gerendert, nicht nur gesammelt", () => {
    assert.match(BOARD, /\{hints\.length > 0 && \(/);
    assert.match(BOARD, /hints\.map\(\(hint\)/);
  });

  test("der Fußtext erklärt „Neuen Termin ansetzen“ nur, wo es den Knopf gibt", () => {
    // In der Sperrliste ist die Aktion auf keiner Karte vorhanden — ein
    // Absatz, der sie erklärt, schickt den Nutzer auf die Suche nach etwas,
    // das dort bewusst fehlt.
    const fuss = slice(BOARD, "{rows.length > 0 && (", "</div>\n  );");
    const absatz = fuss.indexOf("Neuen Termin ansetzen");
    assert.notEqual(absatz, -1, "der erklärende Absatz fehlt ganz");
    assert.match(fuss.slice(0, absatz), /\{listRevives && \(/);
    assert.match(BOARD, /const listRevives = listAllowsRevive\(list\);/);
  });

  test("dieselbe Aktion heißt auf der ganzen Karte gleich", () => {
    // Neben dem Knopf „Neuen Termin ansetzen" standen drei weitere Wörter für
    // dasselbe Ereignis — Badge, Vorgänger-Hinweis und Nachfolger-Verweis.
    assert.doesNotMatch(BOARD, />\s*Wiederbelebt/);
    assert.doesNotMatch(BOARD, /Zurückgeholt — zum neuen Erstgespräch/);
    assert.doesNotMatch(BOARD, /ab dieser Rückholung/);
    assert.match(BOARD, /Neuer Termin angesetzt/);
  });

  test("der Satz erklärt die Folge, statt den Badge zu wiederholen", async () => {
    // Auf derselben Karte steht oben der Badge „Neuer Termin angesetzt". Ein
    // Hinweis, der ihn wörtlich wiederholt, erklärt nicht, warum der Knopf
    // fehlt — genau das muss er aber.
    const { reviveBlockedReason } = await import("@/lib/dropoutLists");
    const bereits = reviveBlockedReason({ entity: "setting", revived: true, excluded: false }) ?? "";
    assert.match(bereits, /einen zweiten setzt die Ablage zu demselben Vorgang nicht an/);
    // Und die Server-Action trägt kein anderes Vokabular als der Knopf.
    assert.doesNotMatch(REVIVE, /zurückholen\."/);
    assert.doesNotMatch(REVIVE, /Bereits zurückgeholt/);
  });
});
