// Rückbau, Spur Einstellungen: was hier geprüft wird, ist eine ABWESENHEIT.
//
// Der Vorlagen-Editor (31 Texte, Suche, Vorschau, Ebenen-Umschalter), die
// Ansicht der 21 Kaskadenstufen und die neun Wartezeiten je Verlustgrund sind
// aus /settings entfernt. Ein Test, der das festhält, ist kein Selbstzweck:
// Diese Bausteine sind nicht durch einen Fehler entstanden, sondern durch
// Fleiß — und genau so kommen sie zurück, wenn niemand widerspricht. Die
// Versionsverwaltung ist das Archiv; diese Datei ist der Widerspruch.
//
// Geprüft wird am QUELLTEXT, dieselbe Bauart wie schreibpfadGrenzen.test.ts:
// Die Karten sind Client-Komponenten mit JSX, der Runner
// (`node --experimental-strip-types`) lädt sie nicht, und eine Attrappe bewiese
// nur, dass die Attrappe stimmt.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

function pfad(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function read(relative: string): string {
  // Zeilenenden vereinheitlichen — `core.autocrlf=true` legt die Quelldateien
  // unter Windows mit CRLF ab; Anker mit `\n` fänden sie sonst nicht.
  return readFileSync(pfad(relative), "utf8").replace(/\r\n/g, "\n");
}

const PAGE = read("src/app/(dashboard)/settings/page.tsx");
const CARD = read("src/components/settings/PipelineSettingsCard.tsx");

/* ------------------------------------------------------------------ *
 * Die entfernten Dateien
 * ------------------------------------------------------------------ */

describe("Rückbau: entfernte Dateien", () => {
  test("es gibt keinen Vorlagen-Editor und keinen Schreibpfad dazu mehr", () => {
    // „Keine Templates" ist wörtlich gemeint. Die Vorlagen-BIBLIOTHEK bleibt
    // (src/lib/messageTemplates.ts) — /nachfassen rendert die Texte weiter;
    // was fällt, ist die Oberfläche, in der man sie bearbeitet, und die beiden
    // Server-Actions dahinter.
    for (const datei of [
      "src/components/settings/MessageTemplatesCard.tsx",
      "src/app/actions/messageTemplates.ts",
    ]) {
      assert.equal(existsSync(pfad(datei)), false, `${datei} ist wieder da`);
    }
  });

  test("der Aufklapp-Baustein der Settings-Karten ist mit seinen Verwendern gegangen", () => {
    // `Collapsible` gab es nur, weil eine Karte vierzehn Zahlen und eine andere
    // 31 Texte zu verstecken hatte. Beides ist weg; eine Komponente ohne
    // Verwender sieht aus wie die geltende Konvention und wäre der nächste
    // Baustein, in den jemand wieder etwas einklappt.
    assert.equal(existsSync(pfad("src/components/settings/Collapsible.tsx")), false);
    assert.doesNotMatch(CARD, /Collapsible/);
  });
});

/* ------------------------------------------------------------------ *
 * Die Seite
 * ------------------------------------------------------------------ */

describe("Rückbau: /settings", () => {
  test("die Seite lädt weder Vorlagen noch Kaskadenstufen", () => {
    // Zwei Abfragen weniger je Aufruf. Beide Loader leben in
    // actions/reminders.ts weiter — /nachfassen und die Termin-Kaskade rufen
    // sie noch —, aber die Einstellungsseite hat für beide keinen Gegenstand
    // mehr.
    assert.doesNotMatch(PAGE, /getTemplateBundles/);
    assert.doesNotMatch(PAGE, /getCascadeSteps/);
    assert.doesNotMatch(PAGE, /MessageTemplatesCard/);
    assert.doesNotMatch(PAGE, /EMPTY_TEMPLATE_BUNDLE/);
  });

  test("die Kopfzeile verspricht keine Vorlagen mehr", () => {
    // Sie zählte auf, was die Seite trägt. „Vorlagen" stünde dort als einziger
    // Punkt ohne Karte darunter.
    assert.doesNotMatch(PAGE, /meta="[^"]*Vorlagen/);
  });

  test("die vier tragenden Karten stehen weiter", () => {
    // Nutzerverwaltung und Leistungsziele sind vom Rückbau ausdrücklich
    // ausgenommen; der Workspace-Block ist die Identität der Organisation.
    for (const anker of [">Workspace<", ">Team<", ">Ziele<", "PipelineSettingsCard"]) {
      assert.ok(PAGE.includes(anker), `${anker} fehlt in /settings`);
    }
  });

  test("das Owner-Gate der Pipeline bleibt strenger als das der Nutzerverwaltung", () => {
    // role='owner' allein reicht nicht: Die beiden Zahlen gelten team-weit,
    // deshalb wörtlich dasselbe Prädikat wie can_manage_org_settings() in der
    // RLS. Ohne den zweiten Teil dürfte ein Owner mit eingeschränkter
    // Datensicht die Recycling-Frist des ganzen Teams stellen.
    assert.match(
      PAGE,
      /const canManageOrgSettings = access\.role === "owner" && access\.data_scope === "workspace"/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Die Pipeline-Karte
 * ------------------------------------------------------------------ */

describe("Rückbau: PipelineSettingsCard", () => {
  test("das Verschiebe-Kontingent bleibt — es ist die eine Zahl, die zählt", () => {
    // Kein Kaskaden- und kein Recycling-Feld: `max_reschedules` trennt „liegt
    // in der Luft" von „ist versorgt" und ist damit genau die Unterscheidung,
    // auf der die neue Arbeitsliste steht.
    assert.match(CARD, /"max_reschedules"/);
    assert.match(CARD, /Verschiebungen je Termin/);
  });

  test("die Kaskadenstufen werden nicht mehr angezeigt", () => {
    // 21 Stufen in neun Kaskaden, nur lesbar — eine Erklärung dafür, welcher
    // Text wann greift. Ohne Kaskaden gibt es nichts zu erklären.
    assert.doesNotMatch(CARD, /cascadeEngine/);
    assert.doesNotMatch(CARD, /CASCADE_KIND_LABELS/);
    assert.doesNotMatch(CARD, /Erinnerungs-Stufen/);
  });

  test("es gibt kein Feld je Verlustgrund und keinen Versuchs-Deckel mehr", () => {
    // Neun Wartezeiten, deren Unterschied zueinander niemand begründen kann,
    // plus ein Deckel — das war die Bedienoberfläche zu einem Regelwerk für
    // zwanzig Setter.
    assert.doesNotMatch(CARD, /LOST_REASON_FIELDS/);
    assert.doesNotMatch(CARD, /Feinstaffelung/);
    assert.doesNotMatch(CARD, /max_attempts/);
    // Und kein Erinnerungs-Horizont: Die Seite, die er steuerte, gibt es nicht
    // mehr.
    assert.doesNotMatch(CARD, /reminder_horizon_days/);
  });

  test("die eine Frist schreibt JEDE Wartezeit-Spalte — sonst wäre sie eine Behauptung", () => {
    // Der Kern des flachen Recyclings, und die Stelle, an der es lautlos
    // zurückfallen würde: `schedule_recycle()` (Migration 0033, eingefroren)
    // sucht sich je Ursprung und Verlustgrund EINE dieser Spalten aus. Schriebe
    // das Feld nur eine davon, gälte für drei der vier Ursprünge und für jeden
    // Closing-Verlustgrund weiter die alte Staffelung — sichtbar nirgends.
    //
    // Geprüft wird gegen den Typ `PipelineSettings` statt gegen eine
    // abgeschriebene Liste: Kommt je eine Wartezeit-Spalte dazu, schlägt dieser
    // Test an, statt dass sie still aus der einen Frist herausfällt.
    const typ = read("src/app/actions/reminders.ts");
    const block = typ.slice(
      typ.indexOf("export type PipelineSettings = {"),
      typ.indexOf("};", typ.indexOf("export type PipelineSettings = {")),
    );
    const spalten = [...block.matchAll(/^\s*(days_[a-z_]+):/gm)].map((m) => m[1]);
    assert.ok(spalten.length >= 14, `nur ${spalten.length} Wartezeit-Spalten gefunden`);

    const liste = CARD.slice(CARD.indexOf("const RECYCLE_COLUMNS"), CARD.indexOf("];", CARD.indexOf("const RECYCLE_COLUMNS")));
    for (const spalte of spalten) {
      assert.ok(liste.includes(`"${spalte}"`), `${spalte} fehlt in RECYCLE_COLUMNS`);
    }
  });

  test("angezeigt wird die längste bisherige Wartezeit, nicht die kürzeste", () => {
    // Solange die alte Staffelung noch in der Datenbank steht, ist die Anzeige
    // eine Vorbelegung — und die kürzeste Frist auf alles anzuwenden hieße, den
    // gesamten toten Bestand auf einmal wieder in die Arbeitsliste zu spülen.
    assert.match(CARD, /const laengste = Math\.max\(\.\.\.gespeichert\)/);
    assert.match(CARD, /value=\{laengste\}/);
  });
});
