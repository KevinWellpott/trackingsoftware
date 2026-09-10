// Korrekturen am Termin-Lebenszyklus — der Fall, dass ein Ergebnis NICHT das
// letzte Wort war.
//
// Alle sieben Regeln hier haben dieselbe Bauart: Ein Ereignis legt eine Kette,
// eine Kaskade oder eine Wiedervorlage an, und der Weg ZURÜCK (oder daneben)
// nimmt sie nicht mit. Das ist teuer, weil nichts kaputtgeht, das jemand sieht:
// Der Datensatz stimmt, nur bekommt der Lead am nächsten Tag einen Satz zu
// lesen, der zu seinem Stand nicht mehr passt — und die Karte in /erinnerungen
// ist eine Kopier-Werkbank, der Satz ginge real raus.
//
// Geprüft wird am QUELLTEXT statt am Verhalten — dieselbe Bauart wie
// lifecycleWiring.test.ts. Eine echte Probe bräuchte eine Datenbank; eine
// Attrappe bewiese nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Der Rumpf einer Funktion — von ihrer Signatur bis zur nächsten. */
function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `Anker nicht gefunden: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `Endanker nicht gefunden: ${to}`);
  return source.slice(start, end);
}

const SETTING_CALLS = read("src/app/actions/settingCalls.ts");
const CLOSING_CALLS = read("src/app/actions/closingCalls.ts");
const SETTING_EDITOR = read("src/components/scripts/SettingCallEditor.tsx");

const CLOSING_OUTCOME = slice(CLOSING_CALLS, "export async function setClosingOutcome(", "\n/**");
const SETTING_OUTCOME = slice(SETTING_CALLS, "export async function setSettingOutcome(", "\n/**");
const CREATE_CLOSING = slice(SETTING_CALLS, "export async function createClosingFromSetting(", "\n/**");
const UPDATE_SETTING = slice(SETTING_CALLS, "export async function updateSettingCall(", "\n/**");

describe("Ein neues Ergebnis kann keine Kette des alten mehr erben", () => {
  // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ──────────────────
  // HIER STANDEN drei Tests, die je einen `supersedeTouches`-Aufruf festhielten:
  // ein Ergebnis am Closing entwertet ALLE seine Kaskaden (E1), das angelegte
  // Closing nimmt die No-Show-Kette des Erstgesprächs mit (E2), ein beendeter
  // Vorgang nimmt alles am Erstgespräch mit (E2).
  //
  // Die Befunde dahinter waren echt: Ein verlorener Deal, bei dem der Lead zwei
  // Tage später doch unterschreibt, behielt Ketten, deren Sätze real rausgingen
  // — „ich habe es gestern und heute nicht erreicht" an einen Kunden, der
  // gerade unterschrieben hat. Und die frühere Kaskadenliste nannte von fünf
  // Kaskaden am entity_type 'closing' genau zwei; das Vergessen fiel niemandem
  // auf, weil nichts kaputtging, das jemand sieht.
  //
  // Der Rückbau hat den Gegenstand entfernt, nicht die Sorgfalt: Ohne Kaskaden
  // gibt es keine Kette, die ein Ergebnis erben könnte. Geprüft wird deshalb
  // die Abwesenheit — sie ist die stärkere Zusicherung, weil keine Liste mehr
  // nachgezogen werden muss.
  const TOUCH_AUFRUFE =
    /supersedeTouches|deleteTouchesForEntity|createNoShowTouch|generateSettingCascade|generateClosingCascade|generateFollowUpCascade|generateClosingKickoff|generateKeinCloseChain/;

  test("E1 · das Closing-Ergebnis rührt keine Erinnerung mehr an", () => {
    assert.doesNotMatch(CLOSING_OUTCOME, TOUCH_AUFRUFE);
    // Was am Ergebnis hängen bleibt, ist die Sache des LEADS: der abgeleitete
    // Show-Status und die Wiedervorlage.
    assert.match(CLOSING_OUTCOME, /patch\.show_status = "show";/);
    assert.match(CLOSING_OUTCOME, /scheduleRecycle\("closing", input\.closingId\)/);
  });

  test("E2 · beide Zweige des angelegten Closings nehmen den No-Show zurück", () => {
    // Von der alten Zusicherung bleibt der fachliche Kern: `show_status:'show'`
    // gilt in BEIDEN Zweigen — dem neu angelegten und dem wiederverwendeten
    // Closing. Der Lead war da, und genau das musste die Kette damals erfahren.
    // Heute liest es die Arbeitsliste aus derselben Zeile.
    assert.equal(CREATE_CLOSING.split('show_status: "show"').length - 1, 1, "der Patch steht nicht mehr genau einmal");
    assert.equal(CREATE_CLOSING.split("qualifiedPatch").length - 1, 4, "nicht mehr beide Zweige schreiben denselben Patch");
    assert.doesNotMatch(CREATE_CLOSING, TOUCH_AUFRUFE);
  });

  test("E2 · ein beendeter Vorgang hinterlässt am Erstgespräch nichts Offenes", () => {
    // Das Kriterium war hier nie „show_status wird zu 'show'" — 'dead' rührt den
    // Show-Status gar nicht an, und trotzdem braucht ein als tot markierter Lead
    // keine Terminfindung mehr. Maßgeblich ist, dass der Vorgang beendet ist:
    // Das steht jetzt in der Zeile selbst, statt in einer Liste von Kaskaden,
    // die jemand hätte nachziehen müssen.
    assert.doesNotMatch(SETTING_OUTCOME, TOUCH_AUFRUFE);
    // Beide toten Enden bekommen weiterhin ihre Wiedervorlage — sonst wäre der
    // Lead nicht beendet, sondern verschwunden.
    assert.match(SETTING_OUTCOME, /input\.outcome === "dead" \|\| input\.outcome === "unqualifiziert"/);
    assert.match(SETTING_OUTCOME, /scheduleRecycle\("setting", input\.settingId\)/);
  });
});

describe("Eine Korrektur ist kein neues Ereignis", () => {
  test("M3 · der Stand VOR dem Schreiben entscheidet, ob es ein neuer Verlust ist", () => {
    // Muster `cancelAppointment`: vorher lesen, dann am ÜBERGANG handeln.
    const readAt = CLOSING_OUTCOME.indexOf('.select("show_status, status, next_recycle_at")');
    const writeAt = CLOSING_OUTCOME.indexOf(".update(");
    assert.notEqual(readAt, -1, "der vorherige Status wird gar nicht gelesen");
    assert.notEqual(writeAt, -1);
    assert.ok(readAt < writeAt, "gelesen wird erst NACH dem Schreiben — dann steht dort der neue Stand");
    assert.match(CLOSING_OUTCOME, /const correctingLoss =[\s\S]*?before\?\.status === "verloren"/);
  });

  test("M3 · die Unterscheidung überlebt den Rückbau — nur ihr Verbraucher ist ein anderer", () => {
    // HIER STAND: „ein reiner Grund-Wechsel baut die Kette nicht neu auf" —
    // sonst stünden die bereits erledigten Stufen drei Wochen später wieder
    // offen da. Die Kette ist mit dem Rückbau gefallen, `correctingLoss` nicht:
    // An ihm hängt weiterhin die WIEDERVORLAGE, und die ist der teurere der
    // beiden Fälle (nächster Test). Die Gegenprobe hält fest, dass die
    // Unterscheidung nicht als vermeintlich toter Zwischenwert mitgefallen ist.
    assert.doesNotMatch(CLOSING_OUTCOME, /generateKeinCloseChain/);
    assert.match(CLOSING_OUTCOME, /correctingLoss/);
  });

  test("M3 · und schiebt die Wiedervorlage nicht um Wochen nach hinten", () => {
    // `schedule_recycle()` rechnet `heute + Wartezeit`. Wer drei Wochen nach
    // dem Verlust nur den Grund korrigiert, verschöbe den Lead damit
    // stillschweigend um genau diese drei Wochen.
    assert.match(CLOSING_OUTCOME, /const needsRecycleDate = !correctingLoss/);
    // Das Nullen des Datums bleibt für den Fall, den der CHECK aus 0033
    // verlangt: 'falsche_zielgruppe'/'kein_fit' dürfen keines tragen.
    assert.match(CLOSING_OUTCOME, /if \(neverRecycled \|\| !correctingLoss\) patch\.next_recycle_at = null;/);
    assert.match(CLOSING_OUTCOME, /const neverRecycled =[\s\S]*?"kein_fit"/);
  });
});

describe("Die Vor-Termin-Kaskade ist gefallen — mitsamt ihrem Regenerator", () => {
  test("M2 + Befund 2 · kein Regenerator mehr, und auch kein halber", () => {
    // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ────────────────
    // HIER STANDEN zwei Tests: „ein Regenerator, zwei Anlässe" (geänderter
    // Termin ODER zurückgenommenes Ergebnis bauen die Bestätigungs-Kaskade neu
    // auf) und „aber nur für einen Termin, der noch bevorsteht" (sonst entstünde
    // EIN sofort fälliger Touch — eine Terminbestätigung für ein Gespräch, das
    // längst gelaufen ist).
    //
    // Beide Regeln beschrieben die Vor-Termin-Kaskade, und die gibt es nicht
    // mehr: keine Stufen, keine Vorlagen, kein Touch. Damit fällt auch der
    // Helfer `settingAppointmentAhead`, der einzig ihre Fälligkeit prüfte —
    // eine zusätzliche Abfrage nach jedem Speichern, die nichts mehr entscheidet.
    // Übrig bleibt die Zusicherung, die den Rückbau überdauert: Speichern
    // schreibt, mehr nicht.
    assert.doesNotMatch(UPDATE_SETTING, /generateSettingCascade/);
    assert.doesNotMatch(SETTING_CALLS, /settingAppointmentAhead/);
    // Der Weg zurück auf „Offen" bleibt trotzdem ein normales UPDATE — der
    // Editor schickt `status: "offen"`, und nichts darf ihn abweisen.
    assert.match(UPDATE_SETTING, /update\(normalized\)/);
  });
});

describe("Ein Pflichtfeld prüft, was die Folge-Logik wirklich braucht", () => {
  test("M1 · die Pflicht ist mit ihrem Grund gefallen, der Server-Riegel nicht", () => {
    // ── GEÄNDERTE ERWARTUNG, und zwar aus dem Rückbau heraus ────────────────
    // HIER STAND: Das Gate vor „Closing anlegen" rechnet mit derselben
    // Bedingung wie der Kanal-Auflöser — Nummer ODER dokumentierte
    // Verweigerung, weil `resolveFollowUpChannel` sonst auf den Akquise-Kanal
    // zurückfiele und es den bei Ads/Social/Sonstige gar nicht gibt.
    //
    // Der Auflöser ist gefallen: Ein Kanal wurde nur gebraucht, um zu
    // entscheiden, WORÜBER eine Erinnerung rausgeht. Damit hat die Pflicht
    // ihren einzigen Grund verloren — ein Gate ohne Gegenstand ist eine Sperre,
    // kein Schutz —, und die WhatsApp-Karte ist mit ihr gegangen.
    //
    // Was NICHT fällt, ist der Server-Riegel: `withWaConsentDerived` hält die
    // beiden CHECKs aus 0032 strukturell erfüllt (`wa_consent_at` nur MIT
    // Nummer). Solange die Spalten stehen, kann ein direkter POST sie treffen,
    // und dann muss die Ableitung greifen — die Prüfung sitzt bewusst in der
    // Server Action und nicht im Client, der jetzt gar nichts mehr schickt.
    assert.match(SETTING_CALLS, /function withWaConsentDerived/);
    assert.match(SETTING_CALLS, /withWaConsentDerived\(withNoShowResolutionCleared\(patch\)\)/);
    // Und der Editor schickt wirklich nichts mehr: sonst stünde die Pflicht
    // halb entfernt da — kein Feld, aber weiterhin ein Schreibpfad.
    assert.doesNotMatch(SETTING_EDITOR, /wa_phone|wa_consent_at|wa_refused_at/);
  });
});

describe("Ein Status, den keine Liste zeigt, ist kein Status", () => {
  test("Befund 11 · „Nachfassen\" verlangt den Zeitpunkt, den es auch speichert", () => {
    // `withFollowUpDateSynced` leitet `follow_up_due` aus `follow_up_due_at`
    // ab — kommt nur das reine Datum an, überschreibt die Synchronisierung es
    // unmittelbar mit NULL. Das Closing stünde auf „Nachfassen" ganz ohne
    // Fälligkeit und damit unsichtbar in /nachfassen.
    assert.match(CLOSING_OUTCOME, /if \(input\.outcome === "nachfassen" && !input\.followUpDueAt\)/);
    assert.doesNotMatch(
      CLOSING_OUTCOME,
      /!input\.followUpDue &&/,
      "das reine Datum genügt dem Guard weiterhin",
    );
  });
});
