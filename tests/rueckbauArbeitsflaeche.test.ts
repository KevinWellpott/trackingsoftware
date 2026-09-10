// Der Rückbau in der Oberfläche: aus dem Termin-Kalender wird DIE
// ARBEITSFLÄCHE.
//
// „Eine Liste pro Person. Darauf stehen die Namen, die genervt werden müssen.
// Fertig." — daraus folgen vier prüfbare Aussagen, und sie sind der Aufbau
// dieser Datei:
//
//   1. Der Zustand einer Zeile wird ABGELEITET, nicht gespeichert. Die
//      gefährlichste Stelle des ganzen Vorhabens, weil `status='offen'` in der
//      Datenbank das GEGENTEIL des angezeigten „Offen" bedeutet.
//   2. „Du bist dran" ist EINE Regel für zwei Listen, nicht zwei.
//   3. Die Arbeitsliste ist die Vorgabe, nicht mehr der Kalender.
//   4. Die Liste ist die des Angemeldeten, und sie kann schreiben.
//
// Zwei Bauarten, dieselbe Aufteilung wie in terminRiegel.test.ts: Was eine
// reine Funktion entscheidet, wird als VERHALTEN geprüft (dranRegel und
// buildEvents kennen keine Datenbank). Was eine Server Action oder eine
// Verdrahtung entscheidet, wird am QUELLTEXT geprüft — eine echte Probe
// bräuchte eine Datenbank, und eine Attrappe bewiese nur, dass die Attrappe
// stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  DRAN_TONE,
  istHeuteKontaktiert,
  istInArbeitsmenge,
  istKontaktDran,
  istTerminDran,
  terminZustand,
  TERMIN_ZUSTAND_LABEL,
  type TerminZustand,
  type TerminZustandInput,
} from "@/lib/dranRegel";
import { buildEvents, type WithCancellation } from "@/lib/termine";
import { parseTermineParams, tabForView } from "@/components/termine/viewState";
import type { SettingCall } from "@/lib/types";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Die Datei OHNE Kommentare — für jede „das steht hier nicht mehr"-Prüfung.
 *
 * Ohne diesen Schritt schlägt der Rückbau an seiner eigenen Begründung fehl:
 * Die Dateien erklären ausführlich, WARUM sie sich die Ansicht nicht merken,
 * warum die Seite die neue Spalte NICHT namentlich selektiert und warum die
 * Rückrufe nicht über das Nachfassen-Board laufen — und nennen dabei
 * zwangsläufig `localStorage`, `follow_up_last_contacted_at` und
 * `actions/nachfassen`. Ein Abwesenheits-Test gegen den Rohtext verböte damit
 * ausgerechnet die Erklärung. Muster `STATEMENTS_0041` aus
 * rueckbauStempelUndPflichtfelder.test.ts.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const DRAN_REGEL = read("src/lib/dranRegel.ts");
const LIST_BOARD = read("src/components/ListBoardV2.tsx");
const TERMINE_LIST = read("src/components/termine/TermineList.tsx");
const RUECKRUF = read("src/components/termine/RueckrufListe.tsx");
const VIEW_STATE = read("src/components/termine/viewState.ts");
const BOARD = read("src/components/termine/TermineBoard.tsx");
const SEITE = read("src/app/(dashboard)/termine/page.tsx");
const STEMPEL = read("src/app/actions/followUpStamp.ts");

const HEUTE = "2026-09-15";
const MORGEN = "2026-09-16T08:00:00.000Z";
const GESTERN = "2026-09-14T08:00:00.000Z";

function zustand(patch: Partial<TerminZustandInput>): TerminZustand {
  return terminZustand(
    {
      kind: "setting",
      status: "offen",
      showStatus: null,
      at: MORGEN,
      cancelledAt: null,
      // Die beiden Ablage-Felder aus 0032 gehören seit der Nachbesserung in die
      // Eingabe — ohne sie stünde ein „abgesagt ohne Aussicht" täglich gold in
      // der Arbeitsliste UND in der Ablage. Die Fälle selbst prüft
      // tests/zaehlerUndArbeitsmenge.test.ts.
      cancelOutlook: null,
      noShowResolution: null,
      revivedAt: null,
      ...patch,
    },
    HEUTE,
  );
}

/* ------------------------------------------------------------------ *
 * 1 — Der abgeleitete Zustand
 * ------------------------------------------------------------------ */

describe("1 · Offen und Verlegt sind ABGELEITET — die größte Falle des Vorhabens", () => {
  test("`status='offen'` wird NICHT als „Offen“ durchgereicht", () => {
    // DER KERN. In der Datenbank heißt `offen` „Termin steht, Ergebnis fehlt"
    // und ist der Anfangszustand JEDER Zeile. Der Auftraggeber meint mit
    // „Offen" das Gegenteil: es steht kein Termin. Wer den Wert übernähme,
    // drehte die Bedeutung des halben Bestands um, ohne dass irgendwo eine
    // Zahl rot würde — es gibt keinen Test, der das von selbst fände, außer
    // diesem.
    assert.equal(zustand({ status: "offen", at: MORGEN }), "verlegt");
    assert.equal(zustand({ status: "offen", at: null }), "offen");
    assert.equal(zustand({ status: "offen", at: GESTERN }), "offen");
  });

  test("„Verlegt“ heißt: ein Termin steht — „Offen“: keiner (mehr)", () => {
    // Die eine Unterscheidung, auf die es ankommt: „Bei Offen liegt jemand in
    // der Luft. Bei Verlegt ist er versorgt."
    assert.equal(istInArbeitsmenge("verlegt"), false);
    assert.equal(istInArbeitsmenge("offen"), true);
  });

  test("ein Termin HEUTE gilt noch als versorgt — Tages-Körnung, nicht Minuten", () => {
    // Diese Liste rechnet auf Berliner Kalendertagen wie alles außer dem
    // Telefon-Rückruf (docs §6). Ein Termin, der heute um 10:00 war, darf nicht
    // ab 10:01 golden mahnen — dafür gibt es den No-Show-Eintrag, und der ist
    // eine Aussage statt einer Uhrzeit-Arithmetik.
    assert.equal(zustand({ at: `${HEUTE}T05:00:00.000Z` }), "verlegt");
  });

  test("die Absage schlägt das Datum — man sagt ab, BEVOR der Termin ist", () => {
    // `cancelAppointment` lässt `appointment_at` stehen (docs §3). Direkt nach
    // einer Absage trägt die Zeile also eine Absage UND ein Datum in der
    // Zukunft; wer nur auf das Datum sieht, hält einen abgeräumten Termin für
    // versorgt und nervt den Menschen nie wieder.
    assert.equal(zustand({ at: MORGEN, cancelledAt: "2026-09-10T09:00:00.000Z" }), "offen");
  });

  test("… und `revived_at` hebt sie auf — das dritte Feld, das den Fall löst", () => {
    // Der naheliegende Vergleich „ist das Datum jünger als die Absage?" ist
    // IMMER wahr (Ereigniszeitpunkt gegen Entscheidungszeitpunkt) und
    // unterscheidet deshalb nichts. Erst `revived_at` sagt „die Absage ist
    // überholt". Es gibt das Feld seit 0032; bis zum Rückbau schrieb es
    // niemand (docs §3).
    assert.equal(
      zustand({ at: MORGEN, cancelledAt: "2026-09-10T09:00:00.000Z", revivedAt: "2026-09-11T09:00:00.000Z" }),
      "verlegt",
    );
  });

  test("das Ergebnis schlägt alles — auch ein Datum in der Zukunft", () => {
    // Ein toter Lead mit einem Termin nächste Woche ist tot, nicht versorgt.
    assert.equal(zustand({ status: "dead", at: MORGEN }), "tot");
    assert.equal(zustand({ status: "unqualifiziert", at: MORGEN }), "nicht_qualifiziert");
    assert.equal(zustand({ status: "closing_gelegt", at: MORGEN }), "closing_gelegt");
    assert.equal(zustand({ kind: "closing", status: "gewonnen", at: MORGEN }), "close");
    assert.equal(zustand({ kind: "closing", status: "verloren", at: MORGEN }), "kein_close");
  });

  test("Show und No-Show kommen aus `show_status`, nicht aus dem Status", () => {
    // `closing_calls` kennt gar keinen No-Show-Status (docs §4) — dort steckt
    // die Information ausschließlich in `show_status`. Beide Zustände bleiben
    // in der Arbeitsmenge: „Er verschwindet von der Liste, wenn er entweder neu
    // terminiert ist oder als tot markiert wird. Nichts anderes nimmt ihn da
    // runter."
    assert.equal(zustand({ at: GESTERN, showStatus: "no_show" }), "no_show");
    assert.equal(zustand({ kind: "closing", at: GESTERN, showStatus: "no_show" }), "no_show");
    assert.equal(zustand({ at: GESTERN, showStatus: "show" }), "show");
    for (const z of ["no_show", "show"] as const) assert.equal(istInArbeitsmenge(z), true);
  });

  test("ein Closing im Status `nachfassen` ist Arbeit, kein Endzustand", () => {
    // Der Auftraggeber nennt für das Closing sechs Zustände, „Nachfassen" ist
    // keiner davon — und muss auch keiner sein: Es heißt „er war da, entschieden
    // ist nichts", also genau die Lage, in der weiter genervt wird.
    const z = zustand({ kind: "closing", status: "nachfassen", at: GESTERN, showStatus: "show" });
    assert.equal(z, "show");
    assert.equal(istInArbeitsmenge(z), true);
  });

  test("die Beschriftungen sind wörtlich die Liste des Auftraggebers", () => {
    // Setting: Show · No-Show · Qualifiziert · Nicht qualifiziert · Closing
    // gelegt · Offen · Verlegt · Tot. Closing: Show · No-Show · Close · Kein
    // Close · Offen · Verlegt. Zusammen zehn Schlüssel, weil sich sechs davon
    // beide Seiten teilen.
    const setting = ["show", "no_show", "qualifiziert", "nicht_qualifiziert", "closing_gelegt", "offen", "verlegt", "tot"];
    const closing = ["show", "no_show", "close", "kein_close", "offen", "verlegt"];
    assert.deepEqual(
      new Set(Object.keys(TERMIN_ZUSTAND_LABEL)),
      new Set([...setting, ...closing]),
      "es gibt einen Zustand mehr oder weniger, als der Auftraggeber sehen will",
    );
    assert.equal(TERMIN_ZUSTAND_LABEL.nicht_qualifiziert, "Nicht qualifiziert");
    assert.equal(TERMIN_ZUSTAND_LABEL.close, "Close");
    assert.equal(TERMIN_ZUSTAND_LABEL.kein_close, "Kein Close");
    assert.equal(TERMIN_ZUSTAND_LABEL.tot, "Tot");
  });

  test("abgeleitet heißt: es wird nichts geschrieben", () => {
    // Kein Backfill, keine Umdeutung, kein Statuswechsel. Die ganze Datei ist
    // frei von Schreiboperationen — sie kennt nicht einmal einen Supabase-Client.
    assert.doesNotMatch(code(DRAN_REGEL), /supabase|update\(|\.from\(/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Eine Regel, zwei Listen
 * ------------------------------------------------------------------ */

describe("2 · „Du bist dran“ steht EINMAL da", () => {
  test("die LinkedIn-Regel liegt in der geteilten Datei, nicht mehr im Board", () => {
    // Das erklärte Vorbild („nur EIN Feld leuchtet Gold") hatte seine Regel als
    // private Funktion im Board, die Termin-Liste eine eigene im Render. Zwei
    // Formulierungen derselben Bedeutung laufen auseinander — denselben Preis
    // hat das Projekt bei `nachfassen_tasks` gegen `isDueFollowUp` schon
    // einmal bezahlt (docs §5.4).
    assert.match(LIST_BOARD, /import \{[^}]*istKontaktDran[^}]*\} from "@\/lib\/dranRegel"/);
    assert.doesNotMatch(
      code(LIST_BOARD),
      /function isDueFollowUp\(/,
      "die LinkedIn-Regel steht wieder als eigene Definition im Board",
    );
  });

  test("… und die Termin-Liste liest dieselbe Datei", () => {
    assert.match(TERMINE_LIST, /from "@\/lib\/dranRegel"/);
  });

  test("Gold ist EINE Farbe — sonst leuchtet die eine Liste anders als die andere", () => {
    // Der Wiedererkennungswert ist der Grund, warum die LinkedIn-Liste zum
    // Vorbild geworden ist; ein zweites, leicht anderes Gold hätte ihn zerlegt.
    assert.deepEqual({ ...DRAN_TONE }, { bg: "var(--warning-bg)", fg: "var(--warning-fg)", border: "var(--warning)" });
    for (const [datei, quelle] of [["ListBoardV2", LIST_BOARD], ["TermineList", TERMINE_LIST], ["RueckrufListe", RUECKRUF]] as const) {
      assert.match(quelle, /DRAN_TONE/, `${datei} malt sein Gold selbst`);
    }
    // Gegenprobe: Der Ton kommt aus vorhandenen Tokens, es gibt keine neue Farbe.
    assert.doesNotMatch(DRAN_REGEL, /#[0-9a-fA-F]{3,8}\b/);
  });

  test("die LinkedIn-Bedingung ist unverändert — inklusive der NULL-Falle", () => {
    // `answered` und `appointment_set` sind `boolean | null`, und NULL ist der
    // NORMALFALL (frisch gepitcht, docs §7). Ein Vergleich auf `false` verlöre
    // die Mehrheit der Zeilen. Die Auslagerung durfte daran nichts ändern: Die
    // Liste ist das Vorbild und darf sich für den Nutzer nicht verändern.
    const basis = { next_follow_up_at: "2026-09-10", answered: null, appointment_set: null, follow_up_number: 1, blocked_at: null };
    assert.equal(istKontaktDran(basis, HEUTE), true);
    assert.equal(istKontaktDran({ ...basis, answered: true }, HEUTE), false);
    assert.equal(istKontaktDran({ ...basis, appointment_set: true }, HEUTE), false);
    assert.equal(istKontaktDran({ ...basis, follow_up_number: 3 }, HEUTE), false);
    assert.equal(istKontaktDran({ ...basis, blocked_at: "2026-09-01" }, HEUTE), false);
    assert.equal(istKontaktDran({ ...basis, next_follow_up_at: "2026-09-20" }, HEUTE), false);
    assert.equal(istKontaktDran({ ...basis, next_follow_up_at: null }, HEUTE), false);
  });

  test("der Stempel macht die Zeile für HEUTE ruhig — und morgen leuchtet sie wieder", () => {
    // Der ganze Sinn des Ein-Klick-Knopfes. Ohne ihn leuchtete jede Zeile jeden
    // Tag gleich hell: Es gäbe nichts abzuhaken, und niemand sähe, ob heute
    // schon jemand drangewesen ist.
    assert.equal(istTerminDran("offen", null, HEUTE), true);
    assert.equal(istTerminDran("offen", `${HEUTE}T18:00:00.000Z`, HEUTE), false);
    assert.equal(istTerminDran("offen", GESTERN, HEUTE), true);
    // Gebucketet über den Berliner Kalendertag, nicht über 24 Stunden (docs §6).
    assert.equal(istHeuteKontaktiert(`${HEUTE}T21:30:00.000Z`, HEUTE), true);
    assert.equal(istHeuteKontaktiert(undefined, HEUTE), false);
  });

  test("was nicht in der Arbeitsmenge liegt, leuchtet nie", () => {
    for (const z of ["verlegt", "tot", "close", "kein_close", "nicht_qualifiziert", "closing_gelegt"] as const) {
      assert.equal(istTerminDran(z, null, HEUTE), false, z);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Das Event-Modell trägt den Zustand
 * ------------------------------------------------------------------ */

describe("3 · buildEvents reicht Zustand und Gold an die Oberfläche durch", () => {
  const NAMEN = new Map([["u1", "kevin"]]);

  function setting(patch: Partial<WithCancellation<SettingCall>> = {}): WithCancellation<SettingCall> {
    return {
      id: "s1",
      status: "offen",
      show_status: null,
      appointment_at: null,
      lead_name: "Meier",
      company: "Meier GmbH",
      meet_link: null,
      meeting_kind: null,
      phone: null,
      source_type: null,
      source_detail: null,
      assigned_user_id: "u1",
      created_by_user_id: "u1",
      ...patch,
    } as WithCancellation<SettingCall>;
  }

  function event(patch: Partial<WithCancellation<SettingCall>> = {}) {
    const { events, ohneTermin } = buildEvents([setting(patch)], [], NAMEN, HEUTE);
    return [...events, ...ohneTermin][0];
  }

  test("der Pill zeigt den abgeleiteten Zustand, nicht den Rohwert", () => {
    assert.equal(event({ appointment_at: null }).statusPill.label, "Offen");
    assert.equal(event({ appointment_at: MORGEN }).statusPill.label, "Verlegt");
    assert.equal(event({ status: "dead" }).statusPill.label, "Tot");
  });

  test("ein Termin ohne Zeitpunkt liegt in der Luft und leuchtet", () => {
    // Er ist der einzige Fall, den es nur in der Liste gibt — im Kalenderraster
    // hat er keinen Platz. Genau deshalb war die Liste nicht zu löschen.
    const e = event({ appointment_at: null });
    assert.equal(e.dayISO, null);
    assert.equal(e.zustand, "offen");
    assert.equal(e.dran, true);
  });

  test("der Stempel von heute nimmt das Gold, der Zustand bleibt", () => {
    const e = event({ appointment_at: null, follow_up_last_contacted_at: `${HEUTE}T09:00:00.000Z` });
    assert.equal(e.zustand, "offen", "der Stempel darf den Zustand nicht verändern");
    assert.equal(e.dran, false);
  });

  test("fehlt Migration 0041, verhält sich die Zeile wie „noch nie genervt“", () => {
    // Der Rückfall, an dem die ganze Seite hängt: Solange 0041 nicht
    // eingespielt ist, kommen die beiden Spalten schlicht nicht mit (die Seite
    // lädt mit `select("*")`). `undefined` heißt dann „noch nie" — die Zeile
    // leuchtet weiter, statt dass irgendetwas leer bleibt.
    const e = event({ appointment_at: null });
    assert.equal(e.lastContactedAt, null);
    assert.equal(e.lastContactedBy, null);
    assert.equal(e.dran, true);
  });

  test("der Stempler bekommt einen Namen — „hast du den angerufen oder ich?“", () => {
    const e = event({ appointment_at: null, follow_up_last_contacted_by_user_id: "u1" });
    assert.equal(e.lastContactedBy, "kevin");
    // Er ist ein AUDIT-Name und ersetzt die Zuständigkeit nicht (docs §2).
    assert.equal(e.assignee?.username, "kevin");
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Die Liste ist die Vorgabe
 * ------------------------------------------------------------------ */

describe("4 · Die Arbeitsliste ist der erste Reiter, der Kalender der zweite", () => {
  test("ohne Parameter beginnt die Seite bei der Arbeit", () => {
    // Vorher lag die Liste hinter einem unbeschrifteten Umschalt-Knopf ganz
    // rechts außen: Sie war da, aber niemand fand sie.
    assert.equal(parseTermineParams({}, HEUTE).view, "liste");
    assert.equal(tabForView("liste"), "liste");
  });

  test("geteilte Links auf den Kalender funktionieren unverändert", () => {
    for (const v of ["monat", "woche", "tag"] as const) {
      assert.equal(parseTermineParams({ view: v }, HEUTE).view, v);
      assert.equal(tabForView(v), "kalender");
    }
    assert.equal(tabForView("rueckruf"), "rueckruf");
    // Unbekanntes fällt auf die Vorgabe, nicht auf den Kalender.
    assert.equal(parseTermineParams({ view: "quatsch" }, HEUTE).view, "liste");
  });

  test("die Vorliebe wird NICHT gemerkt — anders als bei der Seitenleiste", () => {
    // Dort gewinnt der gespeicherte Zustand über die Vorbelegung, weil ein
    // Eintrag im localStorage dort immer die bewusste Entscheidung eines
    // Menschen über EINEN Block ist. Hier wäre die Wirkung die umgekehrte: Wer
    // einmal in den Kalender wechselt — und das tut jeder, der einen Termin
    // sucht —, bekäme dauerhaft den Kalender als Startseite und sähe seine
    // Arbeitsliste nie wieder von selbst. Die Ansicht steht deshalb
    // ausschließlich in der URL.
    for (const [datei, quelle] of [["viewState", VIEW_STATE], ["TermineBoard", BOARD]] as const) {
      assert.doesNotMatch(code(quelle), /localStorage/, `${datei} merkt sich die Ansicht`);
    }
  });

  test("der Ausschnitt der Liste schneidet nach ZUSTAND, nicht nach Zeit", () => {
    // „Anstehend / Vergangen" war eine Kalenderfrage in einer Arbeitsliste und
    // beantwortete die falsche: Ein Termin von letzter Woche, bei dem niemand
    // nachgefasst hat, ist keine Vergangenheit, sondern Arbeit.
    assert.equal(parseTermineParams({}, HEUTE).zeit, "zu_tun");
    assert.equal(parseTermineParams({ zeit: "verlegt" }, HEUTE).zeit, "verlegt");
    // Alte Links fallen auf die Vorgabe zurück, statt still etwas anderes zu zeigen.
    assert.equal(parseTermineParams({ zeit: "anstehend" }, HEUTE).zeit, "zu_tun");
    assert.match(TERMINE_LIST, /zeit === "zu_tun"[\s\S]{0,120}istInArbeitsmenge/);
  });
});

/* ------------------------------------------------------------------ *
 * 5 — Eine Liste pro Person
 * ------------------------------------------------------------------ */

describe("5 · Die Liste zeigt, was der Angemeldete zu tun hat", () => {
  test("die Vorgabe ist die persönliche Sicht, „alle“ die Ausnahme", () => {
    assert.equal(parseTermineParams({}, HEUTE).wer, "mein");
    assert.equal(parseTermineParams({ wer: "alle" }, HEUTE).wer, "alle");
    // Ein Tippfehler in der URL darf nicht versehentlich das ganze Team zeigen.
    assert.equal(parseTermineParams({ wer: "team" }, HEUTE).wer, "mein");
  });

  test("gefiltert wird über `personOf`, nicht über den Ersteller", () => {
    // `assignee` ist bereits `assigned_user_id ?? created_by_user_id` (docs §2)
    // — dieselbe Achse wie jede Auswertung. Ein reiner
    // `created_by_user_id`-Filter ließe jeden Termin verschwinden, den ein
    // Admin FÜR jemanden gelegt hat.
    assert.match(BOARD, /e\.assignee\?\.user_id === scopeUserId/);
  });

  test("bei aktiver Datensicht ist „ich“ der Kollege, dessen Liste ich abarbeite", () => {
    // `effective_user_id ?? user.id` — dieselbe Regel wie bei den
    // Navigations-Zählern (docs §5.4). Andersherum stünde die Seite leer da,
    // sobald jemand die Datensicht eines Kollegen einnimmt.
    assert.match(SEITE, /scopeUserId=\{access\.effective_user_id \?\? access\.user\.id\}/);
    // Und „Alle" gibt es nur für den Owner mit Team-Sicht: Bei aktiver
    // Datensicht hat der Server die Menge längst zugeschnitten, der Schalter
    // wäre dort eine Lüge.
    assert.match(SEITE, /canSeeAll=\{!access\.effective_user_id\}/);
  });

  test("die Rückrufe folgen der ANDEREN Personenachse — dem Listen-Owner", () => {
    // Die zwei Achsen des Datenmodells laufen nebeneinander (docs §5.1): Listen
    // hängen am Owner, Termine an `personOf()`. Sie zu vermischen schriebe
    // einen Telefon-Lead demjenigen zu, der zufällig den Termin angelegt hat.
    assert.match(SEITE, /ownerUserIdOfList/);
    assert.match(SEITE, /matchesOwnScope/);
    assert.match(BOARD, /r\.ownerUserId !== scopeUserId/);
  });
});

/* ------------------------------------------------------------------ *
 * 6 — Die drei Handgriffe
 * ------------------------------------------------------------------ */

describe("6 · Genervt · Neuer Termin · Tot", () => {
  test("der Stempel schreibt die real angemeldete Person, nicht die Datensicht", () => {
    // AUDIT-Feld in der Bedeutung von `created_by_user_id` (docs §2). Genau
    // diesen Fehler hatte `created_by_user_id` bis Migration 0028: Wer mit der
    // Datensicht eines Kollegen arbeitete, schrieb alles auf ihn.
    assert.match(STEMPEL, /follow_up_last_contacted_by_user_id: access\.user\.id/);
    assert.doesNotMatch(code(STEMPEL), /follow_up_last_contacted_by_user_id: access\.effective_user_id/);
  });

  test("eine fehlende Spalte wird erklärt, nicht als Postgres-Meldung durchgereicht", () => {
    // Solange 0041 nicht eingespielt ist, antwortet PostgREST mit PGRST204.
    // Das ist keine Fehlbedienung und darf nicht so aussehen.
    assert.match(STEMPEL, /follow_up_last_contacted/);
    assert.match(STEMPEL, /Migration 0041 ist noch nicht eingespielt/);
  });

  test("„Tot“ benutzt die vorhandenen Ergebnis-Actions samt ihrer Folgen", () => {
    // An einem Ergebnis hängen Recycling-Datum und das Entwerten offener
    // Erinnerungen. Ein Direkt-UPDATE auf `status` ließe den Lead ohne
    // Wiedervorlage verschwinden — „Recycling bleibt" war die Ansage.
    assert.match(STEMPEL, /setSettingOutcome\(\{ settingId: id, outcome: "dead" \}\)/);
    assert.match(STEMPEL, /setClosingOutcome\(\{ closingId: id, outcome: "verloren", lostReasonCode: "sonstiges" \}\)/);
  });

  test("„Neuer Termin“ stempelt `revived_at` nur beim ERSTEN Mal", () => {
    // Muster `wasCancelled` in `cancelAppointment`: Danach ist der Zeitpunkt
    // Historie. Ein zweiter Stempel schöbe die Zeile in der Ablage nach oben.
    assert.match(STEMPEL, /vorher\?\.cancelled_at && !vorher\.revived_at/);
    assert.match(STEMPEL, /revived_at: new Date\(\)\.toISOString\(\)/);
    // Die Absage selbst bleibt stehen: Sie zählt weiter in der Absagequote
    // (docs §5), und die Ablage-Liste „Ersatztermin steht aus" nimmt die Zeile
    // über genau dieses Feld von allein heraus.
    assert.doesNotMatch(code(STEMPEL), /cancelled_at: null/);
  });

  test("… und schreibt das Datum über die vorhandenen Actions", () => {
    assert.match(STEMPEL, /rescheduleSetting\(id, berlinInput\)/);
    assert.match(STEMPEL, /updateClosingCall\(id, \{ call_at: iso \}\)/);
  });

  test("die drei Knöpfe stehen in der Zeile, nicht auf einer Detailseite", () => {
    assert.match(TERMINE_LIST, /markFollowUpContacted/);
    assert.match(TERMINE_LIST, /setNeuerTermin/);
    assert.match(TERMINE_LIST, /markTerminDead/);
    // Nur der beendende Handgriff fragt nach — „Genervt" ist folgenlos, ein
    // neuer Termin korrigierbar.
    assert.match(TERMINE_LIST, /confirm\(\{[\s\S]{0,400}destructive: true/);
  });
});

/* ------------------------------------------------------------------ *
 * 7 — Der Rückfall, an dem die ganze Seite hängt
 * ------------------------------------------------------------------ */

describe("7 · Migration 0041 fehlt noch — die Seite darf davon nichts merken", () => {
  test("beide Termin-Abfragen laden mit `select(\"*\")`", () => {
    // PostgREST weist bei einer fehlenden NAMENTLICH selektierten Spalte die
    // GANZE Abfrage ab; die Seite wäre leer statt unvollständig (dieselbe Falle
    // wie bei 0029 und 0032, docs §7). Mit `*` kommen die beiden neuen Felder
    // einfach nicht mit. Das ist der Grund, warum hier KEIN `available`-Loader
    // steht: Es gibt nichts, wovon zurückzufallen wäre.
    assert.match(SEITE, /from\("setting_calls"\)\.select\("\*"\)/);
    assert.match(SEITE, /from\("closing_calls"\)\.select\("\*"\)/);
    assert.doesNotMatch(code(SEITE), /follow_up_last_contacted/, "die Seite selektiert die neue Spalte namentlich");
  });

  test("die Rückrufe haben dagegen einen echten `available`-Rückfall", () => {
    // Muster `loadCallAttempts` (docs §5.1): „nicht ermittelbar" darf nicht wie
    // „nichts zu tun" aussehen — und eine gescheiterte Telefon-Abfrage darf die
    // Seite nicht mitnehmen, deren Hauptaufgabe woanders liegt.
    assert.match(SEITE, /ladeRueckrufe\([\s\S]{0,120}\.catch\(\(\) => null\)/);
    assert.match(SEITE, /rueckrufeVerfuegbar=\{rueckrufe != null\}/);
    assert.match(RUECKRUF, /Rückrufe nicht ermittelbar/);
  });
});

/* ------------------------------------------------------------------ *
 * 8 — Der Rückruf behält seine Uhrzeit
 * ------------------------------------------------------------------ */

describe("8 · Zwei Zeitkörnungen bleiben getrennt", () => {
  test("der Rückruf misst auf die Minute, alles andere auf den Tag", () => {
    // Ein Rückruf ist die einzige Aufgabe der Software mit einer MIT DEM LEAD
    // VERABREDETEN Uhrzeit (docs §1, §6). Er ist in der Minute nach der
    // verabredeten Zeit versäumt, ein Follow-up erst am Folgetag. Die Regel
    // steht in dueState und wird gelesen, nicht nachgebaut.
    assert.match(RUECKRUF, /isOverdue\(r\.callbackAt, "moment", dueRefAt\(nowMs\)\)/);
    assert.match(RUECKRUF, /from "@\/lib\/dueState"/);
  });

  test("die Rückrufe werden hier geladen, nicht über das Nachfassen-Board", () => {
    // Dieselbe Frage, aber die Zuständigkeit für diese Seite liegt hier. Ein
    // zweiter Aufrufer einer Board-Action wäre eine Kopplung zwischen zwei
    // Bereichen, die sonst nichts miteinander zu tun haben.
    for (const [datei, quelle] of [["page", SEITE], ["TermineBoard", BOARD], ["RueckrufListe", RUECKRUF]] as const) {
      assert.doesNotMatch(code(quelle), /actions\/nachfassen/, `${datei} hängt am Nachfassen-Board`);
    }
    assert.match(SEITE, /\.eq\("status", "rueckruf"\)/);
  });

  test("abgehakt wird im Call-Modus, nicht hier", () => {
    // Ein Rückruf wird nicht abgehakt, sondern GEFÜHRT — und nur im Call-Modus
    // entsteht der Eintrag im Anruf-Log (docs §3). Migration 0041 legt den
    // Nachfass-Stempel deshalb bewusst nur auf den Termin-Tabellen an.
    assert.match(RUECKRUF, /\/telefon\/\$\{r\.listId\}/);
    assert.doesNotMatch(code(RUECKRUF), /markFollowUpContacted/);
  });
});
