// Der Knopf „Termin" in der Arbeitsliste — und die drei Befunde, die an ihm
// hingen.
//
// Alle drei haben dieselbe Bauart: Sie waren STILL. Kein Fehler wurde geworfen,
// keine Zahl wurde rot, und in zwei von drei Fällen sah der Nutzer sogar eine
// Erfolgsmeldung. Genau dafür gibt es diese Datei — sie hält fest, dass die
// Prüfungen nicht wieder verschwinden.
//
//   1. BLOCKER · Ein fehlgeschlagener Klick stempelte `revived_at` und ließ es
//      stehen. Die Zeile fiel danach lautlos aus Arbeitsliste UND Recycling.
//   2. ERNST · Derselbe Knopf löschte auf einer ERSCHIENENEN Zeile den
//      `show_status` — eine erfasste Tatsache, die in keiner zweiten Spalte
//      steht.
//   3. ERNST · Der WhatsApp-Schreibpfad hatte keine Oberfläche mehr, war per
//      direktem POST aber erreichbar und erzeugte dabei einen
//      Einwilligungs-Zeitstempel.
//
// Zwei Bauarten wie in terminRiegel.test.ts: Was eine reine Funktion
// entscheidet, wird als VERHALTEN geprüft (`buildDossier` kennt keine
// Datenbank). Was eine Server Action entscheidet, wird am QUELLTEXT geprüft —
// eine echte Probe bräuchte eine Datenbank, eine Attrappe bewiese nur, dass die
// Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { buildDossier, type DossierInput, type DossierSetting } from "@/lib/leadDossier";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Die Datei OHNE Kommentare — für jede „das steht hier nicht mehr"-Prüfung.
 * Muster `code()` aus rueckbauArbeitsflaeche.test.ts: Die Dateien erklären
 * ausführlich, WARUM der WhatsApp-Pfad gefallen ist, und nennen dabei
 * zwangsläufig `wa_phone`. Ein Abwesenheits-Test gegen den Rohtext verböte
 * ausgerechnet die Begründung.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Der Rumpf einer Funktion — von ihrer Signatur bis zum nächsten Anker. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const STEMPEL = read("src/app/actions/followUpStamp.ts");
const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const CLOSING_CALLS = read("src/app/actions/closingCalls.ts");
const DOSSIER = read("src/lib/leadDossier.ts");

const NEUER_TERMIN = slice(STEMPEL, "export async function setNeuerTermin(", "\n/**");

/* ------------------------------------------------------------------ *
 * 1 — BLOCKER: der Stempel darf nie ohne Nachfolger stehen bleiben
 * ------------------------------------------------------------------ */

describe("1 · „Neuer Termin\" hinterlässt keinen halben Zustand", () => {
  test("was ohne Schreiben zu klären ist, wird VOR dem Stempel geklärt", () => {
    // Die billigste Hälfte der Lösung: Ein unbrauchbares Datum darf gar nicht
    // erst bis zum Stempel kommen. Vorher lag die Umrechnung im Closing-Zweig
    // — also HINTER dem Stempel — und ein leeres Feld kostete eine Zeile.
    const stempelPos = NEUER_TERMIN.indexOf("revived_at: new Date().toISOString()");
    const datumPos = NEUER_TERMIN.indexOf("berlinInputToIso(berlinInput)");
    assert.notEqual(datumPos, -1, "die Umrechnung steht nicht mehr in setNeuerTermin");
    assert.notEqual(stempelPos, -1, "der Stempel ist verschwunden");
    assert.ok(datumPos < stempelPos, "das Datum wird erst nach dem Stempel geprüft");
  });

  test("der Stempel ist ein CLAIM — zwei gleichzeitige Klicks holen nur einmal zurück", () => {
    // Muster `reviveDropout` (actions/revive.ts): `.is('revived_at', null)`
    // macht aus dem UPDATE ein Claim, das ein zweiter Klick nicht mehr gewinnt.
    // Ohne das stempelten beide, und „nur beim ERSTEN Mal" wäre eine Absicht
    // ohne Wirkung.
    assert.match(NEUER_TERMIN, /\.is\("revived_at", null\)/);
    assert.match(NEUER_TERMIN, /\.select\("id"\)/);
  });

  test("scheitert der Schreibpfad, wird der Claim zurückgenommen", () => {
    // DER BLOCKER. Ohne diese Rücknahme passierte die Zeile ab dem
    // fehlgeschlagenen Klick den Absage-Riegel, galt über das alte Datum als
    // „Verlegt" und fiel aus Arbeitsliste UND `recycle_tasks` — Letzteres
    // verlangt `revived_at is null`. Der Nutzer sah eine Fehlermeldung und
    // glaubte, es sei nichts passiert.
    assert.match(NEUER_TERMIN, /revived_at: null/);
    // Zurückgenommen wird NUR der selbst gesetzte Stempel: Wer den Claim
    // verloren hat, darf den fremden nicht abräumen.
    assert.match(NEUER_TERMIN, /res\.error && geclaimt/);
  });

  test("der Absage-Riegel liest das PAAR, nicht nur die Absage", () => {
    // Der Riegel nennt „Neuen Termin ansetzen" selbst als den Weg zurück —
    // konnte ihn aber nicht von einem Kalender-Zug unterscheiden, weil er nur
    // `cancelled_at` las. Für ein abgesagtes CLOSING war der Knopf damit ein
    // Knopf, der ausnahmslos scheitert.
    for (const [name, quelle] of [
      ["moveSettingAppointment", slice(SETTING_CALLS, "export async function moveSettingAppointment(", "\n/**")],
      ["postponeAppointment", slice(SETTING_CALLS, "export async function postponeAppointment(", "\n/**")],
      ["updateClosingCall", slice(CLOSING_CALLS, "export async function updateClosingCall(", "\n/**")],
    ] as const) {
      assert.match(quelle, /revived_at/, `${name} liest die Rückholung nicht`);
      assert.match(quelle, /absageWirktNoch|revived_at/, name);
    }
    // Und die Frage steht je Datei an EINER Stelle, statt dreimal formuliert
    // zu werden.
    assert.match(SETTING_CALLS, /function absageWirktNoch\(/);
    assert.match(CLOSING_CALLS, /function absageWirktNoch\(/);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — ERNST: eine erfasste Show überlebt den neuen Termin
 * ------------------------------------------------------------------ */

describe("2 · Ein Terminwechsel löscht keine erfasste Tatsache", () => {
  test("eine ERSCHIENENE Zeile bekommt nur ein neues Datum", () => {
    // `rescheduleSetting` ist der Ersatztermin-Weg nach einem No-Show: Es setzt
    // Status und Show-Status zurück, weil der No-Show in `no_show_count`
    // erhalten bleibt. Für ein `show` gibt es keinen zweiten Ort — dort wäre
    // der Reset eine Löschung, und die Show-Quote eines abgeschlossenen
    // Zeitraums verlöre ihren Zähler.
    assert.match(NEUER_TERMIN, /show_status === "show"/);
    assert.match(NEUER_TERMIN, /moveSettingAppointment\(/);
    // Der Ersatztermin-Weg bleibt für alles andere — er ist nicht gefallen,
    // nur nicht mehr der einzige.
    assert.match(NEUER_TERMIN, /rescheduleSetting\(id, berlinInput\)/);
  });

  test("Setting und Closing tun bei „erschienen\" dasselbe", () => {
    // Vorher trugen zwei Knöpfe mit demselben Label zwei Bedeutungen: Das
    // Closing verschob nur den Zeitpunkt, das Erstgespräch räumte nebenbei das
    // Ergebnis ab.
    assert.match(NEUER_TERMIN, /updateClosingCall\(id, \{ call_at: iso \}\)/);
    const closingZweig = NEUER_TERMIN.slice(NEUER_TERMIN.indexOf("updateClosingCall("));
    assert.doesNotMatch(closingZweig, /show_status: null/, "der Closing-Zweig räumt jetzt auch ab");
  });

  test("Gegenprobe: `rescheduleSetting` bleibt der frische Anlauf", () => {
    // Die Zusicherung aus vorTerminKaskade.test.ts gilt unverändert — geändert
    // hat sich nur, WER sie aufruft. Verschwände einer der Resets, trüge eine
    // Zeile nach einem No-Show ein neues Datum und weiter ihr altes Ergebnis.
    const reschedule = slice(SETTING_CALLS, "export async function rescheduleSetting(", "\n/**");
    assert.match(reschedule, /status: "offen",/);
    assert.match(reschedule, /show_status: null,/);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — ERNST: WhatsApp ohne Oberfläche, aber mit Schreibpfad
 * ------------------------------------------------------------------ */

describe("3 · Kein Schreibpfad und keine Anzeige ohne Erfassung", () => {
  test("`SettingCallPatch` kennt die drei Felder nicht mehr", () => {
    // Der Editor hat sie mit Welle 3 verloren; geblieben war eine Server
    // Action, die per direktem POST eine persönliche Mobilnummer samt
    // UWG-Einwilligungszeitstempel schreiben konnte — und `withWaConsentDerived`
    // ERZEUGTE den Zeitstempel sogar, wenn keiner mitkam.
    const patch = slice(SETTING_CALLS, "export type SettingCallPatch = {", "};");
    assert.doesNotMatch(patch, /wa_phone|wa_consent_at|wa_refused_at/);
    assert.doesNotMatch(code(SETTING_CALLS), /withWaConsentDerived/);
  });

  test("der Typ ist kein Riegel — die Felder werden zur Laufzeit abgestreift", () => {
    // Die wichtigste Prüfung der drei: `updateSettingCall` reicht den Patch
    // unverändert an `.update()` weiter. Ein Feld aus dem TypeScript-Typ zu
    // nehmen schließt deshalb gar nichts — ein POST mit `wa_phone` käme
    // weiterhin durch.
    const update = slice(SETTING_CALLS, "export async function updateSettingCall(", "\n/**");
    assert.match(update, /ohneWhatsApp/);
    assert.match(SETTING_CALLS, /function ohneWhatsApp</);
    // Und zwar wirklich abstreifen, nicht bloß normalisieren: Die drei Namen
    // stehen im Rest-Operator, sie tauchen im UPDATE nicht wieder auf.
    const strip = slice(SETTING_CALLS, "function ohneWhatsApp<", "\n/**");
    assert.match(strip, /"wa_phone", "wa_consent_at", "wa_refused_at"/);
    assert.match(strip, /delete rest\[/);
  });

  test("das Dossier bietet die Nummer nicht mehr als Kontaktweg an", () => {
    // VERHALTENSPROBE. Ohne Schreibpfad lässt sich eine Einwilligung weder
    // dokumentieren noch widerrufen; eine angebotene Nummer wäre eine
    // Einladung, die niemand zurücknehmen kann.
    const dossier = buildDossier(
      eingabe({
        settings: [
          setting({
            id: "s1",
            wa_phone: "+49 170 1234567",
            wa_consent_at: "2026-08-11T09:00:00.000Z",
          }),
        ],
      }),
    );
    assert.equal(
      dossier.channels.some((c) => c.value.includes("170 1234567")),
      false,
      "die WhatsApp-Nummer steht weiter in den Kontaktwegen",
    );
    assert.doesNotMatch(code(DOSSIER), /kind: "whatsapp"/);
  });

  test("… die dokumentierte VERWEIGERUNG bleibt dagegen stehen", () => {
    // Ein Kontaktverbot ist der eine Datensatz, dessen Verlust schadet statt
    // schützt — dieselbe Begründung wie bei der Sperrliste (docs §1). Es lädt
    // niemanden ein, es hält jemanden ab.
    const dossier = buildDossier(
      eingabe({ settings: [setting({ id: "s1", wa_refused_at: "2026-08-11T09:00:00.000Z" })] }),
    );
    assert.ok(
      dossier.warnings.some((w) => /keine persönliche Nummer/.test(w)),
      "die Verweigerung ist mit der Nummer verschwunden",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Zeilen-Fabriken — nur die Felder, die die Tests oben setzen
 * ------------------------------------------------------------------ */

const RECYCLE = {
  next_recycle_at: null,
  recycle_attempt_count: 0,
  recycle_excluded_at: null,
  recycle_last_contacted_at: null,
  recycle_responded_at: null,
  recycle_reason_code: null,
};

function setting(partial: Partial<DossierSetting> & { id: string }): DossierSetting {
  return {
    lead_name: "Anna Meier",
    company: "Meier GmbH",
    phone: null,
    wa_phone: null,
    wa_consent_at: null,
    wa_refused_at: null,
    source_type: "linkedin",
    source_detail: null,
    source_contact_id: null,
    source_phone_lead_id: null,
    appointment_at: null,
    call_at: null,
    meeting_kind: null,
    meet_link: null,
    status: "offen",
    show_status: null,
    branche: null,
    has_budget_8k: null,
    sole_decider: null,
    can_decide_now: null,
    clear_need: null,
    ist_pain: null,
    warmth: null,
    soll_ziel: null,
    script_answers: null,
    notes: null,
    objections_handled: null,
    objections_open: null,
    follow_up_due: null,
    follow_up_last_contacted_at: null,
    follow_up_last_contacted_by_user_id: null,
    follow_up_last_contacted_username: null,
    no_show_count: 0,
    no_show_resolution: null,
    cancelled_at: null,
    cancel_reason_code: null,
    cancel_reason: null,
    cancel_outlook: null,
    reschedule_count: 0,
    last_reschedule_at: null,
    revived_at: null,
    disqualify_reason_code: null,
    disqualify_reason: null,
    assigned_user_id: null,
    created_by_user_id: null,
    assigned_username: null,
    created_at: "2026-08-10T08:00:00.000Z",
    updated_at: "2026-08-10T08:00:00.000Z",
    ...RECYCLE,
    ...partial,
  };
}

function eingabe(partial: Partial<DossierInput>): DossierInput {
  return {
    anchor: { kind: "setting", id: "s1" },
    contacts: [],
    phoneLeads: [],
    settings: [],
    closings: [],
    attempts: [],
    now: "2026-09-09T10:00:00.000Z",
    ...partial,
  };
}
