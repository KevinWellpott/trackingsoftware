// Die Detailseiten von Erstgespräch und Closing nach dem Aufräumen.
//
// Drei Regeln, die alle drei die Eigenschaft haben, beim nächsten Umbau
// lautlos zu verschwinden — genau dafür stehen die Tests hier:
//
//  1. Auf dem Bildschirm heißt es „Erinnerungen", nicht „Kaskade". Das Wort
//     stammt aus dem Datenmodell; in den Kommentaren und den internen
//     Bezeichnern bleibt es deshalb stehen, in der Oberfläche nicht.
//  2. Ein Knopf, der im aktuellen Zustand nichts bewirken kann, wird
//     WEGGELASSEN statt ausgegraut (Muster AblageBoard.tsx).
//  3. Die WhatsApp-Einwilligung ist kein Feld mehr, sondern eine Ableitung aus
//     der Nummer. Das ist der gefährlichste der drei Punkte: Fällt die
//     Ableitung weg, liefert `resolveFollowUpChannel` nie wieder „whatsapp",
//     und die ganze Spur schaltet sich lautlos ab, ohne dass irgendwo ein
//     Fehler entsteht. Der erste Block unten ist deshalb ein echter
//     Funktionstest MIT Gegenprobe, kein Quelltext-Abgleich.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { resolveFollowUpChannel } from "@/lib/reminderCascade";

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Quelltext ohne Kommentare. „Kaskade" ist ein Wort aus dem Datenmodell und
 * darf in den Kommentaren stehen bleiben — nur eben nicht auf dem Bildschirm.
 * Ein Test über die ganze Datei würde genau das verbieten und wäre damit
 * strenger als die Regel.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const CASCADE_PANEL = read("src/components/termine/CascadePanel.tsx");
const SETTING_EDITOR = read("src/components/scripts/SettingCallEditor.tsx");
const CLOSING_EDITOR = read("src/components/closing/ClosingCallEditor.tsx");
const SETTING_ACTIONS = read("src/app/actions/settingCalls.ts");

/* ------------------------------------------------------------------ *
 * 1. WhatsApp — der Kanal muss weiterhin aufgelöst werden
 * ------------------------------------------------------------------ */

describe("resolveFollowUpChannel — die Spur bleibt an", () => {
  test("Gegenrichtung: mit Nummer UND Stempel entsteht WhatsApp", () => {
    // Das ist der Fall, den der Umbau erzeugen MUSS. Ohne diesen Test wäre die
    // WhatsApp-Spur bei der nächsten Änderung abschaltbar, ohne dass es
    // auffällt — sie fällt still auf den Akquise-Kanal zurück.
    assert.equal(
      resolveFollowUpChannel({
        wa_phone: "+49 170 1234567",
        wa_consent_at: "2026-09-10T08:00:00.000Z",
        source_type: "linkedin",
      }),
      "whatsapp",
    );
    // Auch bei einer Quelle OHNE Akquise-Kanal — dort ist WhatsApp der einzige
    // Weg, den es überhaupt gibt.
    assert.equal(
      resolveFollowUpChannel({
        wa_phone: "+49 170 1234567",
        wa_consent_at: "2026-09-10T08:00:00.000Z",
        source_type: "ads",
      }),
      "whatsapp",
    );
  });

  test("Gegenprobe: Nummer ohne Stempel ergibt KEIN WhatsApp", () => {
    // Der Auflöser bleibt bewusst unverändert — genau deshalb muss der
    // Schreibpfad stempeln. Diese beiden Zeilen sind die Begründung dafür,
    // dass `withWaConsentDerived` existiert.
    assert.equal(
      resolveFollowUpChannel({ wa_phone: "+49 170 1234567", wa_consent_at: null, source_type: "linkedin" }),
      "linkedin",
    );
    assert.equal(
      resolveFollowUpChannel({ wa_phone: "+49 170 1234567", wa_consent_at: null, source_type: "ads" }),
      null,
    );
  });

  test("ohne Nummer bleibt es beim Akquise-Kanal", () => {
    assert.equal(resolveFollowUpChannel({ wa_phone: null, wa_consent_at: null, source_type: "telefon" }), "telefon");
    assert.equal(resolveFollowUpChannel({ wa_phone: "   ", wa_consent_at: null, source_type: "telefon" }), "telefon");
  });
});

describe("Der Schreibpfad stempelt die Einwilligung aus der Nummer", () => {
  test("die Server-Action leitet ab — nicht nur der Editor", () => {
    // Eine Server Action ist per direktem POST erreichbar; säße die Ableitung
    // nur im Client, käme ein Patch mit Nummer und ohne Stempel durch.
    assert.match(SETTING_ACTIONS, /function withWaConsentDerived/);
    assert.match(SETTING_ACTIONS, /withWaConsentDerived\(withNoShowResolutionCleared\(patch\)\)/);
  });

  test("beide CHECKs aus 0032 sind strukturell erfüllt", () => {
    const body = SETTING_ACTIONS.slice(
      SETTING_ACTIONS.indexOf("function withWaConsentDerived"),
      SETTING_ACTIONS.indexOf("async function canAccessAppointment"),
    );
    // `wa_consent_at` nur MIT Nummer — und eine geleerte Nummer nimmt ihren
    // Beleg mit, sonst wiese Postgres das ganze UPDATE ab.
    assert.match(body, /wa_consent_at: phone \? \(patch\.wa_consent_at \?\? new Date\(\)\.toISOString\(\)\) : null/);
  });

  test("der Editor schreibt Nummer und Stempel immer gemeinsam", () => {
    // Zwei Schreibpfade im Editor: die Karte (`saveWaContact`) und das
    // Closing-Modal (`handleCreateClosing`). Beide leiten gleich ab.
    assert.match(SETTING_EDITOR, /wa_consent_at: phone \? new Date\(\)\.toISOString\(\) : null/);
    assert.match(SETTING_EDITOR, /wa_consent_at: waPhone\.trim\(\) \? new Date\(\)\.toISOString\(\) : null/);
    // Die Verweigerung räumt die Nummer mit ab — `wa_refused_at` darf laut
    // CHECK nur OHNE Nummer stehen.
    assert.match(SETTING_EDITOR, /wa_phone: null, wa_consent_at: null, wa_refused_at: new Date\(\)\.toISOString\(\)/);
  });
});

describe("Die Einwilligung ist aus der Oberfläche verschwunden", () => {
  test("kein Einwilligungs-Feld und kein Zustand dafür", () => {
    assert.equal(SETTING_EDITOR.includes("Einwilligung zur WhatsApp-Kontaktierung"), false);
    // `waConsent` war der State hinter dem Häkchen. Bliebe er stehen, wäre die
    // Ableitung nur die halbe Wahrheit.
    assert.equal(/\bwaConsent\b/.test(SETTING_EDITOR), false);
    assert.equal(/setWaConsent/.test(SETTING_EDITOR), false);
  });

  test("die Verweigerung bleibt — an beiden Stellen", () => {
    // Karte im Editor UND Closing-Modal: In beiden muss die Ausnahme
    // erfassbar sein, sonst sperrt das Gate ohne Ausweg.
    const treffer = SETTING_EDITOR.split("Will keine Nummer rausgeben").length - 1;
    assert.ok(treffer >= 2, `„Will keine Nummer rausgeben" steht ${treffer}× im Editor, erwartet mindestens 2×`);
  });

  test("das Pflichtfeld-Gate prüft nur noch Nummer oder Verweigerung", () => {
    assert.match(SETTING_EDITOR, /const waReady = waRefused \|\| waPhoneGiven;/);
  });
});

/* ------------------------------------------------------------------ *
 * 2. „Erinnerungen" statt „Kaskade" — und die Karte klappt zu
 * ------------------------------------------------------------------ */

describe("Die Erinnerungs-Karte des Termins", () => {
  test("heißt auf dem Bildschirm „Erinnerungen“", () => {
    assert.match(CASCADE_PANEL, /<span style=\{SECTION_TITLE\}>Erinnerungen<\/span>/);
    // Kein „Kaskade" mehr außerhalb der Kommentare — weder als Titel noch in
    // einem Erklärsatz, einem Leerzustand oder einem Tooltip.
    assert.equal(withoutComments(CASCADE_PANEL).includes("Kaskade"), false);
    assert.equal(withoutComments(SETTING_EDITOR).includes("Kaskade"), false);
    assert.equal(withoutComments(CLOSING_EDITOR).includes("Kaskade"), false);
  });

  test("startet zugeklappt und benutzt das vorhandene Karten-Rezept", () => {
    // `<details>` OHNE `open` = zu. Ein `open`-Attribut hier wäre der ganze
    // Unterschied zwischen „zugeklappt" und „aufgeklappt".
    assert.match(CASCADE_PANEL, /<details className="card">/);
    assert.equal(CASCADE_PANEL.includes('<details className="card" open'), false);
    // Dasselbe Rezept wie die „Call-Details" im Closing-Editor (globals.css
    // §6.10) — ein zweiter Aufklapp-Mechanismus auf derselben Seite sähe aus
    // wie ein anderes Bedienelement.
    assert.match(CASCADE_PANEL, /className="collapse-summary"/);
    assert.match(CASCADE_PANEL, /className="collapse-chevron"/);
    assert.match(CLOSING_EDITOR, /className="collapse-summary"/);
  });

  test("der zugeklappte Kopf trägt Anzahl, Fälligkeit und Überfälligkeit", () => {
    // Ohne diese drei Angaben zwingt die Aufklappung zum Öffnen und hat nichts
    // gewonnen.
    assert.match(CASCADE_PANEL, /\$\{pending\.length\} offen · nächste \$\{whenLabel\(nextDue\)\}/);
    assert.match(CASCADE_PANEL, /\$\{overdueCount\} überfällig seit \$\{whenLabel\(nextDue\)\}/);
    assert.match(CASCADE_PANEL, /Keine offene Erinnerung/);
    // Überfälliges muss am zugeklappten Kopf ERKENNBAR sein, nicht nur
    // benannt: Farbe plus Zeichen.
    assert.match(CASCADE_PANEL, /overdueCount > 0 && <AlertTriangle/);
    assert.match(CASCADE_PANEL, /color: overdueCount > 0 \? "var\(--danger-fg\)" : undefined/);
  });

  test("Fehler und fehlende Migration bleiben sichtbar", () => {
    // Beide Zustände behalten die statische Karte — eine Fehlermeldung hinter
    // einem Pfeil ist keine.
    assert.match(CASCADE_PANEL, /Die Erinnerungen konnten nicht geladen werden\./);
    assert.match(CASCADE_PANEL, /Die Tabellen für die Erinnerungen fehlen in der Datenbank/);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Die Kopfkarte: Gewichtung statt Kette
 * ------------------------------------------------------------------ */

describe("Kopfkarte von Erstgespräch und Closing", () => {
  test("zwei Reihen: das Gespräch oben, die Ausnahmen darunter", () => {
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      assert.match(source, /Reihe 1: das Gespräch/, name);
      assert.match(source, /Reihe 2: Termin & Korrektur/, name);
      // Die Trennlinie ist das, was die beiden Ränge überhaupt sichtbar macht.
      assert.match(source, /borderTop: "1px solid var\(--border-subtle\)"/, name);
    }
  });

  test("die eingreifenden Aktionen stehen NACH den alltäglichen", () => {
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      const reihe1 = source.indexOf("Reihe 1: das Gespräch");
      const reihe2 = source.indexOf("Reihe 2: Termin & Korrektur");
      const lifecycle = source.indexOf("<AppointmentLifecycleBar");
      const reset = source.indexOf("/> Zurücksetzen");
      assert.ok(reihe1 < reihe2, name);
      // Verschieben/Absagen (Lebenszyklus-Leiste) und Zurücksetzen liegen
      // beide unterhalb der Trennlinie.
      assert.ok(lifecycle > reihe2, `${name}: Lebenszyklus-Leiste steht nicht in Reihe 2`);
      assert.ok(reset > reihe2, `${name}: „Zurücksetzen" steht nicht in Reihe 2`);
    }
  });

  test("„Zurücksetzen“ fehlt, solange es nichts zurückzusetzen gibt", () => {
    // Muster AblageBoard.tsx: weglassen statt ausgrauen. Ein toter Knopf auf
    // JEDEM frisch angelegten Termin ist schlechter als keiner.
    for (const [name, source] of [
      ["SettingCallEditor", SETTING_EDITOR],
      ["ClosingCallEditor", CLOSING_EDITOR],
    ] as const) {
      assert.match(source, /const hasResult =/, name);
      assert.match(source, /\{hasResult && \(/, name);
    }
    // Im Erstgespräch bleibt genau EIN gesperrter Fall stehen: Bei angelegtem
    // Closing GÄBE es etwas zurückzusetzen, es ist nur nicht erlaubt — diese
    // Absage muss lesbar sein, ein verschwundener Knopf ließe danach suchen.
    assert.match(SETTING_EDITOR, /disabled=\{isPending \|\| status === "closing_gelegt"\}/);
  });
});
