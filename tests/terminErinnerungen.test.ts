// Zwei feste Erinnerungen vor jedem Termin — 1 Tag vorher, 1 Stunde vorher,
// egal ob Erstgespräch oder Closing.
//
// „Leute die einen Termin in Zukunft haben sollen mindestens 2 mal daran
// erinnert werden!"
//
// Diese Datei prüft fünf Dinge, und vier davon sind Gegenproben gegen genau die
// Fehler, an denen der Vorgänger gescheitert ist:
//
//   1. DIE ZWEI MARKEN liegen richtig — auf die Minute, und am
//      Umstellungswochenende auf die WANDZEIT. „1 Tag vorher" ist für einen
//      Menschen dieselbe Uhrzeit am Vortag, nicht 24 Stunden; der Tag hat dort
//      23 bzw. 25 Stunden.
//   2. EIN STEMPEL SCHLIESST GENAU EINE ERINNERUNG. Er trägt nicht bis zum
//      Termin, und er verliert die zweite nicht.
//   3. KURZFRISTIG GEBUCHT IST KEIN VERSÄUMNIS. Die Zeile leuchtet (richtig),
//      aber nichts an ihr behauptet „überfällig" — das war die Beschwerde, an
//      der das alte System gefallen ist.
//   4. WER KEINE BEKOMMT: abgesagt, abgeschlossen, vorbei, ohne Termin.
//   5. DIE ZEILE SAGT, WARUM SIE LEUCHTET — und der Ausschnitt heißt nicht mehr
//      „Verlegt".
//
// Bauart wie in rueckbauArbeitsflaeche.test.ts: Was eine reine Funktion
// entscheidet, wird am VERHALTEN geprüft (dranRegel und buildEvents kennen keine
// Datenbank). Was eine Verdrahtung oder ein Text entscheidet, am QUELLTEXT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  ERINNERUNG_KURZ_MINUTEN,
  ERINNERUNG_VORTAG_TAGE,
  erinnerungsZeitpunkte,
  erinnerungText,
  istHeuteKontaktiert,
  istInArbeitsmenge,
  istTerminDran,
  istZuTun,
  offeneErinnerung,
  TERMIN_ZUSTAND_LABEL,
  terminZustand,
  type TerminZustand,
  type TerminZustandInput,
} from "@/lib/dranRegel";
import { isOverdue, dueRefAt } from "@/lib/dueState";
import { zustandPill } from "@/lib/terminMeta";
import { buildEvents, type WithCancellation } from "@/lib/termine";
import type { ClosingCall, SettingCall } from "@/lib/types";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Die Datei ohne Kommentare — Kommentare dürfen erklären, was der Code nicht tut. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const TERMINE_LIST = read("src/components/termine/TermineList.tsx");
const FILTER_BAR = read("src/components/termine/TermineFilterBar.tsx");
const BOARD = read("src/components/termine/TermineBoard.tsx");
const DRAN_REGEL = read("src/lib/dranRegel.ts");

const MIN = 60_000;
const STD = 60 * MIN;

/** Berliner Wandzeit → ms. Die Tests denken in dem, was auf der Uhr steht. */
function berlin(tag: string, uhr: string): number {
  // Sommerzeit +02:00, Winterzeit +01:00 — hier bewusst von Hand angegeben, statt
  // über dieselbe Bibliothek zu rechnen, die geprüft wird.
  const sommer = tag >= "2026-03-29" && tag < "2026-10-25";
  return Date.parse(`${tag}T${uhr}:00.000${sommer ? "+02:00" : "+01:00"}`);
}

const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ *
 * Ein Erstgespräch am Donnerstag, 17.09.2026 um 14:00 Berliner Zeit
 * ------------------------------------------------------------------ */

const TERMIN_MS = berlin("2026-09-17", "14:00");
const TERMIN = iso(TERMIN_MS);
const TERMIN_TAG = "2026-09-17";
const VORTAG_MS = berlin("2026-09-16", "14:00");
const STUNDE_MS = TERMIN_MS - STD;

function zustandVon(patch: Partial<TerminZustandInput>, heute: string): TerminZustand {
  return terminZustand(
    {
      kind: "setting",
      status: "offen",
      showStatus: null,
      at: TERMIN,
      cancelledAt: null,
      cancelOutlook: null,
      noShowResolution: null,
      revivedAt: null,
      ...patch,
    },
    heute,
  );
}

/** Die offene Erinnerung eines ganz normalen, anstehenden Termins. */
function offen(nowMs: number, stempel: string | null = null, patch: Partial<TerminZustandInput> = {}) {
  const heute = new Date(nowMs).toISOString().slice(0, 10);
  return offeneErinnerung(zustandVon(patch, heute), patch.at ?? TERMIN, stempel, nowMs);
}

/* ------------------------------------------------------------------ *
 * 1 — Die zwei Marken
 * ------------------------------------------------------------------ */

describe("1 · Die zwei Marken liegen auf die Minute", () => {
  test("die Konstanten sagen ihre Einheit — und es gibt keine dritte Stufe", () => {
    // Zwei Zahlen, im Code, ohne Einstellung. Muster `CONTACT_GAP_WARN_DAYS`:
    // Was nichts blockiert und für alle gleich gilt, hat nichts zu
    // konfigurieren. Gegenprobe: keine Tabelle, keine Stufennummer, kein Kanal.
    assert.equal(ERINNERUNG_VORTAG_TAGE, 1);
    assert.equal(ERINNERUNG_KURZ_MINUTEN, 60);
    assert.doesNotMatch(code(DRAN_REGEL), /cascade|template|touch_kind|step_no|channel/i);
    assert.doesNotMatch(code(DRAN_REGEL), /supabase|\.from\(/);
  });

  test("die Vortags-Marke: eine Minute davor nichts, ab der Minute die Erinnerung", () => {
    const marken = erinnerungsZeitpunkte(TERMIN);
    assert.ok(marken);
    assert.equal(marken.vortag, VORTAG_MS);
    assert.equal(marken.stunde, STUNDE_MS);
    assert.equal(marken.termin, TERMIN_MS);

    assert.equal(offen(VORTAG_MS - MIN), null, "eine Minute zu früh");
    assert.equal(offen(VORTAG_MS), "vortag", "auf die Minute genau");
    assert.equal(offen(VORTAG_MS + MIN), "vortag");
  });

  test("die Stunden-Marke: exakt 60 Minuten, geprüft mit geschlossener Vortags-Erinnerung", () => {
    // Ohne Stempel wäre auch die Vortags-Marke noch offen und verdeckte den
    // Befund. Der Stempel direkt nach der ersten Marke isoliert die zweite.
    const gestempelt = iso(VORTAG_MS + MIN);
    assert.equal(offen(STUNDE_MS - MIN, gestempelt), null, "eine Minute zu früh");
    assert.equal(offen(STUNDE_MS, gestempelt), "stunde", "auf die Minute genau");
    assert.equal(offen(STUNDE_MS + 30 * MIN, gestempelt), "stunde");
  });

  test("die spätere Marke gewinnt, wenn beide offen sind", () => {
    // Liegt der Termin in einer halben Stunde und hat noch niemand angekündigt,
    // ist „in weniger als einer Stunde" die Aussage, die zählt — die
    // Vortags-Marke ist dann längst Geschichte.
    assert.equal(offen(STUNDE_MS + 30 * MIN), "stunde");
  });

  test("Gegenprobe: ein Termin in fünf Tagen bleibt ruhig", () => {
    const fern = iso(TERMIN_MS + 5 * 24 * STD);
    assert.equal(offen(TERMIN_MS, null, { at: fern }), null);
  });

  test("die Marken können sich nie überholen — darauf ruht der ganze Mechanismus", () => {
    for (const tag of ["2026-03-28", "2026-03-29", "2026-06-15", "2026-10-24", "2026-10-25"]) {
      for (const uhr of ["00:30", "09:00", "14:00", "23:45"]) {
        const m = erinnerungsZeitpunkte(iso(berlin(tag, uhr)));
        assert.ok(m, `${tag} ${uhr}`);
        assert.ok(m.vortag < m.stunde, `${tag} ${uhr}: Vortag liegt nicht vor der Stunde`);
        assert.ok(m.stunde < m.termin, `${tag} ${uhr}: Stunde liegt nicht vor dem Termin`);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Die Zeitumstellung
 * ------------------------------------------------------------------ */

describe("2 · „1 Tag vorher“ ist Wandzeit, nicht 24 Stunden", () => {
  // DIE ENTSCHEIDUNG: Der Auftraggeber sagt „1 Tag vorher". Für einen Menschen
  // heißt das dieselbe Uhrzeit am Vortag — der Termin am Sonntag um 10:00 wird
  // am Samstag um 10:00 angekündigt. An den beiden Umstellungswochenenden ist
  // ein Tag 23 bzw. 25 Stunden lang; eine Millisekunden-Rechnung landete dort
  // auf 09:00 bzw. 11:00, also auf einer Uhrzeit, die niemand gemeint hat.
  //
  // Die Gegenprobe steht bewusst als Zusicherung in der Datei und nicht nur im
  // Bericht: Beide Fälle vergleichen gegen `termin - 24h` und verlangen, dass
  // das ETWAS ANDERES ist.

  test("Frühjahr: der Tag hat 23 Stunden — die Marke bleibt auf 10:00", () => {
    const termin = berlin("2026-03-29", "10:00"); // Umstellungssonntag, CEST
    const marken = erinnerungsZeitpunkte(iso(termin));
    assert.ok(marken);
    assert.equal(marken.vortag, berlin("2026-03-28", "10:00"));
    assert.equal(termin - marken.vortag, 23 * STD, "die Wandzeit-Rechnung ergibt 23 Stunden");
    assert.notEqual(marken.vortag, termin - 24 * STD, "hier wurde in Millisekunden gerechnet");
  });

  test("Herbst: der Tag hat 25 Stunden — die Marke bleibt auf 10:00", () => {
    const termin = berlin("2026-10-25", "10:00"); // Umstellungssonntag, CET
    const marken = erinnerungsZeitpunkte(iso(termin));
    assert.ok(marken);
    assert.equal(marken.vortag, berlin("2026-10-24", "10:00"));
    assert.equal(termin - marken.vortag, 25 * STD, "die Wandzeit-Rechnung ergibt 25 Stunden");
    assert.notEqual(marken.vortag, termin - 24 * STD, "hier wurde in Millisekunden gerechnet");
  });

  test("Monatswechsel und Jahreswechsel rutschen sauber durch", () => {
    // Die Vortags-Rechnung läuft über `Date.UTC(…, tag - 1)` auf den ZIFFERN
    // des Berliner Tagesstrings — sie muss den 1. eines Monats und den 1.1.
    // richtig auf den Vortag abbilden, ohne die Zone anzufassen.
    const ersterMaerz = erinnerungsZeitpunkte(iso(berlin("2026-03-01", "09:00")));
    assert.equal(ersterMaerz?.vortag, berlin("2026-02-28", "09:00"));
    const neujahr = erinnerungsZeitpunkte(iso(berlin("2026-01-01", "09:00")));
    assert.equal(neujahr?.vortag, berlin("2025-12-31", "09:00"));
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Ein Stempel, zwei Erinnerungen
 * ------------------------------------------------------------------ */

describe("3 · Ein Stempel schließt genau die fällige Erinnerung", () => {
  test("der Klick am Vortag macht ruhig — und verliert die zweite nicht", () => {
    const klick = VORTAG_MS + 5 * MIN;
    const stempel = iso(klick);
    assert.equal(offen(klick, stempel), null, "direkt nach dem Klick ist Ruhe");
    assert.equal(offen(STUNDE_MS - MIN, stempel), null, "und sie hält bis zur zweiten Marke");
    assert.equal(offen(STUNDE_MS, stempel), "stunde", "die zweite Erinnerung geht von allein wieder auf");
  });

  test("DIE GEGENPROBE: der Kalendertag hätte die zweite Erinnerung geschluckt", () => {
    // Der Stempel wird gegen die MARKE geprüft, nicht gegen den Kalendertag.
    // Wäre es umgekehrt — und `istHeuteKontaktiert()` liegt als Funktion daneben
    // —, dann verlöre man die Stunden-Erinnerung dadurch, dass man die erste am
    // selben Tag erledigt hat. Genau dieser Fall: Termin heute 14:00, morgens um
    // 09:00 schon gestempelt.
    const heute = TERMIN_TAG;
    const morgens = iso(berlin(TERMIN_TAG, "09:00"));
    assert.equal(istHeuteKontaktiert(morgens, heute), true, "der Tagesvergleich sagt: erledigt");
    assert.equal(offen(STUNDE_MS + MIN, morgens), "stunde", "die Marken-Prüfung sagt: noch offen");
    // … und das Gold folgt der schärferen der beiden Regeln.
    assert.equal(istTerminDran("verlegt", morgens, heute, "stunde"), true);
  });

  test("ein Stempel VOR der ersten Marke hält keine Erinnerung auf", () => {
    // Wer den Lead zwei Tage vor dem Termin anruft, hat damit nicht die
    // Terminbestätigung erledigt.
    const frueh = iso(VORTAG_MS - 6 * STD);
    assert.equal(offen(VORTAG_MS, frueh), "vortag");
  });

  test("ein Klick im Stunden-Fenster beendet die Reihe", () => {
    const stempel = iso(STUNDE_MS + 2 * MIN);
    assert.equal(offen(STUNDE_MS + 3 * MIN, stempel), null);
    assert.equal(offen(TERMIN_MS - MIN, stempel), null);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Kurzfristig gebucht ist kein Versäumnis
 * ------------------------------------------------------------------ */

describe("4 · Kurzfristig gebucht heißt fällig, nicht versäumt", () => {
  // Wer um 14:00 einen Termin für heute 18:00 anlegt, hat die Vortags-Marke im
  // Moment des Buchens längst überschritten. Die Erinnerung ist dann fällig —
  // man schickt eine Bestätigung —, aber sie ist KEIN Versäumnis. Das alte
  // System wurde in dieser Lage sofort rot; daran ist es zurückgewiesen worden.

  const heute = "2026-09-17";
  const gebucht = berlin(heute, "14:00");
  const kurzfristig = iso(berlin(heute, "18:00"));

  test("die Erinnerung ist fällig, und das ist richtig", () => {
    assert.equal(offen(gebucht, null, { at: kurzfristig }), "vortag");
    assert.equal(istTerminDran(zustandVon({ at: kurzfristig }, heute), null, heute, "vortag"), true);
  });

  test("… aber nichts an der Zeile nennt sie überfällig", () => {
    // Die naive Lesart läge vor: Gegen `isOverdue(marke, "moment")` gehalten
    // wäre diese Marke in derselben Sekunde „überfällig", in der der Termin
    // entsteht. Deshalb wird sie NICHT so gelesen — und die Beschriftung spricht
    // vom Termin, nicht von einer verpassten Frist.
    const marke = erinnerungsZeitpunkte(kurzfristig);
    assert.ok(marke);
    assert.equal(
      isOverdue(iso(marke.vortag), "moment", dueRefAt(gebucht)),
      true,
      "die naive Lesart hielte die Marke für überfällig",
    );

    const text = erinnerungText("vortag", heute, heute);
    assert.equal(text, "Termin heute");
    for (const wort of [/überfällig/i, /versäumt/i, /verpasst/i, /seit /i]) {
      assert.doesNotMatch(text, wort, `die Beschriftung macht einen Vorwurf: ${text}`);
    }
    assert.doesNotMatch(erinnerungText("stunde", heute, heute), /überfällig|versäumt|seit /i);
  });

  test("… und die Farbe bleibt Gold, nie Rot", () => {
    // Gold heißt ausnahmslos „du bist dran" (src/lib/dranRegel.ts) — eine
    // Zuteilung, kein Vorwurf. Der Status-Pill derselben Zeile bleibt neutral;
    // `danger` gehört dem geplatzten und dem verlorenen Vorgang.
    assert.equal(zustandPill("verlegt").tone, "neutral");
    assert.doesNotMatch(code(TERMINE_LIST), /erinnerung[\s\S]{0,200}danger/i);
    assert.doesNotMatch(code(DRAN_REGEL), /danger/i);
    // Und es gibt gar keinen dritten Zustand, den man rot färben könnte: Die
    // Regel kennt „offen" und „nicht offen", kein „zu spät".
    assert.doesNotMatch(code(DRAN_REGEL), /ueberfaellig|überfällig|isOverdue/i);
  });
});

/* ------------------------------------------------------------------ *
 * 5 — Wer keine Erinnerung bekommt
 * ------------------------------------------------------------------ */

describe("5 · Abgesagt, abgeschlossen, vorbei — keine Erinnerung", () => {
  const heute = "2026-09-16";
  const jetzt = berlin(heute, "15:00"); // nach der Vortags-Marke (14:00)

  test("Gegenprobe zuerst: der unbehelligte Termin leuchtet", () => {
    assert.equal(offen(jetzt), "vortag");
  });

  test("abgesagt — mit Aussicht wie ohne", () => {
    const abgesagt = { cancelledAt: "2026-09-15T09:00:00.000Z" };
    assert.equal(zustandVon({ ...abgesagt, cancelOutlook: "neuer_termin" }, heute), "offen");
    assert.equal(offen(jetzt, null, { ...abgesagt, cancelOutlook: "neuer_termin" }), null);
    assert.equal(zustandVon({ ...abgesagt, cancelOutlook: "ohne_aussicht" }, heute), "tot");
    assert.equal(offen(jetzt, null, { ...abgesagt, cancelOutlook: "ohne_aussicht" }), null);
  });

  test("… aber `revived_at` holt den Termin und seine Erinnerungen zurück", () => {
    const patch = {
      cancelledAt: "2026-09-15T09:00:00.000Z",
      cancelOutlook: "neuer_termin",
      revivedAt: "2026-09-15T10:00:00.000Z",
    };
    assert.equal(zustandVon(patch, heute), "verlegt");
    assert.equal(offen(jetzt, null, patch), "vortag");
  });

  test("abgeschlossen — Ergebnis schlägt auch ein Datum in der Zukunft", () => {
    for (const patch of [
      { status: "dead" },
      { status: "unqualifiziert" },
      { status: "closing_gelegt" },
      { kind: "closing" as const, status: "gewonnen" },
      { kind: "closing" as const, status: "verloren" },
    ]) {
      assert.equal(offen(jetzt, null, patch), null, JSON.stringify(patch));
    }
  });

  test("No-Show ohne Antwort bekommt keine — der Vorgang ist aus dem Funnel", () => {
    const vorbei = iso(berlin("2026-09-10", "14:00"));
    const patch = { at: vorbei, showStatus: "no_show" as const, noShowResolution: "ohne_antwort" };
    assert.equal(zustandVon(patch, heute), "tot");
    assert.equal(offen(jetzt, null, patch), null);
  });

  test("… steht aber wieder ein Termin, gewinnt der — samt seiner Erinnerungen", () => {
    // Die Reihenfolge in `terminZustand()` ist hier die ganze Fachlichkeit: Der
    // No-Show-Ausgang wird NACH der Termin-Frage geprüft, damit ein inzwischen
    // angesetzter Ersatztermin gewinnt. Genau dann ist eine Ankündigung auch
    // richtig — es steht ja wieder etwas an.
    const patch = { showStatus: "no_show" as const, noShowResolution: "ohne_antwort" };
    assert.equal(zustandVon(patch, heute), "verlegt");
    assert.equal(offen(jetzt, null, patch), "vortag");
  });

  test("vorbei — ab dem Termin gibt es nichts mehr anzukündigen", () => {
    assert.equal(offen(TERMIN_MS - MIN), "stunde");
    assert.equal(offen(TERMIN_MS), null, "in der Minute des Termins");
    assert.equal(offen(TERMIN_MS + 3 * STD), null, "und danach erst recht");
    // Wichtig: Der ZUSTAND ist zu diesem Zeitpunkt noch „verlegt" — die Liste
    // rechnet auf Kalendertagen (docs §6). Die Erinnerung endet trotzdem, weil
    // sie die einzige Frage dieser Seite ist, die eine Uhrzeit braucht.
    assert.equal(zustandVon({}, TERMIN_TAG), "verlegt");
  });

  test("ohne Termin gar keine — da leuchtet die Zeile schon aus anderem Grund", () => {
    assert.equal(offeneErinnerung("offen", null, null, jetzt), null);
    assert.equal(istInArbeitsmenge("offen"), true);
  });

  test("und ohne Uhr behauptet keine Zeile eine Erinnerung", () => {
    // Vor dem ersten Effekt-Tick der Oberfläche ist `nowMs` null: lieber eine
    // Sekunde ohne Gold als eine falsche (Muster `RueckrufListe`).
    assert.equal(offeneErinnerung("verlegt", TERMIN, null, null), null);
  });
});

/* ------------------------------------------------------------------ *
 * 6 — Der Weg auf die Arbeitsliste
 * ------------------------------------------------------------------ */

describe("6 · Die Erinnerung holt den Termin auf die Arbeitsliste", () => {
  const NAMEN = new Map([["u1", "kevin"]]);
  const heute = "2026-09-16";
  const jetzt = berlin(heute, "15:00");

  function setting(patch: Partial<WithCancellation<SettingCall>> = {}): WithCancellation<SettingCall> {
    return {
      id: "s1",
      status: "offen",
      show_status: null,
      appointment_at: TERMIN,
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

  function closing(patch: Partial<WithCancellation<ClosingCall>> = {}): WithCancellation<ClosingCall> {
    return {
      id: "c1",
      status: "offen",
      show_status: null,
      call_at: TERMIN,
      lead_name: "Meier",
      company: "Meier GmbH",
      meet_link: null,
      deal_volume: null,
      assigned_user_id: "u1",
      created_by_user_id: "u1",
      ...patch,
    } as WithCancellation<ClosingCall>;
  }

  test("„egal ob Closing oder Setting“ — beide Tabellen, dieselben zwei Marken", () => {
    const s = buildEvents([setting()], [], NAMEN, heute, jetzt).events[0];
    const c = buildEvents([], [closing()], NAMEN, heute, jetzt).events[0];
    for (const e of [s, c]) {
      assert.equal(e.zustand, "verlegt", "der Zustand bleibt, was er ist");
      assert.equal(e.erinnerung, "vortag");
      assert.equal(e.dran, true);
      assert.equal(istZuTun(e.zustand, e.erinnerung), true);
    }
  });

  test("ohne fällige Erinnerung bleibt der versorgte Termin ruhig und draußen", () => {
    const frueh = berlin("2026-09-15", "09:00");
    const e = buildEvents([setting()], [], NAMEN, "2026-09-15", frueh).events[0];
    assert.equal(e.erinnerung, null);
    assert.equal(e.dran, false);
    assert.equal(istZuTun(e.zustand, e.erinnerung), false);
  });

  test("ohne Uhr ist alles wie vorher — die Zeile leuchtet nicht aus Versehen", () => {
    const e = buildEvents([setting()], [], NAMEN, heute, null).events[0];
    assert.equal(e.erinnerung, null);
    assert.equal(e.dran, false);
  });

  test("der Stempel wirkt durch bis ins Event", () => {
    const e = buildEvents(
      [setting({ follow_up_last_contacted_at: iso(VORTAG_MS + MIN) })],
      [],
      NAMEN,
      heute,
      jetzt,
    ).events[0];
    assert.equal(e.erinnerung, null);
    assert.equal(e.dran, false);
    assert.equal(e.zustand, "verlegt", "der Stempel darf den Zustand nicht verändern");
  });

  test("die Arbeitsmenge selbst bleibt unberührt — `verlegt` ist kein Mitglied", () => {
    // Die Erinnerung liegt QUER zum Zustand, sie erweitert ihn nicht. Wer das
    // verwechselt, holt beim nächsten Umbau alle Termine dauerhaft auf die Liste.
    assert.equal(istInArbeitsmenge("verlegt"), false);
    assert.equal(istZuTun("verlegt", null), false);
    assert.equal(istZuTun("verlegt", "stunde"), true);
    assert.equal(istZuTun("tot", "stunde"), true);
  });
});

/* ------------------------------------------------------------------ *
 * 7 — Die Zeile sagt, warum sie leuchtet
 * ------------------------------------------------------------------ */

describe("7 · Die Zeile sagt es, statt es nur zu färben", () => {
  test("die Beschriftung ist zum Zeitpunkt ihrer Anzeige wahr", () => {
    // Naheliegend wäre „1 Tag vorher" gewesen — bei einem kurzfristig gebuchten
    // Termin stünde das über einem Termin in vier Stunden. Beschriftet wird
    // deshalb die Lage.
    assert.equal(erinnerungText("vortag", "2026-09-18", "2026-09-17"), "Termin morgen");
    assert.equal(erinnerungText("vortag", "2026-09-17", "2026-09-17"), "Termin heute");
    assert.equal(erinnerungText("stunde", "2026-09-17", "2026-09-17"), "Termin in weniger als einer Stunde");
  });

  test("die Liste schreibt sie in die Unterzeile, nicht nur ins Gold", () => {
    assert.match(TERMINE_LIST, /erinnerungText\(event\.erinnerung, event\.dayISO, today\)/);
    assert.match(TERMINE_LIST, /\{anlass \? `\$\{anlass\} · ` : ""\}/);
    // Sie steht in derselben Zeile wie „zuletzt kontaktiert" — der Anlass zuerst,
    // weil er der Grund ist.
    assert.match(TERMINE_LIST, /\{anlass[\s\S]{0,80}lastContactLabel\(genervtVor\)/);
  });

  test("… und die Zeile bekommt ihre drei Knöpfe, allen voran „Genervt“", () => {
    // Ohne sie wäre die goldene Zeile eine Mahnung ohne Handgriff: „Genervt" IST
    // der Klick, der die Erinnerung schließt.
    assert.match(TERMINE_LIST, /const imFluss = istZuTun\(event\.zustand, event\.erinnerung\)/);
    const aktionen = read("src/components/termine/TerminAktionen.tsx");
    assert.match(aktionen, /event\.erinnerung === "stunde"/);
    assert.match(aktionen, /Eine Stunde vor dem Termin meldet sie sich noch einmal/);
  });
});

/* ------------------------------------------------------------------ *
 * 8 — „Verlegt“ heißt jetzt „Termin steht“
 * ------------------------------------------------------------------ */

describe("8 · Der Ausschnitt heißt „Termin steht“ und trägt seine Zahl", () => {
  test("das Wort ist weg, der Schlüssel bleibt", () => {
    // Der Auftraggeber suchte dort seine Termine der nächsten Woche und fand sie
    // nicht: „Verlegt" liest sich als „wurde verschoben", der Ausschnitt enthält
    // aber JEDEN Termin mit einem Datum in der Zukunft. Der URL-Wert bleibt
    // `verlegt` — er beschreibt die Datenlage korrekt und steckt in geteilten
    // Links; ein Schlüssel, den niemand sieht, gewinnt nichts durch ein
    // schöneres Wort.
    assert.equal(TERMIN_ZUSTAND_LABEL.verlegt, "Termin steht");
    assert.match(FILTER_BAR, /\{ value: "verlegt", label: "Termin steht" \}/);
    assert.doesNotMatch(code(FILTER_BAR), /label: "Verlegt"/);
  });

  test("Pill und Ausschnitt sagen dasselbe Wort", () => {
    // Zwei Wörter für dieselbe Aussage in derselben Zeile wären genau die
    // Verwechslung, die den Auftraggeber hat suchen lassen.
    assert.equal(zustandPill("verlegt").label, "Termin steht");
  });

  test("die Zahl kommt aus derselben Menge, die die Liste zeigt", () => {
    assert.match(BOARD, /const zeitCounts = useMemo\(/);
    assert.match(BOARD, /const pool = \[\.\.\.filtered, \.\.\.ohneTermin\]/);
    assert.match(BOARD, /zu_tun: pool\.filter\(\(e\) => istZuTun\(e\.zustand, e\.erinnerung\)\)\.length/);
    assert.match(BOARD, /verlegt: pool\.filter\(\(e\) => e\.zustand === "verlegt"\)\.length/);
    assert.match(BOARD, /alle: pool\.length/);
    // Die Liste darunter schneidet wortgleich.
    assert.match(TERMINE_LIST, /istZuTun\(e\.zustand, e\.erinnerung\)/);
    // Und die Zahl steht IM Label, nicht als zweite Pille daneben (Badge-Budget).
    assert.match(FILTER_BAR, /label: `\$\{o\.label\} · \$\{zeitCounts\[o\.value\]\}`/);
  });

  test("die Uhr tickt in der Oberfläche, nicht im Render-Körper", () => {
    // `Date.now()` im Render wäre unrein (react-hooks/purity) und auf dem Server
    // eine andere Zahl als im Browser — ein Hydrations-Unterschied an genau der
    // Stelle, die eine Zeile golden färbt. Muster `RueckrufListe`.
    assert.match(BOARD, /const \[nowMs, setNowMs\] = useState<number \| null>\(null\)/);
    assert.match(BOARD, /setInterval\(tick, 30_000\)/);
    assert.match(BOARD, /buildEvents\(settings, closings, usernameById, today, nowMs\)/);
  });
});
