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

describe("Ein neues Ergebnis nimmt die Kette des alten zurück", () => {
  test("E1 · ein Ergebnis nimmt ALLE Kaskaden des Closings mit", () => {
    // Verloren → zwei Tage später meldet sich der Lead doch → „Gewonnen".
    // Ohne dieses Entwerten steht am nächsten Tag „sollen wir es für den Moment
    // ruhen lassen?" für einen unterschriebenen Deal; bei „Nachfassen" liefen
    // Kein-Close-Kette und Nachfass-Kaskade gleichzeitig.
    //
    // Bis hierher stand hier eine Kaskadenliste — und genau daran ist die Regel
    // gescheitert: Von den fünf Kaskaden am entity_type 'closing' nannte sie
    // zwei. 'no_show_closing' blieb stehen (der Lead, der nach einem geplatzten
    // Closing doch unterschreibt, las am nächsten Tag „ich habe es gestern und
    // heute nicht erreicht"), und 'closing_kickoff' wurde im ganzen Code nie
    // entwertet. Jetzt gilt hier dieselbe Regel wie in `setSettingOutcome` und
    // `cancelAppointment`: ohne Liste. Die Details stehen in terminRiegel.test.ts.
    assert.match(CLOSING_OUTCOME, /await supersedeTouches\("closing", input\.closingId\);/);
    assert.doesNotMatch(CLOSING_OUTCOME, /supersedeTouches\("closing", input\.closingId, \[/);
    // Ausgenommen ist nicht ein Ergebnis, sondern die reine Grund-Korrektur an
    // einer bereits verlorenen Zeile: Sie ist kein neues Ereignis und darf die
    // laufende „kein Abschluss"-Kette nicht abräumen, ohne sie neu aufzubauen.
    assert.match(CLOSING_OUTCOME, /if \(!correctingLoss\) \{\s*await supersedeTouches\("closing", input\.closingId\);/);
    assert.doesNotMatch(CLOSING_OUTCOME, /input\.outcome !== "verloren"/);
  });

  test("E2 · das angelegte Closing entwertet die No-Show-Kette des Erstgesprächs", () => {
    // `createClosingFromSetting` schreibt show_status:'show' — der No-Show ist
    // damit zurückgenommen. Blieb die Kette stehen, ginge „Passt ein neuer
    // Termin bei dir?" an einen Lead, mit dem ein Closing terminiert ist.
    // Beide Zweige: das neu angelegte UND das wiederverwendete Closing.
    assert.equal(
      CREATE_CLOSING.split('supersedeTouches("setting", settingId, ["setting_msg", "no_show_setting"])').length - 1,
      2,
      "nur einer der beiden Zweige räumt die No-Show-Kette ab",
    );
  });

  test("E2 · ein beendeter Vorgang nimmt ALLE Kaskaden des Erstgesprächs mit", () => {
    // Das Kriterium ist hier bewusst NICHT „show_status wird zu 'show'" —
    // 'dead' rührt den Show-Status gar nicht an, und trotzdem braucht ein als
    // tot markierter Lead keine Terminfindung mehr. Maßgeblich ist, dass der
    // Vorgang beendet ist: 'unqualifiziert' und 'dead' entwerten deshalb ohne
    // Kaskadenliste, wie `cancelAppointment` es tut. Am entity_type 'setting'
    // hängen Bestätigungs-Kaskade, Mail-Spur und No-Show-Kette; keine davon
    // darf danach noch rausgehen, und eine künftige zehnte auch nicht.
    assert.match(SETTING_OUTCOME, /await supersedeTouches\("setting", input\.settingId\);/);
    // Eingegrenzt wird nur dort, wo der Vorgang WEITERGEHT: Beim No-Show löst
    // die Kette die Bestätigungs-Kaskade ab, statt sie mitzunehmen.
    assert.match(SETTING_OUTCOME, /input\.outcome === "no_show"[\s\S]*?\["setting_msg"\][\s\S]*?createNoShowTouch/);
    // Und die alte, engere Fassung ist wirklich weg — sonst stünde die
    // No-Show-Kette eines toten Leads weiter offen.
    assert.doesNotMatch(SETTING_OUTCOME, /input\.settingId, \["no_show_setting"\]/);
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

  test("M3 · ein reiner Grund-Wechsel baut die Kette nicht neu auf", () => {
    // Sonst stünden die bereits erledigten Stufen drei Wochen später wieder
    // offen da — die Erledigungs-Historie speist die „Erinnerungs-Disziplin".
    assert.match(CLOSING_OUTCOME, /if \(!correctingLoss\) await generateKeinCloseChain\(/);
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

describe("Die Vor-Termin-Kaskade folgt dem Termin und dem zurückgenommenen Ergebnis", () => {
  test("M2 + Befund 2 · ein Regenerator, zwei Anlässe", () => {
    // Befund 2: `updateClosingCall` baut die Kaskade bei geändertem `call_at`
    // neu auf, `updateSettingCall` tat das für `appointment_at` nicht — die
    // beiden Pfade liefen auseinander.
    assert.match(UPDATE_SETTING, /"appointment_at" in patch/);
    // M2: „Ergebnis zurücksetzen" dreht den Status auf 'offen'. Die Kaskade
    // wurde beim Ergebnis entwertet und käme sonst nie wieder — für ein manuell
    // angelegtes Setting gibt es den Weg „Termin speichern oder verschieben"
    // gar nicht.
    assert.match(UPDATE_SETTING, /patch\.status === "offen"/);
    // Genau EIN Aufruf: zwei Regeneratoren nebeneinander liefen beim nächsten
    // Umbau auseinander.
    assert.equal(
      UPDATE_SETTING.split("generateSettingCascade(id)").length - 1,
      1,
      "die Kaskade wird an mehr als einer Stelle neu erzeugt",
    );
  });

  test("M2 · aber nur für einen Termin, der noch bevorsteht", () => {
    // Für einen vergangenen Termin findet `planScheduledCascade` keine Stufe
    // mehr und legt EINEN sofort fälligen Touch an — eine Terminbestätigung für
    // ein Gespräch, das längst gelaufen ist.
    const helper = slice(SETTING_CALLS, "async function settingAppointmentAhead(", "\n/**");
    assert.match(helper, /cancelled_at/);
    assert.match(helper, /Date\.parse\(row\.appointment_at\) > Date\.now\(\)/);
    assert.match(UPDATE_SETTING, /settingAppointmentAhead\(id\)/);
  });
});

describe("Ein Pflichtfeld prüft, was die Folge-Logik wirklich braucht", () => {
  test("M1 · das Gate rechnet mit derselben Bedingung wie der Kanal-Auflöser", () => {
    // `resolveFollowUpChannel` verlangt Nummer UND Einwilligung — daran hat
    // sich nichts geändert. Was sich geändert hat, ist die Herkunft der
    // Einwilligung: Sie ist kein eigenes Häkchen mehr, sondern folgt der
    // Nummer (`saveWaContact` / `withWaConsentDerived`). Damit sind „Nummer
    // da" und „WhatsApp auflösbar" dasselbe, und das Gate darf genau darauf
    // prüfen. Die frühere Fassung verlangte hier zusätzlich `waConsent` — ein
    // Feld, das es in der Oberfläche nicht mehr gibt; die Prüfung wäre eine
    // Sperre ohne Ausweg.
    const gate = slice(SETTING_EDITOR, "Kontaktweg für die Closing-Erinnerungen", "function saveWaContact");
    assert.match(gate, /resolveCascadeChannel\(call\.source_type\)/);
    assert.match(SETTING_EDITOR, /import \{ resolveCascadeChannel \} from "@\/lib\/reminderCascade"/);
    // Die dokumentierte Verweigerung bleibt die Ausnahme (Entscheidung E10) —
    // ohne sie gäbe es für eine Quelle ohne Akquise-Kanal keinen Weg vorwärts.
    assert.match(gate, /const waReady = waRefused \|\| waPhoneGiven;/);
    // Die Gegenprobe zum Gate: Eine eingetragene Nummer MUSS den Beleg
    // mitbringen, sonst ginge sie wieder als erfüllte Pflicht durch, ohne
    // einen Kanal zu ergeben. Der ausführliche Test dazu (samt Gegenrichtung
    // auf `resolveFollowUpChannel`) steht in terminDetailKarten.test.ts.
    assert.match(SETTING_EDITOR, /wa_consent_at: phone \? new Date\(\)\.toISOString\(\) : null/);
    assert.match(SETTING_CALLS, /function withWaConsentDerived/);
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
