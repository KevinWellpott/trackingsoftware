// Das Board /nachfassen — die Fehler, die man einer falschen Anzeige nicht
// ansieht.
//
// Zwei Prüfarten, aus zwei Gründen:
//  · Der Anlass-Satz (B) ist reine Bibliothek und wird am VERHALTEN geprüft.
//  · Die Verfügbarkeits-Flagge (A) und die Trennung „nicht lesbar" von „zu alt"
//    (C) hängen an einer Server-Action mit Supabase-Client und an einem
//    React-Client-Component. Beide sind im Node-Test-Runner nicht ladbar (kein
//    JSX-Transform, keine Umgebung), deshalb wird am QUELLTEXT geprüft —
//    dieselbe Bauart wie lifecycleWiring.test.ts und revive.test.ts. Eine
//    Attrappe bewiese hier nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { renderRecycleTemplate } from "@/lib/recycleCadence";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen: Das Projekt hat keine `.gitattributes`, und
  // `core.autocrlf=true` legt die Quelldateien unter Windows mit CRLF ab
  // (NachfassenBoard.tsx liegt genau so da). Mehrere Anker unten tragen ein
  // `\n` — ohne diese Zeile fände `slice()` sie auf einer frisch ausgecheckten
  // Arbeitskopie nicht mehr, und die Datei wäre rot, ohne dass am geprüften
  // Code irgendetwas fehlte.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Wie oft steht `needle` in `source`?
 *
 * `assert.match` kann das nicht beantworten: Ein zweites Vorkommen bricht
 * keinen Treffer. Genau daran ist der doppelte Fehler-Span unbemerkt durch
 * diese Datei gekommen — beide Stellen benutzten dieselbe neue Fassung, jede
 * einzelne Zusicherung war grün, und auf der Karte stand jede Meldung zweimal.
 */
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

/* ------------------------------------------------------------------ *
 * A — Ein Ausfall darf nicht wie Feierabend aussehen
 * ------------------------------------------------------------------ */

describe("A · Ein Ausfall der Union-RPC sieht nicht aus wie „alles erledigt\"", () => {
  test("die Server-Action meldet den Ausfall, statt eine leere Liste zu liefern", () => {
    // Der `.catch` fing den Fehler ab und gab `[]` zurück. Vier von fünf
    // Quellen waren damit still weg — nicht unterscheidbar von „heute ist
    // nichts fällig".
    assert.match(ACTION, /tasksAvailable: boolean/);

    const catchBlock = slice(ACTION, '.catch((e: unknown) => {', "loadRecycleTasks()");
    assert.match(
      catchBlock,
      /tasksAvailable = false/,
      "Der catch um `nachfassen_tasks` muss die Flagge umlegen, sonst bleibt der Ausfall unsichtbar.",
    );

    // …und sie muss auch wirklich hinausgereicht werden.
    const ergebnis = slice(ACTION, "  return {\n    tasks,", "\n}");
    assert.match(ergebnis, /tasksAvailable,/);
  });

  test("das Board zeigt dafür den roten Kasten statt des grünen Leerzustands", () => {
    assert.match(BOARD, /tasksAvailable: boolean/);
    assert.match(BOARD, /\{!tasksAvailable && \(\s*<UnavailableNotice/);

    // Der grüne Leerzustand ist eine Behauptung („alles nachgefasst") und darf
    // ohne geantwortete RPC gar nicht erst fallen.
    const leerzustand = slice(BOARD, "{sections.length === 0 ? (", "Alles nachgefasst");
    assert.match(
      leerzustand,
      /!tasksAvailable \? null/,
      "Ohne Aufgabenliste darf der grüne Leerzustand nicht erscheinen.",
    );
  });

  test("ein Filter auf eine ausgefallene Quelle wird gar nicht erst angeboten", () => {
    // Sonst landet man über die Kanal-Pille in einem Leerzustand, der genau
    // dieselbe Verwechslung erzeugt, die der Kasten oben ausräumt.
    const filter = slice(BOARD, "const visibleFilters = FILTERS.filter(", "return (");
    // `[\s\S]*` statt `.*` mit dotAll: Das `s`-Flag setzt ES2018 voraus, das
    // Projekt zielt auf ES2017 — die Zeichenklasse deckt Zeilenumbrüche
    // genauso ab, ohne am Compiler-Ziel der ganzen Anwendung zu drehen.
    assert.match(filter, /recycling[\s\S]*return recyclingAvailable/);
    assert.match(filter, /return tasksAvailable;/);
  });
});

/* ------------------------------------------------------------------ *
 * B — Der Anlass-Satz kennt beide Grund-Familien
 * ------------------------------------------------------------------ */

const FALLBACK_ANLASS = "es gibt vielleicht Neues zu besprechen";

/** Nur den Platzhalter rendern — genau das tut `recycleAnlass` in der Action. */
function anlassOf(reason: string | null): string {
  return renderRecycleTemplate("{anlass}", { leadName: null, company: null, reason });
}

describe("B · Der Anlass-Satz kennt die Disqualifikations-Gründe", () => {
  test("Erstgespräch und Closing sagen bei derselben Ursache dasselbe", () => {
    // `schedule_recycle()` stempelt bei origin='setting' den
    // DISQUALIFIKATIONS-Code in `recycle_reason_code` (docs §4). Von dessen
    // acht Werten kannte die Map lange nur `kein_bedarf` — ein Lead mit
    // `falscher_zeitpunkt` bekam nach 56 Tagen die Floskel, obwohl der
    // passende Satz unter dem Closing-Schlüssel `timing` danebenstand.
    assert.equal(anlassOf("falscher_zeitpunkt"), anlassOf("timing"));
    assert.equal(anlassOf("kein_budget"), anlassOf("preis"));
    assert.equal(anlassOf("geld"), anlassOf("preis"));
    assert.equal(anlassOf("kein_entscheider"), anlassOf("entscheider"));
  });

  test("genau die Gründe, bei denen ein zweiter Anlauf lohnt, sind nicht mehr stumm", () => {
    // Fünf hier, drei in der Gegenprobe unten: zusammen sind das die acht
    // Werte von `setting_calls.disqualify_reason_code` (docs §4), und jeder
    // steht in genau einem der beiden Töpfe. Wandert einer davon still in den
    // anderen, fällt eine der beiden Zusicherungen.
    for (const code of ["falscher_zeitpunkt", "kein_budget", "geld", "kein_entscheider", "kein_bedarf"]) {
      assert.notEqual(anlassOf(code), FALLBACK_ANLASS, `${code} darf nicht auf die Floskel fallen`);
    }
  });

  test("Gegenprobe: vier Gründe fallen mit Absicht auf den neutralen Satz", () => {
    // `falsche_zielgruppe` und `keine_zusammenarbeit` (Erstgespräch) sowie
    // `kein_fit` (das Closing-Pendant) bekommen nie ein Recycling-Datum
    // (docs §4) — es kann für sie gar keine Karte geben. Und für `sonstiges`
    // gibt es keinen ehrlichen Aufhänger; ein erfundener wäre schlimmer als
    // die Floskel. Erfindet jemand hier später einen Satz, ist das eine
    // Entscheidung und kein Versehen.
    //
    // Die übrigen stummen Gründe — `vertrauen`, `ghosting` und die beiden
    // Ursprungs-Token `dead`/`fu_exhausted` — stehen bewusst NICHT hier,
    // sondern in tests/recycleCadence.test.ts: zwei Kopien derselben Liste
    // laufen früher oder später auseinander.
    for (const code of ["falsche_zielgruppe", "keine_zusammenarbeit", "kein_fit", "sonstiges"]) {
      assert.equal(anlassOf(code), FALLBACK_ANLASS, code);
    }
  });
});

/* ------------------------------------------------------------------ *
 * C — „nicht lesbar" ist nicht „zu alt"
 * ------------------------------------------------------------------ */

describe("C · Nicht lesbare Kontakte werden nicht als „ältere Leads\" verbucht", () => {
  test("der 7-Tage-Schnitt greift nur bei belegtem Pitch-Datum", () => {
    const zweig = slice(ACTION, 'if (r.source === "linkedin") {', 'else if (r.source === "telefon")');

    // Die Reihenfolge ist die Aussage: hiddenOlder++ steht INNERHALB von
    // `if (info)`, unreadableContacts++ im else. Vorher lief beides über
    // `info?.pitched_at ?? null` in einen Topf — eine nicht lesbare Zeile
    // landete unter „Pitch > 7 Tage", obwohl ihr Pitch von gestern sein kann.
    assert.match(
      zweig,
      /if \(info\) \{[\s\S]*hiddenOlder\+\+;[\s\S]*\} else \{[\s\S]*unreadableContacts\+\+;/,
      "hiddenOlder darf nur im belegten Zweig hochzählen, unreadableContacts nur im anderen.",
    );

    // Gegenprobe zum alten Verhalten: Der Kurzschluss über `info?.pitched_at`
    // ist verschwunden — mit ihm war die Unterscheidung gar nicht formulierbar.
    assert.doesNotMatch(zweig, /const pitched = info\?\.pitched_at/);
  });

  test("die Aufgabe verschwindet nicht, sie wird nur getrennt gezählt", () => {
    // Fällig ist fällig: Die RPC entscheidet, was heute ansteht — der
    // Nachschlag liefert nur Beiwerk (Listenbezug, Pitch-Alter).
    const zweig = slice(ACTION, 'if (r.source === "linkedin") {', 'else if (r.source === "telefon")');
    const elseZweig = slice(zweig, "} else {", "}");
    assert.doesNotMatch(elseZweig, /continue;/, "Eine nicht lesbare Zeile darf nicht stillschweigend wegfallen.");

    assert.match(ACTION, /unreadableContacts: number/);
    assert.match(slice(ACTION, "  return {\n    tasks,", "\n}"), /unreadableContacts,/);
  });

  test("das Board erklärt den Unterschied in einer eigenen Zeile", () => {
    assert.match(BOARD, /unreadableContacts: number/);
    assert.match(BOARD, /\{unreadableContacts > 0 && \(/);
    // Die alte Zeile bleibt daneben stehen und behält ihre Aussage — sie gilt
    // ab jetzt nur noch für Kontakte, deren Alter wirklich bekannt ist.
    assert.match(BOARD, /Pitch &gt; 7 Tage\) ausgeblendet/);
  });

  test("Restfall: ein LESBARER Kontakt ohne Pitch-Datum ist nicht „zu alt\"", () => {
    const zweig = slice(ACTION, 'if (r.source === "linkedin") {', 'else if (r.source === "telefon")');

    // Dieselbe Falschaussage eine Ebene tiefer: `!info.pitched_at` zählte eine
    // lesbare Zeile ohne Pitch-Datum nach `hiddenOlder` und blendete sie unter
    // „ältere Leads (Pitch > 7 Tage)" aus. Die Spalte ist nullable (docs §3),
    // der Pitch kann von heute sein — wer die Zahl nachrechnet, findet die
    // Differenz nicht.
    assert.doesNotMatch(zweig, /!info\.pitched_at/, "Kein Pitch-Datum heißt nicht „alt\".");
    assert.match(zweig, /info\.pitchDay !== null && info\.pitchDay < cutoff/);
  });

  test("Restfall: der Rückfall ist der app-weite Pitch-Tag, und die Spalte wird geladen", () => {
    // `coalesce(pitched_at, created_at::date)` ist die Definition, mit der auch
    // die RPCs rechnen (docs §1/§5). Ohne `created_at` im Select gäbe es für
    // eine Zeile ohne `pitched_at` gar keine Aussage — nur eine geratene.
    assert.match(ACTION, /pitchDay: c\.pitched_at \?\? \(berlinDateISO\(c\.created_at\) \|\| null\)/);
    assert.match(ACTION, /\.select\("id, list_id, pitched_at, created_at, lists\(/);
  });
});

/* ------------------------------------------------------------------ *
 * Abarbeitbarkeit — die zwei Stellen, an denen ein Rückschritt teuer wäre
 * ------------------------------------------------------------------ */

describe("Abarbeitbarkeit", () => {
  test("Rückrufe stehen ganz oben — sie sind die einzige Aufgabe mit Uhrzeit", () => {
    // `DUE_GRANULARITY.telefon === "moment"`: ein mit dem Lead VERABREDETER
    // Zeitpunkt. Unter bis zu vier LinkedIn-Sektionen rief man um 11:30
    // zurück, was für 09:00 zugesagt war.
    const sektionen = slice(BOARD, "const sections = useMemo<Section[]>", "return s;");
    const telefon = sektionen.indexOf('label: "Rückrufe"');
    const linkedin = sektionen.indexOf('label: `Follow-up ${fu}`');
    assert.notEqual(telefon, -1);
    assert.notEqual(linkedin, -1);
    assert.ok(telefon < linkedin, "Die Rückruf-Sektion muss vor den Follow-up-Sektionen einsortiert werden.");
  });

  test("„Endgültig raus\" fragt nach, bevor es den Lead für immer sperrt", () => {
    // Es gibt kein Entsperren in der Oberfläche, und `reviveBlockedReason()`
    // verweigert danach zusätzlich jede Rückholung. Ein Fehlgriff auf einer
    // 28 Pixel hohen Pille kostete den Lead endgültig.
    const knopf = slice(BOARD, "Endgültig sperren?", "Endgültig raus");
    assert.match(knopf, /destructive: true/);
    assert.match(knopf, /nicht rückgängig machen/);
    assert.match(knopf, /if \(ok\) runAction\(excludeFromRecycle/);
  });

  test("rohe Datenbank-Meldungen erscheinen nicht auf der Karte", () => {
    const mapper = slice(BOARD, "function friendlyError(", "function TaskCard(");
    assert.match(mapper, /KNOWN_ERROR_MESSAGES\.has\(text\)/);
    assert.match(mapper, /return GENERIC_ERROR_MESSAGE;/);
    assert.match(BOARD, /Konnte nicht gespeichert werden — bitte erneut versuchen\./);
  });

  test("…und sie erscheinen genau EINMAL", () => {
    // Der Fehler-Span stand doppelt im selben Flex-Container: einmal vor dem
    // Sperr-Knopf, einmal dahinter. Beide trugen dieselbe neue Fassung, also
    // war jede `assert.match`-Zusicherung grün — und auf der Karte stand jede
    // Meldung zweimal, links neben und rechts hinter „Endgültig raus".
    assert.equal(countOf(BOARD, "{error && ("), 1, "Nur EIN Fehler-Span in der Knopfreihe.");
    assert.equal(countOf(BOARD, "{friendlyError(error)}"), 1, "Nur EINE gerenderte Meldung.");
  });

  test("der Fehler steht VOR „Endgültig raus\", nicht dahinter", () => {
    // `marginLeft: auto` am Sperr-Knopf schluckt den freien Platz LINKS davon.
    // Ein Element dahinter nimmt ihm die rechte Kante und schiebt ihn nach
    // links — ausgerechnet in dem Moment, in dem gerade ein Fehler erschienen
    // ist und der Zeiger noch auf „Nochmal versucht" steht. Der Knopf sperrt
    // den Lead endgültig; er darf nicht unter den Zeiger wandern.
    const fehler = BOARD.indexOf("{error && (");
    const sperren = BOARD.indexOf("Endgültig sperren?");
    assert.notEqual(fehler, -1);
    assert.notEqual(sperren, -1);
    assert.ok(fehler < sperren, "Der Fehler-Span gehört vor den Sperr-Knopf.");
  });
});

/* ------------------------------------------------------------------ *
 * Der Überfällig-Filter — ein Schalter braucht einen Ausgang
 * ------------------------------------------------------------------ */

describe("Der Überfällig-Filter lässt sich immer wieder lösen", () => {
  test("die Pille bleibt stehen, solange der Filter aktiv ist", () => {
    // Sie rendert an `overdueCount` — und der zählt über ALLE Aufgaben.
    // Arbeitet jemand mit aktivem Schalter die letzte überfällige Aufgabe ab,
    // verschwand die Pille nach dem `router.refresh()`, während `overdueOnly`
    // aktiv blieb: ein dauerhaft leeres Board ohne sichtbaren Grund.
    const pille = slice(BOARD, "Der Überfällig-Schalter:", "Nur überfällig");
    assert.match(
      pille,
      /\{\(overdueCount > 0 \|\| overdueOnly\) && \(/,
      "Ein aktiver Filter muss sichtbar und abschaltbar bleiben, gerade wenn er nichts mehr durchlässt.",
    );
  });

  test("Gegenprobe: keine andere Bedienung setzt overdueOnly zurück", () => {
    // Wäre das anders, dürfte die Zusicherung oben gelockert werden. Die
    // Kanal-Pillen fassen bewusst nur `filter` und `fuFilter` an — „Alle"
    // meint alle KANÄLE, nicht „alle Filter aus"; die beiden Achsen sind
    // getrennt.
    const kanalKlick = slice(BOARD, "onClick={() => {", "}}");
    assert.match(kanalKlick, /setFilter\(f\.value\);/);
    assert.doesNotMatch(kanalKlick, /setOverdueOnly/);
  });

  test("der Leerzustand nennt den Schalter, statt nur auf „Alle\" zu zeigen", () => {
    // Er riet zu „Alle" — dem einen Knopf, der `overdueOnly` gerade nicht
    // anfasst. Ein Ratschlag, der die Liste nicht zurückbringt, macht den
    // Leerzustand zur zweiten Sackgasse.
    const leerzustand = slice(BOARD, "Keine Aufgaben in dieser Auswahl", "</p>");
    assert.match(leerzustand, /Nur überfällig/);
  });
});
