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
//   2. „Du bist dran“ ist EINE Regel für zwei Listen, nicht zwei.
//   3. Die Arbeitsliste ist die Vorgabe, nicht mehr der Kalender.
//   4. Die Liste ist die des Angemeldeten, und sie kann schreiben.
//
// ── NACHGEZOGEN: der Nachfass-Eingang (27.11.2026) ──────────────────────────
// Die Tagesarbeit ist von /termine nach /nachfassen gewandert
// (docs/nachfassen-umbau/PLAN-nachfass-eingang.md §4.7). Für diese Datei heißt
// das: Punkt 1 gilt unverändert (der Eingang nimmt seine Termine über dieselbe
// Ableitung auf). Punkt 2 hat sich verschoben — in der Terminliste heißt Gold
// nur noch „eine Termin-Erinnerung ist offen", das Gold der Arbeitsmenge trägt
// der Eingang. Punkt 3 hat sich umgedreht: /termine öffnet im Kalender, „Zu
// tun" und der Rückruf-Reiter leiten nach /nachfassen. Die Rückrufe (Blöcke 7
// und 8) prüfen deshalb jetzt den Eingang.
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
import { gruppeVon, istJetztDran, plusWerktage, type NachfassEintrag } from "@/lib/nachfassRegel";
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
const EINGANG = read("src/components/nachfassen/NachfassEingang.tsx");
const EINGANG_DATEN = read("src/lib/nachfassenData.ts");
const EINGANG_AKTION = read("src/app/actions/nachfassKontakt.ts");
const VIEW_STATE = read("src/components/termine/viewState.ts");
const BOARD = read("src/components/termine/TermineBoard.tsx");
const SEITE = read("src/app/(dashboard)/termine/page.tsx");
const STEMPEL = read("src/app/actions/followUpStamp.ts");

const HEUTE = "2026-09-15";
const MORGEN = "2026-09-16T08:00:00.000Z";
const GESTERN = "2026-09-14T08:00:00.000Z";

/**
 * Ein FESTES „jetzt", 08:00 Berliner Zeit am 15.09.
 *
 * `buildEvents` verlangt es seit den zwei festen Erinnerungen (`nowMs`,
 * src/lib/dranRegel.ts): Die Marken „1 Tag vorher" und „1 Stunde vorher"
 * entscheiden sich auf die MINUTE, nicht auf den Kalendertag. Der Wert liegt
 * bewusst VOR der Vortags-Marke von `MORGEN` (10:00 Berliner Zeit), damit die
 * Zusicherungen dieser Datei unverändert das prüfen, was sie prüfen sollen —
 * den abgeleiteten Zustand und den Tages-Stempel. Die Erinnerungen selbst haben
 * ihre eigene Datei (tests/terminErinnerungen.test.ts).
 */
const JETZT = Date.parse("2026-09-15T06:00:00.000Z");

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
    for (const [datei, quelle] of [["ListBoardV2", LIST_BOARD], ["TermineList", TERMINE_LIST], ["NachfassEingang", EINGANG]] as const) {
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

  test("in der Terminliste heißt Gold nur noch „Erinnerung offen“", () => {
    // NACHGEZOGEN (Nachfass-Eingang, Plan §4.7). Hier stand: „Der Stempel macht
    // die Zeile für HEUTE ruhig — und morgen leuchtet sie wieder", also Gold =
    // Arbeitsmenge und heute nicht gestempelt. Diese Frage beantwortet jetzt
    // allein /nachfassen; zwei Definitionen von „du bist dran" auf zwei Seiten
    // wären der alte Fehler. In der Terminliste leuchtet nur noch, was dort
    // NICHT steht: eine offene Termin-Erinnerung.
    assert.equal(istTerminDran("offen", null, HEUTE), false);
    assert.equal(istTerminDran("offen", GESTERN, HEUTE), false);
    assert.equal(istTerminDran("verlegt", null, HEUTE, "vortag"), true);
    assert.equal(istTerminDran("verlegt", null, HEUTE, "stunde"), true);
    assert.equal(istTerminDran("verlegt", null, HEUTE, null), false);
    // Der Stempel bleibt die Tagesfrage „heute schon dran gewesen?", gebucketet
    // über den Berliner Kalendertag, nicht über 24 Stunden (docs §6).
    assert.equal(istHeuteKontaktiert(`${HEUTE}T21:30:00.000Z`, HEUTE), true);
    assert.equal(istHeuteKontaktiert(undefined, HEUTE), false);
  });

  test("im Eingang macht ein eingetragener Kontakt die Zeile ruhig — bis zum nächsten Datum", () => {
    // Der Nachfolger des Stempels: „Kontakt eintragen" setzt das Datum des
    // nächsten Kontakts (Plan §4.3). Ohne Datum ist der Vorgang sofort fällig
    // und leuchtet; mit einem Datum in der Zukunft rutscht er nach „Demnächst"
    // und leuchtet nicht, bis der Tag kommt.
    const basis: NachfassEintrag = {
      key: "setting:s1",
      quelle: "termin",
      art: "setting",
      id: "s1",
      name: "Meier",
      firma: null,
      faelligAm: null,
      koernung: "tag",
      ergebnisFehlt: false,
      lebenszeichen: HEUTE,
      kontakte: [],
    };
    const jetzt = Date.parse(`${HEUTE}T08:00:00.000Z`);
    assert.equal(gruppeVon(basis, HEUTE, jetzt, "2026-09-01"), "heute");
    assert.equal(istJetztDran(basis, HEUTE, jetzt), true);
    const nachKontakt: NachfassEintrag = {
      ...basis,
      faelligAm: plusWerktage(HEUTE, 1),
      kontakte: [{ ergebnis: "nicht_erreicht", created_at: `${HEUTE}T08:00:00.000Z` }],
    };
    assert.equal(gruppeVon(nachKontakt, HEUTE, jetzt, "2026-09-01"), "demnaechst");
    assert.equal(istJetztDran(nachKontakt, HEUTE, jetzt), false);
    // … und am Tag selbst ist er wieder dran.
    const morgen = plusWerktage(HEUTE, 1);
    assert.equal(gruppeVon(nachKontakt, morgen, jetzt, "2026-09-01"), "heute");
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
    const { events, ohneTermin } = buildEvents([setting(patch)], [], NAMEN, HEUTE, JETZT);
    return [...events, ...ohneTermin][0];
  }

  test("der Pill zeigt den abgeleiteten Zustand, nicht den Rohwert", () => {
    assert.equal(event({ appointment_at: null }).statusPill.label, "Offen");
    // Der SCHLÜSSEL heißt weiterhin `verlegt` (er steckt in geteilten Links),
    // das WORT auf dem Bildschirm nicht mehr: Der Auftraggeber suchte seine
    // Termine der nächsten Woche im gleichnamigen Ausschnitt und fand sie nicht,
    // weil „Verlegt" nach „wurde verschoben" klingt.
    assert.equal(event({ appointment_at: MORGEN }).statusPill.label, "Termin steht");
    assert.equal(event({ status: "dead" }).statusPill.label, "Tot");
  });

  test("ein Termin ohne Zeitpunkt liegt in der Luft — und steht in der Liste", () => {
    // Er ist der einzige Fall, den es nur in der Liste gibt — im Kalenderraster
    // hat er keinen Platz. Genau deshalb war die Liste nicht zu löschen.
    // Golden ist er in der Terminliste seit dem Nachfass-Eingang nicht mehr: Er
    // hat keine Termin-Erinnerung, und die Tagesarbeit steht auf /nachfassen.
    const e = event({ appointment_at: null });
    assert.equal(e.dayISO, null);
    assert.equal(e.zustand, "offen");
    assert.equal(istInArbeitsmenge(e.zustand), true);
    assert.equal(e.dran, false);
  });

  test("der Stempel verändert den Zustand nicht", () => {
    const e = event({ appointment_at: null, follow_up_last_contacted_at: `${HEUTE}T09:00:00.000Z` });
    assert.equal(e.zustand, "offen", "der Stempel darf den Zustand nicht verändern");
    assert.equal(e.lastContactedAt, `${HEUTE}T09:00:00.000Z`);
    assert.equal(e.dran, false);
  });

  test("fehlt Migration 0041, verhält sich die Zeile wie „noch nie genervt“", () => {
    // Der Rückfall, an dem die ganze Seite hängt: Solange 0041 nicht
    // eingespielt ist, kommen die beiden Spalten schlicht nicht mit (die Seite
    // lädt mit `select("*")`). `undefined` heißt dann „noch nie" — statt dass
    // irgendetwas leer bleibt.
    const e = event({ appointment_at: null });
    assert.equal(e.lastContactedAt, null);
    assert.equal(e.lastContactedBy, null);
    assert.equal(e.zustand, "offen");
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

describe("4 · /termine öffnet im Kalender — die Tagesarbeit steht auf /nachfassen", () => {
  // UMGEDREHT mit dem Nachfass-Eingang (Plan §4.7, Detailfrage O3). Hier stand
  // „Die Arbeitsliste ist der erste Reiter, der Kalender der zweite": Wer
  // /termine morgens öffnete, wollte wissen, wen er nerven muss. Diese Frage
  // beantwortet jetzt /nachfassen; /termine beantwortet „wann habe ich was?"
  // und öffnet deshalb in der Woche.
  test("ohne Parameter beginnt die Seite im Kalender (Woche)", () => {
    assert.equal(parseTermineParams({}, HEUTE).view, "woche");
    assert.equal(tabForView("woche"), "kalender");
  });

  test("geteilte Links auf Liste und Kalender funktionieren unverändert", () => {
    for (const v of ["monat", "woche", "tag"] as const) {
      assert.equal(parseTermineParams({ view: v }, HEUTE).view, v);
      assert.equal(tabForView(v), "kalender");
    }
    assert.equal(parseTermineParams({ view: "liste" }, HEUTE).view, "liste");
    assert.equal(tabForView("liste"), "liste");
    // Unbekanntes fällt auf die Vorgabe.
    assert.equal(parseTermineParams({ view: "quatsch" }, HEUTE).view, "woche");
  });

  test("der Rückruf-Reiter und „Zu tun“ leiten nach /nachfassen", () => {
    // Alte Lesezeichen sollen nicht im Kalender stranden, sondern dort landen,
    // wo die Arbeit jetzt steht.
    assert.match(SEITE, /if \(sp\.view === "rueckruf"\) redirect\("\/nachfassen\?quelle=rueckruf"\);/);
    assert.match(SEITE, /if \(sp\.zeit === "zu_tun"\) redirect\("\/nachfassen"\);/);
    // Und `rueckruf` ist kein Ansichtswert mehr — ohne die Umleitung fiele der
    // Link auf die Vorgabe.
    assert.equal(parseTermineParams({ view: "rueckruf" }, HEUTE).view, "woche");
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
    // beantwortete die falsche. Seit dem Nachfass-Eingang kennt die Liste drei
    // Ausschnitte: die beiden Erinnerungs-Ansichten und „Alle" (Vorgabe).
    assert.equal(parseTermineParams({}, HEUTE).zeit, "alle");
    assert.equal(parseTermineParams({ zeit: "erinnerung_setting" }, HEUTE).zeit, "erinnerung_setting");
    assert.equal(parseTermineParams({ zeit: "erinnerung_closing" }, HEUTE).zeit, "erinnerung_closing");
    // Alte Links fallen auf die Vorgabe zurück, statt still etwas anderes zu
    // zeigen. (`zu_tun` selbst erreicht diese Stelle nicht — die Seite leitet
    // vorher nach /nachfassen um.)
    assert.equal(parseTermineParams({ zeit: "anstehend" }, HEUTE).zeit, "alle");
    assert.equal(parseTermineParams({ zeit: "verlegt" }, HEUTE).zeit, "alle");
    assert.equal(parseTermineParams({ zeit: "zu_tun" }, HEUTE).zeit, "alle");
    // Die Erinnerungs-Ansichten schneiden nach ZUSTAND („Termin steht") und Art.
    assert.match(TERMINE_LIST, /all\.filter\(\(e\) => e\.zustand === "verlegt" && e\.kind === art\)/);
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
    // hängen am Owner, Termine an der Person, die erinnert. Sie zu vermischen
    // schriebe einen Telefon-Lead demjenigen zu, der zufällig den Termin
    // angelegt hat. Seit dem Nachfass-Eingang stehen beide in DERSELBEN Liste
    // (src/lib/nachfassenData.ts) — und jede behält ihre Achse.
    assert.match(EINGANG_DATEN, /const owner = list \? ownerUserIdOfList\(list, idByName\) : null;\s*if \(!alle && owner !== scopeUser\) continue;/);
    assert.match(EINGANG_DATEN, /const person = erinnererOf\(r, zustand\);\s*if \(!alle && person !== scopeUser\) continue;/);
    // „ich" ist bei aktiver Datensicht der Kollege — dieselbe Regel wie hier.
    assert.match(EINGANG_DATEN, /const scopeUser = access\.effective_user_id \?\? access\.user\.id;/);
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
    assert.match(STEMPEL, /updateClosingCall\(id, \{\s*call_at: iso,/);
    // „Nachfassen" endet mit dem neuen Termin (Ablauf-Prüfung 27.11.).
    assert.match(STEMPEL, /vorher\?\.status === "nachfassen" \? \{ status: "offen" as const, follow_up_due_at: null \}/);
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

  test("die Rückrufe lädt die Terminseite gar nicht mehr", () => {
    // Hier stand: „die Rückrufe haben dagegen einen echten `available`-
    // Rückfall" (`ladeRueckrufe` + `RueckrufListe`). Mit dem Nachfass-Eingang
    // sind die Rückrufe nach /nachfassen gewandert; eine Telefon-Abfrage auf
    // /termine wäre jetzt eine Abfrage ohne Anzeige.
    assert.doesNotMatch(code(SEITE), /ladeRueckrufe|rueckrufeVerfuegbar|\.eq\("status", "rueckruf"\)/);
    assert.doesNotMatch(code(BOARD), /RueckrufListe|rueckrufe/);
  });
});

/* ------------------------------------------------------------------ *
 * 8 — Der Rückruf behält seine Uhrzeit
 * ------------------------------------------------------------------ */

describe("8 · Zwei Zeitkörnungen bleiben getrennt — auch in EINER Liste", () => {
  // Hier stand die Prüfung der `RueckrufListe` auf /termine. Seit dem
  // Nachfass-Eingang stehen Rückrufe und Termine in derselben Liste
  // (/nachfassen). Das hat R4 seinerzeit verhindert; gelöst ist es über die
  // Körnung je Eintrag (Plan §4.2): Ein Rückruf ist ab der verabredeten MINUTE
  // dran, ein Termin ab dem TAG.
  const jetzt10 = Date.parse(`${HEUTE}T08:00:00.000Z`); // 10:00 Berlin
  const jetzt16 = Date.parse(`${HEUTE}T14:00:00.000Z`); // 16:00 Berlin
  const START = "2026-09-01";

  function eintrag(patch: Partial<NachfassEintrag>): NachfassEintrag {
    return {
      key: "x:1",
      quelle: "termin",
      art: "setting",
      id: "1",
      name: "Meier",
      firma: null,
      faelligAm: null,
      koernung: "tag",
      ergebnisFehlt: false,
      lebenszeichen: HEUTE,
      kontakte: [],
      ...patch,
    };
  }

  test("der Loader gibt dem Rückruf die Minute, dem Termin den Tag", () => {
    assert.match(EINGANG_DATEN, /faelligAm: l\.callback_at,\s*koernung: "minute",/);
    assert.match(EINGANG_DATEN, /faelligAm: r\.follow_up_due,\s*koernung: "tag",/);
  });

  test("der Rückruf ist ab der verabredeten Minute dran, der Termin ab dem Tag", () => {
    // Ein Rückruf ist die einzige Aufgabe der Software mit einer MIT DEM LEAD
    // VERABREDETEN Uhrzeit (docs §1, §6).
    const rueckruf = eintrag({
      quelle: "rueckruf",
      art: "phone_lead",
      faelligAm: `${HEUTE}T14:00:00.000Z`,
      koernung: "minute",
    });
    assert.equal(gruppeVon(rueckruf, HEUTE, jetzt10, START), "heute");
    assert.equal(istJetztDran(rueckruf, HEUTE, jetzt10), false, "vor 16:00 ist der Rückruf noch nicht dran");
    assert.equal(istJetztDran(rueckruf, HEUTE, jetzt16), true);

    const termin = eintrag({ faelligAm: HEUTE });
    assert.equal(istJetztDran(termin, HEUTE, jetzt10), true, "ein Tagesdatum ist ab Tagesbeginn dran");
  });

  test("ein Rückruf wird nicht ins Nachfass-Protokoll geschrieben, sondern GEFÜHRT", () => {
    // Nur über `setPhoneLeadOutcome` entsteht der Eintrag im Anruf-Log
    // (docs §3). Ein zweites Protokoll für dieselbe Anwahl gäbe doppelte
    // Zahlen — `kontaktEintragen` kennt deshalb keine Quelle `rueckruf`.
    assert.match(EINGANG_AKTION, /quelle: "termin" \| "recycling";\s*ergebnis: Ergebnis;/);
    const start = EINGANG.indexOf('e.quelle === "rueckruf" ? (');
    assert.notEqual(start, -1, "der Rückruf-Zweig der Zeile fehlt");
    // Bis zum Zweig der Termine (der mit „Kontakt eintragen“ beginnt).
    const zweig = EINGANG.slice(start, EINGANG.indexOf("<span ref={kontaktRef", start));
    assert.match(zweig, /telefonAktion\("nicht_erreicht"/);
    assert.doesNotMatch(zweig, /kontaktToggle/);
    assert.doesNotMatch(code(EINGANG), /markFollowUpContacted/);
  });
});
