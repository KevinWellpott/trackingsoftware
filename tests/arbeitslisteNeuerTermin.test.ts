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
//      Einwilligungs-Zeitstempel. Inzwischen sind die Spalten selbst gefallen.
//
// Geprüft wird am QUELLTEXT: Was eine Server Action entscheidet, bräuchte für
// eine echte Probe eine Datenbank, eine Attrappe bewiese nur, dass die
// Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

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
const DOSSIER_ACTION = read("src/app/actions/leadDossier.ts");

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
    // Seit dem Live-Test (P1-3) steht sie EINMAL für alle: in terminMeta.ts.
    assert.match(SETTING_CALLS, /import \{[^}]*absageWirktNoch[^}]*\} from "@\/lib\/terminMeta"/);
    assert.match(CLOSING_CALLS, /import \{[^}]*absageWirktNoch[^}]*\} from "@\/lib\/terminMeta"/);
    assert.doesNotMatch(SETTING_CALLS, /function absageWirktNoch\(/);
    assert.doesNotMatch(CLOSING_CALLS, /function absageWirktNoch\(/);
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

  test("kein Code liest die Spalten, und ein direkter POST kann sie nicht schreiben", () => {
    // Die Spalten fallen erst mit 0050, eine Woche nach dem Livegang. Bis dahin
    // streift `ohneWhatsApp` die drei Felder aus jedem Patch von
    // `updateSettingCall` (Code-Review 27.11.) — sonst schriebe ein direkter
    // POST eine Einwilligung, die niemand mehr löschen kann. Außerhalb des
    // Riegels steht kein Name, der eine der Spalten anfragt.
    const src = code(SETTING_CALLS);
    assert.match(src, /withNoShowResolutionCleared\(ohneWhatsApp\(patch\)\)/);
    const ohneRiegel = src.replace(/function ohneWhatsApp[\s\S]*?\n\}\n/, "");
    assert.doesNotMatch(ohneRiegel, /wa_phone|wa_consent_at|wa_refused_at/);
    assert.doesNotMatch(code(DOSSIER), /wa_phone|wa_consent_at|wa_refused_at/);
    assert.doesNotMatch(code(DOSSIER_ACTION), /wa_phone|wa_consent_at|wa_refused_at/);
  });

  test("das Dossier bietet keine WhatsApp-Nummer als Kontaktweg an", () => {
    assert.doesNotMatch(code(DOSSIER), /kind: "whatsapp"/);
  });
});
